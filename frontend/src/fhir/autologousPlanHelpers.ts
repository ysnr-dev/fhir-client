import { addDays, diffDays, localDay, nowFhirDateTime, toFhirDateTime } from "../lib/dates";
import { type Advisory, advisoryKey, severityOf } from "./advisoryHelpers";
import { isAutologousAppointment } from "./appointmentHelpers";
import {
  APPOINTMENT_TYPE_SYSTEM,
  DEFAULT_APPOINTMENT_TYPE,
  SERVICE_TYPE_SYSTEM,
  appointmentTypeLabel,
} from "./scheduleHelpers";

// 自己血貯血の採血予定(docs/transfusion-order-design.md §2.9)。
//
//   輸血オーダー ServiceRequest ←basedOn── Appointment ×N = 採血予定 1 回(枠は持たない)
//     serviceType = autologous / start・end = 予定日時 / extension = 予定量
//     status: booked(未採血)→ fulfilled(採血済)/ cancelled(取消)
//
// 採血記録(autologousHelpers.ts)のハブは予定を拡張 autologous-appointment で指し、採血登録の
// transaction で予定を fulfilled にする。予定を Appointment にするのは、採血予定日で一覧を引ける
// (`Appointment?service-type=…&date=`)、カルテの予約タブに出る、オーダーの削除で取り消せる、という
// 既存の予約の仕組みにそのまま乗るため。採血室の枠(Schedule/Slot)は使わず、日付と時刻だけ持つ。
//
// 逆算: 最終採血日 = 手術日 − 3 日(指針の「手術 3 日前まで」)、そこから間隔ずつ遡って回数ぶん並べる。
// 1 回目の採血日 + 有効日数が手術日より前なら、その血は手術日までに期限切れになるので警告する。

export const AUTOLOGOUS_SERVICE_TYPE = { code: "autologous", display: "自己血採血" };
/** 予定量(mL)。 */
const PLANNED_VOLUME_EXT_URL = "http://fhir-client.local/StructureDefinition/autologous-planned-volume";
/** 採血記録のハブから予定への参照。 */
export const COLLECTION_APPOINTMENT_EXT_URL =
  "http://fhir-client.local/StructureDefinition/autologous-appointment";

/** 最終採血から手術日までに空ける日数。 */
export const LAST_COLLECTION_GAP_DAYS = 3;
export const DEFAULT_COLLECTION_INTERVAL_DAYS = 7;
export const DEFAULT_COLLECTION_VOLUME = 400;
/** 1 回の採血に見込む時間(予定の end を決めるだけ)。 */
const COLLECTION_MINUTES = 30;
const DEFAULT_COLLECTION_TIME = "10:00";

export type CollectionPlanStatus = "booked" | "fulfilled" | "cancelled";

/** 採血予定 1 回(フォームの行)。 */
export interface CollectionPlanLine {
  /** 保存済みの Appointment id。新しい行は空。 */
  id: string;
  /** 予定日時。datetime-local の入力形式。 */
  plannedAt: string;
  /** 予定量(mL)。入力欄で扱うので文字列。 */
  volume: string;
  status: CollectionPlanStatus;
}

export interface CollectionProposal {
  /** 手術日(使用予定日)"YYYY-MM-DD"。 */
  surgeryDate: string;
  count: number;
  volume: number;
  intervalDays: number;
}

/** 手術日から逆算した採血予定。回数が 0 以下や手術日が無ければ空。 */
export function proposeCollections(proposal: CollectionProposal): CollectionPlanLine[] {
  const day = localDay(proposal.surgeryDate);
  if (!day || proposal.count <= 0) return [];
  const last = addDays(day, -LAST_COLLECTION_GAP_DAYS);
  const interval = Math.max(1, proposal.intervalDays);
  return Array.from({ length: proposal.count }, (_, index) => ({
    id: "",
    plannedAt: `${addDays(last, -interval * (proposal.count - 1 - index))}T${DEFAULT_COLLECTION_TIME}`,
    volume: proposal.volume > 0 ? String(proposal.volume) : "",
    status: "booked" as const,
  }));
}

/** 予定した合計量(mL)。取消した行は数えない。 */
export function plannedVolumeTotal(lines: CollectionPlanLine[]): number {
  return lines
    .filter((line) => line.status !== "cancelled")
    .reduce((sum, line) => sum + (Number(line.volume) || 0), 0);
}

/**
 * 1 回目の採血が手術日までに期限切れになるなら警告。有効日数は製剤マスタ(shelf_life_days)。
 * 予定の並びは plannedAt の順に見る。
 */
export function firstCollectionExpiryAdvisory(
  lines: CollectionPlanLine[],
  shelfLifeDays: number | null | undefined,
  surgeryDate: string,
): Advisory | null {
  const target = localDay(surgeryDate);
  const first = [...lines]
    .filter((line) => line.status !== "cancelled" && localDay(line.plannedAt))
    .sort((a, b) => a.plannedAt.localeCompare(b.plannedAt))[0];
  if (!first || !target || shelfLifeDays == null) return null;
  const expiry = addDays(localDay(first.plannedAt), shelfLifeDays);
  if (expiry >= target) return null;
  return {
    key: advisoryKey("autologous-expiry", "plan", first.plannedAt, target),
    kind: "autologous-expiry",
    severity: severityOf("autologous-expiry", true),
    message: `1 回目（${localDay(first.plannedAt)}）の血は手術日（${target}）までに期限切れになります（有効 ${shelfLifeDays} 日、${diffDays(localDay(first.plannedAt), target)} 日前）`,
  };
}

// ---- FHIR ----

function endOf(plannedAt: string): string {
  const date = new Date(plannedAt);
  date.setMinutes(date.getMinutes() + COLLECTION_MINUTES);
  return nowFhirDateTime(date);
}

/** 採血予定の Appointment。既存の予定(id あり)は日時・量だけ差し替える。 */
export function buildAutologousAppointment(
  line: CollectionPlanLine,
  patientId: string,
  orderReference: string,
  existing?: fhir4.Appointment,
): fhir4.Appointment {
  const appointment: fhir4.Appointment = {
    ...(existing ?? {}),
    resourceType: "Appointment",
    status: existing?.status ?? "booked",
    appointmentType: {
      coding: [
        { system: APPOINTMENT_TYPE_SYSTEM, code: DEFAULT_APPOINTMENT_TYPE, display: appointmentTypeLabel(DEFAULT_APPOINTMENT_TYPE) },
      ],
    },
    serviceType: [{ coding: [{ system: SERVICE_TYPE_SYSTEM, ...AUTOLOGOUS_SERVICE_TYPE }], text: AUTOLOGOUS_SERVICE_TYPE.display }],
    start: toFhirDateTime(line.plannedAt),
    end: endOf(line.plannedAt),
    minutesDuration: COLLECTION_MINUTES,
    // participant の先頭は必ず患者(上流はここから患者を索引する)。
    participant: [{ actor: { reference: `Patient/${patientId}` }, required: "required", status: "accepted" }],
    basedOn: [{ reference: orderReference }],
    extension: [
      ...(existing?.extension ?? []).filter((e) => e.url !== PLANNED_VOLUME_EXT_URL),
      ...(Number(line.volume) > 0
        ? [{ url: PLANNED_VOLUME_EXT_URL, valueQuantity: { value: Number(line.volume), unit: "mL" } }]
        : []),
    ],
  };
  if (line.id) appointment.id = line.id;
  return appointment;
}

export function plannedVolumeOf(appointment: fhir4.Appointment): string {
  const value = appointment.extension?.find((e) => e.url === PLANNED_VOLUME_EXT_URL)?.valueQuantity?.value;
  return value == null ? "" : String(value);
}

/** 保存済みの予定をフォームの行にする(取消した予定は出さない)。 */
export function parseCollectionPlan(appointments: fhir4.Appointment[]): CollectionPlanLine[] {
  return appointments
    .filter(isAutologousAppointment)
    .filter((a) => a.status !== "cancelled" && a.status !== "entered-in-error")
    .map((a) => ({
      id: a.id ?? "",
      plannedAt: (a.start ?? "").slice(0, 16),
      volume: plannedVolumeOf(a),
      status: (a.status === "fulfilled" ? "fulfilled" : "booked") as CollectionPlanStatus,
    }))
    .sort((a, b) => a.plannedAt.localeCompare(b.plannedAt));
}

/**
 * オーダーの登録・更新に同梱する予定のエントリ。新しい行は POST、残した行は PUT、
 * フォームから外した予定は cancelled にする(採血済みの予定は外せない前提で、残っていればそのまま)。
 */
export function collectionPlanEntries(
  lines: CollectionPlanLine[],
  patientId: string,
  orderReference: string,
  existing: fhir4.Appointment[],
): fhir4.BundleEntry[] {
  const byId = new Map(existing.filter(isAutologousAppointment).map((a) => [a.id ?? "", a]));
  const kept = new Set<string>();
  const entries: fhir4.BundleEntry[] = [];
  for (const line of lines) {
    if (!line.plannedAt) continue;
    const current = line.id ? byId.get(line.id) : undefined;
    if (line.id) kept.add(line.id);
    // 採血済みの予定は動かさない。
    if (current?.status === "fulfilled") continue;
    const resource = buildAutologousAppointment(line, patientId, orderReference, current);
    entries.push({
      fullUrl: line.id ? `Appointment/${line.id}` : `urn:uuid:${crypto.randomUUID()}`,
      resource,
      request: line.id ? { method: "PUT", url: `Appointment/${line.id}` } : { method: "POST", url: "Appointment" },
    });
  }
  for (const [id, appointment] of byId) {
    if (kept.has(id) || appointment.status === "cancelled" || appointment.status === "fulfilled") continue;
    const cancelled: fhir4.Appointment = { ...appointment, status: "cancelled" };
    entries.push({ resource: cancelled, request: { method: "PUT", url: `Appointment/${id}` } });
  }
  return entries;
}

/** 採血登録で予定を採血済みにするエントリ。 */
export function fulfillAppointmentEntry(appointment: fhir4.Appointment): fhir4.BundleEntry {
  const fulfilled: fhir4.Appointment = { ...appointment, status: "fulfilled" };
  return { resource: fulfilled, request: { method: "PUT", url: `Appointment/${appointment.id ?? ""}` } };
}

/** 残っている(未採血の)予定を取り消すエントリ。オーダーの中止・削除に同梱する。 */
export function cancelCollectionPlanEntries(appointments: fhir4.Appointment[]): fhir4.BundleEntry[] {
  return appointments
    .filter((a) => isAutologousAppointment(a) && a.status === "booked")
    .map((a): fhir4.BundleEntry => {
      const cancelled: fhir4.Appointment = { ...a, status: "cancelled" };
      return { resource: cancelled, request: { method: "PUT", url: `Appointment/${a.id ?? ""}` } };
    });
}

export function collectionPlanStatusLabel(status: CollectionPlanStatus | string): string {
  return status === "fulfilled" ? "採血済" : status === "cancelled" ? "取消" : "未採血";
}

/** 一覧の進捗の印と同じ色を使うための修飾子(lab-worklist__status--…)。 */
export function collectionPlanStatusClass(status: CollectionPlanStatus | string): string {
  return status === "fulfilled" ? "completed" : status === "cancelled" ? "cancelled" : "requested";
}
