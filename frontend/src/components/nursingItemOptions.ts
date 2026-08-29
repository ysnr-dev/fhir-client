import type { NursingObservation } from "../api/masterClient";

// 看護観察編の検索大分類(配布ファイルの列「検索大分類１〜８」)の見出し。
export const NURSING_OBSERVATION_CATEGORIES = [
  { code: "1", label: "バイタルサイン・全身状態" },
  { code: "2", label: "栄養・代謝" },
  { code: "3", label: "排泄" },
  { code: "4", label: "活動・休息" },
  { code: "5", label: "呼吸・循環" },
  { code: "6", label: "皮膚・粘膜" },
  { code: "7", label: "認知・知覚・精神" },
  { code: "8", label: "その他" },
] as const;

/** 列挙型の選択肢。結果 1〜18 の空でないものを並べる。 */
export function nursingObservationResults(obs: NursingObservation): string[] {
  const values: string[] = [];
  for (let i = 1; i <= 18; i++) {
    const v = obs[`result_${i}`];
    if (v) values.push(v);
  }
  return values;
}
