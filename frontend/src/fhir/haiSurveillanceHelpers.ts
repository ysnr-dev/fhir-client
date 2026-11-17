import type { LineDrainKind } from "../api/masterClient/lineDrain";
import { addDays, diffDays, localDay } from "../lib/dates";
import { observationIdsFromReport } from "./labResultHelpers";
import type { LineDrainRecord } from "./lineDrainHelpers";
import { parseMicroResultForm } from "./microResultHelpers";
import type { NcdSurgery } from "./ncdHelpers";
import { departmentOf } from "./orderHeader";
import { transactionBundle, withVersionLock } from "./shared";
import { summarizeSurgeryOrder } from "./surgeryOrderHelpers";
import { surgeryPerformRecord, type SurgeryPerformRecord } from "./surgeryResultHelpers";

/**
 * 医療関連感染サーベイランス(docs/hai-surveillance-design.md)。
 *
 * 感染の判定 1 件 = Observation 1 件。対象(手術の実施記録のハブ、または留置の Procedure)を partOf で指す
 * (上流で検索・_revinclude が効く参照)。手術部位感染(SSI)は手術のハブ、デバイス関連感染
 * (CLABSI / CAUTI / VAP)は留置を指す。判定の結果は valueCodeableConcept(感染あり / 感染なし)、
 * 診断日(感染なしは判定日)は effectiveDateTime、感染の深さ・埋入物・起因菌は component に持つ。
 */

const OBSERVATION_CATEGORY_SYSTEM = "http://fhir-client.local/CodeSystem/observation-category";
export const HAI_CATEGORY = { code: "hai-surveillance", display: "医療関連感染" } as const;
export const HAI_SYSTEM = "http://fhir-client.local/CodeSystem/hai-surveillance";

export type HaiType = "ssi" | "clabsi" | "cauti" | "vap";

export const HAI_TYPE_LABELS: Record<HaiType, string> = {
  ssi: "手術部位感染",
  clabsi: "中心ライン関連血流感染",
  cauti: "カテーテル関連尿路感染",
  vap: "人工呼吸器関連肺炎",
};

export type HaiResult = "infected" | "not-infected";

export const HAI_RESULT_OPTIONS: { code: HaiResult; display: string }[] = [
  { code: "infected", display: "感染あり" },
  { code: "not-infected", display: "感染なし" },
];

export type SsiDepth = "superficial" | "deep" | "organ-space";

export const SSI_DEPTH_OPTIONS: { code: SsiDepth; display: string }[] = [
  { code: "superficial", display: "表層切開創" },
  { code: "deep", display: "深部切開創" },
  { code: "organ-space", display: "臓器・体腔" },
];

export function ssiDepthLabel(depth: SsiDepth | ""): string {
  return SSI_DEPTH_OPTIONS.find((o) => o.code === depth)?.display ?? "";
}

/** 手術部位感染の観察期間(日)。埋入物のある手術は 90 日まで追う。 */
export const SSI_FOLLOW_UP_DAYS = 30;
export const SSI_IMPLANT_FOLLOW_UP_DAYS = 90;

const COMPONENT_DEPTH = "depth";
const COMPONENT_IMPLANT = "implant";
const COMPONENT_PATHOGEN = "pathogen";

/** 留置の区分に対応するデバイス関連感染。サーベイランスの対象でない区分は null。 */
export function haiTypeOfKind(kind: LineDrainKind): HaiType | null {
  if (kind === "vascular-central") return "clabsi";
  if (kind === "urinary") return "cauti";
  if (kind === "airway") return "vap";
  return null;
}

export interface HaiJudgment {
  id: string;
  type: HaiType;
  result: HaiResult;
  /** 診断日(感染なしは判定日)。YYYY-MM-DD。 */
  date: string;
  depth: SsiDepth | "";
  implant: boolean;
  pathogen: string;
  note: string;
  performer?: fhir4.Reference;
  /** 対象の Procedure(手術のハブ、または留置)の id。 */
  targetId: string;
  observation: fhir4.Observation;
}

export interface HaiJudgmentValues {
  result: HaiResult | "";
  date: string;
  depth: SsiDepth | "";
  implant: boolean;
  pathogen: string;
  note: string;
}

export function emptyHaiJudgmentValues(date: string): HaiJudgmentValues {
  return { result: "", date, depth: "", implant: false, pathogen: "", note: "" };
}

export function haiJudgmentValuesOf(judgment: HaiJudgment): HaiJudgmentValues {
  return {
    result: judgment.result,
    date: judgment.date,
    depth: judgment.depth,
    implant: judgment.implant,
    pathogen: judgment.pathogen,
    note: judgment.note,
  };
}

function haiCodeOf(concept: fhir4.CodeableConcept | undefined): string {
  return concept?.coding?.find((c) => c.system === HAI_SYSTEM)?.code ?? "";
}

export function isHaiObservation(observation: fhir4.Observation): boolean {
  return Boolean(
    observation.category?.some((category) =>
      category.coding?.some((c) => c.system === OBSERVATION_CATEGORY_SYSTEM && c.code === HAI_CATEGORY.code),
    ),
  );
}

export function parseHaiJudgment(observation: fhir4.Observation): HaiJudgment | null {
  if (!observation.id || !isHaiObservation(observation) || observation.status === "entered-in-error") return null;
  const type = haiCodeOf(observation.code);
  const result = haiCodeOf(observation.valueCodeableConcept);
  const targetId =
    observation.partOf?.map((p) => p.reference?.match(/^Procedure\/(.+)$/)?.[1] ?? "").find(Boolean) ?? "";
  if (!(type in HAI_TYPE_LABELS) || (result !== "infected" && result !== "not-infected") || !targetId) return null;
  const component = (key: string) => observation.component?.find((c) => haiCodeOf(c.code) === key);
  const depth = haiCodeOf(component(COMPONENT_DEPTH)?.valueCodeableConcept);
  return {
    id: observation.id,
    type: type as HaiType,
    result,
    date: localDay(observation.effectiveDateTime ?? ""),
    depth: SSI_DEPTH_OPTIONS.some((o) => o.code === depth) ? (depth as SsiDepth) : "",
    implant: component(COMPONENT_IMPLANT)?.valueBoolean === true,
    pathogen: component(COMPONENT_PATHOGEN)?.valueString ?? "",
    note: observation.note?.[0]?.text ?? "",
    performer: observation.performer?.[0],
    targetId,
    observation,
  };
}

/** 対象の Procedure の id → 判定。同じ対象に複数あれば診断日の新しいもの。 */
export function haiJudgmentsByTarget(observations: fhir4.Observation[]): Map<string, HaiJudgment> {
  const byTarget = new Map<string, HaiJudgment>();
  for (const observation of observations) {
    const judgment = parseHaiJudgment(observation);
    if (!judgment) continue;
    const current = byTarget.get(judgment.targetId);
    if (!current || current.date < judgment.date) byTarget.set(judgment.targetId, judgment);
  }
  return byTarget;
}

export function validateHaiJudgment(values: HaiJudgmentValues, type: HaiType, startDay: string, today: string): string | null {
  if (!values.result) return "判定を選んでください";
  if (!values.date) return values.result === "infected" ? "診断日を入力してください" : "判定日を入力してください";
  if (values.date > today) return "先の日付は入力できません";
  if (startDay && values.date < startDay) {
    return type === "ssi" ? "手術日より前の日付は入力できません" : "挿入日より前の日付は入力できません";
  }
  if (type === "ssi" && values.result === "infected" && !values.depth) return "感染部位を選んでください";
  return null;
}

export interface HaiJudgmentTarget {
  type: HaiType;
  patientId: string;
  procedureId: string;
  encounterId?: string;
}

function buildHaiObservation(values: HaiJudgmentValues, target: HaiJudgmentTarget, performer?: fhir4.Reference): fhir4.Observation {
  const infected = values.result === "infected";
  const result = HAI_RESULT_OPTIONS.find((o) => o.code === values.result);
  const concept = (code: string, display: string): fhir4.CodeableConcept => ({
    coding: [{ system: HAI_SYSTEM, code, display }],
  });
  const component: fhir4.ObservationComponent[] = [];
  if (target.type === "ssi") {
    if (infected && values.depth) {
      component.push({
        code: concept(COMPONENT_DEPTH, "感染部位"),
        valueCodeableConcept: concept(values.depth, ssiDepthLabel(values.depth)),
      });
    }
    if (values.implant) component.push({ code: concept(COMPONENT_IMPLANT, "埋入物"), valueBoolean: true });
  }
  if (infected && values.pathogen.trim()) {
    component.push({ code: concept(COMPONENT_PATHOGEN, "起因菌"), valueString: values.pathogen.trim() });
  }
  return {
    resourceType: "Observation",
    status: "final",
    category: [{ coding: [{ system: OBSERVATION_CATEGORY_SYSTEM, ...HAI_CATEGORY }] }],
    code: { ...concept(target.type, HAI_TYPE_LABELS[target.type]), text: HAI_TYPE_LABELS[target.type] },
    subject: { reference: `Patient/${target.patientId}` },
    ...(target.encounterId ? { encounter: { reference: `Encounter/${target.encounterId}` } } : {}),
    partOf: [{ reference: `Procedure/${target.procedureId}` }],
    effectiveDateTime: values.date,
    ...(performer ? { performer: [performer] } : {}),
    valueCodeableConcept: concept(values.result, result?.display ?? ""),
    ...(component.length ? { component } : {}),
    ...(values.note.trim() ? { note: [{ text: values.note.trim() }] } : {}),
  };
}

/**
 * 判定の登録・更新の transaction。更新はフォームから組み直すので、読んだ時点の版を ifMatch に添える。
 * 判定者は登録した人のまま変えない。
 */
export function buildHaiJudgmentBundle(
  values: HaiJudgmentValues,
  target: HaiJudgmentTarget,
  performer: fhir4.Reference | undefined,
  existing?: HaiJudgment,
): fhir4.Bundle {
  if (existing) {
    const url = `Observation/${existing.id}`;
    const resource = { ...buildHaiObservation(values, target, existing.performer ?? performer), id: existing.id };
    return withVersionLock(
      transactionBundle([{ fullUrl: url, resource, request: { method: "PUT", url } }]),
      existing.observation,
    );
  }
  return transactionBundle([
    {
      fullUrl: `urn:uuid:${crypto.randomUUID()}`,
      resource: buildHaiObservation(values, target, performer),
      request: { method: "POST", url: "Observation" },
    },
  ]);
}

// ---- 手術部位感染(SSI) ----

export type SsiState = "pending" | "none" | "infected";

export const SSI_STATE_LABELS: Record<SsiState, string> = {
  pending: "未判定",
  none: "感染なし",
  infected: "SSI",
};

/** 術後の培養陽性(判定の手がかり)。 */
export interface PositiveCulture {
  patientId: string;
  /** 採取日。 */
  date: string;
  material: string;
  organisms: string[];
}

/** 細菌検査結果のうち分離菌のあるものを、患者ごとの培養陽性にする。 */
export function positiveCulturesOf(
  reports: fhir4.DiagnosticReport[],
  observations: Map<string, fhir4.Observation>,
  specimens: Map<string, fhir4.Specimen>,
): PositiveCulture[] {
  return reports.flatMap((report) => {
    const reportObservations = observationIdsFromReport(report).flatMap((id) => observations.get(id) ?? []);
    const reportSpecimens = (report.specimen ?? []).flatMap(
      (ref) => specimens.get(ref.reference?.split("/").pop() ?? "") ?? [],
    );
    const values = parseMicroResultForm(report, reportObservations, reportSpecimens);
    const organisms = values.isolates.map((isolate) => isolate.organismName).filter(Boolean);
    if (organisms.length === 0) return [];
    return [
      {
        patientId: report.subject?.reference?.split("/").pop() ?? "",
        date: localDay(report.effectiveDateTime ?? ""),
        material: values.specimenTypeName,
        organisms,
      },
    ];
  });
}

export interface SsiRow {
  hub: fhir4.Procedure;
  patientId: string;
  encounterId: string;
  /** 手術日(入室日)。 */
  surgeryDate: string;
  record: SurgeryPerformRecord;
  departmentName: string;
  priorityDisplay: string;
  /** 執刀開始〜終了の分。時刻が欠けていれば null。 */
  operationMinutes: number | null;
  /** 術後の経過日数(今日 - 手術日)。 */
  postoperativeDays: number | null;
  /** 観察期間(日)。埋入物ありと判定されていれば 90 日。 */
  followUpDays: number;
  /** 観察期間を過ぎても判定が無い。 */
  overdue: boolean;
  state: SsiState;
  judgment?: HaiJudgment;
  /** 手術日の翌日から観察期間の終わりまでの培養陽性(採取日の古い順)。 */
  cultures: PositiveCulture[];
}

function minutesBetween(from: string, to: string): number | null {
  if (!from || !to) return null;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 60000) : null;
}

/** 手術(ハブ)に判定と術後の培養陽性を当てて行にする。行は手術日の新しい順。 */
export function ssiRows(surgeries: NcdSurgery[], cultures: PositiveCulture[], today: string): SsiRow[] {
  const culturesByPatient = new Map<string, PositiveCulture[]>();
  for (const culture of cultures) {
    culturesByPatient.set(culture.patientId, [...(culturesByPatient.get(culture.patientId) ?? []), culture]);
  }
  return surgeries
    .map(({ hub, children, observations, order }): SsiRow => {
      const record = surgeryPerformRecord(hub, children, observations);
      const surgeryDate = localDay(record.start);
      const patientId = hub.subject?.reference?.split("/").pop() ?? "";
      const judgment = haiJudgmentsByTarget(observations).get(hub.id ?? "");
      const followUpDays = judgment?.implant ? SSI_IMPLANT_FOLLOW_UP_DAYS : SSI_FOLLOW_UP_DAYS;
      const postoperativeDays = surgeryDate ? diffDays(surgeryDate, today) : null;
      const until = surgeryDate ? addDays(surgeryDate, followUpDays) : "";
      return {
        hub,
        patientId,
        encounterId: hub.encounter?.reference?.split("/").pop() ?? "",
        surgeryDate,
        record,
        departmentName: order ? departmentOf(order).departmentName : "",
        priorityDisplay: order ? summarizeSurgeryOrder(order).priorityDisplay : "",
        operationMinutes: minutesBetween(record.times.incisionStart, record.times.incisionEnd),
        postoperativeDays,
        followUpDays,
        overdue: !judgment && postoperativeDays !== null && postoperativeDays > followUpDays,
        state: !judgment ? "pending" : judgment.result === "infected" ? "infected" : "none",
        judgment,
        cultures: surgeryDate
          ? (culturesByPatient.get(patientId) ?? [])
              .filter((culture) => culture.date > surgeryDate && culture.date <= until)
              .sort((a, b) => a.date.localeCompare(b.date))
          : [],
      };
    })
    .sort((a, b) => b.record.start.localeCompare(a.record.start));
}

/** 「11/05 創部膿 MRSA」の行を並べた、培養陽性の内訳。 */
export function positiveCultureSummary(cultures: PositiveCulture[]): string {
  return cultures
    .map((c) => [c.date.slice(5).replace("-", "/"), c.material, c.organisms.join("・")].filter(Boolean).join(" "))
    .join("\n");
}

export interface SsiRateRow {
  label: string;
  surgeries: number;
  pending: number;
  infected: number;
  /** 感染の深さごとの件数(SSI_DEPTH_OPTIONS の並び)。 */
  byDepth: number[];
}

/** 発生率(%)。分母が 0 なら「-」。 */
export function ssiRateLabel(row: Pick<SsiRateRow, "surgeries" | "infected">): string {
  return row.surgeries > 0 ? ((row.infected / row.surgeries) * 100).toFixed(1) : "-";
}

/**
 * 手術を labelOf の値でまとめた発生率の表(件数の多い順、末尾に合計)。分母は期間内の手術すべてで、
 * 判定が済んでいない手術も含める(未判定の件数を並べて出す)。
 */
export function ssiRateSummary(rows: SsiRow[], labelOf: (row: SsiRow) => string): SsiRateRow[] {
  const empty = (label: string): SsiRateRow => ({
    label,
    surgeries: 0,
    pending: 0,
    infected: 0,
    byDepth: SSI_DEPTH_OPTIONS.map(() => 0),
  });
  const total = empty("合計");
  const groups = new Map<string, SsiRateRow>();
  for (const row of rows) {
    const label = labelOf(row) || "未入力";
    const group = groups.get(label) ?? empty(label);
    groups.set(label, group);
    for (const target of [group, total]) {
      target.surgeries += 1;
      if (row.state === "pending") target.pending += 1;
      if (row.state === "infected") {
        target.infected += 1;
        const index = SSI_DEPTH_OPTIONS.findIndex((o) => o.code === row.judgment?.depth);
        if (index >= 0) target.byDepth[index] += 1;
      }
    }
  }
  return [...[...groups.values()].sort((a, b) => b.surgeries - a.surgeries), total];
}

export const SSI_CSV_HEADER = [
  "患者番号",
  "氏名",
  "手術日",
  "術式",
  "術式コード",
  "依頼科",
  "予定区分",
  "創分類",
  "手術時間(分)",
  "埋入物",
  "判定",
  "感染部位",
  "診断日",
  "起因菌",
  "判定者",
  "コメント",
];

/** SSI の一覧の CSV の 1 行(患者番号・氏名は呼ぶ側が先頭に足す)。 */
export function ssiCsvCells(row: SsiRow): string[] {
  const [main] = row.record.procedures;
  const judgment = row.judgment;
  return [
    row.surgeryDate,
    main?.name ?? "",
    main?.code ?? "",
    row.departmentName,
    row.priorityDisplay,
    row.record.woundClass,
    row.operationMinutes === null ? "" : String(row.operationMinutes),
    judgment ? (judgment.implant ? "あり" : "なし") : "",
    SSI_STATE_LABELS[row.state],
    ssiDepthLabel(judgment?.depth ?? ""),
    judgment?.date ?? "",
    judgment?.pathogen ?? "",
    judgment?.performer?.display ?? "",
    judgment?.note ?? "",
  ];
}

// ---- デバイス関連感染(病棟 × 月) ----

export interface DeviceInfectionRow {
  record: LineDrainRecord;
  type: HaiType;
  patientId: string;
  judgment?: HaiJudgment;
}

/** 月と重なる留置のうちサーベイランスの対象(中心静脈・尿路・気道)を、判定を当てて行にする。挿入の新しい順。 */
export function deviceInfectionRows(records: LineDrainRecord[], judgments: Map<string, HaiJudgment>): DeviceInfectionRow[] {
  return records
    .flatMap((record): DeviceInfectionRow[] => {
      const type = haiTypeOfKind(record.kind);
      if (!type || record.status === "entered-in-error") return [];
      return [
        {
          record,
          type,
          patientId: record.procedure.subject.reference?.split("/").pop() ?? "",
          judgment: judgments.get(record.id),
        },
      ];
    })
    .sort((a, b) => (a.record.insertedAt < b.record.insertedAt ? 1 : -1));
}

/** 診断日が days(月内の集計対象の日)に入る感染の件数。 */
export function deviceInfectionCounts(rows: DeviceInfectionRow[], days: string[]): Record<Exclude<HaiType, "ssi">, number> {
  const counts = { clabsi: 0, cauti: 0, vap: 0 };
  const inMonth = new Set(days);
  for (const row of rows) {
    if (row.type === "ssi" || row.judgment?.result !== "infected" || !inMonth.has(row.judgment.date)) continue;
    counts[row.type] += 1;
  }
  return counts;
}

/** 1000 デバイス日あたりの感染率。分母が 0 なら「-」。 */
export function deviceInfectionRateLabel(infections: number, deviceDays: number): string {
  return deviceDays > 0 ? ((infections / deviceDays) * 1000).toFixed(1) : "-";
}
