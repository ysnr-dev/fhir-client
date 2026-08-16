import type { RadJj1017Code } from "../api/masterClient";

// 放射線オーダー項目の画面表示で共通に使う選択肢・ラベル。項目マスタの編集画面と
// 項目検索モーダルの両方が同じ見せ方をするためにここへまとめる。

export const KIND_LABELS: Record<string, string> = {
  single: "単項目",
  set: "セット",
};

// 種別(モダリティ)コード → 別表2が持つモダリティ別の使用可否フラグ。
// 部位の候補を「その撮影で使う部位」から先に見せるために使う。
// 表に対応する列が無いモダリティ(核医学・治療など)は絞り込まない。
export const MODALITY_BODY_PART_FLAG: Record<string, keyof RadJj1017Code> = {
  "1": "use_general",
  "2": "use_general",
  "4": "use_general",
  "5": "use_general",
  "6": "use_ct",
  "7": "use_mr",
  "9": "use_us",
  F: "use_general",
  G: "use_general",
  H: "use_general",
};

// 部位は撮影種別で使うものを先に見せる(別表2のモダリティ別使用可否)。
// 対応する列が無いモダリティのときは素直に全件並べる。
export function renderJj1017CodeOptions(
  codes: RadJj1017Code[],
  flag: keyof RadJj1017Code | undefined,
) {
  const option = (code: RadJj1017Code) => (
    <option key={code.code} value={code.code}>
      {code.code} {code.name}
      {code.common_name ? `（${code.common_name}）` : ""}
    </option>
  );

  if (!flag) return codes.map(option);

  const preferred = codes.filter((code) => code[flag]);
  if (preferred.length === 0) return codes.map(option);
  const rest = codes.filter((code) => !code[flag]);

  return (
    <>
      <optgroup label="この撮影種別で使う部位">{preferred.map(option)}</optgroup>
      <optgroup label="その他">{rest.map(option)}</optgroup>
    </>
  );
}
