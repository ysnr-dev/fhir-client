import { toFhirDateTime } from "../lib/dates";
import type { OrderContext } from "../orderContext";
import {
  collectionPlanEntries,
  parseCollectionPlan,
  type CollectionPlanLine,
} from "./autologousPlanHelpers";
import { orderProblem, type ProblemRef } from "./conditionHelpers";
import { labOrderItemRequests } from "./labOrderHelpers";
import { ORDER_TYPE_SYSTEM, applyOrderContext } from "./orderHeader";
import {
  SETTING_OPTIONS,
  SETTING_SYSTEM,
  codingBySystem,
  type PrescriptionSetting,
} from "./prescriptionHelpers";
import {
  categoryCoding,
  displayOf,
  itemNumber,
  orderComment,
  registrationAuthoredOn,
  withVersionLock,
} from "./shared";
import { keepOrderRevoked } from "./taskHelpers";

// 輸血オーダー。病理検査と同じくヘッダは ServiceRequest で、その下に製剤を並べる。
//
//   ヘッダ ← basedOn ── 製剤明細 ×N(code = 製剤、quantityQuantity = 単位数)
//
// 明細を独立した ServiceRequest にするのは、製剤ごとに単位数(量)が付くため。
// 食事のように orderDetail(CodeableConcept)に載せると数量を持てず拡張が要るが、
// 明細を ServiceRequest にすれば R4 標準の quantityQuantity にそのまま置ける
// (docs/transfusion-order-design.md §2.1)。
//
// ヘッダの載せ方:
// - 輸血検査区分(T&S / 交差適合試験)は code。病理の検査区分と同じ位置づけで、
//   1 オーダーに 1 つだけ選び、部門一覧の絞り込み軸にもなる。
// - authoredOn は登録日時、投与予定日時は occurrenceDateTime(全種別共通の意味。fhir/shared.ts)。
//   occurrence が部門一覧の日付軸とカルテカードの置き場所を兼ねる(上流は occurrenceDateTime
//   しか索引しないので Period は使わない)。
//   実際に投与した時間帯は実施記録の Procedure.performedPeriod で持つ。
// - 緊急度は priority。危機的出血の 3 段階(準備時間 10 / 30 / 60 分)を stat / asap / urgent に
//   当て、緊急でない依頼は routine。
// - 使用場所は locationReference(病棟・手術室・救急など)、使用目的は reasonCode.text。
// - 輸血同意書の確認済フラグはローカル拡張。臨床病名は他オーダーと同じく登録病名
//   からの参照(reasonReference)。
//
// 血液型は 2 か所に載せる(docs/transfusion-order-design.md §2.5)。
// - ヘッダの拡張 = **オーダー時点の患者の血液型**。検査で確定した型だけを写し、確定して
//   いなければ「不明」を明示する(空欄と区別する)。医師は手で入れない。
// - 明細の拡張 = **その製剤を何型で出すか**。患者の型・製剤区分・緊急度から既定を決め、
//   適合する型だけを選ばせる(危機的出血で型が不明なら赤血球は O、血漿・血小板は AB)。
// 検体検査の結果(ABO/RhD/不規則抗体)は画面に参照として並べるだけで、そちらへの
// 参照は保存しない。正本は検査結果側にあり、オーダーに焼き付けると結果の修正・削除
// との整合をオーダー側で面倒みることになるため。

/** 処方・注射・検体検査などの ServiceRequest と区別するオーダー種別。 */
export const TRANSFUSION_ORDER_TYPE = { code: "transfusion", display: "輸血" };

/** ヘッダの code。輸血部門の作業が変わる軸(T&S か交差適合試験か)。 */
export const TEST_TYPE_SYSTEM = "http://fhir-client.local/CodeSystem/transfusion-test-type";

/** 明細の code。製剤マスタ(master_transfusion_products)の独自コード。 */
export const PRODUCT_SYSTEM = "http://fhir-client.local/CodeSystem/transfusion-product";

/** 輸血同意書の確認済フラグ。手術の同意書欄と対応する。 */
const CONSENT_EXT_URL = "http://fhir-client.local/StructureDefinition/transfusion-consent";

/** ABO 血液型 / RhD 血液型。オーダーに載せる「何型を出すか」。 */
export const ABO_SYSTEM = "http://fhir-client.local/CodeSystem/transfusion-abo";
export const RHD_SYSTEM = "http://fhir-client.local/CodeSystem/transfusion-rhd";

// ABO と RhD を 1 つの拡張にまとめず分けるのは、検査としても別項目(LOINC も別)で、
// 「ABO は分かっているが RhD はこれから」という状態がありうるため。
const ABO_EXT_URL = "http://fhir-client.local/StructureDefinition/transfusion-abo";
const RHD_EXT_URL = "http://fhir-client.local/StructureDefinition/transfusion-rhd";

/** 明細の並び順 = 画面で並べた順。 */
const ITEM_NUMBER_SYSTEM = "http://fhir-client.local/IdSystem/transfusion-order-item-number";

/**
 * 緊急度。危機的出血への対応(JAHIS 患者安全ガイド 輸血編 付録 1-3)の 3 段階を FHIR の
 * priority に当てる。レベルⅠ = 心停止が切迫(準備 10 分、交差試験なしで払出)、
 * レベルⅡ = 昇圧剤が要る(30 分、生食法)、レベルⅢ = 出血しているが循環は安定(60 分)。
 */
export type TransfusionOrderPriority = "routine" | "urgent" | "asap" | "stat";

export const TRANSFUSION_PRIORITY_OPTIONS: {
  code: TransfusionOrderPriority;
  display: string;
  /** 緊急度のレベル。0 = 緊急でない。 */
  level: 0 | 1 | 2 | 3;
}[] = [
  { code: "routine", display: "通常", level: 0 },
  { code: "urgent", display: "レベルⅢ(準備 60 分)", level: 3 },
  { code: "asap", display: "レベルⅡ(準備 30 分)", level: 2 },
  { code: "stat", display: "レベルⅠ(準備 10 分)", level: 1 },
];

export function transfusionPriorityDisplay(code: string | undefined): string {
  return displayOf(TRANSFUSION_PRIORITY_OPTIONS, code);
}

/** 緊急度のレベル(1〜3)。緊急でなければ 0。 */
export function urgencyLevelOf(priority: string | undefined): 0 | 1 | 2 | 3 {
  return TRANSFUSION_PRIORITY_OPTIONS.find((o) => o.code === priority)?.level ?? 0;
}

const LEVEL_NUMERALS = ["", "Ⅰ", "Ⅱ", "Ⅲ"] as const;

/** バッジ用の短い表記(「緊急Ⅰ」)。緊急でなければ空。 */
export function urgencyBadgeLabel(priority: string | undefined): string {
  const level = urgencyLevelOf(priority);
  return level ? `緊急${LEVEL_NUMERALS[level]}` : "";
}

/**
 * 輸血検査区分。
 *
 * type-screen         … T&S(タイプ&スクリーン)。血液型と不規則抗体だけ先に調べておき、
 *                       実際に出すときは省略法で適合を確認する。輸血する確率が低い待機手術など。
 * crossmatch          … 交差適合試験。製剤を指定して患者血と実際に混ぜる。実際に輸血する前提。
 * computer-crossmatch … コンピュータクロスマッチ。製剤の型を自施設で確認してあり、患者の型が
 *                       2 回確定・不規則抗体陰性なら試験管の試験を省く。
 * saline-crossmatch   … 生食法。危機的出血のレベルⅡで、主試験を生食法だけで行う。
 * no-crossmatch       … 交差試験なし。危機的出血のレベルⅠで、適合血を用意する時間が無い。
 */
export type TransfusionTestType =
  | "type-screen"
  | "crossmatch"
  | "computer-crossmatch"
  | "saline-crossmatch"
  | "no-crossmatch";

export const TEST_TYPE_OPTIONS: { code: TransfusionTestType; display: string }[] = [
  { code: "crossmatch", display: "交差適合試験" },
  { code: "type-screen", display: "T&S(タイプ&スクリーン)" },
  { code: "computer-crossmatch", display: "コンピュータクロスマッチ" },
  { code: "saline-crossmatch", display: "生食法" },
  { code: "no-crossmatch", display: "交差試験なし" },
];

/** 出庫時に交差適合試験の結果が要る検査区分か(T&S と交差試験なしは要らない)。 */
export function crossmatchRequiredFor(testType: string): boolean {
  return testType === "crossmatch" || testType === "computer-crossmatch" || testType === "saline-crossmatch";
}

export function testTypeDisplay(code: string): string {
  return displayOf(TEST_TYPE_OPTIONS, code);
}

/** ABO 血液型。日本赤十字社の製剤ラベルと同じ 4 区分。 */
export type AboBloodType = "A" | "B" | "O" | "AB";

export const ABO_OPTIONS: { code: AboBloodType; display: string }[] = [
  { code: "A", display: "A" },
  { code: "B", display: "B" },
  { code: "O", display: "O" },
  { code: "AB", display: "AB" },
];

/** RhD 血液型。陽性・陰性の 2 択。 */
export type RhdBloodType = "positive" | "negative";

export const RHD_OPTIONS: { code: RhdBloodType; display: string }[] = [
  { code: "positive", display: "＋" },
  { code: "negative", display: "－" },
];

export function rhdDisplay(code: string): string {
  return displayOf(RHD_OPTIONS, code);
}

/**
 * 患者の血液型が確定していないことを明示する値。ヘッダの拡張にだけ使う
 * (空欄 = 書いていない、と区別するため。危機的出血の依頼で「不明」は依頼の中身そのもの)。
 */
export const UNKNOWN_BLOOD_TYPE = "unknown";
export type PatientAboBloodType = AboBloodType | typeof UNKNOWN_BLOOD_TYPE;
export type PatientRhdBloodType = RhdBloodType | typeof UNKNOWN_BLOOD_TYPE;

/** 「A型 RhD＋」の 1 行表示。カード・詳細で使う(未選択なら空)。不明は「不明」。 */
export function bloodTypeLabel(abo: string, rhd: string): string {
  if (!abo && !rhd) return "";
  if (abo === UNKNOWN_BLOOD_TYPE) return "不明";
  return [abo && `${abo}型`, rhd && rhd !== UNKNOWN_BLOOD_TYPE && `RhD${rhdDisplay(rhd)}`]
    .filter(Boolean)
    .join(" ");
}

// ---- 製剤の血液型の適合 ----

/** 製剤区分(製剤マスタの category)。 */
export type TransfusionProductCategory = "rbc" | "ffp" | "plt" | "auto" | "other";

/** 患者の型から決まる、製剤として出せる ABO。赤血球は抗原で、血漿・血小板は抗体で適合が決まる。 */
const RBC_COMPATIBLE: Record<AboBloodType, AboBloodType[]> = {
  A: ["A", "O"],
  B: ["B", "O"],
  AB: ["AB", "A", "B", "O"],
  O: ["O"],
};
const PLASMA_COMPATIBLE: Record<AboBloodType, AboBloodType[]> = {
  A: ["A", "AB"],
  B: ["B", "AB"],
  AB: ["AB"],
  O: ["O", "A", "B", "AB"],
};

/** 患者の型が確定していないときに出す型(危機的出血の指針: 赤血球は O、血漿・血小板は AB)。 */
const UNKNOWN_DEFAULT_ABO: Partial<Record<TransfusionProductCategory, AboBloodType>> = {
  rbc: "O",
  ffp: "AB",
  plt: "AB",
};

export interface PatientBloodTypeForOrder {
  /** 検査で確定した ABO。確定していなければ空。 */
  abo: AboBloodType | "";
  rhd: RhdBloodType | "";
  /**
   * 造血幹細胞移植後に輸血に使う型(fhir/transfusionProfileHelpers.ts)。ABO 不適合移植の
   * 前後で患者の型が変わるので、赤血球と血漿・血小板で別に持ち、あれば患者の型より優先する。
   */
  transplant?: {
    rbc: { abo: AboBloodType | ""; rhd: RhdBloodType | "" };
    plasma: { abo: AboBloodType | ""; rhd: RhdBloodType | "" };
  };
}

/** 製剤区分に対して突き合わせる患者の型。移植後の指定があればそれ、無ければ患者の型。 */
export function patientTypeForCategory(
  patient: PatientBloodTypeForOrder,
  category: string | undefined,
): { abo: AboBloodType | ""; rhd: RhdBloodType | "" } {
  if (!patient.transplant) return { abo: patient.abo, rhd: patient.rhd };
  const override =
    category === "rbc" ? patient.transplant.rbc : category === "ffp" || category === "plt" ? patient.transplant.plasma : null;
  return override?.abo ? override : { abo: patient.abo, rhd: patient.rhd };
}

/** 製剤区分に血液型の指定が要るか。アルブミンなどの「その他」には要らない。 */
export function productNeedsBloodType(category: string | undefined): boolean {
  return category !== "other";
}

/**
 * その製剤で選べる ABO。患者の型が確定していなければ、赤血球は O、血漿・血小板は AB だけ
 * (指針の異型適合血)。自己血は本人の型だけ。区分が分からない製剤(マスタから消えたもの)は
 * 制限しない。
 */
export function compatibleAbo(
  patient: PatientBloodTypeForOrder,
  category: string | undefined,
): AboBloodType[] {
  const all = ABO_OPTIONS.map((o) => o.code);
  if (!productNeedsBloodType(category)) return all;
  const type = patientTypeForCategory(patient, category);
  if (!type.abo) {
    const fallback = UNKNOWN_DEFAULT_ABO[category as TransfusionProductCategory];
    return fallback ? [fallback] : all;
  }
  switch (category) {
    case "rbc":
      return RBC_COMPATIBLE[type.abo];
    case "ffp":
    case "plt":
      return PLASMA_COMPATIBLE[type.abo];
    case "auto":
      return [type.abo];
    default:
      return all;
  }
}

/**
 * その製剤で選べる RhD。陰性の患者には陰性だけ(レベルⅠの危機的出血では陽性も可)。
 * 血漿は RhD を問わない。型が確定していなければ両方(既定は陽性。在庫のある型で出す)。
 */
export function compatibleRhd(
  patient: PatientBloodTypeForOrder,
  category: string | undefined,
  level: number,
): RhdBloodType[] {
  const all = RHD_OPTIONS.map((o) => o.code);
  if (!productNeedsBloodType(category) || category === "ffp") return all;
  if (patientTypeForCategory(patient, category).rhd === "negative" && level !== 1) return ["negative"];
  return all;
}

/**
 * 製剤の血液型の既定。患者の型が確定していれば同じ型、していなければ指針の異型適合血。
 * 選べる型に入らないときは空(医師に選ばせる)。
 */
export function defaultProductBloodType(
  patient: PatientBloodTypeForOrder,
  category: string | undefined,
  level: number,
): { abo: AboBloodType | ""; rhd: RhdBloodType | "" } {
  if (!productNeedsBloodType(category)) return { abo: "", rhd: "" };
  const type = patientTypeForCategory(patient, category);
  const abos = compatibleAbo(patient, category);
  const rhds = compatibleRhd(patient, category, level);
  const abo = type.abo && abos.includes(type.abo) ? type.abo : abos.length === 1 ? abos[0] : "";
  const rhd = type.rhd && rhds.includes(type.rhd) ? type.rhd : rhds.includes("positive") ? "positive" : (rhds[0] ?? "");
  return { abo, rhd };
}

/** 製剤の型が患者の型と違う(異型適合)。取り違えではなく意図した選択だが、カードで印を付ける。 */
export function isDifferentFromPatient(
  product: { abo: string; rhd: string },
  patient: { abo: string; rhd: string },
): boolean {
  if (!patient.abo || patient.abo === UNKNOWN_BLOOD_TYPE) return false;
  return Boolean(product.abo) && product.abo !== patient.abo;
}

// ---- フォームの値 ----

/** 製剤明細 1 行。製剤マスタから選び、単位数を入れる。 */
export interface TransfusionProductValues {
  /** 保存済み明細の ServiceRequest id。新規行は空。 */
  id: string;
  /** 製剤コード(master_transfusion_products.item_code)。 */
  productCode: string;
  productName: string;
  /** 略称。カード・一覧の狭い場所で使うのでオーダーにも写しておく。 */
  abbreviation: string;
  /** 単位数。入力欄で扱うので文字列で持つ。 */
  units: string;
  /** 単位の呼び方(単位 / mL / 本)。製剤マスタから写す。 */
  unitLabel: string;
  /** この製剤を出す ABO 血液型。区分「その他」は空。 */
  abo: AboBloodType | "";
  rhd: RhdBloodType | "";
  note: string;
}

export interface TransfusionOrderFormValues {
  setting: PrescriptionSetting;
  priority: TransfusionOrderPriority;
  testType: TransfusionTestType;
  /**
   * オーダー時点の患者の血液型。検査で確定した型を写し、確定していなければ「不明」。
   * 画面では入力させず、患者の血液型(fhir/bloodTypeHelpers.ts)から入れる。
   */
  patientAbo: PatientAboBloodType | "";
  patientRhd: PatientRhdBloodType | "";
  /** 投与予定日時。datetime-local の入力形式(YYYY-MM-DDTHH:mm)。 */
  scheduledDateTime: string;
  /** 使用場所(Location.id)。病棟・手術室・救急など、製剤を届ける先。 */
  locationId: string;
  locationName: string;
  /** 使用目的(術中出血、貧血 など)。 */
  purpose: string;
  /** 輸血同意書を確認済か。 */
  consentConfirmed: boolean;
  comment: string;
  problem: ProblemRef | null;
  products: TransfusionProductValues[];
  /** 自己血の採血予定(fhir/autologousPlanHelpers.ts)。自己血の製剤を含むときだけ使う。 */
  collections: CollectionPlanLine[];
}

export function emptyTransfusionProduct(): TransfusionProductValues {
  return {
    id: "",
    productCode: "",
    productName: "",
    abbreviation: "",
    units: "",
    unitLabel: "単位",
    abo: "",
    rhd: "",
    note: "",
  };
}

export function emptyTransfusionOrderForm(
  setting: PrescriptionSetting,
): TransfusionOrderFormValues {
  return {
    setting,
    priority: "routine",
    testType: "crossmatch",
    patientAbo: "",
    patientRhd: "",
    scheduledDateTime: "",
    locationId: "",
    locationName: "",
    purpose: "",
    consentConfirmed: false,
    comment: "",
    problem: null,
    products: [emptyTransfusionProduct()],
    collections: [],
  };
}

/**
 * 「赤血球液-LR「日赤」2単位 / 2単位」の 1 行表示。カード・一覧で使う。
 *
 * 製剤名には「2単位」のように規格が入っていることが多く、そのうしろに使用量を
 * 空白だけで続けると「2単位 2単位」と読めてしまう。区切り文字を挟んで、
 * 名称の一部ではなくオーダーした量だと分かるようにする(実施記録の bagLabel も同じ)。
 */
export function productLabel(product: TransfusionProductValues): string {
  const name = product.abbreviation || product.productName;
  if (!name) return "";
  const amount = product.units ? `${name} / ${product.units}${product.unitLabel}` : name;
  const type = bloodTypeLabel(product.abo, product.rhd);
  return type ? `${amount} ${type}` : amount;
}

/** 製剤を 1 行に並べたラベル(「RBC-LR / 2単位, FFP-LR / 4単位」)。 */
export function productSummary(products: TransfusionProductValues[]): string {
  return products.map(productLabel).filter(Boolean).join(", ");
}

// ---- FHIR リソースの組み立て ----

/** ServiceRequest が輸血オーダーかどうか。他オーダーとの振り分けに使う。 */
export function isTransfusionServiceRequest(sr: fhir4.ServiceRequest): boolean {
  return (sr.category ?? []).some((category) =>
    category.coding?.some(
      (c) => c.system === ORDER_TYPE_SYSTEM && c.code === TRANSFUSION_ORDER_TYPE.code,
    ),
  );
}

/** ABO / RhD の拡張。ヘッダ(患者の型)・明細(製剤の型)・出庫のバッグで同じ形。 */
export function bloodTypeExtensions(abo: string, rhd: string): fhir4.Extension[] {
  const extension: fhir4.Extension[] = [];
  if (abo) {
    const display = abo === UNKNOWN_BLOOD_TYPE ? "不明" : abo;
    extension.push({
      url: ABO_EXT_URL,
      valueCodeableConcept: {
        coding: [{ system: ABO_SYSTEM, code: abo, display }],
        text: abo === UNKNOWN_BLOOD_TYPE ? "不明" : `${abo}型`,
      },
    });
  }
  if (rhd) {
    const display = rhd === UNKNOWN_BLOOD_TYPE ? "不明" : rhdDisplay(rhd);
    extension.push({
      url: RHD_EXT_URL,
      valueCodeableConcept: {
        coding: [{ system: RHD_SYSTEM, code: rhd, display }],
        text: rhd === UNKNOWN_BLOOD_TYPE ? "RhD不明" : `RhD${display}`,
      },
    });
  }
  return extension;
}

// 製剤明細の ServiceRequest。製剤(code)・単位数(quantityQuantity)・出す血液型(拡張)を持つ。
function buildProductRequest(
  product: TransfusionProductValues,
  sequence: number,
  patientId: string,
  authoredOn: string,
  occurrenceDateTime: string | undefined,
  headerReference: string,
): fhir4.ServiceRequest {
  const resource: fhir4.ServiceRequest = {
    resourceType: "ServiceRequest",
    status: "active",
    intent: "order",
    identifier: [{ system: ITEM_NUMBER_SYSTEM, value: String(sequence) }],
    subject: { reference: `Patient/${patientId}` },
    // 登録日時・投与予定日時はヘッダと同じ値を写す(明細だけで引いたときに日付が分かるように)。
    authoredOn,
    ...(occurrenceDateTime ? { occurrenceDateTime } : {}),
    code: {
      coding: [
        { system: PRODUCT_SYSTEM, code: product.productCode, display: product.productName },
      ],
      text: product.productName,
    },
    basedOn: [{ reference: headerReference }],
  };
  if (product.id) resource.id = product.id;

  // 単位数。UCUM に無い数え方(単位・本)なので system/code は載せず表示名だけ持つ。
  const units = Number(product.units);
  if (Number.isFinite(units) && units > 0) {
    resource.quantityQuantity = { value: units, unit: product.unitLabel || "単位" };
  }
  if (product.note.trim()) resource.note = [{ text: product.note.trim() }];
  const bloodType = bloodTypeExtensions(product.abo, product.rhd);
  if (bloodType.length > 0) resource.extension = bloodType;

  return resource;
}

function buildTransfusionOrderServiceRequest(
  values: TransfusionOrderFormValues,
  patientId: string,
  requester: OrderContext,
  authoredOn: string,
  serviceRequestId?: string,
): fhir4.ServiceRequest {
  const resource: fhir4.ServiceRequest = {
    resourceType: "ServiceRequest",
    status: "active",
    intent: "order",
    priority: values.priority,
    category: [
      { coding: [{ system: ORDER_TYPE_SYSTEM, ...TRANSFUSION_ORDER_TYPE }] },
      ...(values.setting
        ? [
            {
              coding: [
                {
                  system: SETTING_SYSTEM,
                  code: values.setting,
                  display: displayOf(SETTING_OPTIONS, values.setting),
                },
              ],
            },
          ]
        : []),
    ],
    // 輸血検査区分。輸血部門の作業(適合試験をどこまでやるか)がこれで決まる。
    code: {
      coding: [
        {
          system: TEST_TYPE_SYSTEM,
          code: values.testType,
          display: testTypeDisplay(values.testType),
        },
      ],
      text: testTypeDisplay(values.testType),
    },
    subject: { reference: `Patient/${patientId}` },
    // 登録日時(全種別共通の意味。fhir/shared.ts)。フォームでは入力しない。
    authoredOn,
  };

  if (serviceRequestId) resource.id = serviceRequestId;
  // 投与予定日時 = オーダー開始日。部門一覧はこの日付でオーダーを拾う。datetime-local の
  // 値はタイムゾーンを持たないので、実行環境のオフセットを付けて保存する(付けないと上流が
  // UTC として読む)。
  if (values.scheduledDateTime) {
    resource.occurrenceDateTime = toFhirDateTime(values.scheduledDateTime);
  }
  if (values.problem) {
    resource.reasonReference = [
      {
        reference: `Condition/${values.problem.conditionId}`,
        display: values.problem.display,
      },
    ];
  }
  if (values.purpose.trim()) resource.reasonCode = [{ text: values.purpose.trim() }];
  if (values.locationId) {
    resource.locationReference = [
      {
        reference: `Location/${values.locationId}`,
        ...(values.locationName ? { display: values.locationName } : {}),
      },
    ];
  }
  applyOrderContext(resource, requester);

  const extension: fhir4.Extension[] = bloodTypeExtensions(values.patientAbo, values.patientRhd);
  if (values.consentConfirmed) extension.push({ url: CONSENT_EXT_URL, valueBoolean: true });
  if (extension.length > 0) {
    // applyOrderContext が入れた拡張(診療科・病棟)を消さないように後ろへ足す。
    resource.extension = [...(resource.extension ?? []), ...extension];
  }

  if (values.comment) resource.note = [{ text: values.comment }];

  return resource;
}

// ヘッダ 1 件 + 製剤 N 件の transaction Bundle。新規登録ではヘッダを urn:uuid で
// 参照するので、basedOn はサーバー側で採番後の id に解決される。
function buildTransfusionOrderTransactionBundle(
  values: TransfusionOrderFormValues,
  patientId: string,
  requester: OrderContext,
  authoredOn: string,
  serviceRequestId?: string,
  originalItemIds: string[] = [],
  originalAppointments: fhir4.Appointment[] = [],
): fhir4.Bundle {
  const headerReference = serviceRequestId
    ? `ServiceRequest/${serviceRequestId}`
    : `urn:uuid:${crypto.randomUUID()}`;

  const header = buildTransfusionOrderServiceRequest(
    values,
    patientId,
    requester,
    authoredOn,
    serviceRequestId,
  );
  const kept = new Set<string>();
  const entries: fhir4.BundleEntry[] = [
    {
      fullUrl: headerReference,
      resource: header,
      request: serviceRequestId
        ? { method: "PUT", url: `ServiceRequest/${serviceRequestId}` }
        : { method: "POST", url: "ServiceRequest" },
    },
  ];

  // 製剤が選ばれていない行(追加したまま入力しなかった行)は保存しない。
  const products = values.products.filter((product) => product.productCode);
  products.forEach((product, index) => {
    if (product.id) kept.add(product.id);
    entries.push({
      fullUrl: product.id ? `ServiceRequest/${product.id}` : `urn:uuid:${crypto.randomUUID()}`,
      resource: buildProductRequest(
        product,
        index + 1,
        patientId,
        authoredOn,
        header.occurrenceDateTime,
        headerReference,
      ),
      request: product.id
        ? { method: "PUT", url: `ServiceRequest/${product.id}` }
        : { method: "POST", url: "ServiceRequest" },
    });
  });

  // 画面から外された製剤を消す。
  for (const id of originalItemIds) {
    if (!kept.has(id)) entries.push({ request: { method: "DELETE", url: `ServiceRequest/${id}` } });
  }

  // 自己血の採血予定。新しい予定は POST、残した予定は PUT、外した予定は取消。
  entries.push(...collectionPlanEntries(values.collections, patientId, headerReference, originalAppointments));

  return { resourceType: "Bundle", type: "transaction", entry: entries };
}

export function buildTransfusionOrderBundle(
  values: TransfusionOrderFormValues,
  patientId: string,
  requester: OrderContext,
): fhir4.Bundle {
  return buildTransfusionOrderTransactionBundle(values, patientId, requester, registrationAuthoredOn());
}

/** 更新。登録日時は元のリソースから引き継ぐ(編集で動かさない)。 */
export function buildTransfusionOrderUpdateBundle(
  values: TransfusionOrderFormValues,
  patientId: string,
  original: fhir4.ServiceRequest,
  /** 元の製剤明細の id。外されたものを DELETE するために使う。 */
  originalItemIds: string[],
  requester: OrderContext,
  /** 元の採血予定。外されたものを取り消し、残したものは版を引き継いで PUT する。 */
  originalAppointments: fhir4.Appointment[] = [],
): fhir4.Bundle {
  return keepOrderRevoked(
    withVersionLock(
      buildTransfusionOrderTransactionBundle(
        values,
        patientId,
        requester,
        registrationAuthoredOn(original),
        original.id,
        originalItemIds,
        originalAppointments,
      ),
      original,
    ),
    original,
  );
}

/** オーダーとその明細をまとめて消す Bundle。残っている採血予定の取消も同梱する。 */
export function buildTransfusionOrderDeleteBundle(
  serviceRequestId: string,
  itemIds: string[],
  appointmentEntries: fhir4.BundleEntry[] = [],
): fhir4.Bundle {
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      ...appointmentEntries,
      { request: { method: "DELETE", url: `ServiceRequest/${serviceRequestId}` } },
      ...itemIds.map((id) => ({
        request: { method: "DELETE" as const, url: `ServiceRequest/${id}` },
      })),
    ],
  };
}

// 既存のオーダーを DO(流用)して新規登録するためのフォーム値。明細の id を落として
// 新規登録(POST)にし、投与予定日時は空にする(登録日時は保存時に採る)。
export function buildDoTransfusionOrderForm(
  values: TransfusionOrderFormValues,
  setting: PrescriptionSetting,
): TransfusionOrderFormValues {
  return {
    ...values,
    setting,
    scheduledDateTime: "",
    // 患者の血液型はいまの検査結果から入れ直す(DO 元の時点の型を引き継がない)。
    // 製剤の型は同じ患者なので引き継ぐ。同意書の確認は輸血ごとに取り直すものなので引き継がない。
    patientAbo: "",
    patientRhd: "",
    consentConfirmed: false,
    products: values.products.map((product) => ({ ...product, id: "" })),
    // 採血予定は手術日から逆算するものなので、DO 元の予定は引き継がない。
    collections: [],
  };
}

// ---- 一覧・カルテ表示のための parse ----

export interface TransfusionOrderSummary {
  settingDisplay: string;
  /** 緊急度の表示(通常 / レベルⅠ〜Ⅲ)。 */
  priorityDisplay: string;
  /** 緊急度のレベル(1〜3)。緊急でなければ 0。 */
  urgencyLevel: number;
  /** バッジ用の短い表記(「緊急Ⅰ」)。緊急でなければ空。 */
  urgencyBadge: string;
  /** 輸血検査区分の表示(交差適合試験・T&S)。カードの見出しに出す。 */
  testTypeDisplay: string;
  testType: string;
  /** 緊急のオーダーはカードで目立たせるため、区分そのものも返す。 */
  urgent: boolean;
  /** 同意書の確認済フラグ。未確認はカードで注意を出す。 */
  consentConfirmed: boolean;
  /** オーダー時点の患者の ABO 血液型(不明は unknown)。カードで色付きに出すのでコードそのものを返す。 */
  aboBloodType: string;
  rhdBloodType: string;
  /** 「A型 RhD＋」の 1 行表示。書いていなければ空。 */
  bloodTypeDisplay: string;
  /** 使用場所の表示名。 */
  locationName: string;
  /** 使用目的。 */
  purpose: string;
}

export function transfusionOrderTestType(sr: fhir4.ServiceRequest): TransfusionTestType {
  const code = codingBySystem(sr.code?.coding, TEST_TYPE_SYSTEM)?.code;
  return TEST_TYPE_OPTIONS.some((o) => o.code === code)
    ? (code as TransfusionTestType)
    : "crossmatch";
}

export function transfusionOrderConsent(sr: fhir4.ServiceRequest): boolean {
  return sr.extension?.find((e) => e.url === CONSENT_EXT_URL)?.valueBoolean === true;
}

function codeFromExtension(sr: fhir4.ServiceRequest, url: string, system: string): string {
  const concept = sr.extension?.find((e) => e.url === url)?.valueCodeableConcept;
  return codingBySystem(concept?.coding, system)?.code ?? "";
}

/** 拡張の列から ABO / RhD を読む(不明や知らない値は空)。出庫のバッグで使う。 */
export function bloodTypeOfExtensions(extension: fhir4.Extension[] | undefined): {
  abo: AboBloodType | "";
  rhd: RhdBloodType | "";
} {
  const code = (url: string, system: string) =>
    codingBySystem(extension?.find((e) => e.url === url)?.valueCodeableConcept?.coding, system)?.code;
  const abo = code(ABO_EXT_URL, ABO_SYSTEM);
  const rhd = code(RHD_EXT_URL, RHD_SYSTEM);
  return {
    abo: ABO_OPTIONS.some((o) => o.code === abo) ? (abo as AboBloodType) : "",
    rhd: RHD_OPTIONS.some((o) => o.code === rhd) ? (rhd as RhdBloodType) : "",
  };
}

/** 製剤の型(明細の拡張)。 */
function productAbo(sr: fhir4.ServiceRequest): AboBloodType | "" {
  const code = codeFromExtension(sr, ABO_EXT_URL, ABO_SYSTEM);
  return ABO_OPTIONS.some((o) => o.code === code) ? (code as AboBloodType) : "";
}

function productRhd(sr: fhir4.ServiceRequest): RhdBloodType | "" {
  const code = codeFromExtension(sr, RHD_EXT_URL, RHD_SYSTEM);
  return RHD_OPTIONS.some((o) => o.code === code) ? (code as RhdBloodType) : "";
}

/** オーダー時点の患者の ABO(ヘッダの拡張)。不明は unknown。 */
export function transfusionOrderAbo(sr: fhir4.ServiceRequest): PatientAboBloodType | "" {
  const code = codeFromExtension(sr, ABO_EXT_URL, ABO_SYSTEM);
  if (code === UNKNOWN_BLOOD_TYPE) return UNKNOWN_BLOOD_TYPE;
  return ABO_OPTIONS.some((o) => o.code === code) ? (code as AboBloodType) : "";
}

export function transfusionOrderRhd(sr: fhir4.ServiceRequest): PatientRhdBloodType | "" {
  const code = codeFromExtension(sr, RHD_EXT_URL, RHD_SYSTEM);
  if (code === UNKNOWN_BLOOD_TYPE) return UNKNOWN_BLOOD_TYPE;
  return RHD_OPTIONS.some((o) => o.code === code) ? (code as RhdBloodType) : "";
}

export function transfusionOrderLocationName(sr: fhir4.ServiceRequest): string {
  return sr.locationReference?.[0]?.display ?? "";
}

export function transfusionOrderLocationId(sr: fhir4.ServiceRequest): string {
  return sr.locationReference?.[0]?.reference?.split("/").pop() ?? "";
}

export function transfusionOrderPurpose(sr: fhir4.ServiceRequest): string {
  return sr.reasonCode?.[0]?.text ?? "";
}

export function summarizeTransfusionOrder(sr: fhir4.ServiceRequest): TransfusionOrderSummary {
  const testType = transfusionOrderTestType(sr);
  const abo = transfusionOrderAbo(sr);
  const rhd = transfusionOrderRhd(sr);
  const urgencyLevel = urgencyLevelOf(sr.priority);
  return {
    settingDisplay: categoryCoding(sr, SETTING_SYSTEM)?.display ?? "",
    priorityDisplay: transfusionPriorityDisplay(sr.priority),
    urgencyLevel,
    urgencyBadge: urgencyBadgeLabel(sr.priority),
    testTypeDisplay: testTypeDisplay(testType),
    testType,
    urgent: urgencyLevel > 0,
    consentConfirmed: transfusionOrderConsent(sr),
    aboBloodType: abo,
    rhdBloodType: rhd,
    bloodTypeDisplay: bloodTypeLabel(abo, rhd),
    locationName: transfusionOrderLocationName(sr),
    purpose: transfusionOrderPurpose(sr),
  };
}

function parseProductRequest(
  request: fhir4.ServiceRequest,
  header: fhir4.ServiceRequest | undefined,
): TransfusionProductValues {
  const coding = codingBySystem(request.code?.coding, PRODUCT_SYSTEM);
  const quantity = request.quantityQuantity;
  // 製剤の型を明細に持つ前のオーダーは、ヘッダの型(当時は「何型を出すか」)を製剤の型として読む。
  const headerAbo = header ? transfusionOrderAbo(header) : "";
  const headerRhd = header ? transfusionOrderRhd(header) : "";
  const hasOwnType = Boolean(productAbo(request) || productRhd(request));

  return {
    id: request.id ?? "",
    productCode: coding?.code ?? "",
    productName: coding?.display ?? request.code?.text ?? "",
    // 略称はマスタ側にしか無いので、保存済みオーダーからは復元できない。
    // 表示側は abbreviation が空なら productName に落ちる(productLabel)。
    abbreviation: "",
    units: quantity?.value == null ? "" : String(quantity.value),
    unitLabel: quantity?.unit ?? "単位",
    abo: hasOwnType ? productAbo(request) : headerAbo === UNKNOWN_BLOOD_TYPE ? "" : headerAbo,
    rhd: hasOwnType ? productRhd(request) : headerRhd === UNKNOWN_BLOOD_TYPE ? "" : headerRhd,
    note: request.note?.[0]?.text ?? "",
  };
}

/**
 * オーダーの製剤明細。itemRequests には、そのオーダーにぶら下がる明細を渡す
 * (`_revinclude:iterate=ServiceRequest:based-on` で取得)。画面で並べた順に並べる。
 * `header` を渡すと、製剤の型を持たない古い明細にヘッダの型を補う。
 */
export function transfusionOrderProducts(
  itemRequests: fhir4.ServiceRequest[],
  header?: fhir4.ServiceRequest,
): TransfusionProductValues[] {
  return [...itemRequests]
    .sort((a, b) => itemNumber(a, ITEM_NUMBER_SYSTEM) - itemNumber(b, ITEM_NUMBER_SYSTEM))
    .map((request) => parseProductRequest(request, header));
}

/** ServiceRequest の一覧から、指定のオーダーにぶら下がる明細だけを取り出す。
 *  明細をヘッダの basedOn 先にするのは検体検査・病理と同じなので判定を流用する。 */
export function transfusionOrderItemRequests(
  serviceRequests: fhir4.ServiceRequest[],
  headerId: string,
): fhir4.ServiceRequest[] {
  return labOrderItemRequests(serviceRequests, headerId);
}

export const transfusionOrderComment = orderComment;
export const transfusionOrderProblem = orderProblem;

// ---- 編集フォームへの復元 ----

export function parseTransfusionOrderForm(
  sr: fhir4.ServiceRequest,
  itemRequests: fhir4.ServiceRequest[] = [],
  appointments: fhir4.Appointment[] = [],
): TransfusionOrderFormValues {
  const products = transfusionOrderProducts(itemRequests, sr);
  const priority = TRANSFUSION_PRIORITY_OPTIONS.some((o) => o.code === sr.priority)
    ? (sr.priority as TransfusionOrderPriority)
    : "routine";
  return {
    setting: (categoryCoding(sr, SETTING_SYSTEM)?.code ?? "") as PrescriptionSetting,
    priority,
    testType: transfusionOrderTestType(sr),
    patientAbo: transfusionOrderAbo(sr),
    patientRhd: transfusionOrderRhd(sr),
    // datetime-local の入力値に合わせて分までに丸める。
    scheduledDateTime: sr.occurrenceDateTime?.slice(0, 16) ?? "",
    locationId: transfusionOrderLocationId(sr),
    locationName: transfusionOrderLocationName(sr),
    purpose: transfusionOrderPurpose(sr),
    consentConfirmed: transfusionOrderConsent(sr),
    comment: transfusionOrderComment(sr),
    problem: transfusionOrderProblem(sr),
    // 製剤が 1 件も無いオーダー(壊れたデータ)でも入力欄が出るように 1 行は残す。
    products: products.length > 0 ? products : [emptyTransfusionProduct()],
    collections: parseCollectionPlan(appointments),
  };
}
