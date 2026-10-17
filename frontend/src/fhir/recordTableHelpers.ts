import { csvBlob } from "../lib/csv";
import { patientCell, type ExtractPatientRow, type PatientColumn } from "./extractQueryHelpers";

// データ抽出の記録を表にするタブの結果の表(docs/data-extract-design.md §18・§21)。どのタブも
// 患者番号・氏名・患者の列・患者ごとの属性(比較群・担当医)・固定列・項目の列の順に並べ、一覧・内訳・CSV で同じセルを使う。

export interface RecordTableRow {
  key: string;
  patient: ExtractPatientRow;
  /** 固定列(折り返さない)の値。 */
  fixed: string[];
  /** 項目の列の値(長ければ折り返す)。 */
  values: string[];
}

/** 患者ごとに 1 つの値を持つ列(比較群・担当医)。患者の列の直後に並べる。 */
export interface PatientAttribute {
  label: string;
  valueOf: (patientId: string) => string;
}

/** 比較群の列の見出し。 */
export const STRATUM_COLUMN = "比較群";
/** クラスタタブ(§22)の比較群の列の見出し。 */
export const CLUSTER_COLUMN = "クラスタ";
/** 担当医の列の見出し。 */
export const ATTENDING_COLUMN = "担当医";
/** 基準日(§24)の列の見出し。 */
export const INDEX_DATE_COLUMN = "基準日";

/** 属性を持たない患者の値。 */
export const EMPTY_ATTRIBUTE = "(なし)";

/** タブの見出し(患者番号・氏名・患者の列・固定列・項目の列)に、属性の列を患者の列の直後に差し込む。 */
export function recordTableHeader(
  header: string[],
  patientColumns: PatientColumn[],
  attributes: PatientAttribute[] = [],
): string[] {
  const at = 2 + patientColumns.length;
  return [...header.slice(0, at), ...attributes.map((a) => a.label), ...header.slice(at)];
}

/** 行ごとのセル(recordTableHeader と同じ並び)。 */
export function recordTableCells(
  rows: RecordTableRow[],
  patientColumns: PatientColumn[],
  attributes: PatientAttribute[] = [],
): string[][] {
  return rows.map(({ patient, fixed, values }) => [
    patient.patientNumber,
    patient.name,
    ...patientColumns.map((column) => String(patientCell(patient, column) ?? "")),
    ...attributes.map((a) => a.valueOf(patient.patientId)),
    ...fixed,
    ...values,
  ]);
}

/** 結果の表の CSV(BOM 付き UTF-8)。 */
export function recordTableCsv(
  header: string[],
  patientColumns: PatientColumn[],
  rows: RecordTableRow[],
  attributes: PatientAttribute[] = [],
): Blob {
  return csvBlob(
    recordTableHeader(header, patientColumns, attributes),
    recordTableCells(rows, patientColumns, attributes),
  );
}
