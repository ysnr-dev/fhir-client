import type { ExtractQuery } from "../api/masterClient";
import type { ConditionExtractCategory, ConditionExtractSuspected, EncounterExtractKind } from "../api/queries";
import type { TreatmentType } from "./adverseEventHelpers";
import type { AdverseEventRowMode } from "./adverseEventExtractHelpers";
import type { ChartItem } from "./chartDefinitionHelpers";
import type { ExtractOutput, ExtractPeriod } from "./extractQueryHelpers";
import type {
  AdmissionDateMode,
  ExtractCode,
  ExtractDrugClass,
  ExtractKind,
  ExtractLeaf,
  ExtractOrderType,
} from "./extractQueryModel";
import type { LabExtractAggregate, LabExtractRowMode } from "./labExtractHelpers";
import type { MicroSusceptibilityField } from "./microExtractHelpers";
import type { BreakdownSettings } from "./recordBreakdownHelpers";

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
  | "intervention"
  | "encounter"
  | "condition"
  | "cluster"
  | "indicator"
  | "event";

export type ExtractTab = "patient" | ExtractRecordTab;

/** データ抽出のタブ(画面の並び順)。 */
export const EXTRACT_TABS: { key: ExtractTab; label: string }[] = [
  { key: "patient", label: "患者" },
  { key: "cluster", label: "クラスタ" },
  { key: "indicator", label: "指標" },
  { key: "event", label: "イベント" },
  { key: "encounter", label: "入院・外来" },
  { key: "condition", label: "病名" },
  { key: "template", label: "テンプレート" },
  { key: "lab", label: "検査結果" },
  { key: "medication", label: "投薬" },
  { key: "micro", label: "細菌検査" },
  { key: "surgery", label: "手術" },
  { key: "perform", label: "部門実施" },
  { key: "adverse", label: "有害事象" },
  { key: "pathway", label: "パス" },
  { key: "intervention", label: "薬剤師介入" },
];

export function extractTabLabel(tab: ExtractTab): string {
  return EXTRACT_TABS.find((t) => t.key === tab)?.label ?? tab;
}

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

// タブごとの条件(共通の項目 + そのタブの入力欄の値)。形の検証は backend の ExtractRecordDefinition::TAB_FIELDS。

export interface EncounterExtractDefinition extends ExtractRecordDefinition {
  kind?: EncounterExtractKind;
  date_mode?: AdmissionDateMode;
  department_id?: string;
  ward_id?: string;
}

export interface ConditionExtractDefinition extends ExtractRecordDefinition {
  codes?: ExtractCode[];
  clinical_status?: string[];
  category?: ConditionExtractCategory;
  suspected?: ConditionExtractSuspected;
  date_field?: "onset" | "recorded";
}

export interface TemplateExtractDefinition extends ExtractRecordDefinition {
  template_url?: string;
  latest_only?: boolean;
  department_id?: string;
}

export interface LabExtractDefinition extends ExtractRecordDefinition {
  items?: ChartItem[];
  mode?: LabExtractRowMode;
  aggregates?: LabExtractAggregate[];
  interpretation?: boolean;
  department_id?: string;
}

export interface MedicationExtractDefinition extends ExtractRecordDefinition {
  codes?: ExtractCode[];
  drug_classes?: ExtractDrugClass[];
  order_type?: ExtractOrderType;
  department_id?: string;
}

export interface MicroExtractDefinition extends ExtractRecordDefinition {
  include_no_isolate?: boolean;
  first_isolate_only?: boolean;
  susceptibility?: MicroSusceptibilityField[];
}

export interface SurgeryExtractDefinition extends ExtractRecordDefinition {
  procedures?: { code: string; name: string }[];
  department_id?: string;
}

export interface PerformExtractDefinition extends ExtractRecordDefinition {
  order_kind?: string;
  department_id?: string;
}

export interface AdverseEventExtractDefinition extends ExtractRecordDefinition {
  treatment_type?: TreatmentType;
  terms?: string[];
  mode?: AdverseEventRowMode;
}

export interface InterventionExtractDefinition extends ExtractRecordDefinition {
  /** intervened は介入ありだけ(既定)、all は問題なしも含める。 */
  result?: "intervened" | "all";
  order_kind?: "prescription" | "injection";
  /** 介入種別のコード(マスタの code)。 */
  types?: string[];
  department_id?: string;
}

export interface PathwayExtractDefinition extends ExtractRecordDefinition {
  pathway_code?: string;
}

export interface ClusterExtractDefinition extends ExtractRecordDefinition {
  /** クラスタごとに比べる指標(条件 1 件ずつ。§22)。クラスタは共通項目の strata。 */
  metrics?: ExtractMetric[];
}

/** 指標の期間の刻み(内訳の刻みのうち週・日を除いたもの)。 */
export type IndicatorGrain = "year" | "fiscal" | "quarter" | "month";

export const INDICATOR_GRAINS: { value: IndicatorGrain; label: string }[] = [
  { value: "month", label: "月" },
  { value: "quarter", label: "四半期" },
  { value: "fiscal", label: "年度" },
  { value: "year", label: "年" },
];

/** 目標の向き(ge: 目標以上が良い、le: 目標以下が良い)。 */
export type TargetDirection = "ge" | "le";

export interface IndicatorExtractDefinition extends ExtractRecordDefinition {
  grain?: IndicatorGrain;
  /** 分母(患者の集団)。条件 1 件・「患者」タブに保存した条件・患者フォルダのどれか。 */
  denominator?: ExtractStratum;
  /** 分子(分母のうち条件に当たる患者)。患者フォルダは置けない。 */
  numerator?: ExtractStratum;
  /** 目標値(%)。 */
  target?: number;
  target_direction?: TargetDirection;
}

/** イベントタブ(§25)の結果イベント。条件 1 件か死亡(Patient.deceasedDateTime)。 */
export type EventOutcome = ExtractMetric | { key: string; kind: "death"; label?: string };

export const DEATH_OUTCOME_KIND = "death";

export function isDeathOutcome(outcome: EventOutcome | undefined): outcome is { key: string; kind: "death"; label?: string } {
  return outcome?.kind === DEATH_OUTCOME_KIND;
}

export interface EventExtractDefinition extends ExtractRecordDefinition {
  /** 基準イベント(条件 1 件)。タブの期間内の最初の記録の日が患者の基準日。 */
  index?: ExtractMetric;
  /** 基準の日(開始日 / 終了日。終了日を持つ種類だけ)。 */
  index_anchor?: "start" | "end";
  outcome?: EventOutcome;
  /** 基準日の何日後から結果を数えるか(既定 1)。 */
  outcome_from_days?: number;
  /** 最大の追跡日数(無ければ今日まで)。 */
  follow_days?: number;
}

export type StratumKind = Exclude<ExtractKind, "patient">;

/**
 * 比較群(クラスタ)1 つ(docs/data-extract-design.md §21・§22)。条件 1 件(kind あり。「患者」タブの条件と同じ形)、
 * 「患者」タブに保存した条件(query_code)、患者フォルダ(patient_folder_id。下位フォルダを含む)のどれか。label が名前。
 */
export type ExtractStratum = Omit<ExtractLeaf, "kind" | "not" | "relation" | "output_fields"> & {
  kind?: StratumKind;
  query_code?: string;
  /** 選ぶ前は null。 */
  patient_folder_id?: number | null;
  /** 基準日(§24)。条件型の比較群で、該当記録の最初 / 最後の日を患者の基準日にする。 */
  index_date?: IndexDateMode;
};

/** 比較群の基準日の取り方(該当記録の最初の日 / 最後の日。日は記録の開始日)。 */
export type IndexDateMode = "first" | "last";

export const INDEX_DATE_MODES: { value: IndexDateMode; label: string }[] = [
  { value: "first", label: "最初の記録" },
  { value: "last", label: "最後の記録" },
];

export const MAX_STRATA = 8;

/** クラスタタブの指標(条件型の比較群と同じ形)。 */
export type ExtractMetric = ExtractStratum & { kind: StratumKind };

export const MAX_METRICS = 8;

export function isMetric(stratum: ExtractStratum): stratum is ExtractMetric {
  return Boolean(stratum.kind);
}

/** 患者フォルダの比較群か(選ぶ前の null も含む)。 */
export function isFolderStratum(stratum: ExtractStratum): boolean {
  return "patient_folder_id" in stratum && !stratum.kind && !stratum.query_code;
}

/** 条件型の比較群・指標を「患者」タブの条件にする。期間を入れていなければタブの期間で数える。 */
export function stratumLeaf(stratum: ExtractStratum, period: ExtractPeriod | null | undefined, name: string): ExtractLeaf {
  const { query_code: _code, patient_folder_id: _folder, ...rest } = stratum;
  return { ...rest, kind: stratum.kind!, label: name, period: stratum.period ?? period ?? null };
}

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
