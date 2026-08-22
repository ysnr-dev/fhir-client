import { today } from "../lib/dates";
import type { OrderContext } from "../orderContext";
import { orderProblem, type ProblemRef } from "./conditionHelpers";
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

// 細菌検査(微生物検査)オーダー。検体検査・放射線検査と同じくヘッダは
// ServiceRequest で、その下を 2 段の明細にする。
//
//   ヘッダ ← basedOn ── 検体グループ明細(contained Specimen を持つ)
//                          ← basedOn ── 検査項目明細(塗抹・培養など)
//
// UI は「1 オーダー = 1 検体」に制限するが、FHIR 構造は検体グループ層を残す。
// 後から複数検体 UI に拡張してもデータ移行が発生しないようにするため
// (docs/micro-order-design.md §7.1)。
//
// 検体グループ明細の載せ方:
// - 検体は contained の Specimen(JP_Specimen_Common)にし、ServiceRequest.specimen で
//   指す(検体検査と同じ方式)。検体種別は JANIS 材料コード、採取部位・左右は
//   collection.bodySite、採取方法は collection.method。まだ採っていないので
//   status は付けない。
// - 採取予定日時は occurrenceDateTime。Specimen.collection.collectedDateTime は
//   「実際に採取した日時」で意味が違うため使わない。
// - 目的菌は orderDetail(オーダーの追加指示そのもの)。JANIS 感染症病原体コード。
// - 疑い病名は放射線の依頼病名と同じ形: 登録病名から選んだなら
//   reasonReference(Condition)、フリーテキストなら reasonCode.text。
//
// ヘッダの載せ方:
// - 前投与抗菌薬はローカル拡張の valueString。処方から取り込んでも最終的には
//   自由編集できる文字列(YJ→JANIS 抗菌薬コードの公的対応表が無く、構造化しない)。
// - 検査目的区分(診断目的/監視培養)はローカル拡張の valueCode。放射線の
//   rad-exam-purpose(自由文字列)と意味が違うので別拡張にする。

// 処方・注射・検体検査・放射線検査の ServiceRequest と区別するオーダー種別。
export const MICRO_ORDER_TYPE = { code: "micro", display: "細菌検査" };

// 細菌検査オーダー項目マスタの独自コード。
const ORDER_ITEM_SYSTEM = "http://fhir-client.local/CodeSystem/micro-order-item";
// JANIS 検査部門のコード表。公式の FHIR system URI が無いため、他のローカル
// コードと同じ fhir-client.local の URI を使う。
// 細菌検査結果(microResultHelpers)も材料・菌名を同じ体系で持つので共有する。
export const SPECIMEN_TYPE_SYSTEM = "http://fhir-client.local/CodeSystem/janis-specimen-type";
export const ORGANISM_SYSTEM = "http://fhir-client.local/CodeSystem/janis-organism";
// 採取部位・左右・採取方法(施設マスタ)。
const COLLECTION_SITE_SYSTEM = "http://fhir-client.local/CodeSystem/micro-collection-site";
const LATERALITY_SYSTEM = "http://fhir-client.local/CodeSystem/micro-laterality";
const COLLECTION_METHOD_SYSTEM = "http://fhir-client.local/CodeSystem/micro-collection-method";
// 前投与抗菌薬(自由文字列)と検査目的区分(診断/監視培養)。
const PRIOR_ANTIMICROBIAL_EXT_URL =
  "http://fhir-client.local/StructureDefinition/micro-prior-antimicrobial";
const EXAM_PURPOSE_EXT_URL = "http://fhir-client.local/StructureDefinition/micro-exam-purpose";

// 明細の並び順(検体検査・放射線と同じ考え方)。
const ITEM_NUMBER_SYSTEM = "http://fhir-client.local/IdSystem/micro-order-item-number";

const SPECIMEN_PROFILE = "http://jpfhir.jp/fhir/core/StructureDefinition/JP_Specimen_Common";
const CONTAINED_SPECIMEN_ID = "specimen";

export type MicroOrderPriority = "routine" | "urgent";

export type MicroExamPurpose = "" | "diagnostic" | "surveillance";

export const EXAM_PURPOSE_OPTIONS: { code: Exclude<MicroExamPurpose, "">; display: string }[] = [
  { code: "diagnostic", display: "診断目的" },
  { code: "surveillance", display: "監視培養" },
];

export const LATERALITY_OPTIONS: { code: string; display: string }[] = [
  { code: "R", display: "右" },
  { code: "L", display: "左" },
  { code: "B", display: "両側" },
];

/** オーダーした検査項目 1 件。マスタの写しなので、表示に必要な値をすべて持つ。 */
export interface MicroOrderItemLine {
  /** 明細の ServiceRequest の id。画面で足したばかりの項目は空(登録時に採番)。 */
  id: string;
  /** 細菌検査オーダー項目マスタの項目コード。 */
  code: string;
  name: string;
  /** 略称。カードのように狭い場所で並べるときに使う。 */
  shortName: string;
}

/** 目的菌 1 件(JANIS 感染症病原体コードの写し)。 */
export interface MicroOrganismRef {
  code: string;
  name: string;
}

/** 検体(検体グループ明細)の入力値。マスタの写し。 */
export interface MicroSpecimenValues {
  /** 検体グループ明細の ServiceRequest の id。新規は空。 */
  id: string;
  /** JANIS 材料コード。 */
  typeCode: string;
  typeName: string;
  siteCode: string;
  siteName: string;
  /** 左右(R/L/B)。空なら指定なし。 */
  lateralityCode: string;
  methodCode: string;
  methodName: string;
  /** 採取予定日時("YYYY-MM-DDTHH:mm")。空なら未定。 */
  collectionDateTime: string;
  /** 目的菌(複数)。 */
  organisms: MicroOrganismRef[];
  /**
   * 疑い病名。登録病名から選んだ場合はその Condition の id。
   * 空ならフリーテキスト(reasonName だけを持つ)。
   */
  reasonConditionId: string;
  reasonName: string;
}

export interface MicroOrderFormValues {
  setting: PrescriptionSetting;
  priority: MicroOrderPriority;
  /** 依頼日。 */
  authoredDate: string;
  /** 依頼コメント。 */
  comment: string;
  /** 前投与抗菌薬(自由文字列。処方から取り込んでも最終的には文字列)。 */
  priorAntimicrobial: string;
  /** 検査目的区分。空なら未指定。 */
  examPurpose: MicroExamPurpose;
  // 対象プロブレム(POMR)。null なら特定の問題に紐付かない検査。
  problem: ProblemRef | null;
  /** 検体(UI は 1 オーダー 1 検体)。 */
  specimen: MicroSpecimenValues;
  /** 検体にぶら下がる検査項目。 */
  items: MicroOrderItemLine[];
}

export function emptyMicroSpecimen(): MicroSpecimenValues {
  return {
    id: "",
    typeCode: "",
    typeName: "",
    siteCode: "",
    siteName: "",
    lateralityCode: "",
    methodCode: "",
    methodName: "",
    collectionDateTime: "",
    organisms: [],
    reasonConditionId: "",
    reasonName: "",
  };
}

export function emptyMicroOrderForm(
  problem: ProblemRef | null = null,
  setting: PrescriptionSetting = "outpatient",
): MicroOrderFormValues {
  return {
    setting,
    priority: "routine",
    authoredDate: today(),
    comment: "",
    priorAntimicrobial: "",
    examPurpose: "diagnostic",
    problem,
    specimen: emptyMicroSpecimen(),
    items: [],
  };
}

export function priorityDisplay(priority: string | undefined): string {
  return priority ? displayOf(PRIORITY_OPTIONS, priority) : "";
}

export function lateralityDisplay(code: string): string {
  return code ? displayOf(LATERALITY_OPTIONS, code) : "";
}

export function examPurposeDisplay(code: string): string {
  return code ? displayOf(EXAM_PURPOSE_OPTIONS, code as Exclude<MicroExamPurpose, "">) : "";
}

/** 採取部位の表示(「右 耳」)。左右指定なしの部位は部位名だけ。 */
export function collectionSiteLabel(specimen: MicroSpecimenValues): string {
  return [lateralityDisplay(specimen.lateralityCode), specimen.siteName].filter(Boolean).join(" ");
}

/** 検体の見出し(「喀出痰（気管内・吸引）」)。カード・詳細・プレビューで共用。 */
export function specimenLabel(specimen: MicroSpecimenValues): string {
  const name = specimen.typeName || specimen.typeCode || "検体未設定";
  const detail = [collectionSiteLabel(specimen), specimen.methodName].filter(Boolean).join("・");
  return detail ? `${name}（${detail}）` : name;
}

/** 目的菌を 1 行に並べたラベル。 */
export function organismSummary(organisms: MicroOrganismRef[]): string {
  return organisms.map((organism) => organism.name).join(", ");
}

// ---- FHIR リソースの組み立て ----

/** ServiceRequest が細菌検査オーダーかどうか。他オーダーとの振り分けに使う。 */
export function isMicroServiceRequest(sr: fhir4.ServiceRequest): boolean {
  return (sr.category ?? []).some((category) =>
    category.coding?.some((c) => c.system === ORDER_TYPE_SYSTEM && c.code === MICRO_ORDER_TYPE.code),
  );
}

// 検体グループ明細に contained する Specimen。
function buildSpecimenResource(
  specimen: MicroSpecimenValues,
  patientId: string,
): fhir4.Specimen {
  const resource: fhir4.Specimen = {
    resourceType: "Specimen",
    id: CONTAINED_SPECIMEN_ID,
    meta: { profile: [SPECIMEN_PROFILE] },
    subject: { reference: `Patient/${patientId}` },
  };

  if (specimen.typeCode) {
    resource.type = {
      coding: [
        {
          system: SPECIMEN_TYPE_SYSTEM,
          code: specimen.typeCode,
          display: specimen.typeName || undefined,
        },
      ],
      text: specimen.typeName || undefined,
    };
  }

  const collection: fhir4.SpecimenCollection = {};
  if (specimen.siteCode || specimen.lateralityCode) {
    const coding: fhir4.Coding[] = [];
    if (specimen.siteCode) {
      coding.push({
        system: COLLECTION_SITE_SYSTEM,
        code: specimen.siteCode,
        display: specimen.siteName || undefined,
      });
    }
    if (specimen.lateralityCode) {
      coding.push({
        system: LATERALITY_SYSTEM,
        code: specimen.lateralityCode,
        display: lateralityDisplay(specimen.lateralityCode) || undefined,
      });
    }
    collection.bodySite = { coding, text: collectionSiteLabel(specimen) || undefined };
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

// 検体グループ明細の ServiceRequest。検体・目的菌・疑い病名・採取予定日時を持つ。
function buildSpecimenGroupRequest(
  specimen: MicroSpecimenValues,
  sequence: number,
  patientId: string,
  authoredOn: string,
  headerReference: string,
): fhir4.ServiceRequest {
  const resource: fhir4.ServiceRequest = {
    resourceType: "ServiceRequest",
    status: "active",
    intent: "order",
    identifier: [{ system: ITEM_NUMBER_SYSTEM, value: String(sequence) }],
    subject: { reference: `Patient/${patientId}` },
    authoredOn,
    // 検体グループそのものは検査ではないので、表示用の text だけを持つ。
    code: { text: specimen.typeName || "検体" },
    basedOn: [{ reference: headerReference }],
    contained: [buildSpecimenResource(specimen, patientId)],
    specimen: [
      { reference: `#${CONTAINED_SPECIMEN_ID}`, display: specimen.typeName || undefined },
    ],
  };
  if (specimen.id) resource.id = specimen.id;

  if (specimen.collectionDateTime) {
    resource.occurrenceDateTime = specimen.collectionDateTime;
  }
  if (specimen.organisms.length > 0) {
    resource.orderDetail = specimen.organisms.map((organism) => ({
      coding: [{ system: ORGANISM_SYSTEM, code: organism.code, display: organism.name }],
      text: organism.name,
    }));
  }
  // 疑い病名。登録病名から選んだものは参照で、フリーテキストはそのまま文字列で持つ。
  if (specimen.reasonConditionId) {
    resource.reasonReference = [
      {
        reference: `Condition/${specimen.reasonConditionId}`,
        display: specimen.reasonName || undefined,
      },
    ];
  } else if (specimen.reasonName) {
    resource.reasonCode = [{ text: specimen.reasonName }];
  }

  return resource;
}

// 検査項目明細の ServiceRequest。親(検体グループ)を basedOn で指す。
function buildItemRequest(
  item: MicroOrderItemLine,
  sequence: number,
  patientId: string,
  authoredOn: string,
  parentReference: string,
): fhir4.ServiceRequest {
  const resource: fhir4.ServiceRequest = {
    resourceType: "ServiceRequest",
    status: "active",
    intent: "order",
    identifier: [{ system: ITEM_NUMBER_SYSTEM, value: String(sequence) }],
    subject: { reference: `Patient/${patientId}` },
    authoredOn,
    code: {
      coding: [{ system: ORDER_ITEM_SYSTEM, code: item.code, display: item.name }],
      text: item.name,
    },
    basedOn: [{ reference: parentReference }],
  };
  if (item.id) resource.id = item.id;
  return resource;
}

function buildMicroOrderServiceRequest(
  values: MicroOrderFormValues,
  patientId: string,
  requester: OrderContext,
  serviceRequestId?: string,
): fhir4.ServiceRequest {
  const resource: fhir4.ServiceRequest = {
    resourceType: "ServiceRequest",
    status: "active",
    intent: "order",
    priority: values.priority,
    category: [
      { coding: [{ system: ORDER_TYPE_SYSTEM, ...MICRO_ORDER_TYPE }] },
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
    subject: { reference: `Patient/${patientId}` },
    authoredOn: values.authoredDate,
  };

  if (serviceRequestId) resource.id = serviceRequestId;
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
  if (values.priorAntimicrobial) {
    extension.push({ url: PRIOR_ANTIMICROBIAL_EXT_URL, valueString: values.priorAntimicrobial });
  }
  if (values.examPurpose) {
    extension.push({ url: EXAM_PURPOSE_EXT_URL, valueCode: values.examPurpose });
  }
  if (extension.length > 0) resource.extension = extension;

  if (values.comment) {
    resource.note = [{ text: values.comment }];
  }

  return resource;
}

// ヘッダ 1 件 + 検体グループ 1 件 + 検査項目 N 件の transaction Bundle。
// 新規登録ではヘッダ・検体グループを urn:uuid で参照するので、basedOn は
// サーバー側で採番後の id に解決される。
function buildMicroOrderTransactionBundle(
  values: MicroOrderFormValues,
  patientId: string,
  requester: OrderContext,
  serviceRequestId?: string,
  originalItemIds: string[] = [],
): fhir4.Bundle {
  const headerReference = serviceRequestId
    ? `ServiceRequest/${serviceRequestId}`
    : `urn:uuid:${crypto.randomUUID()}`;
  const specimenReference = values.specimen.id
    ? `ServiceRequest/${values.specimen.id}`
    : `urn:uuid:${crypto.randomUUID()}`;

  const kept = new Set<string>();
  if (values.specimen.id) kept.add(values.specimen.id);

  const entries: fhir4.BundleEntry[] = [
    {
      fullUrl: headerReference,
      resource: buildMicroOrderServiceRequest(values, patientId, requester, serviceRequestId),
      request: serviceRequestId
        ? { method: "PUT", url: `ServiceRequest/${serviceRequestId}` }
        : { method: "POST", url: "ServiceRequest" },
    },
    {
      fullUrl: specimenReference,
      resource: buildSpecimenGroupRequest(
        values.specimen,
        1,
        patientId,
        values.authoredDate,
        headerReference,
      ),
      request: values.specimen.id
        ? { method: "PUT", url: `ServiceRequest/${values.specimen.id}` }
        : { method: "POST", url: "ServiceRequest" },
    },
  ];

  values.items.forEach((item, index) => {
    if (item.id) kept.add(item.id);
    entries.push({
      fullUrl: item.id ? `ServiceRequest/${item.id}` : `urn:uuid:${crypto.randomUUID()}`,
      resource: buildItemRequest(item, index + 2, patientId, values.authoredDate, specimenReference),
      request: item.id
        ? { method: "PUT", url: `ServiceRequest/${item.id}` }
        : { method: "POST", url: "ServiceRequest" },
    });
  });

  for (const id of originalItemIds) {
    if (!kept.has(id)) entries.push({ request: { method: "DELETE", url: `ServiceRequest/${id}` } });
  }

  return { resourceType: "Bundle", type: "transaction", entry: entries };
}

export function buildMicroOrderBundle(
  values: MicroOrderFormValues,
  patientId: string,
  requester: OrderContext,
): fhir4.Bundle {
  return buildMicroOrderTransactionBundle(values, patientId, requester);
}

export function buildMicroOrderUpdateBundle(
  values: MicroOrderFormValues,
  patientId: string,
  serviceRequestId: string,
  /** 元の明細(検体グループ・検査項目)の id。外されたものを DELETE するために使う。 */
  originalItemIds: string[],
  requester: OrderContext,
): fhir4.Bundle {
  return buildMicroOrderTransactionBundle(
    values,
    patientId,
    requester,
    serviceRequestId,
    originalItemIds,
  );
}

/** オーダーとその明細をまとめて消す Bundle。 */
export function buildMicroOrderDeleteBundle(
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
// 新規登録(POST)にし、依頼日は当日・採取予定日時は空にする。
// 血液培養の 2 セット目は「DO して採取部位を変える」運用なので、この形が入口になる。
export function buildDoMicroOrderForm(
  values: MicroOrderFormValues,
  setting: PrescriptionSetting,
): MicroOrderFormValues {
  return {
    ...values,
    setting,
    authoredDate: today(),
    specimen: { ...values.specimen, id: "", collectionDateTime: "" },
    items: values.items.map((item) => ({ ...item, id: "" })),
  };
}

// ---- 一覧・カルテ表示のための parse ----

export interface MicroOrderSummary {
  settingDisplay: string;
  priorityDisplay: string;
  /** 至急のオーダーはカードで目立たせるため、区分そのものも返す。 */
  urgent: boolean;
}

export function summarizeMicroOrder(sr: fhir4.ServiceRequest): MicroOrderSummary {
  return {
    settingDisplay: categoryCoding(sr, SETTING_SYSTEM)?.display ?? "",
    priorityDisplay: priorityDisplay(sr.priority),
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

/** 明細が検体グループ(contained Specimen を持つ)かどうか。検査項目との振り分けに使う。 */
function isSpecimenGroupRequest(request: fhir4.ServiceRequest): boolean {
  return Boolean(containedSpecimenOf(request));
}

function parseSpecimenGroupRequest(request: fhir4.ServiceRequest): MicroSpecimenValues {
  const contained = containedSpecimenOf(request);
  const type = codingBySystem(contained?.type?.coding, SPECIMEN_TYPE_SYSTEM);
  const bodySite = contained?.collection?.bodySite?.coding;
  const site = codingBySystem(bodySite, COLLECTION_SITE_SYSTEM);
  const laterality = codingBySystem(bodySite, LATERALITY_SYSTEM);
  const method = codingBySystem(contained?.collection?.method?.coding, COLLECTION_METHOD_SYSTEM);
  const reasonReference = request.reasonReference?.find((r) =>
    r.reference?.startsWith("Condition/"),
  );

  return {
    id: request.id ?? "",
    typeCode: type?.code ?? "",
    typeName: type?.display ?? contained?.type?.text ?? "",
    siteCode: site?.code ?? "",
    siteName: site?.display ?? "",
    lateralityCode: laterality?.code ?? "",
    methodCode: method?.code ?? "",
    methodName: method?.display ?? "",
    // datetime-local の入力値に合わせて分までに丸める。
    collectionDateTime: request.occurrenceDateTime?.slice(0, 16) ?? "",
    organisms: (request.orderDetail ?? []).flatMap((detail) => {
      const coding = codingBySystem(detail.coding, ORGANISM_SYSTEM);
      return coding?.code ? [{ code: coding.code, name: coding.display ?? detail.text ?? "" }] : [];
    }),
    reasonConditionId: reasonReference?.reference?.split("/").pop() ?? "",
    reasonName: reasonReference?.display ?? request.reasonCode?.[0]?.text ?? "",
  };
}

function parseItemRequest(request: fhir4.ServiceRequest): MicroOrderItemLine {
  const itemCoding = codingBySystem(request.code?.coding, ORDER_ITEM_SYSTEM);
  return {
    id: request.id ?? "",
    code: itemCoding?.code ?? "",
    name: itemCoding?.display ?? request.code?.text ?? "",
    shortName: "",
  };
}

/**
 * オーダーの検体と検査項目。itemRequests には、そのオーダーにぶら下がる明細
 * (検体グループ・検査項目)を渡す(`_revinclude:iterate=ServiceRequest:based-on` で取得)。
 * UI は 1 検体だが、構造上は複数あり得るので先頭の検体グループを採る。
 */
export function microOrderContents(itemRequests: fhir4.ServiceRequest[]): {
  specimen: MicroSpecimenValues;
  items: MicroOrderItemLine[];
} {
  const sorted = [...itemRequests].sort((a, b) => itemNumber(a, ITEM_NUMBER_SYSTEM) - itemNumber(b, ITEM_NUMBER_SYSTEM));
  const group = sorted.find(isSpecimenGroupRequest);
  const items = sorted
    .filter((request) => !isSpecimenGroupRequest(request))
    .map(parseItemRequest);

  return {
    specimen: group ? parseSpecimenGroupRequest(group) : emptyMicroSpecimen(),
    items,
  };
}

/**
 * 「2026-08-11 喀出痰 塗抹・鏡検/培養・同定」のような 1 行要約。結果登録の
 * オーダー選択肢と、結果内容表示の紐付けオーダー表示に使う。
 * 検査項目名自体が「・」を含むため、項目の区切りは「/」にする。
 */
export function microOrderLabel(
  header: fhir4.ServiceRequest,
  itemRequests: fhir4.ServiceRequest[],
): string {
  const date = header.authoredOn?.slice(0, 10) ?? "";
  const contents = microOrderContents(itemRequests);
  const items = contents.items.map((item) => item.name).join("/");
  return [date, contents.specimen.typeName, items].filter(Boolean).join(" ");
}

/** ServiceRequest の一覧から、指定のオーダーにぶら下がる明細だけを取り出す。
 *  ヘッダ → 検体グループ → 検査項目の 2 段構造は検体検査と同じなので判定を流用する。 */
export function microOrderItemRequests(
  serviceRequests: fhir4.ServiceRequest[],
  headerId: string,
): fhir4.ServiceRequest[] {
  return labOrderItemRequests(serviceRequests, headerId);
}

export const microOrderComment = orderComment;
export const microOrderProblem = orderProblem;

export function microOrderPriorAntimicrobial(sr: fhir4.ServiceRequest): string {
  return sr.extension?.find((e) => e.url === PRIOR_ANTIMICROBIAL_EXT_URL)?.valueString ?? "";
}

export function microOrderExamPurpose(sr: fhir4.ServiceRequest): MicroExamPurpose {
  const code = sr.extension?.find((e) => e.url === EXAM_PURPOSE_EXT_URL)?.valueCode;
  return code === "diagnostic" || code === "surveillance" ? code : "";
}

// ---- 編集フォームへの復元 ----

export function parseMicroOrderForm(
  sr: fhir4.ServiceRequest,
  itemRequests: fhir4.ServiceRequest[] = [],
): MicroOrderFormValues {
  const contents = microOrderContents(itemRequests);
  return {
    setting: (categoryCoding(sr, SETTING_SYSTEM)?.code ?? "") as PrescriptionSetting,
    priority: (sr.priority === "urgent" ? "urgent" : "routine") as MicroOrderPriority,
    authoredDate: sr.authoredOn?.slice(0, 10) ?? today(),
    comment: microOrderComment(sr),
    priorAntimicrobial: microOrderPriorAntimicrobial(sr),
    examPurpose: microOrderExamPurpose(sr),
    problem: microOrderProblem(sr),
    specimen: contents.specimen,
    items: contents.items,
  };
}
