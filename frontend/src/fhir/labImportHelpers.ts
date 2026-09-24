import type { LabResultImportRow, LabResultItem } from "../api/masterClient";
import { toDateInput } from "../lib/dates";
import {
  emptyLabResultForm,
  judgeInterpretation,
  lineKeyOf,
  matchReferenceRange,
  type LabInterpretation,
  type LabResultFormValues,
  type LabResultLineValues,
  type LabResultSetting,
  type LabResultSubject,
} from "./labResultHelpers";

// 取込ファイルの行(backend の台帳)を、手入力と同じ検査結果フォームの値に直す。
//
// 登録そのものは手入力と 1 本の同じ道(useCreateLabResult / useUpdateLabResult)を通す。
// 基準値の適用・パニック値の通知・報告区分の遷移がその先に入っているため
// (docs/lab-result-import-design.md §2)。

/** 候補のまとまり(ORC/OBR 群)。1 群 = 上流の DiagnosticReport 1 件になる。 */
export interface LabImportGroup {
  groupNo: number;
  rows: LabResultImportRow[];
  patientNumber: string;
  patientName: string;
  patientBirthDate: string;
  labelNumber: string;
  placerOrderNumber: string;
  /** 採取日(YYYY-MM-DD)。OBR-7 → SPM-17 → OBX-14 の順で決まったもの。 */
  collectedDate: string;
  setting: LabResultSetting;
  reportStatus: "preliminary" | "final";
  reportComment: string;
  specimenMaterialName: string;
  /** 上流に登録済みなら、その結果の id(行に書き戻したもの)。 */
  registeredReportId: string;
}

export function groupImportRows(rows: LabResultImportRow[]): LabImportGroup[] {
  const byGroup = new Map<number, LabResultImportRow[]>();
  for (const row of rows) {
    const list = byGroup.get(row.group_no);
    if (list) list.push(row);
    else byGroup.set(row.group_no, [row]);
  }

  return Array.from(byGroup.entries())
    .sort(([a], [b]) => a - b)
    .map(([groupNo, groupRows]) => {
      const sorted = [...groupRows].sort((a, b) => a.sequence - b.sequence);
      const head = sorted[0];
      return {
        groupNo,
        rows: sorted,
        patientNumber: head.patient_number ?? "",
        patientName: head.patient_name ?? "",
        patientBirthDate: head.patient_birth_date ?? "",
        labelNumber: head.label_number ?? "",
        placerOrderNumber: head.placer_order_number ?? "",
        collectedDate: collectedDateOf(sorted),
        setting: settingOf(head),
        reportStatus: importReportStatusOf(sorted),
        reportComment: head.report_comment ?? "",
        specimenMaterialName: head.specimen_material_name ?? "",
        registeredReportId: sorted.find((row) => row.report_fhir_id)?.report_fhir_id ?? "",
      };
    });
}

function settingOf(row: LabResultImportRow): LabResultSetting {
  return row.setting === "inpatient" || row.setting === "outpatient" ? row.setting : "";
}

// 採取日はオーダーの採取日時(OBR-7)が正。無ければ検査日時(OBX-14)で代用する。
// ISO 文字列をブラウザのローカル(JST)で日付に直す。
function collectedDateOf(rows: LabResultImportRow[]): string {
  const iso =
    rows.find((row) => row.collected_at)?.collected_at ??
    rows.find((row) => row.observed_at)?.observed_at ??
    "";
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : toDateInput(date);
}

/**
 * 報告区分。OBR-25 が P(事前的に確認された結果)なら中間報告、F / C なら最終報告。
 * OBR-25 が無ければ OBX-11 が全部 P のときだけ中間報告にする。
 * 訂正(C)を最終報告として送ると、確定済みのレポートへの保存で
 * nextLabReportStatus が corrected に進める(readme「報告区分」)。
 */
export function importReportStatusOf(rows: LabResultImportRow[]): "preliminary" | "final" {
  const orderStatus = rows.find((row) => row.report_status)?.report_status?.toUpperCase();
  if (orderStatus === "P") return "preliminary";
  if (orderStatus) return "final";

  const statuses = rows.map((row) => row.observation_status?.toUpperCase()).filter(Boolean);
  return statuses.length > 0 && statuses.every((status) => status === "P") ? "preliminary" : "final";
}

// ファイルの異常フラグ(OBX-8)を画面の判定に写す。施設の基準値があるときは使わない。
// 測定限界(< >)は方向だけを採り、N / A / AA は判定なしにする(A は非数値結果の
// 「異常」で、H / L のどちらとも言えないため)。
const FILE_FLAGS: Record<string, LabInterpretation> = {
  HH: "HH",
  H: "H",
  L: "L",
  LL: "LL",
  ">": "H",
  "<": "L",
};

/**
 * 登録する判定。施設の基準値が正本で、Observation.referenceRange に焼き付くのも
 * そちらのため(readme「基準値と H/L の自動判定」)。基準値を持たない項目に限り
 * ファイルの異常フラグを使う。
 */
export function importInterpretationOf(
  row: LabResultImportRow,
  item: LabResultItem | undefined,
  subject: LabResultSubject | undefined,
  collectedDate: string,
): LabInterpretation {
  const range = matchReferenceRange(item, subject, collectedDate);
  if (range) return judgeInterpretation(row.value ?? "", range);
  return FILE_FLAGS[(row.abnormal_flag ?? "").toUpperCase()] ?? "";
}

/** 登録する行(ready)だけをフォームの行に直す。マスタに無い項目は落とす。 */
export function importLinesOf(
  group: LabImportGroup,
  itemsByCode: Map<string, LabResultItem>,
  subject: LabResultSubject | undefined,
): LabResultLineValues[] {
  return group.rows
    .filter((row) => row.status === "ready" || row.status === "registered")
    .flatMap((row) => {
      const item = row.result_item_code ? itemsByCode.get(row.result_item_code) : undefined;
      if (!item) return [];
      return [
        {
          item,
          value: row.value ?? "",
          interpretation: importInterpretationOf(row, item, subject, group.collectedDate),
          note: row.note ?? "",
        },
      ];
    });
}

/** 紐付け先のオーダーから引き継ぐ文脈。オーダーなしで登録するときは空でよい。 */
export interface LabImportOrderContext {
  orderId: string;
  departmentId: string;
  departmentName: string;
  setting: LabResultSetting;
}

/** 新規登録用のフォーム値。 */
export function buildImportFormValues(
  group: LabImportGroup,
  lines: LabResultLineValues[],
  context: LabImportOrderContext,
): LabResultFormValues {
  const base = emptyLabResultForm(context.setting || group.setting || "outpatient");
  return {
    ...base,
    specimenDate: group.collectedDate || base.specimenDate,
    departmentId: context.departmentId,
    departmentName: context.departmentName,
    orderId: context.orderId,
    reportStatus: group.reportStatus,
    conclusion: group.reportComment,
    lines,
  };
}

/**
 * 既存レポートへの追記用。同じ結果項目の行は値・判定・コメントを差し替え、
 * 無い行は末尾に足す。オーダー・実施者・保存済みの報告区分は既存のものを保つ
 * (確定済みのレポートを更新すると保存時に訂正報告になる)。
 */
export function mergeImportLines(
  existing: LabResultFormValues,
  group: LabImportGroup,
  lines: LabResultLineValues[],
): LabResultFormValues {
  const incoming = new Map(lines.map((line) => [lineKeyOf(line.item!), line]));
  const merged = existing.lines.map((line) => {
    const replacement = line.item ? incoming.get(lineKeyOf(line.item)) : undefined;
    if (!replacement) return line;
    incoming.delete(lineKeyOf(line.item!));
    return { ...line, value: replacement.value, interpretation: replacement.interpretation, note: replacement.note };
  });

  return {
    ...existing,
    specimenDate: group.collectedDate || existing.specimenDate,
    reportStatus: group.reportStatus,
    conclusion: group.reportComment || existing.conclusion,
    lines: [...merged, ...incoming.values()],
  };
}

/** transaction の応答から登録した検査結果の id を取り出す。 */
export function reportIdFromTransactionResponse(bundle: fhir4.Bundle): string {
  for (const entry of bundle.entry ?? []) {
    const location = entry.response?.location ?? "";
    const matched = location.match(/DiagnosticReport\/([^/]+)/);
    if (matched) return matched[1];
  }
  return "";
}
