import { buildError, masterFetch, type MasterSearchResult } from "./core";

// ---- 郵便番号マスタ(日本郵便 KEN_ALL.CSV) ----

export interface PostalCode {
  id: number;
  postal_code: string;
  jis_code: string | null;
  prefecture: string;
  city: string;
  /** 町域名。「以下に掲載がない場合」などの注記行は空。 */
  town: string;
  prefecture_kana: string | null;
  city_kana: string | null;
  town_kana: string | null;
}

export async function searchPostalCodes(params: {
  postal_code?: string;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<PostalCode>> {
  const search = new URLSearchParams();
  if (params.postal_code) search.set("postal_code", params.postal_code);
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`/master/postal_codes?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<PostalCode>;
}
