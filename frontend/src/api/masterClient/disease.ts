import { buildError, masterFetch, type MasterSearchResult } from "./core";

export interface Disease {
  id: number;
  management_number: string;
  name: string;
  name_kana: string | null;
  // 1:レベル1病名、2:レベル2病名、3:互換表記(同義語)
  adoption_category: string | null;
  // 病名交換用コード(4桁)
  exchange_code: string | null;
  icd10_2013: string | null;
  // レセ電算用傷病名コード
  receipt_code: string | null;
  // 00:制限なし、01:修飾語との組合せが望ましい
  single_use_prohibited_category: string | null;
}

export interface Modifier {
  id: number;
  management_number: string;
  name: string;
  name_kana: string | null;
  // 修飾語交換用コード
  exchange_code: string | null;
  // 10以上:病名の前に置く(接頭語)、9以下:後に置く(接尾語)
  connection_position_category: string | null;
  // 前から2桁目が分類(1:部位〜8:接尾語、9:歯科)
  modifier_category: string | null;
  // レセ電算用修飾語コード
  receipt_code: string | null;
}

export async function searchDiseases(params: {
  name?: string;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<Disease>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  // 削除区分レコード(過去版から削除された病名)は選択対象にしない
  search.set("exclude_deleted", "1");
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`/master/diseases?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<Disease>;
}

export async function searchModifiers(params: {
  name?: string;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<Modifier>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  search.set("exclude_deleted", "1");
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`/master/modifiers?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<Modifier>;
}
