import { buildError, masterFetch } from "./core";

// ---- 看護必要度のレセプト電算処理システム用コード(別紙7 別表1・別表2) ----

export interface NursingAcuityCode {
  /** item = 別表1(項目に当たるコード)、a3_exclusion = 別表2(A3 の種類数から除く薬剤)。 */
  kind: "item" | "a3_exclusion";
  /** 評価票の項目コード(A1 / A6-1 / C21 など)。 */
  item_code: string;
  code: string;
  name: string | null;
  /** 必要度Ⅰを評価する場合のみに用いるコード(配布ファイルの「※」)。 */
  form_i_only: boolean;
  /** C 項目の評価の対象になる日数(当日を含む)。 */
  days: number | null;
}

// 1 回に問い合わせるコードの数(backend の上限 500 と URL の長さに収まる幅)。
const CODE_CHUNK = 150;

/** 実施記録に出てきたコードのうち、別表1・別表2 に当たる行。 */
export async function searchNursingAcuityCodes(codes: string[]): Promise<NursingAcuityCode[]> {
  const unique = [...new Set(codes.filter((code) => /^\d{9}$/.test(code)))];
  const results: NursingAcuityCode[] = [];
  for (let i = 0; i < unique.length; i += CODE_CHUNK) {
    const search = new URLSearchParams();
    search.set("code", unique.slice(i, i + CODE_CHUNK).join(","));
    const res = await masterFetch(`/master/nursing_acuity_codes?${search.toString()}`);
    if (!res.ok) throw await buildError(res);
    results.push(...((await res.json()) as { items: NursingAcuityCode[] }).items);
  }
  return results;
}
