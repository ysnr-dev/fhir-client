import { buildError, masterFetch, type MasterSearchResult } from "./core";

// ---- 看護マスタ(MEDIS 看護実践用語標準マスター) ----
// 配布ファイルを取込で洗い替える読み取り専用。画面からの登録・編集は無い。

export interface NursingAct {
  id: number;
  change_category: string;
  manage_no: string;
  level1_code: string;
  level1_name: string | null;
  level1_definition: string | null;
  level2_code: string;
  level2_name: string | null;
  level2_definition: string | null;
  level3_code: string;
  level3_name: string | null;
  level3_definition: string | null;
  level4_code: string;
  level4_name: string | null;
  level4_definition: string | null;
  example: string | null;
  code_16: string;
  active: boolean;
}

export interface NursingActLevel {
  code: string;
  name: string | null;
  children: { code: string; name: string | null }[];
}

export interface NursingActLevels {
  levels: NursingActLevel[];
}

export interface NursingObservation {
  id: number;
  change_category: string;
  manage_no: string;
  search_category_1: string | null;
  search_category_2: string | null;
  search_category_3: string | null;
  search_category_4: string | null;
  search_category_5: string | null;
  search_category_6: string | null;
  search_category_7: string | null;
  search_category_8: string | null;
  name: string;
  kana: string | null;
  focus: string | null;
  site: string | null;
  phase: string | null;
  other: string | null;
  criteria: string | null;
  expression_type: string | null;
  unit: string | null;
  unit_code: string | null;
  result_group_code: string | null;
  active: boolean;
  [key: `result_${number}`]: string | null | undefined;
}

export interface NursingObservationResult {
  id: number;
  result_group_code: string;
  result_code: string;
  name: string;
}

export interface NursingUnit {
  id: number;
  unit_code: string;
  name: string;
}

const NURSING_ACTS_PATH = "/master/nursing_acts";
const NURSING_OBSERVATIONS_PATH = "/master/nursing_observations";
const NURSING_OBSERVATION_RESULTS_PATH = "/master/nursing_observation_results";

export async function searchNursingActs(params: {
  name?: string;
  level1_code?: string;
  level2_code?: string;
  level3_code?: string;
  /** 管理番号。カンマ区切りで複数指定できる。 */
  manage_no?: string;
  /** 16 桁コード。カンマ区切りで複数指定できる。 */
  code_16?: string;
  /** false で削除済みの用語も返す。 */
  active?: boolean;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<NursingAct>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.level1_code) search.set("level1_code", params.level1_code);
  if (params.level2_code) search.set("level2_code", params.level2_code);
  if (params.level3_code) search.set("level3_code", params.level3_code);
  if (params.manage_no) search.set("manage_no", params.manage_no);
  if (params.code_16) search.set("code_16", params.code_16);
  if (params.active === false) search.set("active", "false");
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`${NURSING_ACTS_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<NursingAct>;
}

/** 行為(第 3 階層)。修飾語で分かれた行を畳んだもの。 */
export interface NursingActAction {
  level1_code: string;
  level1_name: string | null;
  level2_code: string;
  level2_name: string | null;
  level3_code: string;
  level3_name: string | null;
  /** その行為が持つ行数(修飾語なしの D000 を含む)。 */
  modifier_count: number;
  /** 行為を選んだ時点で確定するコード(修飾語なしの D000、無ければ先頭)。 */
  default_code_16: string | null;
  default_manage_no: string | null;
  default_modifier_name: string | null;
}

export async function searchNursingActActions(params: {
  name?: string;
  level1_code?: string;
  level2_code?: string;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<NursingActAction>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.level1_code) search.set("level1_code", params.level1_code);
  if (params.level2_code) search.set("level2_code", params.level2_code);
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`${NURSING_ACTS_PATH}/actions?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<NursingActAction>;
}

export async function fetchNursingActLevels(): Promise<NursingActLevels> {
  const res = await masterFetch(`${NURSING_ACTS_PATH}/levels`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as NursingActLevels;
}

export async function searchNursingObservations(params: {
  name?: string;
  /** 検索大分類 1〜8。 */
  category?: string;
  manage_no?: string;
  active?: boolean;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<NursingObservation>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.category) search.set("category", params.category);
  if (params.manage_no) search.set("manage_no", params.manage_no);
  if (params.active === false) search.set("active", "false");
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`${NURSING_OBSERVATIONS_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<NursingObservation>;
}

export async function fetchNursingObservationResults(params: {
  result_group_code: string;
}): Promise<MasterSearchResult<NursingObservationResult>> {
  const search = new URLSearchParams();
  search.set("result_group_code", params.result_group_code);
  search.set("per", "500");
  const res = await masterFetch(`${NURSING_OBSERVATION_RESULTS_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<NursingObservationResult>;
}
