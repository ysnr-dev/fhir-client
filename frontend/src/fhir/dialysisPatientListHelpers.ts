import { diffDays, localDay } from "../lib/dates";
import {
  dialysisSessionDay,
  dialysisSessionDisplay,
  type DialysisSession,
  type DialysisSessionDisplay,
  type DryWeight,
  dryWeightOf,
} from "./dialysisResultHelpers";
import { summarizeDialysisOrder } from "./dialysisOrderHelpers";
import { dialysisTaskStatus } from "./dialysisTaskHelpers";
import { interpretationCodeOf, RESULT_ITEM_SYSTEM } from "./labResultHelpers";
import { codingBySystem, referenceIdOfType } from "./shared";

// 透析患者一覧(docs/dialysis-order-design.md §6.2)。基準日に効いている透析室の透析オーダーの患者を 1 人 1 行にし、
// ドライウェイトの推移・直近の透析・直近の採血・バスキュラーアクセスを並べる。

/**
 * 一覧に並べる採血の項目。結果項目コード(同梱の検体検査マスタ = レセ電算の検査コード)で引く。
 * 上流のコード検索は完全一致なので、JLAC11 の分析物での前方一致はできない。
 */
export const DIALYSIS_LAB_ITEMS = [
  { key: "hb", label: "Hb", resultItemCode: "160008010-03" },
  { key: "alb", label: "Alb", resultItemCode: "160018910" },
  { key: "k", label: "K", resultItemCode: "160021410" },
  { key: "ip", label: "P", resultItemCode: "160021810" },
  { key: "ca", label: "Ca", resultItemCode: "160021510" },
] as const;

export type DialysisLabKey = (typeof DIALYSIS_LAB_ITEMS)[number]["key"];

/** 何日前までの採血を「直近」として拾うか。 */
export const DIALYSIS_LAB_LOOKBACK_DAYS = 90;

/** 直近の透析と、その前の回を探す範囲(週 1 回の患者でも前の回が入るように 3 週)。 */
export const DIALYSIS_SESSION_LOOKBACK_DAYS = 21;

/** ドライウェイトの推移に並べる件数(古い → 新しい)。 */
const DRY_WEIGHT_HISTORY = 4;

export function dialysisLabSearchCodes(): string {
  return DIALYSIS_LAB_ITEMS.map((item) => `${RESULT_ITEM_SYSTEM}|${item.resultItemCode}`).join(",");
}

export interface DialysisLabValue {
  text: string;
  /** H / L / HH / LL。基準内・未判定は空。 */
  interpretation: string;
  date: string;
}

export interface DialysisLabSnapshot {
  /** 一覧の項目のうち最も新しい採血の日。 */
  date: string;
  values: Partial<Record<DialysisLabKey, DialysisLabValue>>;
}

const IGNORED_OBSERVATION_STATUSES = new Set(["entered-in-error", "cancelled", "registered"]);

function labValueText(observation: fhir4.Observation): string {
  const quantity = observation.valueQuantity;
  if (quantity?.value != null) return String(quantity.value);
  return observation.valueString ?? "";
}

/** 項目ごとに基準日以前で最も新しい結果。 */
export function latestDialysisLabs(observations: readonly fhir4.Observation[], baseDate: string): DialysisLabSnapshot {
  const values: DialysisLabSnapshot["values"] = {};
  const sorted = observations
    .filter((o) => !IGNORED_OBSERVATION_STATUSES.has(o.status))
    .map((o) => ({ observation: o, date: localDay(o.effectiveDateTime) }))
    .filter((entry) => entry.date && entry.date <= baseDate)
    .sort((a, b) => (b.observation.effectiveDateTime ?? "").localeCompare(a.observation.effectiveDateTime ?? ""));
  for (const { observation, date } of sorted) {
    const code = codingBySystem(observation.code?.coding, RESULT_ITEM_SYSTEM)?.code;
    const item = DIALYSIS_LAB_ITEMS.find((i) => i.resultItemCode === code);
    if (!item || values[item.key]) continue;
    const text = labValueText(observation);
    if (!text) continue;
    values[item.key] = { text, interpretation: interpretationCodeOf(observation), date };
  }
  const dates = Object.values(values).map((value) => value.date);
  return { date: dates.sort().pop() ?? "", values };
}

/** 基準日以前のドライウェイト(古い → 新しい)。 */
export function dryWeightHistory(observations: readonly fhir4.Observation[], baseDate: string): DryWeight[] {
  return observations
    .filter((o) => !IGNORED_OBSERVATION_STATUSES.has(o.status))
    .flatMap((o) => {
      const dw = dryWeightOf(o);
      return dw && dw.date && dw.date <= baseDate ? [{ ...dw, at: o.effectiveDateTime ?? "" }] : [];
    })
    .sort((a, b) => a.at.localeCompare(b.at))
    .map(({ value, date }) => ({ value, date }));
}

function dryWeightOn(history: readonly DryWeight[], date: string): DryWeight | undefined {
  return [...history].reverse().find((dw) => dw.date <= date);
}

/** 透析間の体重増加(今回の透析前 − 前回の透析後)。 */
export interface DialysisWeightGain {
  kg: number;
  /** DW に対する割合(%)。DW が無ければ undefined。 */
  percent?: number;
  /** 前回との間の日数(中 2 日なら 2)。 */
  interval: number;
}

export interface DialysisPatientRow {
  patientId: string;
  patient?: fhir4.Patient;
  order: fhir4.ServiceRequest;
  /** 次回以降の予約(近い順)。 */
  appointments: fhir4.Appointment[];
  dryWeights: DryWeight[];
  latest?: DialysisSessionDisplay;
  /** 直近の透析後体重 − その日の DW。 */
  postDiff?: number;
  weightGain?: DialysisWeightGain;
  labs: DialysisLabSnapshot;
}

/** 透析一覧の 1 行(オーダー・患者・進捗・基準日以降の予約)。 */
export interface DialysisOrderRow {
  order: fhir4.ServiceRequest;
  patient?: fhir4.Patient;
  task?: fhir4.Task;
  appointments: fhir4.Appointment[];
}

export function dialysisSessionPatientId(session: DialysisSession): string {
  return referenceIdOfType(session.hub.subject?.reference, "Patient");
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * 一覧の対象 = 基準日に効いている透析室の透析オーダー(ベッドサイド・中止・受付取消を除く)の患者。
 * 1 人に複数のオーダー(入院と外来など)があれば開始日の新しいほうを採る。
 */
export function dialysisPatientOrders<T extends DialysisOrderRow>(rows: readonly T[]): T[] {
  const byPatient = new Map<string, T>();
  for (const row of rows) {
    const patientId = row.patient?.id;
    if (!patientId || row.order.status !== "active") continue;
    if (dialysisTaskStatus(row.task) === "cancelled") continue;
    const summary = summarizeDialysisOrder(row.order);
    if (summary.bedside) continue;
    const current = byPatient.get(patientId);
    if (!current || summarizeDialysisOrder(current.order).startDate < summary.startDate) byPatient.set(patientId, row);
  }
  return rows.filter((row) => row.patient?.id && byPatient.get(row.patient.id) === row);
}

export interface DialysisPatientRowInput {
  rows: readonly DialysisOrderRow[];
  baseDate: string;
  sessions: readonly DialysisSession[];
  dryWeightsByPatient: ReadonlyMap<string, fhir4.Observation[]>;
  labsByPatient: ReadonlyMap<string, fhir4.Observation[]>;
}

export function buildDialysisPatientRows(input: DialysisPatientRowInput): DialysisPatientRow[] {
  const finished = input.sessions.filter(
    (session) =>
      (session.hub.status === "completed" || session.hub.status === "stopped") &&
      dialysisSessionDay(session) &&
      dialysisSessionDay(session) <= input.baseDate,
  );
  return dialysisPatientOrders(input.rows).map((row) => {
    const patientId = row.patient?.id ?? "";
    const dryWeights = dryWeightHistory(input.dryWeightsByPatient.get(patientId) ?? [], input.baseDate);
    const own = finished
      .filter((session) => dialysisSessionPatientId(session) === patientId)
      .sort((a, b) => (b.hub.performedPeriod?.start ?? "").localeCompare(a.hub.performedPeriod?.start ?? ""));
    const latest = own[0] ? dialysisSessionDisplay(own[0]) : undefined;
    const previous = own[1] ? dialysisSessionDisplay(own[1]) : undefined;
    const dw = latest ? dryWeightOn(dryWeights, latest.date) : undefined;

    let weightGain: DialysisWeightGain | undefined;
    if (latest?.preWeight != null && previous?.postWeight != null) {
      const kg = round1(latest.preWeight - previous.postWeight);
      weightGain = {
        kg,
        percent: dw ? round1((kg / dw.value) * 100) : undefined,
        interval: Math.max(diffDays(previous.date, latest.date) - 1, 0),
      };
    }

    return {
      patientId,
      patient: row.patient,
      order: row.order,
      appointments: row.appointments,
      dryWeights: dryWeights.slice(-DRY_WEIGHT_HISTORY),
      latest,
      postDiff: latest?.postWeight != null && dw ? round1(latest.postWeight - dw.value) : undefined,
      weightGain,
      labs: latestDialysisLabs(input.labsByPatient.get(patientId) ?? [], input.baseDate),
    };
  });
}

/** 「+0.3」「-0.5」「±0」。 */
export function signedKg(value: number): string {
  if (value === 0) return "±0";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}
