import { buildError, MasterApiError, masterFetch, type MasterSearchResult } from "./core";

// 特定器材(特定保険医療材料)。レセプト電算の特定器材マスターの写しで、
// 放射線検査の実施入力で使った器材を選ぶために引く。
export interface MedicalMaterial {
  id: number;
  material_code: string;
  name: string | null;
  name_kana: string | null;
  unit_code: string | null;
  unit_name: string | null;
  /** 材料価格(円)。会計連携の基礎になる。 */
  price: string | null;
  /** 特定器材種別。フィルムと材料などの用途区分。 */
  material_category: string | null;
  /** 廃止年月日。"99999999" は廃止されていないことを表す(レセ電算の慣行)。 */
  abolished_on: string | null;
  basic_name: string | null;
}

export async function searchMedicalMaterials(params: {
  name?: string;
  /** 特定器材コード。カンマ区切りで複数指定できる。 */
  material_code?: string;
  material_category?: string;
  /** true なら廃止されていないものだけ。 */
  active?: boolean;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<MedicalMaterial>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.material_code) search.set("material_code", params.material_code);
  if (params.material_category) search.set("material_category", params.material_category);
  if (params.active) search.set("active", "true");
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`/master/medical_materials?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<MedicalMaterial>;
}

// 医科診療行為(手技料)。レセプト電算の医科診療行為マスターの写しで、
// 放射線検査の実施入力で手技を確定するために引く。
export interface MedicalProcedure {
  id: number;
  procedure_code: string;
  name: string | null;
  name_kana: string | null;
  /** 点数。点数識別(point_type)と組で意味を持つ。 */
  points: string | null;
  point_type: string | null;
  /** コード表用番号のアルファベット部。点数表の章で、画像診断は E。 */
  code_table_number_alpha: string | null;
  point_table_section_number: string | null;
  /** 廃止年月日。"99999999" は廃止されていないことを表す(レセ電算の慣行)。 */
  abolished_on: string | null;
  basic_name: string | null;
}

/**
 * コメント関連テーブルの 1 行。診療行為コードに関係するコメントコードと条件。
 * condition_category: 00 = 記載要領の文言で決まる条件 / 01 = 算定したら要る /
 * 02 = 入院・入院外のどちらかで算定したら / 03 = 複数回算定したら。
 */
export interface CommentRelation {
  id: number;
  procedure_code: string;
  procedure_name: string | null;
  comment_code: string;
  comment_text: string | null;
  condition_category: string | null;
  inpatient_outpatient: string | null;
  billing_count: string | null;
}

/** 診療行為コード(複数可)に関係するコメントコードの候補。設定画面でコメントを選ぶときに使う。 */
export async function fetchCommentRelations(
  procedureCodes: string[],
): Promise<MasterSearchResult<CommentRelation>> {
  const search = new URLSearchParams({ procedure_code: procedureCodes.join(","), per: "100" });
  const res = await masterFetch(`/master/comment_relations?${search.toString()}`);
  if (!res.ok) throw new MasterApiError(`${res.status} ${res.statusText}`, res.status);
  return (await res.json()) as MasterSearchResult<CommentRelation>;
}

export async function searchMedicalProcedures(params: {
  name?: string;
  /** 診療行為コード。カンマ区切りで複数指定できる。 */
  procedure_code?: string;
  code_table_number_alpha?: string;
  /** true なら廃止されていないものだけ。 */
  active?: boolean;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<MedicalProcedure>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.procedure_code) search.set("procedure_code", params.procedure_code);
  if (params.code_table_number_alpha) {
    search.set("code_table_number_alpha", params.code_table_number_alpha);
  }
  if (params.active) search.set("active", "true");
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`/master/medical_procedures?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<MedicalProcedure>;
}
