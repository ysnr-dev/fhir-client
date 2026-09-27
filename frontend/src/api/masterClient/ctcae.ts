import { buildError, masterFetch, type MasterSearchResult } from "./core";

// CTCAE(有害事象共通用語規準)v5.0 日本語訳 JCOG 版。配布 Excel を取り込んで検索する
// (docs/chemo-regimen-design.md §8.11)。登録・編集は無い。
export interface CtcaeTerm {
  id: number;
  /** MedDRA の下層語コード(8 桁)。 */
  meddra_code: string;
  soc_en: string | null;
  soc_ja: string | null;
  term_en: string | null;
  term_ja: string;
  grade1_ja: string | null;
  grade2_ja: string | null;
  grade3_ja: string | null;
  grade4_ja: string | null;
  grade5_ja: string | null;
  grade1_en: string | null;
  grade2_en: string | null;
  grade3_en: string | null;
  grade4_en: string | null;
  grade5_en: string | null;
  definition_ja: string | null;
  definition_en: string | null;
  navigational_note_ja: string | null;
  navigational_note_en: string | null;
  display_order: number | null;
}

const CTCAE_TERMS_PATH = "/master/ctcae_terms";

export async function searchCtcaeTerms(params: {
  name?: string;
  soc?: string;
  meddra_code?: string;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<CtcaeTerm>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.soc) search.set("soc", params.soc);
  if (params.meddra_code) search.set("meddra_code", params.meddra_code);
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`${CTCAE_TERMS_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<CtcaeTerm>;
}

/** 器官別大分類(SOC)の一覧。収載順。 */
export async function fetchCtcaeSocs(): Promise<string[]> {
  const res = await masterFetch(`${CTCAE_TERMS_PATH}/socs`);
  if (!res.ok) throw await buildError(res);
  return ((await res.json()) as { items: string[] }).items;
}

export const DOSE_CONVERSIONS_PATH = "/master/medicine_dose_conversions";
