import { csvBlob } from "../lib/csv";
import { dateTimeLabel, localDay } from "../lib/dates";
import {
  patientCell,
  patientColumnLabel,
  patientColumnsOf,
  patientRowOf,
  type ExtractOutput,
  type ExtractPatientRow,
} from "./extractQueryHelpers";
import { departmentOf } from "./orderHeader";
import {
  SURGERY_PERFORM_STAFF_ROLE_OPTIONS,
  summarizeSurgeryOrder,
  surgeryAnesthesiaManagementDisplay,
  surgeryAnesthesiaMethodDisplay,
} from "./surgeryOrderHelpers";
import { SURGERY_OBSERVATION_FIELDS, SURGERY_TIME_FIELDS, surgeryPerformRecord } from "./surgeryResultHelpers";

// 手術実績の抽出(docs/data-extract-design.md §11)。手術の実施記録 1 件(ハブの Procedure)を 1 行にし、
// 時刻・所要時間・申込の区分・術式・スタッフ・測定値・記録を列にする。

export interface SurgeryExtractRow extends ExtractPatientRow {
  rowKey: string;
  /** 入室日時(並べ替え用)。 */
  start: string;
  /** 折り返さない列(SURGERY_FIXED_HEADERS と同じ並び)。 */
  fixed: string[];
  /** 折り返す列(SURGERY_VALUE_HEADERS と同じ並び)。 */
  values: string[];
}

export const SURGERY_FIXED_HEADERS = [
  "入室日",
  "入室",
  ...SURGERY_TIME_FIELDS.map((field) => field.label),
  "退室",
  "在室時間(分)",
  "麻酔時間(分)",
  "手術時間(分)",
  "状態",
  "予定区分",
  "入外",
  "依頼科",
  "執刀科",
  "手術室",
];

export const SURGERY_VALUE_HEADERS = [
  "術式",
  "術式コード",
  "他の術式・麻酔",
  "麻酔方法",
  "麻酔管理",
  ...SURGERY_PERFORM_STAFF_ROLE_OPTIONS.map((role) => role.display),
  ...SURGERY_OBSERVATION_FIELDS.map((field) => `${field.label}(mL)`),
  "創分類",
  "カウント",
  "合併症",
  "転帰",
];

const STATUS_LABELS: Record<string, string> = {
  completed: "実施済",
  stopped: "途中で中止",
  "not-done": "実施せず",
  "in-progress": "実施中",
  preparation: "準備中",
  "on-hold": "保留中",
};

/** 「HH:mm」(端末のローカル時刻)。 */
function clock(value: string): string {
  return dateTimeLabel(value).slice(11, 16);
}

/** 2 つの日時の間の分。どちらかが無ければ空。 */
function minutes(from: string, to: string): string {
  if (!from || !to) return "";
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Number.isFinite(ms) && ms >= 0 ? String(Math.round(ms / 60000)) : "";
}

function orderIdOf(hub: fhir4.Procedure): string {
  const reference = hub.basedOn?.find((r) => r.reference?.startsWith("ServiceRequest/"))?.reference ?? "";
  return reference.slice("ServiceRequest/".length);
}

/** 実施記録を表の行にする。行は入室の新しい順。 */
export function surgeryExtractRows(
  hubs: fhir4.Procedure[],
  children: Map<string, fhir4.Procedure[]>,
  observations: Map<string, fhir4.Observation[]>,
  orders: Map<string, fhir4.ServiceRequest>,
  patients: Map<string, fhir4.Patient>,
): SurgeryExtractRow[] {
  const rows = hubs.map((hub): SurgeryExtractRow => {
    const hubId = hub.id ?? "";
    const childList = children.get(hubId) ?? [];
    // 測定値はハブにぶら下げるが、子に付いていても拾う(実施記録の表示と同じ)。
    const measures = [hubId, ...childList.map((c) => c.id ?? "")].flatMap((id) => observations.get(id) ?? []);
    const record = surgeryPerformRecord(hub, childList, measures);
    const order = orders.get(orderIdOf(hub));
    const summary = order ? summarizeSurgeryOrder(order) : null;
    const patientId = hub.subject?.reference?.split("/").pop() ?? "";
    const { times } = record;
    const [main, ...others] = record.procedures;
    const staffOf = (role: string) =>
      record.staff
        .filter((s) => s.role === role)
        .map((s) => s.name)
        .join("、");
    return {
      ...patientRowOf(patientId, patients.get(patientId)),
      rowKey: hubId,
      start: record.start,
      fixed: [
        localDay(record.start),
        clock(record.start),
        ...SURGERY_TIME_FIELDS.map((field) => clock(times[field.key])),
        clock(record.end),
        minutes(record.start, record.end),
        minutes(times.anesthesiaStart, times.anesthesiaEnd),
        minutes(times.incisionStart, times.incisionEnd),
        STATUS_LABELS[record.status] ?? record.status,
        summary?.priorityDisplay ?? "",
        summary?.settingDisplay ?? "",
        order ? departmentOf(order).departmentName : "",
        summary?.surgicalDepartmentName ?? "",
        summary?.roomName ?? "",
      ],
      values: [
        main?.name ?? "",
        main?.code ?? "",
        others.map((p) => p.name || p.code).join("、"),
        summary?.anesthesiaMethods.map(surgeryAnesthesiaMethodDisplay).join("、") ?? "",
        summary?.anesthesiaManagement ? surgeryAnesthesiaManagementDisplay(summary.anesthesiaManagement) : "",
        ...SURGERY_PERFORM_STAFF_ROLE_OPTIONS.map((role) => staffOf(role.code)),
        ...SURGERY_OBSERVATION_FIELDS.map((field) => {
          const value = record.measures[field.key];
          return value === undefined ? "" : String(value);
        }),
        record.woundClass,
        record.countCheck,
        record.complication,
        record.outcome,
      ],
    };
  });
  return rows.sort(
    (a, b) =>
      b.start.localeCompare(a.start) ||
      a.patientNumber.localeCompare(b.patientNumber, undefined, { numeric: true }),
  );
}

export function surgeryExtractHeader(output: ExtractOutput | undefined): string[] {
  return [
    "患者番号",
    "氏名",
    ...patientColumnsOf(output).map(patientColumnLabel),
    ...SURGERY_FIXED_HEADERS,
    ...SURGERY_VALUE_HEADERS,
  ];
}

export function surgeryExtractCsv(rows: SurgeryExtractRow[], output: ExtractOutput | undefined): Blob {
  const patientColumns = patientColumnsOf(output);
  return csvBlob(
    surgeryExtractHeader(output),
    rows.map((row) => [
      row.patientNumber,
      row.name,
      ...patientColumns.map((column) => patientCell(row, column)),
      ...row.fixed,
      ...row.values,
    ]),
  );
}
