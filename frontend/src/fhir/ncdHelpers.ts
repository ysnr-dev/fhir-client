import { addDays, dateTimeLabel, diffDays, localDay } from "../lib/dates";
import { conceptLabel } from "./shared";
import { responseAnswer, templateRecordState, type TemplateRecordState } from "./conditionTemplateHelpers";
import {
  ADMISSION_CLASS_CODE,
  encounterAdmissionDate,
  encounterDischargeDate,
} from "./encounterHelpers";
import { departmentOf } from "./orderHeader";
import { plainAnswerText } from "./questionnaireResponseHelpers";
import {
  summarizeSurgeryOrder,
  surgeryAnesthesiaManagementDisplay,
  surgeryAnesthesiaMethodDisplay,
} from "./surgeryOrderHelpers";
import { surgeryPerformRecord, type SurgeryPerformRecord } from "./surgeryResultHelpers";

// NCD(National Clinical Database)の症例登録(docs/ncd-registration-design.md)。手術の実施記録(ハブ Procedure)
// 1 件につき症例登録のテンプレートの回答 1 件。回答は `partOf` でハブを指す。
// ここには症例登録の状態(一覧の行)と、初期値変数「NCD」の組み立てを置く。

/** 施設設定 ncd_registration(backend の DEFAULT_NCD_REGISTRATION と同じ形)。 */
export interface NcdRegistrationSettings {
  /** 症例登録のテンプレートの url(版を問わない)。 */
  template: string;
}

export const DEFAULT_NCD_REGISTRATION: NcdRegistrationSettings = {
  template: "http://fhir-client.local/Questionnaire/ncd-case-01",
};

/** 術後合併症の観察期間(日)。NCD は術後 30 日の合併症・死亡を登録する。 */
export const NCD_FOLLOW_UP_DAYS = 30;

// ---- 回答の linkId ----

/** NCD への登録状況(未登録 / 登録済)と登録日・NCD 症例番号の linkId。 */
export const NCD_STATUS_LINK_ID = "ncd_status";
export const NCD_REGISTERED_ON_LINK_ID = "ncd_registered-on";
export const NCD_STATUS_REGISTERED = "registered";

export type NcdRegistrationState = TemplateRecordState | "written";

export const NCD_REGISTRATION_STATE_LABELS: Record<NcdRegistrationState, string> = {
  missing: "未登録",
  draft: "記入中",
  written: "記入済",
  done: "登録済",
};

/** 回答が指す手術(ハブ Procedure)の id。無ければ空。 */
export function ncdProcedureIdOf(response: fhir4.QuestionnaireResponse): string {
  return (
    response.partOf
      ?.map((reference) => reference.reference?.match(/^Procedure\/(.+)$/)?.[1] ?? "")
      .find(Boolean) ?? ""
  );
}

/** 登録の状態。回答が確定していても、登録状況が「登録済」でなければ「記入済」。 */
export function ncdRegistrationStateOf(response: fhir4.QuestionnaireResponse | undefined): NcdRegistrationState {
  const state = templateRecordState(response);
  if (state !== "done") return state;
  return responseAnswer(response, NCD_STATUS_LINK_ID)?.valueCoding?.code === NCD_STATUS_REGISTERED ? "done" : "written";
}

export interface NcdSurgery {
  hub: fhir4.Procedure;
  children: fhir4.Procedure[];
  observations: fhir4.Observation[];
  order?: fhir4.ServiceRequest;
}

export interface NcdRegistrationRow {
  hub: fhir4.Procedure;
  patientId: string;
  /** 手術日(入室日)。 */
  surgeryDate: string;
  record: SurgeryPerformRecord;
  departmentName: string;
  priorityDisplay: string;
  /** 術後の経過日数(今日 - 手術日)。 */
  postoperativeDays: number | null;
  state: NcdRegistrationState;
  response?: fhir4.QuestionnaireResponse;
  registeredOn: string;
}

/** 同じ手術に当たる回答のうち採るもの。確定を優先し、同じ状態なら新しい方。 */
function pickResponse(responses: fhir4.QuestionnaireResponse[]): fhir4.QuestionnaireResponse | undefined {
  return [...responses].sort((a, b) => {
    const rank = (r: fhir4.QuestionnaireResponse) => (templateRecordState(r) === "done" ? 0 : 1);
    return rank(a) - rank(b) || (b.authored ?? "").localeCompare(a.authored ?? "");
  })[0];
}

/** 手術(ハブ)と回答を `partOf` で突き合わせて行にする。行は手術日の新しい順。 */
export function ncdRegistrationRows(
  surgeries: NcdSurgery[],
  responses: fhir4.QuestionnaireResponse[],
  today: string,
): NcdRegistrationRow[] {
  const byProcedure = new Map<string, fhir4.QuestionnaireResponse[]>();
  for (const response of responses) {
    if (response.status === "entered-in-error" || response.status === "stopped") continue;
    const id = ncdProcedureIdOf(response);
    if (id) byProcedure.set(id, [...(byProcedure.get(id) ?? []), response]);
  }
  return surgeries
    .map(({ hub, children, observations, order }) => {
      const record = surgeryPerformRecord(hub, children, observations);
      const surgeryDate = localDay(record.start);
      const response = pickResponse(byProcedure.get(hub.id ?? "") ?? []);
      return {
        hub,
        patientId: hub.subject?.reference?.split("/").pop() ?? "",
        surgeryDate,
        record,
        departmentName: order ? departmentOf(order).departmentName : "",
        priorityDisplay: order ? summarizeSurgeryOrder(order).priorityDisplay : "",
        postoperativeDays: surgeryDate ? diffDays(surgeryDate, today) : null,
        state: ncdRegistrationStateOf(response),
        response,
        registeredOn: plainAnswerText(responseAnswer(response, NCD_REGISTERED_ON_LINK_ID) ?? {}),
      };
    })
    .sort((a, b) => b.record.start.localeCompare(a.record.start));
}

/** 一覧の既定の期間(今日までの 90 日)。 */
export function defaultNcdFrom(today: string): string {
  return addDays(today, -90);
}

// ---- 初期値変数 ----

/** 初期値式が参照する元データ(api/queries/populate.ts が読む)。式が NCD の変数を使うときだけ揃う。 */
export interface NcdPopulateSources {
  /** 対象の手術(ハブ・子・測定値・申込)。 */
  surgery?: NcdSurgery;
  /** 患者の入院(手術を含む入院を探す)。 */
  admissions: fhir4.Encounter[];
}

export const NCD_POPULATE_VARIABLES = [
  "ncdSurgeryDate",
  "ncdProcedureName",
  "ncdProcedureCode",
  "ncdProcedures",
  "ncdPriority",
  "ncdDepartment",
  "ncdSurgicalDepartment",
  "ncdSurgeon",
  "ncdAssistants",
  "ncdAnesthesiologist",
  "ncdAnesthesia",
  "ncdAnesthesiaManagement",
  "ncdRoomMinutes",
  "ncdAnesthesiaMinutes",
  "ncdOperationMinutes",
  "ncdBloodLoss",
  "ncdTransfusionVolume",
  "ncdTransfused",
  "ncdWoundClass",
  "ncdComplicationNote",
  "ncdOutcome",
  "ncdAdmissionDate",
  "ncdDischargeDate",
  "ncdPostoperativeDays",
  "ncdDeathDate",
  "ncdDiedWithin30Days",
] as const;

export function usesNcdVariables(expressions: Iterable<string | undefined>): boolean {
  for (const expression of expressions) {
    if (expression && NCD_POPULATE_VARIABLES.some((name) => expression.includes(`%${name}`))) return true;
  }
  return false;
}

function minutesBetween(from: string, to: string): number | undefined {
  if (!from || !to) return undefined;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 60000) : undefined;
}

/** 手術日を含む入院(class = IMP)。複数当たれば入院日が最も新しいもの。 */
export function admissionCoveringSurgery(
  admissions: fhir4.Encounter[],
  surgeryDate: string,
): fhir4.Encounter | undefined {
  if (!surgeryDate) return undefined;
  return admissions
    .filter((encounter) => encounter.class?.code === ADMISSION_CLASS_CODE)
    .filter((encounter) => {
      const start = encounter.period?.start?.slice(0, 10) ?? "";
      const end = encounter.period?.end?.slice(0, 10) ?? "";
      return start && start <= surgeryDate && (!end || end >= surgeryDate);
    })
    .sort((a, b) => (b.period?.start ?? "").localeCompare(a.period?.start ?? ""))[0];
}

/** 初期値式の環境に足す「NCD」の変数。対象の手術が無いときも変数名は必ず置く。 */
export function ncdPopulateValues(
  patient: fhir4.Patient,
  sources: NcdPopulateSources | undefined,
): Record<string, string | number | undefined> {
  const surgery = sources?.surgery;
  const record = surgery ? surgeryPerformRecord(surgery.hub, surgery.children, surgery.observations) : undefined;
  const summary = surgery?.order ? summarizeSurgeryOrder(surgery.order) : undefined;
  const surgeryDate = record ? localDay(record.start) : "";
  const admission = sources ? admissionCoveringSurgery(sources.admissions, surgeryDate) : undefined;
  const dayOf = (value: string) => (value === "-" ? "" : value);
  const admissionDate = admission ? dayOf(encounterAdmissionDate(admission)) : "";
  const dischargeDate = admission ? dayOf(encounterDischargeDate(admission)) : "";
  const deathDate = patient.deceasedDateTime?.slice(0, 10) ?? "";
  const staffOf = (role: string) =>
    (record?.staff ?? [])
      .filter((s) => s.role === role)
      .map((s) => s.name)
      .join("、");
  const [main, ...others] = record?.procedures ?? [];
  const transfusion = record?.measures.transfusionVolume;
  return {
    ncdSurgeryDate: surgeryDate,
    ncdProcedureName: main?.name ?? "",
    ncdProcedureCode: main?.code ?? "",
    ncdProcedures: [main, ...others]
      .map((p) => p?.name || p?.code || "")
      .filter(Boolean)
      .join("、"),
    ncdPriority: summary?.priorityDisplay ?? "",
    ncdDepartment: surgery?.order ? departmentOf(surgery.order).departmentName : "",
    ncdSurgicalDepartment: summary?.surgicalDepartmentName ?? "",
    ncdSurgeon: staffOf("surgeon"),
    ncdAssistants: staffOf("assistant"),
    ncdAnesthesiologist: staffOf("anesthesiologist"),
    ncdAnesthesia: summary?.anesthesiaMethods.map(surgeryAnesthesiaMethodDisplay).join("、") ?? "",
    ncdAnesthesiaManagement: summary?.anesthesiaManagement
      ? surgeryAnesthesiaManagementDisplay(summary.anesthesiaManagement)
      : "",
    ncdRoomMinutes: record ? minutesBetween(record.start, record.end) : undefined,
    ncdAnesthesiaMinutes: record ? minutesBetween(record.times.anesthesiaStart, record.times.anesthesiaEnd) : undefined,
    ncdOperationMinutes: record ? minutesBetween(record.times.incisionStart, record.times.incisionEnd) : undefined,
    ncdBloodLoss: record?.measures.bloodLoss,
    ncdTransfusionVolume: transfusion,
    ncdTransfused: record ? (transfusion && transfusion > 0 ? "yes" : "no") : "",
    ncdWoundClass: record?.woundClass ?? "",
    ncdComplicationNote: record?.complication ?? "",
    ncdOutcome: record?.outcome ?? "",
    ncdAdmissionDate: admissionDate,
    ncdDischargeDate: dischargeDate,
    ncdPostoperativeDays: surgeryDate && dischargeDate ? diffDays(surgeryDate, dischargeDate) : undefined,
    ncdDeathDate: deathDate,
    ncdDiedWithin30Days: surgeryDate
      ? deathDate && diffDays(surgeryDate, deathDate) <= NCD_FOLLOW_UP_DAYS
        ? "yes"
        : "no"
      : "",
  };
}

/** 「2026/08/28 09:00〜11:20」。一覧と詳細で使う。 */
export function surgeryPeriodLabel(record: SurgeryPerformRecord): string {
  const start = dateTimeLabel(record.start);
  const end = record.end ? dateTimeLabel(record.end).slice(11, 16) : "";
  return end ? `${start}〜${end}` : start;
}

/** 申込の表示名が無い(削除済み)ときの術式名。 */
export function surgeryNameOf(record: SurgeryPerformRecord, hub: fhir4.Procedure): string {
  return record.procedures[0]?.name || conceptLabel(hub.code) || "";
}
