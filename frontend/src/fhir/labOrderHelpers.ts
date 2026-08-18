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

// 検体検査オーダー。処方・注射と同じくオーダーヘッダは ServiceRequest で、
// 明細(検査項目)も 1 件ずつ独立した ServiceRequest にする。
//
//   ヘッダ ← basedOn ── 明細(単独の項目・パネル) ← basedOn ── パネルの構成項目
//
// カルテのタイムラインは患者の ServiceRequest を 1 本のページングで読むので、
// 明細がカードとして紛れ込まないよう `based-on:missing=true` でヘッダだけを
// 取り、明細は `_revinclude:iterate=ServiceRequest:based-on` で同じ応答に
// 添えてもらう(上流サーバーは 2026-08-09 に based-on 検索へ対応済み)。
//
// 明細の各 ServiceRequest は、オーダーした時点の検査項目マスタの内容(項目コード・
// 名称・略称・JLAC コード・検体・採取管)を写して持つ。マスタを直した後に過去の
// オーダーの中身が変わってしまわないよう、参照ではなく写しにしている。
//
// 明細を contained に入れていた頃・検査項目を orderDetail に直接持っていた頃の
// オーダーも読めるようにしてある(labOrderItems の読み出し順を参照)。

// 処方の ServiceRequest と区別するオーダー種別(注射と同じ CodeSystem)。
export const LAB_ORDER_TYPE = { code: "lab", display: "検体検査" };

// 検査項目コード(検体検査オーダー項目マスタの独自コード)。
const ORDER_ITEM_SYSTEM = "http://fhir-client.local/CodeSystem/lab-order-item";
// JLAC10 コード。JLAC11(labResultHelpers)と同じくローカル URI。
const JLAC10_SYSTEM = "http://fhir-client.local/CodeSystem/jlac10";
// 採取管。施設ごとのマスタなのでローカル URI。
const CONTAINER_SYSTEM = "http://fhir-client.local/CodeSystem/lab-container";

// 明細の ServiceRequest に添える検体。採る検体そのものを表す情報なので Specimen
// リソースにして、明細に contained して ServiceRequest.specimen で指す。採取管は
// Specimen.container.type に持つ(検体と採取管は 1 対 1 で決まる)。
// オーダー時点ではまだ採っていないので status(available など)は付けない。
const SPECIMEN_PROFILE = "http://jpfhir.jp/fhir/core/StructureDefinition/JP_Specimen_Common";
// contained の中だけで一意ならよいので、明細ごとに固定の id を使う。
const CONTAINED_SPECIMEN_ID = "specimen";

// 検体・採取管を拡張で持っていた頃の明細。読み出しのためだけに残してある。
const SPECIMEN_EXT_URL = "http://fhir-client.local/StructureDefinition/lab-order-specimen";
const CONTAINER_EXT_URL = "http://fhir-client.local/StructureDefinition/lab-order-container";

// 明細の並び順。独立したリソースは検索の戻り順が保証されないため、伝票で選んだ
// 順番を明細自身に持たせる(処方の RP 番号と同じ考え方)。
const ITEM_NUMBER_SYSTEM = "http://fhir-client.local/IdSystem/lab-order-item-number";


export type LabOrderPriority = "routine" | "urgent";

export const PRIORITY_OPTIONS: { code: LabOrderPriority; display: string }[] = [
  { code: "routine", display: "通常" },
  { code: "urgent", display: "至急" },
];

/** オーダーした検査項目 1 件。マスタの写しなので、表示に必要な値をすべて持つ。 */
export interface LabOrderItemLine {
  /** 明細の ServiceRequest の id。画面で足したばかりの項目は空(登録時に採番)。 */
  id: string;
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

// 1 行の要約に並べる検査項目の数。これを超えた分は「他 N 件」にまとめる。
const LABEL_ITEM_COUNT = 3;

/**
 * オーダー 1 件を 1 行で表す要約(「2026-08-09 末梢血液一般検査・CRP 他2件」)。
 * 検査結果の登録画面のオーダー選択や、紐付け先の表示のように、
 * オーダーの中身を展開できない狭い場所で使う。
 */
export function labOrderLabel(sr: fhir4.ServiceRequest, items: LabOrderItemLine[]): string {
  const date = (sr.occurrenceDateTime ?? sr.authoredOn ?? "").slice(0, 10);
  const names = topLevelItems(items)
    .map((item) => item.name)
    .filter(Boolean);
  const shown = names.slice(0, LABEL_ITEM_COUNT).join("・");
  const rest = names.length > LABEL_ITEM_COUNT ? ` 他${names.length - LABEL_ITEM_COUNT}件` : "";
  const urgent = sr.priority === "urgent" ? "【至急】" : "";
  return `${date} ${urgent}${shown || "(項目なし)"}${rest}`;
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

// 明細 1 件(検査項目 1 つ)の ServiceRequest。親(ヘッダ、またはパネル)を
// basedOn で指す。parentReference には Bundle 内の fullUrl をそのまま渡すので、
// 新規登録では urn:uuid、更新では ServiceRequest/{id} になる。
function buildItemRequest(
  item: LabOrderItemLine,
  sequence: number,
  patientId: string,
  authoredOn: string,
  parentReference: string,
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

  const resource: fhir4.ServiceRequest = {
    resourceType: "ServiceRequest",
    status: "active",
    intent: "order",
    identifier: [{ system: ITEM_NUMBER_SYSTEM, value: String(sequence) }],
    subject: { reference: `Patient/${patientId}` },
    authoredOn,
    code: { coding, text: item.name },
    basedOn: [{ reference: parentReference }],
  };
  if (item.id) resource.id = item.id;

  const specimen = buildItemSpecimen(item, patientId);
  if (specimen) {
    resource.contained = [specimen];
    resource.specimen = [
      { reference: `#${CONTAINED_SPECIMEN_ID}`, display: item.specimenName || undefined },
    ];
  }

  return resource;
}

// 明細に contained する Specimen。検体も採取管も決まっていない項目には付けない。
function buildItemSpecimen(item: LabOrderItemLine, patientId: string): fhir4.Specimen | undefined {
  if (!item.specimenCode && !item.containerCode) return undefined;

  const resource: fhir4.Specimen = {
    resourceType: "Specimen",
    id: CONTAINED_SPECIMEN_ID,
    meta: { profile: [SPECIMEN_PROFILE] },
    subject: { reference: `Patient/${patientId}` },
  };

  if (item.specimenCode) {
    resource.type = {
      coding: [
        {
          system: JLAC11_SPECIMEN_SYSTEM,
          code: item.specimenCode,
          display: item.specimenName || undefined,
        },
      ],
      text: item.specimenName || undefined,
    };
  }
  if (item.containerCode) {
    resource.container = [
      {
        type: {
          coding: [
            {
              system: CONTAINER_SYSTEM,
              code: item.containerCode,
              display: item.containerName || undefined,
            },
          ],
          text: item.containerName || undefined,
        },
      },
    ];
  }

  return resource;
}

// 明細が指している検体。ServiceRequest.specimen は contained への内部参照なので、
// 参照先を contained の中から引く。
function containedSpecimenOf(request: fhir4.ServiceRequest): fhir4.Specimen | undefined {
  const reference = request.specimen?.[0]?.reference;
  if (!reference?.startsWith("#")) return undefined;

  const id = reference.slice(1);
  return (request.contained ?? []).find(
    (resource): resource is fhir4.Specimen =>
      resource.resourceType === "Specimen" && resource.id === id,
  );
}

function parseItemRequest(request: fhir4.ServiceRequest, parentCode: string): LabOrderItemLine {
  const coding = request.code?.coding;
  // contained だった頃の明細は id がリソース内だけの文字列(item-1)なので拾わない。
  const id = request.id && !request.id.startsWith("item-") ? request.id : "";
  const itemCoding = codingBySystem(coding, ORDER_ITEM_SYSTEM);
  const jlac11 = codingBySystem(coding, JLAC11_SYSTEM);
  const jlac10 = codingBySystem(coding, JLAC10_SYSTEM);
  const abbreviation = codingBySystem(coding, ABBREVIATION_SYSTEM);
  const contained = containedSpecimenOf(request);
  // 検体・採取管を拡張で持っていた頃の明細のために、contained が無ければ拡張を読む。
  const specimen =
    codingBySystem(contained?.type?.coding, JLAC11_SPECIMEN_SYSTEM) ??
    request.extension?.find((e) => e.url === SPECIMEN_EXT_URL)?.valueCodeableConcept?.coding?.[0];
  const container =
    codingBySystem(contained?.container?.[0]?.type?.coding, CONTAINER_SYSTEM) ??
    request.extension?.find((e) => e.url === CONTAINER_EXT_URL)?.valueCodeableConcept?.coding?.[0];

  return {
    id,
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

// 明細の Bundle エントリ。既にある明細は PUT、画面で足したものは POST、
// 外した明細は DELETE(呼び出し側が元の id 一覧を渡す)。
function buildItemEntries(
  items: LabOrderItemLine[],
  patientId: string,
  authoredOn: string,
  headerReference: string,
  originalItemIds: string[],
): fhir4.BundleEntry[] {
  const entries: fhir4.BundleEntry[] = [];
  const kept = new Set<string>();
  let sequence = 0;

  const pushEntry = (item: LabOrderItemLine, parentReference: string): string => {
    sequence += 1;
    const fullUrl = item.id ? `ServiceRequest/${item.id}` : `urn:uuid:${crypto.randomUUID()}`;
    if (item.id) kept.add(item.id);

    entries.push({
      fullUrl,
      resource: buildItemRequest(item, sequence, patientId, authoredOn, parentReference),
      request: item.id
        ? { method: "PUT", url: `ServiceRequest/${item.id}` }
        : { method: "POST", url: "ServiceRequest" },
    });
    return fullUrl;
  };

  for (const item of topLevelItems(items)) {
    const itemReference = pushEntry(item, headerReference);
    for (const member of membersOf(items, item.code)) pushEntry(member, itemReference);
  }

  for (const id of originalItemIds) {
    if (!kept.has(id)) entries.push({ request: { method: "DELETE", url: `ServiceRequest/${id}` } });
  }

  return entries;
}

// 明細を独立したリソースにする前のオーダー。検査項目を orderDetail の
// CodeableConcept として直接持っていた(パネルの構成項目は持てなかった)。
// 過去のオーダーが「項目なし」に見えないよう、明細が無いときだけ読む。
function parseLegacyOrderDetail(detail: fhir4.CodeableConcept): LabOrderItemLine {
  const itemCoding = codingBySystem(detail.coding, ORDER_ITEM_SYSTEM);
  const jlac11 = codingBySystem(detail.coding, JLAC11_SYSTEM);
  const jlac10 = codingBySystem(detail.coding, JLAC10_SYSTEM);
  const specimen = detail.extension?.find((e) => e.url === SPECIMEN_EXT_URL)?.valueCodeableConcept
    ?.coding?.[0];
  const container = detail.extension?.find((e) => e.url === CONTAINER_EXT_URL)?.valueCodeableConcept
    ?.coding?.[0];

  return {
    id: "",
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

function itemNumber(request: fhir4.ServiceRequest): number {
  const value = request.identifier?.find((i) => i.system === ITEM_NUMBER_SYSTEM)?.value;
  // 番号を持たない明細(contained だった頃)は配列の順序のままにしたいので後ろに置かない。
  return value ? Number(value) : 0;
}

// 明細の ServiceRequest 群を、親子の分かる 1 本の配列にする。
// requests には単独の項目・パネル・パネルの構成項目が混ざって届く。
function parseItemRequests(
  requests: fhir4.ServiceRequest[],
  headerId: string | undefined,
): LabOrderItemLine[] {
  // 明細の id(または contained id)→ 項目コード。構成項目に親のコードを持たせる。
  const codeById = new Map<string, string>();
  for (const request of requests) {
    const code = codingBySystem(request.code?.coding, ORDER_ITEM_SYSTEM)?.code;
    if (request.id && code) codeById.set(request.id, code);
  }

  return [...requests]
    .sort((a, b) => itemNumber(a) - itemNumber(b))
    .map((request) => {
      const parentId = request.basedOn?.[0]?.reference?.replace(/^#/, "").split("/").pop() ?? "";
      // ヘッダを指しているものは単独で選んだ項目(親コードなし)。
      const parentCode = parentId === headerId ? "" : (codeById.get(parentId) ?? "");
      return parseItemRequest(request, parentCode);
    });
}

function buildLabOrderServiceRequest(
  values: LabOrderFormValues,
  patientId: string,
  requester: OrderContext,
  serviceRequestId?: string,
): fhir4.ServiceRequest {
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

// ヘッダ 1 件 + 明細 N 件の transaction Bundle。新規登録ではヘッダを urn:uuid で
// 参照するので、明細の basedOn はサーバー側で採番後の id に解決される。
function buildLabOrderTransactionBundle(
  values: LabOrderFormValues,
  patientId: string,
  requester: OrderContext,
  serviceRequestId?: string,
  originalItemIds: string[] = [],
): fhir4.Bundle {
  const headerReference = serviceRequestId
    ? `ServiceRequest/${serviceRequestId}`
    : `urn:uuid:${crypto.randomUUID()}`;

  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      {
        fullUrl: headerReference,
        resource: buildLabOrderServiceRequest(values, patientId, requester, serviceRequestId),
        request: serviceRequestId
          ? { method: "PUT", url: `ServiceRequest/${serviceRequestId}` }
          : { method: "POST", url: "ServiceRequest" },
      },
      ...buildItemEntries(
        values.items,
        patientId,
        values.authoredDate,
        headerReference,
        originalItemIds,
      ),
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
  originalItemIds: string[],
  requester: OrderContext,
): fhir4.Bundle {
  return buildLabOrderTransactionBundle(
    values,
    patientId,
    requester,
    serviceRequestId,
    originalItemIds,
  );
}

/** オーダーとその明細をまとめて消す Bundle。 */
export function buildLabOrderDeleteBundle(
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

// 既存のオーダーを DO(流用)して新規登録するためのフォーム値。処方・注射と同じく
// 明細の id を落として新規登録(POST)にし、検査日は当日にする。
export function buildDoLabOrderForm(values: LabOrderFormValues): LabOrderFormValues {
  return {
    ...values,
    authoredDate: today(),
    items: values.items.map((item) => ({ ...item, id: "" })),
  };
}

// ---- 一覧・カルテ表示のための parse ----

export interface LabOrderSummary {
  /** 入外区分のコード。一覧の絞り込みで使う(表示は settingDisplay)。 */
  settingCode: string;
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
  const setting = categoryCoding(sr, SETTING_SYSTEM);
  return {
    settingCode: setting?.code ?? "",
    settingDisplay: setting?.display ?? "",
    priorityDisplay: priorityDisplay(sr.priority),
    urgent: sr.priority === "urgent",
  };
}

/**
 * オーダーした検査項目(単独項目・パネル・パネルの構成項目をすべて含む平坦な一覧)。
 *
 * items には、そのオーダーにぶら下がる明細の ServiceRequest を渡す
 * (`_revinclude:iterate=ServiceRequest:based-on` で取得したもの)。
 * 明細を独立リソースにする前のオーダーのために、渡されなかった場合は
 * contained → orderDetail の順で読む。
 */
export function labOrderItems(
  sr: fhir4.ServiceRequest,
  items: fhir4.ServiceRequest[] = [],
): LabOrderItemLine[] {
  if (items.length > 0) return parseItemRequests(items, sr.id);

  const contained = (sr.contained ?? []).filter(
    (resource): resource is fhir4.ServiceRequest => resource.resourceType === "ServiceRequest",
  );
  if (contained.length > 0) return parseItemRequests(contained, sr.id);

  return (sr.orderDetail ?? []).map(parseLegacyOrderDetail);
}

/** 検索結果の Bundle から ServiceRequest だけを取り出す(ヘッダと明細が混ざって届く)。 */
export function serviceRequestsOf(bundle: fhir4.Bundle | undefined): fhir4.ServiceRequest[] {
  return (bundle?.entry ?? [])
    .map((entry) => entry.resource)
    .filter((resource): resource is fhir4.ServiceRequest => resource?.resourceType === "ServiceRequest");
}

/** ServiceRequest の一覧から、指定のオーダーにぶら下がる明細だけを取り出す。 */
export function labOrderItemRequests(
  serviceRequests: fhir4.ServiceRequest[],
  headerId: string,
): fhir4.ServiceRequest[] {
  const descendants = new Set([headerId]);
  // ヘッダ → 明細 → 構成項目の 2 段。親が先に入っていないと孫を拾えないので、
  // 増えなくなるまで繰り返す(件数は数十なので素朴に回してよい)。
  for (let depth = 0; depth < 2; depth += 1) {
    for (const request of serviceRequests) {
      const parentId = parentRequestId(request);
      if (parentId && descendants.has(parentId) && request.id) descendants.add(request.id);
    }
  }
  return serviceRequests.filter((request) => request.id !== headerId && descendants.has(request.id ?? ""));
}

/**
 * ServiceRequest が別の ServiceRequest の明細か(タイムラインのカードにしない)。
 * 検体検査・放射線検査とも明細をヘッダの basedOn 先にするので、判定は共通。
 */
export function isOrderItemRequest(sr: fhir4.ServiceRequest): boolean {
  return Boolean(parentRequestId(sr));
}

function parentRequestId(sr: fhir4.ServiceRequest): string | undefined {
  const reference = sr.basedOn?.[0]?.reference;
  return reference?.startsWith("ServiceRequest/") ? reference.split("/")[1] : undefined;
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

export function parseLabOrderForm(
  sr: fhir4.ServiceRequest,
  items: fhir4.ServiceRequest[] = [],
): LabOrderFormValues {
  return {
    setting: (categoryCoding(sr, SETTING_SYSTEM)?.code ?? "") as PrescriptionSetting,
    priority: (sr.priority === "urgent" ? "urgent" : "routine") as LabOrderPriority,
    authoredDate: sr.authoredOn?.slice(0, 10) ?? today(),
    comment: labOrderComment(sr),
    problem: labOrderProblem(sr),
    items: labOrderItems(sr, items),
  };
}
