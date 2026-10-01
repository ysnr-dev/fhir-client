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
