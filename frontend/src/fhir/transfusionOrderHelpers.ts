import { toFhirDateTime } from "../lib/dates";
import type { OrderContext } from "../orderContext";
import { orderProblem, type ProblemRef } from "./conditionHelpers";
import { labOrderItemRequests } from "./labOrderHelpers";
import {
  ORDER_TYPE_SYSTEM,
  SETTING_OPTIONS,
  SETTING_SYSTEM,
  applyOrderContext,
  codingBySystem,
  type PrescriptionSetting,
} from "./prescriptionHelpers";
import {
  categoryCoding,
  displayOf,
  itemNumber,
  orderComment,
  orderDay,
  PRIORITY_OPTIONS,
  registrationAuthoredOn,
} from "./shared";

export { PRIORITY_OPTIONS };

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
// - 輸血同意書の確認済フラグはローカル拡張。臨床病名は他オーダーと同じく登録病名
//   からの参照(reasonReference)。
//
// 血液型はオーダーに載せる。輸血は「何型を出すか」が依頼の中身そのもので、
// 製剤の払い出しはこの型で行われるため(docs/transfusion-order-design.md §2.5)。
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

export type TransfusionOrderPriority = "routine" | "urgent";

/**
 * 輸血検査区分。
 *
 * type-screen … T&S(タイプ&スクリーン)。血液型と不規則抗体だけ先に調べておき、
 *               実際に出すときは省略法で適合を確認する。輸血する確率が低い待機手術など。
 * crossmatch  … 交差適合試験。製剤を指定して患者血と実際に混ぜる。実際に輸血する前提。
 */
export type TransfusionTestType = "type-screen" | "crossmatch";

export const TEST_TYPE_OPTIONS: { code: TransfusionTestType; display: string }[] = [
  { code: "crossmatch", display: "交差適合試験" },
  { code: "type-screen", display: "T&S(タイプ&スクリーン)" },
];

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

/** 「A型 RhD＋」の 1 行表示。カード・詳細で使う(未選択なら空)。 */
export function bloodTypeLabel(abo: string, rhd: string): string {
  if (!abo && !rhd) return "";
  return [abo && `${abo}型`, rhd && `RhD${rhdDisplay(rhd)}`].filter(Boolean).join(" ");
}

export function priorityDisplay(priority: string | undefined): string {
  return priority === "urgent" ? "至急" : "通常";
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
  note: string;
}

export interface TransfusionOrderFormValues {
  setting: PrescriptionSetting;
  priority: TransfusionOrderPriority;
  testType: TransfusionTestType;
  /** ABO 血液型。未確定のうちは空。 */
  aboBloodType: AboBloodType | "";
  /** RhD 血液型。未確定のうちは空。 */
  rhdBloodType: RhdBloodType | "";
  /** 投与予定日時。datetime-local の入力形式(YYYY-MM-DDTHH:mm)。 */
  scheduledDateTime: string;
  /** 輸血同意書を確認済か。 */
  consentConfirmed: boolean;
  comment: string;
  problem: ProblemRef | null;
  products: TransfusionProductValues[];
}

export function emptyTransfusionProduct(): TransfusionProductValues {
  return {
    id: "",
    productCode: "",
    productName: "",
    abbreviation: "",
    units: "",
    unitLabel: "単位",
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
    aboBloodType: "",
    rhdBloodType: "",
    scheduledDateTime: "",
    consentConfirmed: false,
    comment: "",
    problem: null,
    products: [emptyTransfusionProduct()],
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
  return product.units ? `${name} / ${product.units}${product.unitLabel}` : name;
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

// 製剤明細の ServiceRequest。製剤(code)と単位数(quantityQuantity)を持つ。
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
  applyOrderContext(resource, requester);

  const extension: fhir4.Extension[] = [];
  if (values.aboBloodType) {
    extension.push({
      url: ABO_EXT_URL,
      valueCodeableConcept: {
        coding: [{ system: ABO_SYSTEM, code: values.aboBloodType, display: values.aboBloodType }],
        text: `${values.aboBloodType}型`,
      },
    });
  }
  if (values.rhdBloodType) {
    const display = rhdDisplay(values.rhdBloodType);
    extension.push({
      url: RHD_EXT_URL,
      valueCodeableConcept: {
        coding: [{ system: RHD_SYSTEM, code: values.rhdBloodType, display }],
        text: `RhD${display}`,
      },
    });
  }
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
): fhir4.Bundle {
  return buildTransfusionOrderTransactionBundle(
    values,
    patientId,
    requester,
    registrationAuthoredOn(original),
    original.id,
    originalItemIds,
  );
}

/** オーダーとその明細をまとめて消す Bundle。 */
export function buildTransfusionOrderDeleteBundle(
  serviceRequestId: string,
  itemIds: string[],
): fhir4.Bundle {
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
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
    // 血液型は患者の属性なのでそのまま引き継ぐ。同意書の確認は輸血ごとに
    // 取り直すものなので引き継がない。
    consentConfirmed: false,
    products: values.products.map((product) => ({ ...product, id: "" })),
  };
}

// ---- 一覧・カルテ表示のための parse ----

export interface TransfusionOrderSummary {
  settingDisplay: string;
  priorityDisplay: string;
  /** 輸血検査区分の表示(交差適合試験・T&S)。カードの見出しに出す。 */
  testTypeDisplay: string;
  testType: string;
  /** 至急のオーダーはカードで目立たせるため、区分そのものも返す。 */
  urgent: boolean;
  /** 同意書の確認済フラグ。未確認はカードで注意を出す。 */
  consentConfirmed: boolean;
  /** ABO 血液型。カードで色付きに出すのでコードそのものを返す。 */
  aboBloodType: string;
  rhdBloodType: string;
  /** 「A型 RhD＋」の 1 行表示。未選択なら空。 */
  bloodTypeDisplay: string;
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

export function transfusionOrderAbo(sr: fhir4.ServiceRequest): AboBloodType | "" {
  const code = codeFromExtension(sr, ABO_EXT_URL, ABO_SYSTEM);
  return ABO_OPTIONS.some((o) => o.code === code) ? (code as AboBloodType) : "";
}

export function transfusionOrderRhd(sr: fhir4.ServiceRequest): RhdBloodType | "" {
  const code = codeFromExtension(sr, RHD_EXT_URL, RHD_SYSTEM);
  return RHD_OPTIONS.some((o) => o.code === code) ? (code as RhdBloodType) : "";
}

export function summarizeTransfusionOrder(sr: fhir4.ServiceRequest): TransfusionOrderSummary {
  const testType = transfusionOrderTestType(sr);
  const abo = transfusionOrderAbo(sr);
  const rhd = transfusionOrderRhd(sr);
  return {
    settingDisplay: categoryCoding(sr, SETTING_SYSTEM)?.display ?? "",
    priorityDisplay: priorityDisplay(sr.priority),
    testTypeDisplay: testTypeDisplay(testType),
    testType,
    urgent: sr.priority === "urgent",
    consentConfirmed: transfusionOrderConsent(sr),
    aboBloodType: abo,
    rhdBloodType: rhd,
    bloodTypeDisplay: bloodTypeLabel(abo, rhd),
  };
}

function parseProductRequest(request: fhir4.ServiceRequest): TransfusionProductValues {
  const coding = codingBySystem(request.code?.coding, PRODUCT_SYSTEM);
  const quantity = request.quantityQuantity;

  return {
    id: request.id ?? "",
    productCode: coding?.code ?? "",
    productName: coding?.display ?? request.code?.text ?? "",
    // 略称はマスタ側にしか無いので、保存済みオーダーからは復元できない。
    // 表示側は abbreviation が空なら productName に落ちる(productLabel)。
    abbreviation: "",
    units: quantity?.value == null ? "" : String(quantity.value),
    unitLabel: quantity?.unit ?? "単位",
    note: request.note?.[0]?.text ?? "",
  };
}

/**
 * オーダーの製剤明細。itemRequests には、そのオーダーにぶら下がる明細を渡す
 * (`_revinclude:iterate=ServiceRequest:based-on` で取得)。画面で並べた順に並べる。
 */
export function transfusionOrderProducts(
  itemRequests: fhir4.ServiceRequest[],
): TransfusionProductValues[] {
  return [...itemRequests]
    .sort((a, b) => itemNumber(a, ITEM_NUMBER_SYSTEM) - itemNumber(b, ITEM_NUMBER_SYSTEM))
    .map(parseProductRequest);
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

/**
 * 「2026-08-29 交差適合試験 RBC-LR 2単位」のような 1 行要約。
 * 実施入力の対象表示など、オーダーを 1 行で指すところで使う。
 */
export function transfusionOrderLabel(
  header: fhir4.ServiceRequest,
  itemRequests: fhir4.ServiceRequest[],
): string {
  const date = orderDay(header);
  const products = productSummary(transfusionOrderProducts(itemRequests));
  return [date, testTypeDisplay(transfusionOrderTestType(header)), products]
    .filter(Boolean)
    .join(" ");
}

// ---- 編集フォームへの復元 ----

export function parseTransfusionOrderForm(
  sr: fhir4.ServiceRequest,
  itemRequests: fhir4.ServiceRequest[] = [],
): TransfusionOrderFormValues {
  const products = transfusionOrderProducts(itemRequests);
  return {
    setting: (categoryCoding(sr, SETTING_SYSTEM)?.code ?? "") as PrescriptionSetting,
    priority: (sr.priority === "urgent" ? "urgent" : "routine") as TransfusionOrderPriority,
    testType: transfusionOrderTestType(sr),
    aboBloodType: transfusionOrderAbo(sr),
    rhdBloodType: transfusionOrderRhd(sr),
    // datetime-local の入力値に合わせて分までに丸める。
    scheduledDateTime: sr.occurrenceDateTime?.slice(0, 16) ?? "",
    consentConfirmed: transfusionOrderConsent(sr),
    comment: transfusionOrderComment(sr),
    problem: transfusionOrderProblem(sr),
    // 製剤が 1 件も無いオーダー(壊れたデータ)でも入力欄が出るように 1 行は残す。
    products: products.length > 0 ? products : [emptyTransfusionProduct()],
  };
}
