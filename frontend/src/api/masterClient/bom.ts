import { buildError, masterFetch, type MasterSearchResult } from "./core";

// BOM(Basic Outcome Master®、日本クリニカルパス学会)のアウトカム・観察項目。配布ファイルを取り込んで
// 検索する(docs/clinical-pathway-design.md §3.3)。登録・編集は無い。配布ファイルは学会の知財で同梱しない。

export interface BomOutcome {
  id: number;
  manage_no: string | null;
  /** 大分類(G 患者目標 / H 患者状態)。 */
  category_code: string | null;
  category_name: string | null;
  /** 中分類(H013 循環 など)。 */
  subcategory_code: string | null;
  subcategory_name: string | null;
  outcome_code: string;
  outcome_name: string;
  display_order: number | null;
}

export interface BomAssessment {
  id: number;
  manage_no: string | null;
  /** 観察項目分類(19 バイタルサイン など)。 */
  category_code: string | null;
  category_name: string | null;
  assessment_code: string;
  name: string;
  name2: string | null;
  /** 対応する MEDIS 看護観察の管理番号と名称。 */
  medis_manage_no: string | null;
  medis_name: string | null;
  display_order: number | null;
}

export interface BomSearchParams {
  name?: string;
  category_code?: string;
  code?: string;
  page?: number;
  per?: number;
}

function query(params: BomSearchParams): string {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.category_code) search.set("category_code", params.category_code);
  if (params.code) search.set("code", params.code);
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));
  return search.toString();
}

export async function searchBomOutcomes(params: BomSearchParams): Promise<MasterSearchResult<BomOutcome>> {
  const res = await masterFetch(`/master/bom_outcomes?${query(params)}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<BomOutcome>;
}

/** アウトカムに属する観察項目(BOM の OAT の組)。マスタに無いコードは名称だけ。 */
export async function fetchBomOutcomeAssessments(outcomeCode: string): Promise<BomAssessment[]> {
  const res = await masterFetch(`/master/bom_outcomes/${encodeURIComponent(outcomeCode)}/assessments`);
  if (!res.ok) throw await buildError(res);
  return ((await res.json()) as { items: BomAssessment[] }).items;
}

export async function searchBomAssessments(params: BomSearchParams): Promise<MasterSearchResult<BomAssessment>> {
  const res = await masterFetch(`/master/bom_assessments?${query(params)}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<BomAssessment>;
}
