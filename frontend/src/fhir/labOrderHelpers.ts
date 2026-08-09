import type { OrderContext } from "../orderContext";
import { problemRefFromReference, type ProblemRef } from "./conditionHelpers";
import { ABBREVIATION_SYSTEM, JLAC11_SPECIMEN_SYSTEM, JLAC11_SYSTEM } from "./labResultHelpers";
import {
  ORDER_TYPE_SYSTEM,
  SETTING_OPTIONS,
  SETTING_SYSTEM,
  applyOrderContext,
  codingBySystem,
  type PrescriptionSetting,
} from "./prescriptionHelpers";

// 検体検査オーダー。処方・注射と同じくオーダーヘッダは ServiceRequest だが、
// 明細も ServiceRequest で表す(パネル検査 → 構成項目の親子を FHIR 側で持つため)。
//
// 明細を独立したリソースにせず contained に入れている理由:
// (1) 上流 FHIR サーバーが ServiceRequest の based-on 検索に対応しておらず
//     (未知の検索パラメータは無視されて全件返る)、「このオーダーの子」を引けない。
// (2) カルテのタイムラインは患者の ServiceRequest を 1 本のページングで読むため、
//     項目ごとに独立したリソースを作ると 1 オーダーでページが埋まり、
//     「1 オーダー = 1 カード」で並べられなくなる(子を除外する検索もできない)。
// contained なら 1 リソースの読み書きで階層ごと扱えて、上記のどちらにも当たらない。
// 上流が based-on 検索に対応したら、独立リソースへの移行を検討する。
//
// 明細の各 ServiceRequest は、オーダーした時点の検査項目マスタの内容(項目コード・
// 名称・略称・JLAC コード・検体・採取管)を写して持つ。マスタを直した後に過去の
// オーダーの中身が変わってしまわないよう、参照ではなく写しにしている。
// パネルの構成項目も同じ明細として持ち、親のパネルを basedOn(#id)で指す。

// 処方の ServiceRequest と区別するオーダー種別(注射と同じ CodeSystem)。
export const LAB_ORDER_TYPE = { code: "lab", display: "検体検査" };

// 検査項目コード(検体検査オーダー項目マスタの独自コード)。
const ORDER_ITEM_SYSTEM = "http://fhir-client.local/CodeSystem/lab-order-item";
// JLAC10 コード。JLAC11(labResultHelpers)と同じくローカル URI。
const JLAC10_SYSTEM = "http://fhir-client.local/CodeSystem/jlac10";
// 採取管。施設ごとのマスタなのでローカル URI。
const CONTAINER_SYSTEM = "http://fhir-client.local/CodeSystem/lab-container";

// 明細の ServiceRequest に添える検体・採取管。CodeableConcept は 1 つの概念を
// 複数体系で表すものなので、検査項目とは別の概念である検体・採取管は拡張に持つ。
const SPECIMEN_EXT_URL = "http://fhir-client.local/StructureDefinition/lab-order-specimen";
const CONTAINER_EXT_URL = "http://fhir-client.local/StructureDefinition/lab-order-container";

// ヘッダの orderDetail から明細(contained の ServiceRequest)を指す拡張。
// 処方・注射が orderDetail から MedicationRequest を指すのと同じ形。
const ITEM_REQUEST_EXT_URL = "http://fhir-client.local/StructureDefinition/lab-order-item-request";

export type LabOrderPriority = "routine" | "urgent";

export const PRIORITY_OPTIONS: { code: LabOrderPriority; display: string }[] = [
  { code: "routine", display: "通常" },
  { code: "urgent", display: "至急" },
];

/** オーダーした検査項目 1 件。マスタの写しなので、表示に必要な値をすべて持つ。 */
export interface LabOrderItemLine {
  /** 検体検査オーダー項目マスタの項目コード。 */
  code: string;
  name: string;
  /** 略称(WBC など)。カードのように狭い場所で構成項目を並べるときに使う。 */
  shortName: string;
  jlacCode: string;
  /** jlac10 | jlac11。空ならコード体系不明(JLAC コード自体も空)。 */
  jlacCodeSystem: string;
  specimenCode: string;
  specimenName: string;
  containerCode: string;
  containerName: string;
  /**
   * パネル検査の構成項目としてオーダーした場合、その親(パネル)の項目コード。
   * 空ならオーダー画面で単独で選んだ項目。同じ項目がパネルの構成項目としても
   * 単独としても入ることはない(選択時にどちらか一方へ寄せる)。
   */
  parentCode: string;
}

export interface LabOrderFormValues {
  setting: PrescriptionSetting;
  priority: LabOrderPriority;
  /** 検査日(検体を採る日)。 */
  authoredDate: string;
  comment: string;
  // 対象プロブレム(POMR)。null なら特定の問題に紐付かない検査。
  problem: ProblemRef | null;
  items: LabOrderItemLine[];
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function emptyLabOrderForm(problem: ProblemRef | null = null): LabOrderFormValues {
  return {
    setting: "outpatient",
    priority: "routine",
    authoredDate: today(),
    comment: "",
    problem,
    items: [],
  };
}

function displayOf<T extends { code: string; display: string }>(options: T[], code: string): string {
  return options.find((o) => o.code === code)?.display ?? code;
}

export function priorityDisplay(priority: string | undefined): string {
  return priority ? displayOf(PRIORITY_OPTIONS, priority) : "";
}

// ---- 親子・検体ごとのまとめ ----
//
// 採血の現場は「どの容器に何を採るか」の単位で動くので、オーダー内容は
// 検体ごとにまとめて見せる(オーダー画面のプレビュー・カルテのカード・詳細で共用)。
// パネル検査の構成項目は、検体でばらさず親のパネルにぶら下げて見せる。

/** オーダーの 1 単位。パネルなら members にその構成項目が入る。 */
export interface LabOrderEntry {
  item: LabOrderItemLine;
  members: LabOrderItemLine[];
}

export interface LabSpecimenGroup {
  specimenCode: string;
  specimenName: string;
  containerName: string;
  entries: LabOrderEntry[];
}

/** 単独で選んだ項目(パネルを含む)。構成項目は除く。 */
export function topLevelItems(items: LabOrderItemLine[]): LabOrderItemLine[] {
  return items.filter((item) => !item.parentCode);
}

/** 指定したパネルの構成項目。 */
export function membersOf(items: LabOrderItemLine[], panelCode: string): LabOrderItemLine[] {
  return items.filter((item) => item.parentCode === panelCode);
}

export function groupBySpecimen(items: LabOrderItemLine[]): LabSpecimenGroup[] {
  const groups = new Map<string, LabSpecimenGroup>();

  for (const item of topLevelItems(items)) {
    const entry: LabOrderEntry = { item, members: membersOf(items, item.code) };
    const group = groups.get(item.specimenCode);
    if (group) {
      group.entries.push(entry);
      // 同じ検体で採取管が食い違うことは無い想定だが、先に入った空を埋める。
      if (!group.containerName) group.containerName = item.containerName;
    } else {
      groups.set(item.specimenCode, {
        specimenCode: item.specimenCode,
        specimenName: item.specimenName,
        containerName: item.containerName,
        entries: [entry],
      });
    }
  }

  // 検体が決まっていないもの(マスタで検体未設定の項目)は最後に置く。
  return Array.from(groups.values()).sort((a, b) => {
    if (!a.specimenCode) return 1;
    if (!b.specimenCode) return -1;
    return a.specimenCode.localeCompare(b.specimenCode);
  });
}

/** 構成項目を 1 行に並べたラベル(「WBC, RBC」)。狭い場所で親に添える。 */
export function memberSummary(members: LabOrderItemLine[]): string {
  return members.map((member) => member.shortName || member.name).join(", ");
}

/** 検体グループの見出し(「血清（生化学用分離剤入り管）」)。 */
export function specimenGroupLabel(group: LabSpecimenGroup): string {
  const name = group.specimenName || group.specimenCode || "検体未設定";
  return group.containerName ? `${name}（${group.containerName}）` : name;
}

// ---- FHIR リソースの組み立て ----

/** ServiceRequest が検体検査オーダーかどうか。処方・注射との振り分けに使う。 */
export function isLabServiceRequest(sr: fhir4.ServiceRequest): boolean {
  return (sr.category ?? []).some((category) =>
    category.coding?.some((c) => c.system === ORDER_TYPE_SYSTEM && c.code === LAB_ORDER_TYPE.code),
  );
}

function jlacSystemOf(codeSystem: string): string {
  return codeSystem === "jlac10" ? JLAC10_SYSTEM : JLAC11_SYSTEM;
}

// 明細 1 件(検査項目 1 つ)の ServiceRequest。contained に入れるので、
// リソース内で一意な id を位置から振る(項目コードは日本語などを含みうるため
// FHIR の id に使えない)。パネルの構成項目は親を basedOn(#id)で指す。
function buildItemRequest(
  item: LabOrderItemLine,
  containedId: string,
  patientId: string,
  parentContainedId?: string,
): fhir4.ServiceRequest {
  const coding: fhir4.Coding[] = [
    { system: ORDER_ITEM_SYSTEM, code: item.code, display: item.name },
  ];
  if (item.jlacCode) {
    coding.push({ system: jlacSystemOf(item.jlacCodeSystem), code: item.jlacCode, display: item.name });
  }
  if (item.shortName) {
    coding.push({ system: ABBREVIATION_SYSTEM, code: item.shortName, display: item.shortName });
  }

  const extension: fhir4.Extension[] = [];
  if (item.specimenCode) {
    extension.push({
      url: SPECIMEN_EXT_URL,
      valueCodeableConcept: {
        coding: [
          {
            system: JLAC11_SPECIMEN_SYSTEM,
            code: item.specimenCode,
            display: item.specimenName || undefined,
          },
        ],
      },
    });
  }
  if (item.containerCode) {
    extension.push({
      url: CONTAINER_EXT_URL,
      valueCodeableConcept: {
        coding: [
          {
            system: CONTAINER_SYSTEM,
            code: item.containerCode,
            display: item.containerName || undefined,
          },
        ],
      },
    });
  }

  const resource: fhir4.ServiceRequest = {
    resourceType: "ServiceRequest",
    id: containedId,
    status: "active",
    intent: "order",
    subject: { reference: `Patient/${patientId}` },
    code: { coding, text: item.name },
  };
  if (parentContainedId) resource.basedOn = [{ reference: `#${parentContainedId}` }];
  if (extension.length) resource.extension = extension;

  return resource;
}

function parseItemRequest(request: fhir4.ServiceRequest, parentCode: string): LabOrderItemLine {
  const coding = request.code?.coding;
  const itemCoding = codingBySystem(coding, ORDER_ITEM_SYSTEM);
  const jlac11 = codingBySystem(coding, JLAC11_SYSTEM);
  const jlac10 = codingBySystem(coding, JLAC10_SYSTEM);
  const abbreviation = codingBySystem(coding, ABBREVIATION_SYSTEM);
  const specimen = request.extension?.find((e) => e.url === SPECIMEN_EXT_URL)?.valueCodeableConcept
    ?.coding?.[0];
  const container = request.extension?.find((e) => e.url === CONTAINER_EXT_URL)?.valueCodeableConcept
    ?.coding?.[0];

  return {
    code: itemCoding?.code ?? "",
    name: itemCoding?.display ?? request.code?.text ?? "",
    shortName: abbreviation?.code ?? "",
    jlacCode: jlac11?.code ?? jlac10?.code ?? "",
    jlacCodeSystem: jlac11 ? "jlac11" : jlac10 ? "jlac10" : "",
    specimenCode: specimen?.code ?? "",
    specimenName: specimen?.display ?? "",
    containerCode: container?.code ?? "",
    containerName: container?.display ?? "",
    parentCode,
  };
}

interface BuiltItemRequests {
  contained: fhir4.ServiceRequest[];
  /** ヘッダから明細を指す orderDetail(単独で選んだ項目のぶんだけ)。 */
  orderDetail: fhir4.CodeableConcept[];
}

function buildItemRequests(items: LabOrderItemLine[], patientId: string): BuiltItemRequests {
  const contained: fhir4.ServiceRequest[] = [];
  const orderDetail: fhir4.CodeableConcept[] = [];

  topLevelItems(items).forEach((item, index) => {
    const containedId = `item-${index + 1}`;
    contained.push(buildItemRequest(item, containedId, patientId));
    orderDetail.push({
      extension: [{ url: ITEM_REQUEST_EXT_URL, valueReference: { reference: `#${containedId}` } }],
      text: item.name,
    });

    membersOf(items, item.code).forEach((member, memberIndex) => {
      contained.push(
        buildItemRequest(member, `${containedId}-${memberIndex + 1}`, patientId, containedId),
      );
    });
  });

  return { contained, orderDetail };
}

// 明細を contained にする前(パネルの構成項目を持たなかった頃)のオーダー。
// 検査項目を orderDetail の CodeableConcept として直接持っていた。
// 過去のオーダーが「項目なし」に見えないよう、contained が無いときだけ読む。
function parseLegacyOrderDetail(detail: fhir4.CodeableConcept): LabOrderItemLine {
  const itemCoding = codingBySystem(detail.coding, ORDER_ITEM_SYSTEM);
  const jlac11 = codingBySystem(detail.coding, JLAC11_SYSTEM);
  const jlac10 = codingBySystem(detail.coding, JLAC10_SYSTEM);
  const specimen = detail.extension?.find((e) => e.url === SPECIMEN_EXT_URL)?.valueCodeableConcept
    ?.coding?.[0];
  const container = detail.extension?.find((e) => e.url === CONTAINER_EXT_URL)?.valueCodeableConcept
    ?.coding?.[0];

  return {
    code: itemCoding?.code ?? "",
    name: itemCoding?.display ?? detail.text ?? "",
    shortName: "",
    jlacCode: jlac11?.code ?? jlac10?.code ?? "",
    jlacCodeSystem: jlac11 ? "jlac11" : jlac10 ? "jlac10" : "",
    specimenCode: specimen?.code ?? "",
    specimenName: specimen?.display ?? "",
    containerCode: container?.code ?? "",
    containerName: container?.display ?? "",
    parentCode: "",
  };
}

function parseItemRequests(sr: fhir4.ServiceRequest): LabOrderItemLine[] {
  const requests = (sr.contained ?? []).filter(
    (resource): resource is fhir4.ServiceRequest => resource.resourceType === "ServiceRequest",
  );
  if (requests.length === 0) {
    return (sr.orderDetail ?? []).map(parseLegacyOrderDetail);
  }

  // 親の contained id → 項目コード。構成項目に親のコードを持たせるために引く。
  const codeById = new Map<string, string>();
  for (const request of requests) {
    const code = codingBySystem(request.code?.coding, ORDER_ITEM_SYSTEM)?.code;
    if (request.id && code) codeById.set(request.id, code);
  }

  return requests.map((request) => {
    const parentId = request.basedOn?.[0]?.reference?.replace(/^#/, "") ?? "";
    return parseItemRequest(request, codeById.get(parentId) ?? "");
  });
}

function buildLabOrderServiceRequest(
  values: LabOrderFormValues,
  patientId: string,
  requester: OrderContext,
  serviceRequestId?: string,
): fhir4.ServiceRequest {
  const { contained, orderDetail } = buildItemRequests(values.items, patientId);
  const resource: fhir4.ServiceRequest = {
    resourceType: "ServiceRequest",
    status: "active",
    intent: "order",
    priority: values.priority,
    // 読み出し側は system で引くので順序には依存しない。入外区分は未選択のことが
    // あるので、空の Coding(code が空文字)を作らないよう選択時だけ足す。
    category: [
      { coding: [{ system: ORDER_TYPE_SYSTEM, ...LAB_ORDER_TYPE }] },
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
    // 検体を採る日。オーダー日と同じ日を入れる(検査日として 1 つだけ入力する)。
    occurrenceDateTime: values.authoredDate,
    // 明細は contained の ServiceRequest。orderDetail はヘッダから明細を指す索引で、
    // 単独で選んだ項目(パネルを含む)だけを並べる(構成項目は親の basedOn で辿る)。
    contained,
    orderDetail,
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
  if (values.comment) {
    resource.note = [{ text: values.comment }];
  }

  return resource;
}

// 明細は contained なので Bundle は 1 エントリだが、処方・注射と同じ
// transaction Bundle の POST で送る(mutation を共用するため)。
function buildLabOrderTransactionBundle(
  values: LabOrderFormValues,
  patientId: string,
  requester: OrderContext,
  serviceRequestId?: string,
): fhir4.Bundle {
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      {
        fullUrl: serviceRequestId
          ? `ServiceRequest/${serviceRequestId}`
          : `urn:uuid:${crypto.randomUUID()}`,
        resource: buildLabOrderServiceRequest(values, patientId, requester, serviceRequestId),
        request: serviceRequestId
          ? { method: "PUT", url: `ServiceRequest/${serviceRequestId}` }
          : { method: "POST", url: "ServiceRequest" },
      },
    ],
  };
}

export function buildLabOrderBundle(
  values: LabOrderFormValues,
  patientId: string,
  requester: OrderContext,
): fhir4.Bundle {
  return buildLabOrderTransactionBundle(values, patientId, requester);
}

export function buildLabOrderUpdateBundle(
  values: LabOrderFormValues,
  patientId: string,
  serviceRequestId: string,
  requester: OrderContext,
): fhir4.Bundle {
  return buildLabOrderTransactionBundle(values, patientId, requester, serviceRequestId);
}

// 既存のオーダーを DO(流用)して新規登録するためのフォーム値。処方・注射と同じく
// 検査日は当日にする。
export function buildDoLabOrderForm(values: LabOrderFormValues): LabOrderFormValues {
  return { ...values, authoredDate: today() };
}

// ---- 一覧・カルテ表示のための parse ----

export interface LabOrderSummary {
  settingDisplay: string;
  priorityDisplay: string;
  /** 至急のオーダーはカードで目立たせるため、区分そのものも返す。 */
  urgent: boolean;
}

function categoryCoding(sr: fhir4.ServiceRequest, system: string): fhir4.Coding | undefined {
  for (const category of sr.category ?? []) {
    const coding = codingBySystem(category.coding, system);
    if (coding) return coding;
  }
  return undefined;
}

export function summarizeLabOrder(sr: fhir4.ServiceRequest): LabOrderSummary {
  return {
    settingDisplay: categoryCoding(sr, SETTING_SYSTEM)?.display ?? "",
    priorityDisplay: priorityDisplay(sr.priority),
    urgent: sr.priority === "urgent",
  };
}

/** オーダーした検査項目(単独項目・パネル・パネルの構成項目をすべて含む平坦な一覧)。 */
export function labOrderItems(sr: fhir4.ServiceRequest): LabOrderItemLine[] {
  return parseItemRequests(sr);
}

export function labOrderComment(sr: fhir4.ServiceRequest): string {
  return sr.note?.[0]?.text ?? "";
}

export function labOrderProblem(sr: fhir4.ServiceRequest | undefined): ProblemRef | null {
  for (const reference of sr?.reasonReference ?? []) {
    const problem = problemRefFromReference(reference);
    if (problem) return problem;
  }
  return null;
}

// ---- 編集フォームへの復元 ----

export function parseLabOrderForm(sr: fhir4.ServiceRequest): LabOrderFormValues {
  return {
    setting: (categoryCoding(sr, SETTING_SYSTEM)?.code ?? "") as PrescriptionSetting,
    priority: (sr.priority === "urgent" ? "urgent" : "routine") as LabOrderPriority,
    authoredDate: sr.authoredOn?.slice(0, 10) ?? today(),
    comment: labOrderComment(sr),
    problem: labOrderProblem(sr),
    items: labOrderItems(sr),
  };
}
