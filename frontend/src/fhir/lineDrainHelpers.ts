import type { LineDrainKind, LineDrainType } from "../api/masterClient/lineDrain";
import { diffDays, localDay, toFhirDateTime } from "../lib/dates";
import { departmentExtension, departmentOf, type DepartmentRef } from "./orderHeader";
import { transactionBundle, withVersionLock } from "./shared";

/**
 * 留置物(ライン・ドレーン・カテーテル)の台帳(docs/line-drain-design.md)。
 *
 * 留置 1 件 = 挿入の Procedure 1 件。performedPeriod.start が挿入、end が抜去で、留置中は end を持たない
 * (上流の date 検索が「進行中」として引く)。管の実体(種別・製品・サイズ・ロット)は Device に持ち、
 * focalDevice で指す。上流に focalDevice を辿る検索が無いので、一覧・カード・経過表・患者帯が Device を
 * 引き直さずに済むよう、内容を manipulated.display に写す。刺入部観察は Observation.partOf で留置を指す。
 *
 * - category: オーダー由来の実施記録(order-type)と混ざらない procedure-category 体系の `line-drain`
 * - 抜去の区分: 標準要素 outcome(留置の結末)
 * - 記録者: performer(オーダーではなく処置・観察の記録なので Provenance を付けない。有害事象と同じ)
 */

export const LINE_DRAIN_CATEGORY_SYSTEM = "http://fhir-client.local/CodeSystem/procedure-category";
export const LINE_DRAIN_CATEGORY = { code: "line-drain", display: "留置物" } as const;
export const LINE_DRAIN_TYPE_SYSTEM = "http://fhir-client.local/CodeSystem/line-drain-type";
export const LINE_DRAIN_KIND_SYSTEM = "http://fhir-client.local/CodeSystem/line-drain-kind";
export const LINE_DRAIN_REMOVAL_SYSTEM = "http://fhir-client.local/CodeSystem/line-drain-removal";
const DEVICE_ACTION_SYSTEM = "http://hl7.org/fhir/CodeSystem/device-action";
const PROCEDURE_PROFILE = "http://jpfhir.jp/fhir/core/StructureDefinition/JP_Procedure";
const DEVICE_PROFILE = "http://jpfhir.jp/fhir/core/StructureDefinition/JP_Device";

const OBSERVATION_CATEGORY_SYSTEM = "http://fhir-client.local/CodeSystem/observation-category";
export const LINE_DRAIN_SITE_CATEGORY = { code: "line-drain-site", display: "刺入部観察" } as const;
export const LINE_DRAIN_SITE_SYSTEM = "http://fhir-client.local/CodeSystem/line-drain-site-finding";
const SITE_CHECK_CODE = { code: "site-check", display: "刺入部観察" } as const;

export const LINE_DRAIN_KIND_LABELS: Record<LineDrainKind, string> = {
  "vascular-central": "中心静脈",
  "vascular-peripheral": "末梢静脈",
  arterial: "動脈",
  urinary: "尿路",
  airway: "気道",
  gi: "消化管",
  drain: "ドレーン",
  other: "その他",
};

export const LINE_DRAIN_KIND_OPTIONS = (Object.keys(LINE_DRAIN_KIND_LABELS) as LineDrainKind[]).map((code) => ({
  code,
  display: LINE_DRAIN_KIND_LABELS[code],
}));

export type LineDrainRemovalReason = "planned" | "self" | "accidental" | "infection" | "occlusion" | "other";

export const REMOVAL_REASON_OPTIONS: { code: LineDrainRemovalReason; display: string }[] = [
  { code: "planned", display: "計画抜去" },
  { code: "self", display: "自己抜去" },
  { code: "accidental", display: "事故抜去" },
  { code: "infection", display: "感染疑い" },
  { code: "occlusion", display: "閉塞・不良" },
  { code: "other", display: "その他" },
];

/** 自己抜去・事故抜去。デバイス日数の表で「計画外抜去」に数える。 */
export function isUnplannedRemoval(reason: LineDrainRemovalReason | ""): boolean {
  return reason === "self" || reason === "accidental";
}

export function removalReasonLabel(reason: LineDrainRemovalReason | ""): string {
  return REMOVAL_REASON_OPTIONS.find((o) => o.code === reason)?.display ?? "";
}

export type LineDrainStatus = "in-progress" | "completed" | "entered-in-error";

export interface LineDrainRecord {
  id: string;
  status: LineDrainStatus;
  typeCode: string;
  typeName: string;
  kind: LineDrainKind;
  bodySite: string;
  deviceId: string;
  /** 「製品名 サイズ」の 1 行(Device の内容の写し)。 */
  deviceLabel: string;
  insertedAt: string;
  removedAt: string;
  removalReason: LineDrainRemovalReason | "";
  performer?: fhir4.Reference;
  purpose: string;
  note: string;
  removalNote: string;
  encounterId: string;
  procedure: fhir4.Procedure;
  /** 刺入部観察(新しい順)。 */
  observations: LineDrainSiteObservation[];
}

export interface LineDrainFormValues {
  typeCode: string;
  bodySite: string;
  size: string;
  productName: string;
  lotNumber: string;
  /** datetime-local の値(YYYY-MM-DDTHH:mm)。 */
  insertedAt: string;
  performerId: string;
  performerName: string;
  purpose: string;
  note: string;
}

export interface LineDrainRemovalValues {
  removedAt: string;
  reason: LineDrainRemovalReason | "";
  note: string;
}

export function emptyLineDrainForm(now: string): LineDrainFormValues {
  return {
    typeCode: "",
    bodySite: "",
    size: "",
    productName: "",
    lotNumber: "",
    insertedAt: now,
    performerId: "",
    performerName: "",
    purpose: "",
    note: "",
  };
}

export function isLineDrainProcedure(procedure: fhir4.Procedure): boolean {
  return Boolean(
    procedure.category?.coding?.some(
      (c) => c.system === LINE_DRAIN_CATEGORY_SYSTEM && c.code === LINE_DRAIN_CATEGORY.code,
    ),
  );
}

function codingOf(concept: fhir4.CodeableConcept | undefined, system: string): fhir4.Coding | undefined {
  return concept?.coding?.find((c) => c.system === system);
}

function isLineDrainKind(value: string | undefined): value is LineDrainKind {
  return Boolean(value && value in LINE_DRAIN_KIND_LABELS);
}

export function parseLineDrain(procedure: fhir4.Procedure, observations: fhir4.Observation[]): LineDrainRecord | null {
  if (!procedure.id || !isLineDrainProcedure(procedure)) return null;
  const status = procedure.status;
  if (status !== "in-progress" && status !== "completed" && status !== "entered-in-error") return null;
  const type = codingOf(procedure.code, LINE_DRAIN_TYPE_SYSTEM);
  const kind = codingOf(procedure.code, LINE_DRAIN_KIND_SYSTEM)?.code;
  const device = procedure.focalDevice?.[0]?.manipulated;
  const removal = codingOf(procedure.outcome, LINE_DRAIN_REMOVAL_SYSTEM)?.code as LineDrainRemovalReason | undefined;
  const ref = `Procedure/${procedure.id}`;
  return {
    id: procedure.id,
    status,
    typeCode: type?.code ?? "",
    typeName: type?.display ?? procedure.code?.text ?? "",
    kind: isLineDrainKind(kind) ? kind : "other",
    bodySite: procedure.bodySite?.[0]?.text ?? "",
    deviceId: device?.reference?.split("/").pop() ?? "",
    deviceLabel: device?.display ?? "",
    insertedAt: procedure.performedPeriod?.start ?? "",
    removedAt: procedure.performedPeriod?.end ?? "",
    removalReason: removal ?? "",
    performer: procedure.performer?.[0]?.actor,
    purpose: procedure.reasonCode?.[0]?.text ?? "",
    note: procedure.note?.[0]?.text ?? "",
    removalNote: procedure.note?.[1]?.text ?? "",
    encounterId: procedure.encounter?.reference?.split("/").pop() ?? "",
    procedure,
    observations: observations
      .filter((o) => o.partOf?.some((p) => p.reference === ref))
      .map(parseSiteObservation)
      .filter((o): o is LineDrainSiteObservation => o !== null)
      .sort((a, b) => (a.effectiveAt < b.effectiveAt ? 1 : -1)),
  };
}

/** 留置中を先に、挿入の新しい順。 */
export function sortLineDrains(records: LineDrainRecord[]): LineDrainRecord[] {
  return [...records].sort((a, b) => {
    if ((a.status === "in-progress") !== (b.status === "in-progress")) return a.status === "in-progress" ? -1 : 1;
    return a.insertedAt < b.insertedAt ? 1 : -1;
  });
}

/** 「種別 部位」。 */
export function lineDrainLabel(record: Pick<LineDrainRecord, "typeName" | "bodySite">): string {
  return [record.typeName, record.bodySite].filter(Boolean).join(" ");
}

/** 「製品名 サイズ」。 */
export function deviceLabelOf(values: Pick<LineDrainFormValues, "productName" | "size">): string {
  return [values.productName.trim(), values.size.trim()].filter(Boolean).join(" ");
}

/** 留置日数。挿入当日を 1 日目と数える。抜去済は抜去日まで。 */
export function daysInserted(record: Pick<LineDrainRecord, "insertedAt" | "removedAt">, today: string): number {
  if (!record.insertedAt) return 0;
  const end = record.removedAt ? localDay(record.removedAt) : today;
  return Math.max(0, diffDays(localDay(record.insertedAt), end)) + 1;
}

/** 「留置 n 日目」(留置中)/「n 日間」(抜去済)。 */
export function daysInsertedLabel(record: LineDrainRecord, today: string): string {
  const days = daysInserted(record, today);
  return record.status === "in-progress" ? `留置 ${days} 日目` : `${days} 日間`;
}

/** 種別マスタの警告日数を超えて留置しているか。 */
export function isOverWarnDays(record: LineDrainRecord, types: LineDrainType[], today: string): boolean {
  if (record.status !== "in-progress") return false;
  const warn = types.find((t) => t.code === record.typeCode)?.warn_days;
  return Boolean(warn && daysInserted(record, today) > warn);
}

export function validateLineDrain(values: LineDrainFormValues): string | null {
  if (!values.typeCode) return "種別を選んでください";
  if (!values.insertedAt) return "挿入日時を入力してください";
  return null;
}

export function validateRemoval(values: LineDrainRemovalValues, record: LineDrainRecord): string | null {
  if (!values.removedAt) return "抜去日時を入力してください";
  if (!values.reason) return "区分を選んでください";
  if (toFhirDateTime(values.removedAt) < record.insertedAt) return "抜去日時は挿入日時より後にしてください";
  return null;
}

export function formValuesOf(record: LineDrainRecord, device: fhir4.Device | undefined): LineDrainFormValues {
  return {
    typeCode: record.typeCode,
    bodySite: record.bodySite,
    size: device?.property?.[0]?.valueCode?.[0]?.text ?? "",
    productName: device?.deviceName?.[0]?.name ?? "",
    lotNumber: device?.lotNumber ?? "",
    insertedAt: record.insertedAt,
    performerId: record.performer?.reference?.split("/").pop() ?? "",
    performerName: record.performer?.display ?? "",
    purpose: record.purpose,
    note: record.note,
  };
}

export interface LineDrainBuildContext {
  patientId: string;
  department: DepartmentRef;
  encounterId?: string;
}

function buildDevice(values: LineDrainFormValues, type: LineDrainType, patientId: string): fhir4.Device {
  const productName = values.productName.trim();
  const size = values.size.trim();
  const lot = values.lotNumber.trim();
  return {
    resourceType: "Device",
    meta: { profile: [DEVICE_PROFILE] },
    status: "active",
    type: { coding: [{ system: LINE_DRAIN_TYPE_SYSTEM, code: type.code, display: type.name }] },
    ...(productName ? { deviceName: [{ name: productName, type: "user-friendly-name" }] } : {}),
    ...(lot ? { lotNumber: lot } : {}),
    ...(size ? { property: [{ type: { text: "サイズ" }, valueCode: [{ text: size }] }] } : {}),
    patient: { reference: `Patient/${patientId}` },
  };
}

function buildProcedure(
  values: LineDrainFormValues,
  type: LineDrainType,
  context: LineDrainBuildContext,
  deviceRef: string,
): fhir4.Procedure {
  const performerId = values.performerId.trim();
  const purpose = values.purpose.trim();
  const note = values.note.trim();
  return {
    resourceType: "Procedure",
    meta: { profile: [PROCEDURE_PROFILE] },
    status: "in-progress",
    category: { coding: [{ system: LINE_DRAIN_CATEGORY_SYSTEM, ...LINE_DRAIN_CATEGORY }] },
    code: {
      coding: [
        { system: LINE_DRAIN_TYPE_SYSTEM, code: type.code, display: type.name },
        { system: LINE_DRAIN_KIND_SYSTEM, code: type.kind, display: LINE_DRAIN_KIND_LABELS[type.kind] },
      ],
      text: type.name,
    },
    subject: { reference: `Patient/${context.patientId}` },
    ...(context.encounterId ? { encounter: { reference: `Encounter/${context.encounterId}` } } : {}),
    performedPeriod: { start: toFhirDateTime(values.insertedAt) },
    ...(values.bodySite.trim() ? { bodySite: [{ text: values.bodySite.trim() }] } : {}),
    focalDevice: [
      {
        action: { coding: [{ system: DEVICE_ACTION_SYSTEM, code: "implanted" }] },
        manipulated: { reference: deviceRef, ...(deviceLabelOf(values) ? { display: deviceLabelOf(values) } : {}) },
      },
    ],
    ...(performerId
      ? {
          performer: [
            {
              actor: {
                reference: `Practitioner/${performerId}`,
                ...(values.performerName.trim() ? { display: values.performerName.trim() } : {}),
              },
            },
          ],
        }
      : {}),
    ...(purpose ? { reasonCode: [{ text: purpose }] } : {}),
    ...(note ? { note: [{ text: note }] } : {}),
    ...(context.department.departmentId
      ? { extension: [departmentExtension(context.department.departmentId, context.department.departmentName)] }
      : {}),
  };
}

/** 新規登録の transaction(Device を POST し、Procedure がその urn で指す)。 */
export function buildLineDrainCreateBundle(
  values: LineDrainFormValues,
  type: LineDrainType,
  context: LineDrainBuildContext,
): fhir4.Bundle {
  const deviceUrl = `urn:uuid:${crypto.randomUUID()}`;
  const procedureUrl = `urn:uuid:${crypto.randomUUID()}`;
  return transactionBundle([
    { fullUrl: deviceUrl, resource: buildDevice(values, type, context.patientId), request: { method: "POST", url: "Device" } },
    {
      fullUrl: procedureUrl,
      resource: buildProcedure(values, type, context, deviceUrl),
      request: { method: "POST", url: "Procedure" },
    },
  ]);
}

/**
 * 編集の transaction。フォームから組み直すので、読んだ時点の Procedure と Device の版を ifMatch に添える。
 * 状態・抜去・診療科・入院は元のまま引き継ぐ(編集で変えるのは挿入の内容だけ)。
 */
export function buildLineDrainUpdateBundle(
  values: LineDrainFormValues,
  type: LineDrainType,
  record: LineDrainRecord,
  device: fhir4.Device | undefined,
): fhir4.Bundle {
  const original = record.procedure;
  const department = departmentOf(original);
  const deviceId = device?.id ?? record.deviceId;
  const deviceRef = `Device/${deviceId}`;
  const rebuilt = buildProcedure(
    values,
    type,
    { patientId: original.subject.reference?.split("/").pop() ?? "", department, encounterId: record.encounterId },
    deviceRef,
  );
  const procedure: fhir4.Procedure = {
    ...rebuilt,
    id: original.id,
    status: original.status,
    ...(original.performedPeriod?.end
      ? { performedPeriod: { ...rebuilt.performedPeriod, end: original.performedPeriod.end } }
      : {}),
    ...(original.outcome ? { outcome: original.outcome } : {}),
    ...(record.removalNote ? { note: [{ text: values.note.trim() }, { text: record.removalNote }] } : {}),
  };
  const entries: fhir4.BundleEntry[] = [
    { fullUrl: `Procedure/${original.id}`, resource: procedure, request: { method: "PUT", url: `Procedure/${original.id}` } },
  ];
  if (deviceId) {
    const rebuiltDevice = { ...buildDevice(values, type, record.procedure.subject.reference?.split("/").pop() ?? ""), id: deviceId };
    entries.unshift({ fullUrl: deviceRef, resource: rebuiltDevice, request: { method: "PUT", url: deviceRef } });
  }
  return withVersionLock(transactionBundle(entries), original, device);
}

/** 抜去。読んだ Procedure を書き換えて返す(版は postBundle が添える)。 */
export function removeLineDrain(procedure: fhir4.Procedure, values: LineDrainRemovalValues): fhir4.Procedure {
  const note = values.note.trim();
  const insertNote = procedure.note?.[0]?.text ?? "";
  return {
    ...procedure,
    status: "completed",
    performedPeriod: { ...procedure.performedPeriod, end: toFhirDateTime(values.removedAt) },
    outcome: {
      coding: [{ system: LINE_DRAIN_REMOVAL_SYSTEM, code: values.reason, display: removalReasonLabel(values.reason) }],
    },
    ...(note || insertNote ? { note: [{ text: insertNote }, ...(note ? [{ text: note }] : [])] } : {}),
  };
}

/** 抜去の取消(抜去済 → 留置中)。 */
export function reopenLineDrain(procedure: fhir4.Procedure): fhir4.Procedure {
  const { outcome: _outcome, ...rest } = procedure;
  const insertNote = procedure.note?.[0]?.text ?? "";
  const { end: _end, ...period } = procedure.performedPeriod ?? {};
  return {
    ...rest,
    status: "in-progress",
    performedPeriod: period,
    ...(insertNote ? { note: [{ text: insertNote }] } : { note: undefined }),
  };
}

export function markLineDrainEnteredInError(procedure: fhir4.Procedure): fhir4.Procedure {
  return { ...procedure, status: "entered-in-error" };
}

// ---- 刺入部観察 ----

export type SiteFindingGrade = "none" | "mild" | "marked";
export type SiteFixation = "ok" | "loose" | "detached";
export type SitePatency = "ok" | "sluggish" | "occluded";

export interface SiteFindingItem {
  key: string;
  label: string;
  options: { code: string; display: string }[];
  /** 表示する区分。無ければ全種別。 */
  kinds?: LineDrainKind[];
}

const GRADE_OPTIONS = [
  { code: "none", display: "なし" },
  { code: "mild", display: "軽度" },
  { code: "marked", display: "著明" },
];

export const SITE_FINDING_ITEMS: SiteFindingItem[] = [
  { key: "redness", label: "発赤", options: GRADE_OPTIONS },
  { key: "swelling", label: "腫脹", options: GRADE_OPTIONS },
  { key: "pain", label: "疼痛", options: GRADE_OPTIONS },
  { key: "exudate", label: "滲出液", options: GRADE_OPTIONS },
  {
    key: "fixation",
    label: "固定",
    options: [
      { code: "ok", display: "良" },
      { code: "loose", display: "緩み" },
      { code: "detached", display: "外れ" },
    ],
  },
  {
    key: "patency",
    label: "開通性",
    options: [
      { code: "ok", display: "良" },
      { code: "sluggish", display: "不良" },
      { code: "occluded", display: "閉塞" },
    ],
    kinds: ["vascular-central", "vascular-peripheral", "arterial", "urinary", "gi", "drain"],
  },
];

export const DRESSING_KEY = "dressing";

export interface LineDrainSiteFormValues {
  effectiveAt: string;
  /** 項目 key → 選んだ code。未選択は空。 */
  findings: Record<string, string>;
  dressing: boolean;
  note: string;
  performerId: string;
  performerName: string;
}

export interface LineDrainSiteObservation {
  id: string;
  effectiveAt: string;
  findings: Record<string, string>;
  dressing: boolean;
  note: string;
  performer?: fhir4.Reference;
  observation: fhir4.Observation;
}

export function emptySiteForm(now: string): LineDrainSiteFormValues {
  return { effectiveAt: now, findings: {}, dressing: false, note: "", performerId: "", performerName: "" };
}

/** 区分に合う観察項目。 */
export function siteFindingItemsFor(kind: LineDrainKind): SiteFindingItem[] {
  return SITE_FINDING_ITEMS.filter((item) => !item.kinds || item.kinds.includes(kind));
}

export function validateSiteObservation(values: LineDrainSiteFormValues): string | null {
  if (!values.effectiveAt) return "観察日時を入力してください";
  const any = Object.values(values.findings).some(Boolean) || values.dressing || values.note.trim();
  return any ? null : "観察の項目を 1 つ以上入れてください";
}

export function buildSiteObservation(
  values: LineDrainSiteFormValues,
  record: LineDrainRecord,
  patientId: string,
  id?: string,
): fhir4.Observation {
  const components: fhir4.ObservationComponent[] = [];
  for (const item of SITE_FINDING_ITEMS) {
    const code = values.findings[item.key];
    if (!code) continue;
    const display = item.options.find((o) => o.code === code)?.display ?? code;
    components.push({
      code: { coding: [{ system: LINE_DRAIN_SITE_SYSTEM, code: item.key, display: item.label }] },
      valueCodeableConcept: { coding: [{ system: LINE_DRAIN_SITE_SYSTEM, code, display }] },
    });
  }
  if (values.dressing) {
    components.push({
      code: { coding: [{ system: LINE_DRAIN_SITE_SYSTEM, code: DRESSING_KEY, display: "ドレッシング交換" }] },
      valueBoolean: true,
    });
  }
  const performerId = values.performerId.trim();
  return {
    resourceType: "Observation",
    ...(id ? { id } : {}),
    status: "final",
    category: [{ coding: [{ system: OBSERVATION_CATEGORY_SYSTEM, ...LINE_DRAIN_SITE_CATEGORY }] }],
    code: { coding: [{ system: LINE_DRAIN_SITE_SYSTEM, ...SITE_CHECK_CODE }], text: SITE_CHECK_CODE.display },
    subject: { reference: `Patient/${patientId}` },
    ...(record.encounterId ? { encounter: { reference: `Encounter/${record.encounterId}` } } : {}),
    partOf: [{ reference: `Procedure/${record.id}` }],
    effectiveDateTime: toFhirDateTime(values.effectiveAt),
    ...(performerId
      ? {
          performer: [
            {
              reference: `Practitioner/${performerId}`,
              ...(values.performerName.trim() ? { display: values.performerName.trim() } : {}),
            },
          ],
        }
      : {}),
    ...(components.length ? { component: components } : {}),
    ...(values.note.trim() ? { note: [{ text: values.note.trim() }] } : {}),
  };
}

export function parseSiteObservation(observation: fhir4.Observation): LineDrainSiteObservation | null {
  if (!observation.id) return null;
  const findings: Record<string, string> = {};
  let dressing = false;
  for (const component of observation.component ?? []) {
    const key = codingOf(component.code, LINE_DRAIN_SITE_SYSTEM)?.code;
    if (!key) continue;
    if (key === DRESSING_KEY) dressing = component.valueBoolean === true;
    else {
      const code = codingOf(component.valueCodeableConcept, LINE_DRAIN_SITE_SYSTEM)?.code;
      if (code) findings[key] = code;
    }
  }
  return {
    id: observation.id,
    effectiveAt: observation.effectiveDateTime ?? "",
    findings,
    dressing,
    note: observation.note?.[0]?.text ?? "",
    performer: observation.performer?.[0],
    observation,
  };
}

/** 「発赤 軽度 / 滲出液 なし / ドレッシング交換」の 1 行。 */
export function siteObservationSummary(observation: LineDrainSiteObservation): string {
  const parts = SITE_FINDING_ITEMS.flatMap((item) => {
    const code = observation.findings[item.key];
    if (!code) return [];
    const display = item.options.find((o) => o.code === code)?.display ?? code;
    return [`${item.label} ${display}`];
  });
  if (observation.dressing) parts.push("ドレッシング交換");
  if (observation.note) parts.push(observation.note);
  return parts.join(" / ");
}

// ---- 施設の規則・テンプレートの変数 %devices ----

export interface LineDrainPopulateValue {
  code: string;
  name: string;
  kind: LineDrainKind;
  bodySite: string;
  insertedAt: string;
  daysInserted: number;
}

/** 留置中の管を %devices の各要素にする。 */
export function lineDrainPopulateValues(procedures: fhir4.Procedure[], today: string): LineDrainPopulateValue[] {
  return procedures
    .map((p) => parseLineDrain(p, []))
    .filter((r): r is LineDrainRecord => r !== null && r.status === "in-progress")
    .map((r) => ({
      code: r.typeCode,
      name: r.typeName,
      kind: r.kind,
      bodySite: r.bodySite,
      insertedAt: r.insertedAt,
      daysInserted: daysInserted(r, today),
    }));
}

// ---- デバイス日数(病棟 × 月) ----

/** デバイス日数の表の系統。中心静脈・尿路・気道を分け、残りはまとめる。 */
export const DEVICE_DAY_GROUPS = [
  { key: "vascular-central", label: "中心静脈カテーテル" },
  { key: "urinary", label: "尿道留置カテーテル" },
  { key: "airway", label: "気管チューブ" },
  { key: "other", label: "その他" },
] as const;
export type DeviceDayGroup = (typeof DEVICE_DAY_GROUPS)[number]["key"];

export function deviceDayGroupOf(kind: LineDrainKind): DeviceDayGroup {
  return kind === "vascular-central" || kind === "urinary" || kind === "airway" ? kind : "other";
}

export interface DeviceDayStats {
  deviceDays: number;
  inserted: number;
  removed: number;
  unplannedRemoved: number;
}

export interface LineDrainMonthStats {
  /** 月内の患者延べ日数(在院した患者 × 日)。 */
  patientDays: number;
  groups: Record<DeviceDayGroup, DeviceDayStats>;
}

function emptyStats(): DeviceDayStats {
  return { deviceDays: 0, inserted: 0, removed: 0, unplannedRemoved: 0 };
}

/**
 * 病棟 × 月のデバイス日数。presence は日 → その日に病棟に居た患者 id の集合。日ごとに、居た患者の
 * 留置のうち「挿入日 ≤ 日 かつ(抜去なし または 抜去日 ≥ 日)」の件数を足す。新規挿入・抜去は
 * その日が月内で患者が居た日のものだけ数える。
 */
export function lineDrainMonthStats(
  presence: Map<string, Set<string>>,
  records: LineDrainRecord[],
  days: string[],
): LineDrainMonthStats {
  const groups = Object.fromEntries(DEVICE_DAY_GROUPS.map((g) => [g.key, emptyStats()])) as Record<
    DeviceDayGroup,
    DeviceDayStats
  >;
  let patientDays = 0;
  const byPatient = new Map<string, LineDrainRecord[]>();
  for (const record of records) {
    if (record.status === "entered-in-error" || !record.insertedAt) continue;
    const patientId = record.procedure.subject.reference?.split("/").pop() ?? "";
    byPatient.set(patientId, [...(byPatient.get(patientId) ?? []), record]);
  }
  for (const day of days) {
    const patients = presence.get(day);
    if (!patients) continue;
    patientDays += patients.size;
    for (const patientId of patients) {
      for (const record of byPatient.get(patientId) ?? []) {
        const start = localDay(record.insertedAt);
        const end = record.removedAt ? localDay(record.removedAt) : "";
        const stats = groups[deviceDayGroupOf(record.kind)];
        if (start <= day && (!end || end >= day)) stats.deviceDays += 1;
        if (start === day) stats.inserted += 1;
        if (end === day) {
          stats.removed += 1;
          if (isUnplannedRemoval(record.removalReason)) stats.unplannedRemoved += 1;
        }
      }
    }
  }
  return { patientDays, groups };
}
