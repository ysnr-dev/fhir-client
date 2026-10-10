import type { ExtractOutput, ExtractPeriod } from "./extractQueryHelpers";
import type { ExtractKind, ExtractLeaf } from "./extractQueryModel";
import type { BreakdownSettings } from "./recordBreakdownHelpers";
import type { ExtractQuery } from "../api/masterClient";

// データ抽出の記録を表にするタブで保存する条件(docs/data-extract-design.md §17)。タブごとの入力欄の値を
// そのまま持つ。形の検証は backend(ExtractRecordDefinition)。

export type ExtractRecordTab =
  | "template"
  | "lab"
  | "medication"
  | "micro"
  | "surgery"
  | "perform"
  | "adverse"
  | "pathway"
  | "encounter"
  | "condition";

export type ExtractTab = "patient" | ExtractRecordTab;

/** どの記録タブにも共通する項目。タブごとの条件はこれを広げる。 */
export interface ExtractRecordDefinition {
  schema_version: 1;
  period?: ExtractPeriod;
  /** 「患者」タブに保存した条件の code(環境をまたいでも同じ条件を指す)。 */
  patient_query_code?: string;
  patient_folder_id?: number;
  output?: ExtractOutput;
  /** 内訳の切り口(docs/data-extract-design.md §18)。 */
  breakdown?: BreakdownSettings;
  /** 比較群(§21)。 */
  strata?: ExtractStratum[];
  /** 比較群に入らない患者を除く。 */
  strata_only?: boolean;
  /** 担当医の列の決め方(§21)。 */
  attending?: AttendingMode;
}

/**
 * 比較群 1 つ(docs/data-extract-design.md §21)。条件 1 件(kind あり。「患者」タブの条件と同じ形)か、
 * 「患者」タブに保存した条件(query_code)のどちらか。label が比較群の名前。
 */
export type ExtractStratum = Omit<ExtractLeaf, "kind" | "not" | "relation" | "output_fields"> & {
  kind?: Exclude<ExtractKind, "patient">;
  query_code?: string;
};

export const MAX_STRATA = 8;

/** 担当医の決め方。期間内の記録から患者ごとに最も多い医師を 1 人とる。 */
export type AttendingMode = "outpatient" | "inpatient" | "prescriber";

export const ATTENDING_MODES: { value: AttendingMode; label: string }[] = [
  { value: "outpatient", label: "外来の担当医" },
  { value: "inpatient", label: "入院の主治医" },
  { value: "prescriber", label: "処方の依頼医" },
];

/** 保存した条件を、そのタブの条件の形で読む(形は backend が保存のときに確かめている)。 */
export function recordDefinitionOf<T extends ExtractRecordDefinition>(query: ExtractQuery): T {
  return query.definition as unknown as T;
}

/** 空の値を落とした条件(保存と「未保存」の判定で、入力していない項目を持たないようにする)。 */
export function compactDefinition<T extends object>(definition: T): T {
  return Object.fromEntries(
    Object.entries(definition).filter(([, value]) => {
      if (value === undefined || value === null || value === "") return false;
      if (Array.isArray(value)) return value.length > 0;
      return true;
    }),
  ) as T;
}

/** キーの並びに左右されない比較用の文字列(保存値と画面の値で「未保存」を判定する)。 */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
