// 削除の理由を、確認モーダルから削除のリクエストへ渡すための受け渡し場所。
// 削除の mutation は種別ごとに id しか受け取らないので、モーダルが消す対象の参照と理由を
// ここに置き、fhirClient がその対象を消すリクエストに X-Delete-Reason として載せる
// (中継が削除の来歴に書く。backend の FhirDeleteProvenance)。対象が一致するリクエストだけに載る
// ので、連日の注射のように何回かに分けて消すときも全部に付く。削除が終わったら消す。

/** 理由の入力欄の候補。 */
export const DELETE_REASON_SUGGESTIONS = ["誤入力", "患者間違い", "重複登録"];

let staged: { references: Set<string>; reason: string } | null = null;

/** 消す対象("Composition/abc" の形)と理由を置く。前に置いたものは捨てる。 */
export function stageDeleteReason(references: string[], reason: string) {
  const text = reason.trim();
  staged = text && references.length > 0 ? { references: new Set(references), reason: text } : null;
}

/** 消す対象のどれかが置いた対象なら、その理由。一致しなければ null。 */
export function stagedDeleteReason(deleteUrls: string[]): string | null {
  return staged && deleteUrls.some((url) => staged?.references.has(url)) ? staged.reason : null;
}

export function clearDeleteReason() {
  staged = null;
}
