import { addDays } from "../lib/dates";

// データ抽出(docs/data-extract-design.md)の条件のモデルと、条件を検索にするときの部品。
// 条件の種類ごとの定義(fhir/extractKinds.ts)と、組み合わせ・結果(fhir/extractQueryHelpers.ts)の
// 両方が使う。

/** 条件の種類。並びは「＋条件」の選択肢の順。足すときは fhir/extractKinds.ts の対応表も埋める。 */
export const EXTRACT_KINDS = [
  "patient",
  "condition",
  "observation",
  "medication",
  "order",
  "admission",
  "outpatient",
] as const;

export type ExtractKind = (typeof EXTRACT_KINDS)[number];

export interface ExtractCode {
  system: string;
  code: string;
  display?: string;
}

/** 期間。absolute は日付(どちらか片方でもよい)、relative は今日から days 日前〜今日。 */
export interface ExtractPeriod {
  mode: "absolute" | "relative";
  from?: string;
  to?: string;
  days?: number;
}

export type ExtractValueOp = "ge" | "gt" | "le" | "lt";
export const EXTRACT_VALUE_OPS: { value: ExtractValueOp; label: string }[] = [
  { value: "ge", label: "以上" },
  { value: "gt", label: "より大きい" },
  { value: "le", label: "以下" },
  { value: "lt", label: "未満" },
];

export type AdmissionDateMode = "overlap" | "admitted" | "discharged";
export const ADMISSION_DATE_MODES: { value: AdmissionDateMode; label: string }[] = [
  { value: "overlap", label: "期間中に入院していた" },
  { value: "admitted", label: "期間中に入院した" },
  { value: "discharged", label: "期間中に退院した" },
];

export type ExtractOrderType = "prescription" | "injection";
export const EXTRACT_ORDER_TYPES: { value: ExtractOrderType; label: string }[] = [
  { value: "prescription", label: "処方" },
  { value: "injection", label: "注射" },
];

/** 部門オーダーの条件で、依頼(ServiceRequest)と実施(Procedure)のどちらを数えるか。 */
export type ExtractOrderStage = "ordered" | "performed";
export const EXTRACT_ORDER_STAGES: { value: ExtractOrderStage; label: string }[] = [
  { value: "ordered", label: "依頼" },
  { value: "performed", label: "実施" },
];

/**
 * 時間関係。同じ AND グループの別の条件(key)の記録の日から from_days〜to_days 日に入る記録だけを
 * 数える(負の日数は前)。基準の記録のどれか 1 つに対して窓に入れば数える。anchor_date は基準の
 * 記録のどの日を使うか(end は入院・外来・実施の終了日。再入院を「退院の翌日から 30 日」で見るときなど)。
 */
export interface ExtractRelation {
  key: string;
  from_days: number;
  to_days: number;
  anchor_date?: "start" | "end";
}

/** 薬効分類(YJ コードの先頭 2〜4 桁)。実行時に医薬品コードへ展開する。 */
export interface ExtractDrugClass {
  code: string;
  name?: string;
}

export const CLINICAL_STATUS_OPTIONS = [
  { value: "active", label: "継続" },
  { value: "resolved", label: "治癒" },
  { value: "inactive", label: "中止" },
  { value: "remission", label: "寛解" },
] as const;

/** 条件ごとに出す項目。 */
export type LeafOutputField = "count" | "first" | "last" | "latest";

export const LEAF_OUTPUT_FIELDS: { value: LeafOutputField; label: string }[] = [
  { value: "count", label: "件数" },
  { value: "first", label: "最初" },
  { value: "last", label: "最後" },
  { value: "latest", label: "最新" },
];

export interface ExtractLeaf {
  key: string;
  kind: ExtractKind;
  label?: string;
  /** 除外(AND グループの直下で、除外でない兄弟があるときだけ)。 */
  not?: boolean;
  period?: ExtractPeriod | null;
  /** 期間内に何件以上あれば該当とするか(既定 1)。 */
  min_count?: number;
  codes?: ExtractCode[];
  gender?: string[];
  age?: { min?: number | null; max?: number | null };
  clinical_status?: string[];
  /** 病名の日付。既定は開始日(onset)。 */
  date_field?: "recorded" | "onset";
  value?: { op: ExtractValueOp; value: number } | null;
  date_mode?: AdmissionDateMode;
  department_id?: string;
  department_name?: string;
  /** 入院の病棟(Location)。 */
  ward_id?: string;
  ward_name?: string;
  /** 処方・注射の条件で薬効分類から指定した薬(codes と和をとる)。 */
  drug_classes?: ExtractDrugClass[];
  /** 処方・注射の区別。無ければ両方。 */
  order_type?: ExtractOrderType;
  /** 部門オーダーの種別(order-type のコード)。 */
  order_kind?: string;
  /** 部門オーダーの依頼か実施か。 */
  stage?: ExtractOrderStage;
  relation?: ExtractRelation;
  /** 一覧・CSV に出す項目。無ければすべて。 */
  output_fields?: LeafOutputField[];
}

export interface ExtractGroup {
  op: "and" | "or";
  children: ExtractNode[];
}

export type ExtractNode = ExtractGroup | ExtractLeaf;

/** 条件の検索で返る型。 */
export type ExtractRecord =
  | fhir4.Patient
  | fhir4.Condition
  | fhir4.Observation
  | fhir4.MedicationRequest
  | fhir4.ServiceRequest
  | fhir4.Procedure
  | fhir4.Encounter;

// ---- 条件 → FHIR 検索の部品 ----

export interface ResolvedPeriod {
  from?: string;
  to?: string;
}

export function resolvePeriod(period: ExtractPeriod | null | undefined, today: string): ResolvedPeriod | null {
  if (!period) return null;
  if (period.mode === "relative") return { from: addDays(today, -(period.days ?? 0)), to: today };
  return { from: period.from || undefined, to: period.to || undefined };
}

/** 年齢の範囲を生年月日の範囲に直す(min 歳以上 = 生年月日が今日の min 年前以前)。 */
export function ageToBirthDateRange(age: ExtractLeaf["age"], today: string): { le?: string; gt?: string } {
  const shift = (years: number) => {
    const [y, m, d] = today.split("-").map(Number);
    const date = new Date(Date.UTC(y - years, m - 1, d));
    return date.toISOString().slice(0, 10);
  };
  return {
    le: age?.min != null ? shift(age.min) : undefined,
    gt: age?.max != null ? shift(age.max + 1) : undefined,
  };
}

export const EXTRACT_CODE_CHUNK = 100;

export interface LeafSearch {
  resourceType: string;
  /** コードが多い条件は分けて引き、患者の和集合を取る。 */
  paramsList: URLSearchParams[];
}

function codeParam(codes: ExtractCode[]): string {
  return codes.map((c) => `${c.system}|${c.code}`).join(",");
}

export function withCodes(codes: ExtractCode[], build: (codeValue: string) => URLSearchParams): URLSearchParams[] {
  const chunks: URLSearchParams[] = [];
  for (let i = 0; i < codes.length; i += EXTRACT_CODE_CHUNK) {
    chunks.push(build(codeParam(codes.slice(i, i + EXTRACT_CODE_CHUNK))));
  }
  return chunks;
}

export function appendRange(params: URLSearchParams, name: string, range: ResolvedPeriod | null) {
  if (range?.from) params.append(name, `ge${range.from}`);
  if (range?.to) params.append(name, `le${range.to}`);
}
