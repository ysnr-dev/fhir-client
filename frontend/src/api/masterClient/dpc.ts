import { buildError, masterFetch, type MasterSearchResult } from "./core";

// DPC 電子点数表の ICD-10 → 診断群分類上6桁の対応表。様式1 の必須判定で引く。
// 配布 Excel を取り込んで検索するだけで、登録・編集は無い。
export interface DpcIcdCode {
  /** 診断群分類の上6桁(MDCコード2桁 + 分類コード4桁)。分類の末尾は "x" のことがある("01021x")。 */
  mdc6: string;
  /** 問い合わせた ICD-10(小数点なし)。 */
  icd10: string;
  icd_name: string;
  /** 対応表の表記。"I50$" は I50 で始まるコードすべて、"M!!!!" は表に無い M コードすべて。 */
  icd_pattern?: string;
}

/**
 * ICD-10(小数点なし)から診断群分類上6桁を引く。対応表の "I50$" のような表記は
 * サーバー側で解くので、返る icd10 は問い合わせたコードそのもの。
 * 対応表に無いコードは結果に出ない。
 */
export async function fetchDpcIcdCodes(icd10s: string[]): Promise<DpcIcdCode[]> {
  if (icd10s.length === 0) return [];
  const search = new URLSearchParams({ icd10: icd10s.join(",") });

  const res = await masterFetch(`/master/dpc_icd_codes?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return ((await res.json()) as MasterSearchResult<DpcIcdCode>).items;
}

// ---- 手術基幹コード(STEM7) ----

/** K コード → 外保連手術試案の手術基幹コード(STEM7)の対応表の 1 行。 */
export interface DpcStem7Code {
  id: number;
  /** 様式1 の点数表コードの書き方(K0821ｲ、K082-21)。 */
  k_code: string;
  /** 配布ファイルの表記(K082 1 ｲ)。 */
  k_code_source: string;
  surgery_name: string | null;
  /** 空白を詰めた 7 桁。 */
  stem7: string;
  /** 同じ K コードに複数の STEM7 があるときの使い分け。 */
  note: string | null;
}

// 細目の全角カナ → 半角カナ(様式1・診療行為マスタの書き方)。
const SUBITEM_KANA: Record<string, string> = {
  イ: "ｲ", ロ: "ﾛ", ハ: "ﾊ", ニ: "ﾆ", ホ: "ﾎ", ヘ: "ﾍ", ト: "ﾄ", チ: "ﾁ", リ: "ﾘ", ヌ: "ﾇ",
};

/**
 * 点数表コードを対応表の書き方(空白なし・英数字と括弧は半角・細目は半角カナ)にそろえる。
 * backend の Master::DpcStem7Code.normalize_k_code と同じ。
 */
export function normalizeDpcKCode(code: string): string {
  return code
    .replace(/[０-９Ａ-Ｚａ-ｚ（）－]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\s/g, "")
    .replace(/[イロハニホヘトチリヌ]/g, (c) => SUBITEM_KANA[c])
    .toUpperCase();
}

/** 点数表コード(複数)の STEM7 の候補。対応表に無いコードは結果に出ない。 */
export async function fetchDpcStem7Codes(kCodes: string[]): Promise<DpcStem7Code[]> {
  const codes = [...new Set(kCodes.map(normalizeDpcKCode).filter(Boolean))];
  if (codes.length === 0) return [];
  const search = new URLSearchParams({ k_code: codes.join(","), per: "100" });
  const res = await masterFetch(`/master/dpc_stem7_codes?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return ((await res.json()) as MasterSearchResult<DpcStem7Code>).items;
}

/** 候補が 1 つ(STEM7 が 1 種類)のときだけ、その STEM7。 */
export function singleDpcStem7(candidates: DpcStem7Code[]): string {
  const stems = [...new Set(candidates.map((c) => c.stem7))];
  return stems.length === 1 ? stems[0] : "";
}

// ---- 診断群分類(14 桁)の判定と、電子点数表の閲覧 ----

/** 判定に渡す様式1 の値(fhir/dpcCodingHelpers.ts の dpcCodingInputsFromForm1 が作る)。 */
export interface DpcCodingInputs {
  icd10?: string;
  comorbidity_icd10s: string[];
  birth_date?: string;
  jcs?: number;
  birth_weight?: number;
  pregnancy_weeks?: number;
  delivery_bleeding?: number;
  burn_index?: number;
  gaf?: number;
  /** 院内肺炎 3 / 市中肺炎 5 / 肺炎以外 8。 */
  pneumonia_category?: string;
  adrop?: number;
  /** 脳卒中の発症時期(1〜4)。 */
  stroke_onset?: string;
  child_pugh?: number;
  pancreatitis_a?: number;
  pancreatitis_b?: number;
  transfer?: boolean;
  bilateral?: boolean;
  reoperation?: boolean;
  surgeries: { date?: string; k_code: string; name?: string }[];
}

/** 人の上書き。branches は分岐の値、accepted / rejected は手術・処置・薬剤のコード。 */
export interface DpcCodingOverrides {
  branches: Record<string, string>;
  accepted: string[];
  rejected: string[];
}

export interface DpcEvidence {
  /** performed(実施記録) / form1(様式1) / suggested・accepted・derived(候補) / override(人が足した)。 */
  source: string;
  ref?: string;
  date?: string;
  code?: string;
  name?: string;
  note?: string;
}

export interface DpcBranch {
  key: string;
  label: string;
  value: string | null;
  auto_value: string | null;
  status: "auto" | "override" | "undetermined" | "not_applicable";
  options: { value: string; label: string | null }[];
  evidence: DpcEvidence[];
}

export interface DpcCandidate {
  code: string;
  name: string;
  /** suggested(確定待ち) / accepted / rejected / derived(実施記録から導いたもの)。 */
  status: "suggested" | "accepted" | "rejected" | "derived";
  basis: DpcEvidence[];
  note: string | null;
}

export interface DpcPointRow {
  dpc_code: string;
  bundled: boolean;
  names: {
    disease: string | null;
    surgery: string | null;
    proc1: string | null;
    proc2: string | null;
    comorbidity: string | null;
    severity: string | null;
  };
  /** 入院日Ⅰ〜Ⅲ(包括の対象外は null)。 */
  days: (number | null)[];
  /** 入院期間Ⅰ〜Ⅲの 1 日あたり点数。 */
  points: (number | null)[];
}

export interface DpcCodingRow extends DpcPointRow {
  /** 入院期間Ⅰ〜Ⅲの末日(YYYY-MM-DD)。 */
  period_ends: (string | null)[];
  /** 在院日数ぶんの包括点数の合計(期間Ⅲを超えた日は数えない)。 */
  estimated_points: number | null;
  ccpm: string | null;
  consistent?: boolean;
  current?: boolean;
}

export interface DpcCodingResult {
  edition: string | null;
  base_date?: string;
  mdc6: string | null;
  mdc6_options?: string[];
  classification_name: string | null;
  branches?: DpcBranch[];
  candidates?: DpcCandidate[];
  dpc_codes?: string[];
  stay?: { admitted_on: string; discharged_on: string | null; days: number };
  result?: DpcCodingRow | null;
  simulation?: DpcCodingRow[];
  /** 基準日に有効な医療機関別係数。 */
  coefficient?: { from: string; value: string } | null;
  warnings: string[];
}

export async function postDpcCoding(body: {
  encounter_id: string;
  inputs: DpcCodingInputs;
  overrides: DpcCodingOverrides;
}): Promise<DpcCodingResult> {
  const res = await masterFetch("/master/dpc/coding", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as DpcCodingResult;
}

export interface DpcEdition {
  edition: string;
  source_filename: string | null;
  counts: Record<string, number>;
  imported_at: string;
}

export async function fetchDpcEditions(): Promise<DpcEdition[]> {
  const res = await masterFetch("/master/dpc_tables");
  if (!res.ok) throw await buildError(res);
  return ((await res.json()) as { items: DpcEdition[] }).items;
}

export interface DpcClassificationList {
  edition: string | null;
  classifications: { code: string; name: string }[];
  points: DpcPointRow[];
}

export async function fetchDpcClassifications(params: {
  q?: string;
  mdc6?: string;
  on?: string;
}): Promise<DpcClassificationList> {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.mdc6) search.set("mdc6", params.mdc6);
  if (params.on) search.set("on", params.on);
  const res = await masterFetch(`/master/dpc/classifications?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as DpcClassificationList;
}
