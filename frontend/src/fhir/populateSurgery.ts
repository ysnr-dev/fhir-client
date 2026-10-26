// 初期値変数「手術」の組み立て。対象は記入の対象の手術(回答の partOf が指すハブ Procedure)で、
// 無ければ患者の最新の手術。手術記録・紹介状・症例登録など、手術の実施記録を写す様式で共通に使う。
import { diffDays, localDay } from "../lib/dates";
import { ADMISSION_CLASS_CODE, encounterAdmissionDate, encounterDischargeDate } from "./encounterHelpers";
import type { NcdSurgery } from "./ncdHelpers";
import { departmentOf } from "./orderHeader";
import {
  summarizeSurgeryOrder,
  surgeryAnesthesiaManagementDisplay,
  surgeryAnesthesiaMethodDisplay,
} from "./surgeryOrderHelpers";
import { surgeryPerformRecord } from "./surgeryResultHelpers";

/** 初期値式が参照する元データ(api/queries/populate.ts が読む)。式が手術の変数を使うときだけ揃う。 */
export interface SurgeryPopulateSources {
  /** 対象の手術(ハブ・子・測定値・申込)。 */
  surgery?: NcdSurgery;
  /** 患者の入院(手術を含む入院を探す)。 */
  admissions: fhir4.Encounter[];
}

/** 元データを読む必要がある変数名(% なし)。 */
export const SURGERY_POPULATE_VARIABLES = [
  "surgeryDate",
  "surgeryProcedureName",
  "surgeryProcedureCode",
  "surgeryProcedures",
  "surgeryPriority",
  "surgeryRequestDepartment",
  "surgeryDepartment",
  "surgeon",
  "surgeryAssistants",
  "anesthesiologist",
  "anesthesiaMethods",
  "anesthesiaManagement",
  "surgeryRoomMinutes",
  "anesthesiaMinutes",
  "operationMinutes",
  "bloodLoss",
  "transfusionVolume",
  "transfused",
  "woundClass",
  "surgeryComplication",
  "surgeryOutcome",
  "surgeryAdmissionDate",
  "surgeryDischargeDate",
  "postoperativeDays",
  "surgeryToDeathDays",
] as const;

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

/** 初期値式の環境に足す「手術」の変数。対象の手術が無いときも変数名は必ず置く。 */
export function surgeryPopulateValues(
  patient: fhir4.Patient,
  sources: SurgeryPopulateSources | undefined,
): Record<string, string | number | boolean | undefined> {
  const surgery = sources?.surgery;
  const record = surgery ? surgeryPerformRecord(surgery.hub, surgery.children, surgery.observations) : undefined;
  const summary = surgery?.order ? summarizeSurgeryOrder(surgery.order) : undefined;
  const surgeryDate = record ? localDay(record.start) : "";
  const admission = sources ? admissionCoveringSurgery(sources.admissions, surgeryDate) : undefined;
  const dayOf = (value: string) => (value === "-" ? "" : value);
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
    surgeryDate,
    surgeryProcedureName: main?.name ?? "",
    surgeryProcedureCode: main?.code ?? "",
    surgeryProcedures: [main, ...others]
      .map((p) => p?.name || p?.code || "")
      .filter(Boolean)
      .join("、"),
    surgeryPriority: summary?.priorityDisplay ?? "",
    surgeryRequestDepartment: surgery?.order ? departmentOf(surgery.order).departmentName : "",
    surgeryDepartment: summary?.surgicalDepartmentName ?? "",
    surgeon: staffOf("surgeon"),
    surgeryAssistants: staffOf("assistant"),
    anesthesiologist: staffOf("anesthesiologist"),
    anesthesiaMethods: summary?.anesthesiaMethods.map(surgeryAnesthesiaMethodDisplay).join("、") ?? "",
    anesthesiaManagement: summary?.anesthesiaManagement
      ? surgeryAnesthesiaManagementDisplay(summary.anesthesiaManagement)
      : "",
    surgeryRoomMinutes: record ? minutesBetween(record.start, record.end) : undefined,
    anesthesiaMinutes: record ? minutesBetween(record.times.anesthesiaStart, record.times.anesthesiaEnd) : undefined,
    operationMinutes: record ? minutesBetween(record.times.incisionStart, record.times.incisionEnd) : undefined,
    bloodLoss: record?.measures.bloodLoss,
    transfusionVolume: transfusion,
    transfused: record ? Boolean(transfusion && transfusion > 0) : undefined,
    woundClass: record?.woundClass ?? "",
    surgeryComplication: record?.complication ?? "",
    surgeryOutcome: record?.outcome ?? "",
    surgeryAdmissionDate: admission ? dayOf(encounterAdmissionDate(admission)) : "",
    surgeryDischargeDate: dischargeDate,
    postoperativeDays: surgeryDate && dischargeDate ? diffDays(surgeryDate, dischargeDate) : undefined,
    surgeryToDeathDays: surgeryDate && deathDate ? diffDays(surgeryDate, deathDate) : undefined,
  };
}
