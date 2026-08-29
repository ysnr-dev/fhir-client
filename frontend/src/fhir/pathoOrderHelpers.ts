import { today } from "../lib/dates";
import type { OrderContext } from "../orderContext";
import { orderProblem, type ProblemRef } from "./conditionHelpers";
import { binaryIdFromAttachment, imageBinaryEntry } from "./schemaImage";
import type { SchemaImageRef } from "./questionnaireResponseHelpers";
import type { TemplateBinding } from "./questionnaireResponseHelpers";
import { categoryCoding, displayOf, itemNumber, orderComment, PRIORITY_OPTIONS } from "./shared";

export { PRIORITY_OPTIONS };
import { labOrderItemRequests } from "./labOrderHelpers";
import {
  ORDER_TYPE_SYSTEM,
  SETTING_OPTIONS,
  SETTING_SYSTEM,
  applyOrderContext,
  codingBySystem,
  type PrescriptionSetting,
} from "./prescriptionHelpers";

// 病理検査(組織診・細胞診)オーダー。細菌検査と同じくヘッダは ServiceRequest で、
// その下に検体を並べる。
//
//   ヘッダ ← basedOn ── 検体明細 ×N(contained Specimen を持つ)
//
// 細菌検査と違って検査項目の層(第3段)は作らない。病理の「検査項目」は
// JAHIS の検査目的群(組織診/細胞診/術中迅速)が実質そのもので、1 オーダーに
// 1 つだけ選ぶため、ヘッダの code に載せる(docs/patho-order-design.md §3.1)。
// 代わりに、細菌検査が 1 件に制限していた検体の層を UI でも複数に開く。
// 多部位の生検(胃前庭部と胃体部を別容器で提出する、など)が病理では普通のため。
//
// 検体明細の載せ方(細菌検査に合わせる):
// - 検体は contained の Specimen(JP_Specimen_Common)にし、ServiceRequest.specimen で
//   指す。検体タイプ(生検/手術材料/細胞診材料)は type、臓器・検査材料と左右は
//   collection.bodySite、採取法は collection.method。まだ採っていないので status は
//   付けない。
// - 検体の並び順(=検体番号)は identifier の連番。
//
// ヘッダの載せ方:
// - 検査区分は code。JAHIS テーブル LPATHO001(検査目的群)のコードをそのまま使う。
// - 採取(予定)日時は occurrenceDateTime。部門一覧の日付軸とカルテカードの置き場所を
//   兼ねる(上流は occurrenceDateTime しか索引しないので Period は使わない)。
//   検体ごとの実採取日時は結果レポート側の Specimen.collection.collectedDateTime で持つ。
// - 臨床経過・所見、報告希望日、手術室番号はローカル拡張。臨床病名は放射線・細菌検査と
//   同じく登録病名からの参照(reasonReference)。

// 処方・注射・検体検査・細菌検査などの ServiceRequest と区別するオーダー種別。
export const PATHO_ORDER_TYPE = { code: "pathology", display: "病理検査" };

// JAHIS 病理・臨床細胞データ交換規約のコード表。公式の FHIR system URI が無いため、
// 他のローカルコードと同じ fhir-client.local の URI を使う。
// 病理レポート(pathoResultHelpers)も臓器・検体タイプを同じ体系で持つので共有する。
/** LPATHO001 検査目的群(組織診・細胞診・術中迅速)。 */
export const EXAM_CATEGORY_SYSTEM =
  "http://fhir-client.local/CodeSystem/jahis-patho-exam-category";
/** LPATHO002 検体タイプ(細胞診材料・生検・手術材料)。 */
export const SPECIMEN_TYPE_SYSTEM =
  "http://fhir-client.local/CodeSystem/jahis-patho-specimen-type";
/** LPATHO003 臓器・検査材料(master_patho_organs)。 */
export const ORGAN_SYSTEM = "http://fhir-client.local/CodeSystem/jahis-patho-organ";
/** LPATHO004 採取法(master_patho_collection_methods)。 */
export const COLLECTION_METHOD_SYSTEM =
  "http://fhir-client.local/CodeSystem/jahis-patho-collection-method";
// 左右。細菌検査の micro-laterality と同じ値だが、部門ごとにマスタが違うので分ける。
const LATERALITY_SYSTEM = "http://fhir-client.local/CodeSystem/patho-laterality";

// 臨床経過・所見(JAHIS のコメント種別 MS3-24/MS3-34 に当たる自由文)、
// 報告希望日(AP-021)、手術室番号(AP-011)。
const CLINICAL_INFO_EXT_URL = "http://fhir-client.local/StructureDefinition/patho-clinical-info";
const REPORT_DUE_EXT_URL = "http://fhir-client.local/StructureDefinition/patho-report-due";
const OPERATING_ROOM_EXT_URL =
  "http://fhir-client.local/StructureDefinition/patho-operating-room";
// 臨床経過・所見をテンプレートから書いたときの、記入内容(QuestionnaireResponse)への参照。
// 本文(patho-clinical-info)は人が読む平文の写しで、正本はこちらが指す回答。
// 放射線・生理・内視鏡・手術と同じ作りで、病理は 1 オーダー 1 件なのでヘッダに付く。
const CLINICAL_INFO_QR_EXT_URL =
  "http://fhir-client.local/StructureDefinition/patho-clinical-info-questionnaire-response";
// シェーマ(JAHIS コメント種別 AP-031)。臓器図に病変の位置を描いた画像で、
// 描き込み済みの合成 PNG を Binary に保存し、valueAttachment で参照する
// (テンプレートの描き込みと同じ持ち方。schemaImage.ts を参照)。
// 多部位の生検では臓器ごとに要るので繰り返し可にする。
const SCHEMA_IMAGE_EXT_URL = "http://fhir-client.local/StructureDefinition/patho-schema-image";

// 明細(検体)の並び順 = 検体番号。
const ITEM_NUMBER_SYSTEM = "http://fhir-client.local/IdSystem/patho-order-item-number";

const SPECIMEN_PROFILE = "http://jpfhir.jp/fhir/core/StructureDefinition/JP_Specimen_Common";
const CONTAINED_SPECIMEN_ID = "specimen";

export type PathoOrderPriority = "routine" | "urgent";

/**
 * 検査区分(JAHIS テーブル LPATHO001 検査目的群)。
 * 免疫染色(N002)・遺伝子検査(N005)はこの配列に足せば増やせる
 * (docs/patho-order-design.md §8)。
 */
export type PathoExamCategory = "N000" | "N004" | "N003";

export const EXAM_CATEGORY_OPTIONS: { code: PathoExamCategory; display: string }[] = [
  { code: "N000", display: "組織診" },
  { code: "N004", display: "細胞診" },
  { code: "N003", display: "術中迅速" },
];

/** 検査区分が細胞診系か(検体タイプの既定値とレポートの診断欄が変わる)。 */
export function isCytologyCategory(code: string): boolean {
  return code === "N004";
}

/** 検体タイプ(JAHIS テーブル LPATHO002)。 */
export const SPECIMEN_TYPE_OPTIONS: { code: string; display: string }[] = [
  { code: "201", display: "生検" },
  { code: "211", display: "手術材料" },
  { code: "101", display: "細胞診材料" },
];

/** 検査区分で選べる検体タイプ。細胞診は細胞診材料だけ、組織診系は生検・手術材料。 */
export function specimenTypeOptionsFor(
  examCategory: string,
): { code: string; display: string }[] {
  return isCytologyCategory(examCategory)
    ? SPECIMEN_TYPE_OPTIONS.filter((o) => o.code === "101")
    : SPECIMEN_TYPE_OPTIONS.filter((o) => o.code !== "101");
}

/** 検査区分に対する検体タイプの既定値。区分を切り替えたときの補正に使う。 */
export function defaultSpecimenTypeFor(examCategory: string): { code: string; display: string } {
  return specimenTypeOptionsFor(examCategory)[0];
}

export const LATERALITY_OPTIONS: { code: string; display: string }[] = [
  { code: "R", display: "右" },
  { code: "L", display: "左" },
  { code: "B", display: "両側" },
];

/** 検体(検体明細)1 件の入力値。マスタの写しなので表示に必要な値をすべて持つ。 */
export interface PathoSpecimenValues {
  /** 検体明細の ServiceRequest の id。画面で足したばかりの検体は空(登録時に採番)。 */
  id: string;
  /** LPATHO002 検体タイプ。 */
  typeCode: string;
  typeName: string;
  /** LPATHO003 臓器・検査材料。 */
  organCode: string;
  organName: string;
  /** 左右(R/L/B)。空なら指定なし。 */
  lateralityCode: string;
  /** LPATHO004 採取法。 */
  methodCode: string;
  methodName: string;
  /** 部位の詳細・肉眼的性状などの補足(自由文)。 */
  note: string;
}

export interface PathoOrderFormValues {
  setting: PrescriptionSetting;
  priority: PathoOrderPriority;
  /** 依頼日。 */
  authoredDate: string;
  /** 検査区分(LPATHO001 検査目的群)。 */
  examCategory: PathoExamCategory;
  /** 採取(予定)日時("YYYY-MM-DDTHH:mm")。空なら未定。 */
  collectionDateTime: string;
  /** 臨床経過・所見(自由文)。 */
  clinicalInfo: string;
  /** 報告希望日("YYYY-MM-DD")。空なら指定なし。 */
  reportDueDate: string;
  /** 手術室番号(術中迅速のときだけ使う)。 */
  operatingRoom: string;
  /** 依頼コメント。 */
  comment: string;
  /**
   * 臨床経過・所見をテンプレートから書いたときの紐付け。null なら直接入力。
   * clinicalInfo はこの回答を平文化した写しで、テンプレート紐付き中は編集させない。
   */
  clinicalInfoTemplate: TemplateBinding | null;
  /** 対象プロブレム(POMR)。null なら特定の問題に紐付かない検査。 */
  problem: ProblemRef | null;
  /** 検体(多部位の生検があるので複数)。 */
  specimens: PathoSpecimenValues[];
  /** シェーマ(臓器図への描き込み)。 */
  schemas: PathoSchemaValues[];
}

/** シェーマ 1 枚。保存済みは binaryId、描いたばかりは dataUrl を持つ。 */
export interface PathoSchemaValues {
  /** 保存済み画像の Binary id。まだ保存していなければ空。 */
  binaryId: string;
  /** 描いたばかりの合成 PNG(dataURL)。保存済みを読み戻したときは空。 */
  dataUrl: string;
  /** 台紙にしたシェーママスタの名前(「胃」など)。画像のキャプションに使う。 */
  name: string;
}

export function emptyPathoSpecimen(examCategory: string = "N000"): PathoSpecimenValues {
  const type = defaultSpecimenTypeFor(examCategory);
  return {
    id: "",
    typeCode: type.code,
    typeName: type.display,
    organCode: "",
    organName: "",
    lateralityCode: "",
    methodCode: "",
    methodName: "",
    note: "",
  };
}

export function emptyPathoOrderForm(
  problem: ProblemRef | null = null,
  setting: PrescriptionSetting = "outpatient",
): PathoOrderFormValues {
  return {
    setting,
    priority: "routine",
    authoredDate: today(),
    examCategory: "N000",
    collectionDateTime: "",
    clinicalInfo: "",
    reportDueDate: "",
    operatingRoom: "",
    comment: "",
    clinicalInfoTemplate: null,
    problem,
    specimens: [emptyPathoSpecimen("N000")],
    schemas: [],
  };
}

export function priorityDisplay(priority: string | undefined): string {
  return priority ? displayOf(PRIORITY_OPTIONS, priority) : "";
}

export function lateralityDisplay(code: string): string {
  return code ? displayOf(LATERALITY_OPTIONS, code) : "";
}

export function examCategoryDisplay(code: string): string {
  return code ? displayOf(EXAM_CATEGORY_OPTIONS, code as PathoExamCategory) : "";
}

export function specimenTypeDisplay(code: string): string {
  return code ? displayOf(SPECIMEN_TYPE_OPTIONS, code) : "";
}

/** 採取部位の表示(「右 肺上葉」)。左右指定なしの臓器は臓器名だけ。 */
export function organLabel(specimen: PathoSpecimenValues): string {
  return [lateralityDisplay(specimen.lateralityCode), specimen.organName]
    .filter(Boolean)
    .join(" ");
}

/** 検体の見出し(「① 胃前庭部（生検・EMR）」の括弧の中まで)。 */
export function specimenLabel(specimen: PathoSpecimenValues): string {
  const name = organLabel(specimen) || "臓器未設定";
  const detail = [specimenTypeDisplay(specimen.typeCode), specimen.methodName]
    .filter(Boolean)
    .join("・");
  return detail ? `${name}（${detail}）` : name;
}

/** 検体を 1 行に並べたラベル(「胃前庭部, 胃体部」)。カード・一覧で使う。 */
export function specimenSummary(specimens: PathoSpecimenValues[]): string {
  return specimens.map((specimen) => organLabel(specimen) || "臓器未設定").join(", ");
}

// ---- FHIR リソースの組み立て ----

/** ServiceRequest が病理検査オーダーかどうか。他オーダーとの振り分けに使う。 */
export function isPathoServiceRequest(sr: fhir4.ServiceRequest): boolean {
  return (sr.category ?? []).some((category) =>
    category.coding?.some((c) => c.system === ORDER_TYPE_SYSTEM && c.code === PATHO_ORDER_TYPE.code),
  );
}

// 検体明細に contained する Specimen。
function buildSpecimenResource(
  specimen: PathoSpecimenValues,
  patientId: string,
): fhir4.Specimen {
  const resource: fhir4.Specimen = {
    resourceType: "Specimen",
    id: CONTAINED_SPECIMEN_ID,
    meta: { profile: [SPECIMEN_PROFILE] },
    subject: { reference: `Patient/${patientId}` },
  };

  if (specimen.typeCode) {
    const display = specimen.typeName || specimenTypeDisplay(specimen.typeCode);
    resource.type = {
      coding: [{ system: SPECIMEN_TYPE_SYSTEM, code: specimen.typeCode, display }],
      text: display || undefined,
    };
  }

  const collection: fhir4.SpecimenCollection = {};
  if (specimen.organCode || specimen.lateralityCode) {
    const coding: fhir4.Coding[] = [];
    if (specimen.organCode) {
      coding.push({
        system: ORGAN_SYSTEM,
        code: specimen.organCode,
        display: specimen.organName || undefined,
      });
    }
    if (specimen.lateralityCode) {
      coding.push({
        system: LATERALITY_SYSTEM,
        code: specimen.lateralityCode,
        display: lateralityDisplay(specimen.lateralityCode) || undefined,
      });
    }
    collection.bodySite = { coding, text: organLabel(specimen) || undefined };
  }
  if (specimen.methodCode) {
    collection.method = {
      coding: [
        {
          system: COLLECTION_METHOD_SYSTEM,
          code: specimen.methodCode,
          display: specimen.methodName || undefined,
        },
      ],
      text: specimen.methodName || undefined,
    };
  }
  if (collection.bodySite || collection.method) resource.collection = collection;

  return resource;
}

// 検体明細の ServiceRequest。検体そのもの(contained Specimen)と補足を持つ。
function buildSpecimenRequest(
  specimen: PathoSpecimenValues,
  sequence: number,
  patientId: string,
  authoredOn: string,
  headerReference: string,
): fhir4.ServiceRequest {
  const label = organLabel(specimen) || specimen.typeName || "検体";
  const resource: fhir4.ServiceRequest = {
    resourceType: "ServiceRequest",
    status: "active",
    intent: "order",
    identifier: [{ system: ITEM_NUMBER_SYSTEM, value: String(sequence) }],
    subject: { reference: `Patient/${patientId}` },
    authoredOn,
    // 検体そのものは検査ではないので、表示用の text だけを持つ。
    code: { text: label },
    basedOn: [{ reference: headerReference }],
    contained: [buildSpecimenResource(specimen, patientId)],
    specimen: [{ reference: `#${CONTAINED_SPECIMEN_ID}`, display: label }],
  };
  if (specimen.id) resource.id = specimen.id;
  if (specimen.note.trim()) resource.note = [{ text: specimen.note.trim() }];

  return resource;
}

function buildPathoOrderServiceRequest(
  values: PathoOrderFormValues,
  patientId: string,
  requester: OrderContext,
  /** 臨床経過・所見の記入内容(QuestionnaireResponse)への参照。テンプレート未使用なら空。 */
  clinicalInfoTemplateRef: string,
  /** シェーマ画像の参照(保存済みは Binary/<id>、新規は Bundle 内のプレースホルダ)。 */
  schemaRefs: { url: string; name: string }[],
  serviceRequestId?: string,
): fhir4.ServiceRequest {
  const resource: fhir4.ServiceRequest = {
    resourceType: "ServiceRequest",
    status: "active",
    intent: "order",
    priority: values.priority,
    category: [
      { coding: [{ system: ORDER_TYPE_SYSTEM, ...PATHO_ORDER_TYPE }] },
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
    // 検査区分。病理では「何を依頼したか」がこの 1 つに集約される。
    code: {
      coding: [
        {
          system: EXAM_CATEGORY_SYSTEM,
          code: values.examCategory,
          display: examCategoryDisplay(values.examCategory),
        },
      ],
      text: examCategoryDisplay(values.examCategory),
    },
    subject: { reference: `Patient/${patientId}` },
    authoredOn: values.authoredDate,
  };

  if (serviceRequestId) resource.id = serviceRequestId;
  // 採取(予定)日時。部門一覧はこの日付でオーダーを拾う。
  if (values.collectionDateTime) resource.occurrenceDateTime = values.collectionDateTime;
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
  if (values.clinicalInfo.trim()) {
    extension.push({ url: CLINICAL_INFO_EXT_URL, valueString: values.clinicalInfo.trim() });
  }
  if (values.reportDueDate) {
    extension.push({ url: REPORT_DUE_EXT_URL, valueDate: values.reportDueDate });
  }
  if (values.operatingRoom.trim()) {
    extension.push({ url: OPERATING_ROOM_EXT_URL, valueString: values.operatingRoom.trim() });
  }
  if (clinicalInfoTemplateRef) {
    extension.push({
      url: CLINICAL_INFO_QR_EXT_URL,
      valueReference: { reference: clinicalInfoTemplateRef },
    });
  }
  for (const schema of schemaRefs) {
    extension.push({
      url: SCHEMA_IMAGE_EXT_URL,
      valueAttachment: {
        contentType: "image/png",
        url: schema.url,
        // 台紙の名前を添えておくと、画像を開かなくてもどの臓器の図か分かる。
        title: schema.name || undefined,
      },
    });
  }
  if (extension.length > 0) {
    // applyOrderContext が入れた拡張(診療科・病棟)を消さないように後ろへ足す。
    resource.extension = [...(resource.extension ?? []), ...extension];
  }

  if (values.comment) resource.note = [{ text: values.comment }];

  return resource;
}

// ヘッダ 1 件 + 検体 N 件の transaction Bundle。新規登録ではヘッダを urn:uuid で
// 参照するので、basedOn はサーバー側で採番後の id に解決される。
/**
 * 臨床経過・所見のテンプレート記入内容を Bundle に積み、ヘッダから指す参照を返す。
 * オーダー本体と同じ transaction に載せるのは、先に単独で保存すると「オーダーを
 * 保存しなかったときに回答だけが残る」ため(手術の術前指示と同じ作り)。
 * 参照が外れた回答は呼び出し側が DELETE する。
 */
function pushClinicalInfoTemplateEntry(
  entries: fhir4.BundleEntry[],
  binding: TemplateBinding | null,
): { reference: string; keptResponseId: string } {
  if (!binding) return { reference: "", keptResponseId: "" };
  const { responseId, draft } = binding;
  if (!draft) {
    // 再編集していない保存済みの回答 → 参照だけ引き継ぐ。
    return responseId
      ? { reference: `QuestionnaireResponse/${responseId}`, keptResponseId: responseId }
      : { reference: "", keptResponseId: "" };
  }
  // 保存済みの再編集は同じ id へ PUT、新規記入は urn:uuid で POST し、
  // 実 ID への解決は上流の transaction 処理に任せる。
  const reference = responseId
    ? `QuestionnaireResponse/${responseId}`
    : `urn:uuid:${crypto.randomUUID()}`;
  if (responseId) {
    entries.push({
      resource: { ...draft.response, id: responseId },
      request: { method: "PUT", url: reference },
    });
  } else {
    entries.push({
      fullUrl: reference,
      resource: draft.response,
      request: { method: "POST", url: "QuestionnaireResponse" },
    });
  }
  entries.push(...draft.imageEntries);
  return { reference, keptResponseId: responseId ?? "" };
}

/**
 * シェーマ画像を Bundle に積み、ヘッダから指す参照を返す。描いたばかりの画像は
 * Binary を作り、まだ id が無いのでプレースホルダ(urn:uuid)で指す(上流の
 * transaction が実 ID に書き換える)。保存済みの画像はそのまま参照を引き継ぐ。
 */
function pushSchemaEntries(
  entries: fhir4.BundleEntry[],
  schemas: PathoSchemaValues[],
): { url: string; name: string }[] {
  return schemas.flatMap((schema) => {
    if (schema.binaryId) return [{ url: `Binary/${schema.binaryId}`, name: schema.name }];
    if (!schema.dataUrl) return [];
    const { placeholder, entry } = imageBinaryEntry(schema.dataUrl, "image/png");
    entries.push(entry);
    return [{ url: placeholder, name: schema.name }];
  });
}

function buildPathoOrderTransactionBundle(
  values: PathoOrderFormValues,
  patientId: string,
  requester: OrderContext,
  serviceRequestId?: string,
  originalItemIds: string[] = [],
  /** 元のオーダーが参照していた記入内容の回答 id。外れたら同じ transaction で消す。 */
  originalResponseIds: string[] = [],
): fhir4.Bundle {
  const headerReference = serviceRequestId
    ? `ServiceRequest/${serviceRequestId}`
    : `urn:uuid:${crypto.randomUUID()}`;

  const kept = new Set<string>();

  // 画像・回答はヘッダより先に置く(ヘッダがプレースホルダで指すため)。
  const entries: fhir4.BundleEntry[] = [];
  const template = pushClinicalInfoTemplateEntry(entries, values.clinicalInfoTemplate);
  const schemaRefs = pushSchemaEntries(entries, values.schemas);

  entries.push({
    fullUrl: headerReference,
    resource: buildPathoOrderServiceRequest(
      values,
      patientId,
      requester,
      template.reference,
      schemaRefs,
      serviceRequestId,
    ),
    request: serviceRequestId
      ? { method: "PUT", url: `ServiceRequest/${serviceRequestId}` }
      : { method: "POST", url: "ServiceRequest" },
  });

  values.specimens.forEach((specimen, index) => {
    if (specimen.id) kept.add(specimen.id);
    entries.push({
      fullUrl: specimen.id
        ? `ServiceRequest/${specimen.id}`
        : `urn:uuid:${crypto.randomUUID()}`,
      resource: buildSpecimenRequest(
        specimen,
        index + 1,
        patientId,
        values.authoredDate,
        headerReference,
      ),
      request: specimen.id
        ? { method: "PUT", url: `ServiceRequest/${specimen.id}` }
        : { method: "POST", url: "ServiceRequest" },
    });
  });

  // 画面から外された検体を消す。
  for (const id of originalItemIds) {
    if (!kept.has(id)) entries.push({ request: { method: "DELETE", url: `ServiceRequest/${id}` } });
  }
  // テンプレートを解除した(参照が外れた)記入内容も同じ transaction で消す。
  for (const id of originalResponseIds) {
    if (id !== template.keptResponseId) {
      entries.push({ request: { method: "DELETE", url: `QuestionnaireResponse/${id}` } });
    }
  }

  return { resourceType: "Bundle", type: "transaction", entry: entries };
}

export function buildPathoOrderBundle(
  values: PathoOrderFormValues,
  patientId: string,
  requester: OrderContext,
): fhir4.Bundle {
  return buildPathoOrderTransactionBundle(values, patientId, requester);
}

export function buildPathoOrderUpdateBundle(
  values: PathoOrderFormValues,
  patientId: string,
  serviceRequestId: string,
  /** 元の検体明細の id。外されたものを DELETE するために使う。 */
  originalItemIds: string[],
  requester: OrderContext,
  /** 元のオーダーが参照していた記入内容の回答 id。外れたら同じ transaction で消す。 */
  originalResponseIds: string[] = [],
): fhir4.Bundle {
  return buildPathoOrderTransactionBundle(
    values,
    patientId,
    requester,
    serviceRequestId,
    originalItemIds,
    originalResponseIds,
  );
}

/** オーダーとその明細・テンプレート記入内容をまとめて消す Bundle。
 *  シェーマの Binary は消さない(旧版が参照しているため。schemaImage.ts を参照)。 */
export function buildPathoOrderDeleteBundle(
  serviceRequestId: string,
  itemIds: string[],
  responseIds: string[] = [],
): fhir4.Bundle {
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      { request: { method: "DELETE", url: `ServiceRequest/${serviceRequestId}` } },
      ...itemIds.map((id) => ({
        request: { method: "DELETE" as const, url: `ServiceRequest/${id}` },
      })),
      ...responseIds.map((id) => ({
        request: { method: "DELETE" as const, url: `QuestionnaireResponse/${id}` },
      })),
    ],
  };
}

// 既存のオーダーを DO(流用)して新規登録するためのフォーム値。明細の id を落として
// 新規登録(POST)にし、依頼日は当日・採取予定日時は空にする。
export function buildDoPathoOrderForm(
  values: PathoOrderFormValues,
  setting: PrescriptionSetting,
): PathoOrderFormValues {
  return {
    ...values,
    setting,
    authoredDate: today(),
    collectionDateTime: "",
    specimens: values.specimens.map((specimen) => ({ ...specimen, id: "" })),
    // テンプレートの記入内容とシェーマは引き継がない。同じ回答・画像を 2 つの
    // オーダーが指すと、片方を消したときにもう片方が壊れるため(複写後に改めて
    // 記入・作図する)。文言だけは clinicalInfo に残るので下書きとして使える。
    clinicalInfoTemplate: null,
    schemas: [],
  };
}

// ---- 一覧・カルテ表示のための parse ----

export interface PathoOrderSummary {
  settingDisplay: string;
  priorityDisplay: string;
  /** 検査区分の表示(組織診・細胞診・術中迅速)。カードの見出しに出す。 */
  examCategoryDisplay: string;
  examCategory: string;
  /** 至急のオーダーはカードで目立たせるため、区分そのものも返す。 */
  urgent: boolean;
}

export function summarizePathoOrder(sr: fhir4.ServiceRequest): PathoOrderSummary {
  const category = pathoOrderExamCategory(sr);
  return {
    settingDisplay: categoryCoding(sr, SETTING_SYSTEM)?.display ?? "",
    priorityDisplay: priorityDisplay(sr.priority),
    examCategoryDisplay: examCategoryDisplay(category),
    examCategory: category,
    urgent: sr.priority === "urgent",
  };
}

function containedSpecimenOf(request: fhir4.ServiceRequest): fhir4.Specimen | undefined {
  const reference = request.specimen?.[0]?.reference;
  if (!reference?.startsWith("#")) return undefined;

  const id = reference.slice(1);
  return (request.contained ?? []).find(
    (resource): resource is fhir4.Specimen =>
      resource.resourceType === "Specimen" && resource.id === id,
  );
}

function parseSpecimenRequest(request: fhir4.ServiceRequest): PathoSpecimenValues {
  const contained = containedSpecimenOf(request);
  const type = codingBySystem(contained?.type?.coding, SPECIMEN_TYPE_SYSTEM);
  const bodySite = contained?.collection?.bodySite?.coding;
  const organ = codingBySystem(bodySite, ORGAN_SYSTEM);
  const laterality = codingBySystem(bodySite, LATERALITY_SYSTEM);
  const method = codingBySystem(contained?.collection?.method?.coding, COLLECTION_METHOD_SYSTEM);

  return {
    id: request.id ?? "",
    typeCode: type?.code ?? "",
    typeName: type?.display ?? contained?.type?.text ?? "",
    organCode: organ?.code ?? "",
    organName: organ?.display ?? "",
    lateralityCode: laterality?.code ?? "",
    methodCode: method?.code ?? "",
    methodName: method?.display ?? "",
    note: request.note?.[0]?.text ?? "",
  };
}

/**
 * オーダーの検体。itemRequests には、そのオーダーにぶら下がる明細を渡す
 * (`_revinclude:iterate=ServiceRequest:based-on` で取得)。検体番号の順に並べる。
 */
export function pathoOrderSpecimens(
  itemRequests: fhir4.ServiceRequest[],
): PathoSpecimenValues[] {
  return [...itemRequests]
    .filter((request) => Boolean(containedSpecimenOf(request)))
    .sort((a, b) => itemNumber(a, ITEM_NUMBER_SYSTEM) - itemNumber(b, ITEM_NUMBER_SYSTEM))
    .map(parseSpecimenRequest);
}

/**
 * 「2026-08-29 組織診 胃前庭部, 胃体部」のような 1 行要約。レポート登録の
 * オーダー選択肢と、レポート内容表示の紐付けオーダー表示に使う。
 */
export function pathoOrderLabel(
  header: fhir4.ServiceRequest,
  itemRequests: fhir4.ServiceRequest[],
): string {
  const date = header.occurrenceDateTime?.slice(0, 10) ?? header.authoredOn?.slice(0, 10) ?? "";
  const specimens = specimenSummary(pathoOrderSpecimens(itemRequests));
  return [date, examCategoryDisplay(pathoOrderExamCategory(header)), specimens]
    .filter(Boolean)
    .join(" ");
}

/** ServiceRequest の一覧から、指定のオーダーにぶら下がる明細だけを取り出す。
 *  明細をヘッダの basedOn 先にするのは検体検査と同じなので判定を流用する。 */
export function pathoOrderItemRequests(
  serviceRequests: fhir4.ServiceRequest[],
  headerId: string,
): fhir4.ServiceRequest[] {
  return labOrderItemRequests(serviceRequests, headerId);
}

export const pathoOrderComment = orderComment;
export const pathoOrderProblem = orderProblem;

export function pathoOrderExamCategory(sr: fhir4.ServiceRequest): PathoExamCategory {
  const code = codingBySystem(sr.code?.coding, EXAM_CATEGORY_SYSTEM)?.code;
  return EXAM_CATEGORY_OPTIONS.some((o) => o.code === code)
    ? (code as PathoExamCategory)
    : "N000";
}

/** 1 件の ServiceRequest が参照している臨床経過・所見の回答 id。持たなければ空。 */
function clinicalInfoResponseIdOf(sr: fhir4.ServiceRequest): string {
  const reference = sr.extension?.find((e) => e.url === CLINICAL_INFO_QR_EXT_URL)?.valueReference
    ?.reference;
  return reference?.match(/^QuestionnaireResponse\/(.+)$/)?.[1] ?? "";
}

/**
 * オーダーが参照している記入内容(QuestionnaireResponse)の id。
 * 更新・削除で孤児を残さないためと、カルテのタイムラインで「オーダーのカードに
 * 描かれる回答」を単独カードから外すために使う(他部門と同じ形なので配列で受ける)。
 */
export function pathoOrderResponseIds(serviceRequests: fhir4.ServiceRequest[]): string[] {
  return serviceRequests.map(clinicalInfoResponseIdOf).filter(Boolean);
}

/** 臨床経過・所見がテンプレート由来なら、その回答への紐付け。 */
export function pathoOrderClinicalInfoTemplate(
  sr: fhir4.ServiceRequest,
): TemplateBinding | null {
  const responseId = clinicalInfoResponseIdOf(sr);
  return responseId ? { responseId, draft: null } : null;
}

/** オーダーに添えられたシェーマ画像。描き込み済みの合成 PNG(Binary)を指す。 */
export function pathoOrderSchemas(sr: fhir4.ServiceRequest): PathoSchemaValues[] {
  return (sr.extension ?? [])
    .filter((e) => e.url === SCHEMA_IMAGE_EXT_URL)
    .flatMap((e) => {
      const binaryId = binaryIdFromAttachment(e.valueAttachment);
      return binaryId
        ? [{ binaryId, dataUrl: "", name: e.valueAttachment?.title ?? "" }]
        : [];
    });
}

/** シェーマ画像を SchemaImageGallery に渡せる形にする(未保存の描き立ても出せる)。 */
export function pathoSchemaImageRefs(schemas: PathoSchemaValues[]): SchemaImageRef[] {
  return schemas.map((schema, index) => ({
    key: `patho-schema#${index}`,
    label: schema.name,
    binaryId: schema.binaryId || null,
    dataUrl: schema.dataUrl || null,
  }));
}

export function pathoOrderClinicalInfo(sr: fhir4.ServiceRequest): string {
  return sr.extension?.find((e) => e.url === CLINICAL_INFO_EXT_URL)?.valueString ?? "";
}

export function pathoOrderReportDueDate(sr: fhir4.ServiceRequest): string {
  return sr.extension?.find((e) => e.url === REPORT_DUE_EXT_URL)?.valueDate ?? "";
}

export function pathoOrderOperatingRoom(sr: fhir4.ServiceRequest): string {
  return sr.extension?.find((e) => e.url === OPERATING_ROOM_EXT_URL)?.valueString ?? "";
}

// ---- 編集フォームへの復元 ----

export function parsePathoOrderForm(
  sr: fhir4.ServiceRequest,
  itemRequests: fhir4.ServiceRequest[] = [],
): PathoOrderFormValues {
  const examCategory = pathoOrderExamCategory(sr);
  const specimens = pathoOrderSpecimens(itemRequests);
  return {
    setting: (categoryCoding(sr, SETTING_SYSTEM)?.code ?? "") as PrescriptionSetting,
    priority: (sr.priority === "urgent" ? "urgent" : "routine") as PathoOrderPriority,
    authoredDate: sr.authoredOn?.slice(0, 10) ?? today(),
    examCategory,
    // datetime-local の入力値に合わせて分までに丸める。
    collectionDateTime: sr.occurrenceDateTime?.slice(0, 16) ?? "",
    clinicalInfo: pathoOrderClinicalInfo(sr),
    clinicalInfoTemplate: pathoOrderClinicalInfoTemplate(sr),
    reportDueDate: pathoOrderReportDueDate(sr),
    operatingRoom: pathoOrderOperatingRoom(sr),
    comment: pathoOrderComment(sr),
    problem: pathoOrderProblem(sr),
    schemas: pathoOrderSchemas(sr),
    // 検体が 1 件も無いオーダー(壊れたデータ)でも入力欄が出るように 1 行は残す。
    specimens: specimens.length > 0 ? specimens : [emptyPathoSpecimen(examCategory)],
  };
}
