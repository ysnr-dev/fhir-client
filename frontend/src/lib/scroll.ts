// 操作の結果として別の場所へ画面を送るときのスクロール。
//
// いきなり切り替わると、操作者には画面が変わったのかスクロールしたのかが分からないので、
// 動く様子が見えるよう滑らかに送る。OS で視差効果を減らす設定にしているときは即時に移る。
// 画面を開いたときの初期位置合わせ(今日の列へ寄せるなど)は動きを見せる必要が無いので使わない。

export function scrollIntoViewVisibly(
  element: Element | null | undefined,
  block: ScrollLogicalPosition = "start",
): void {
  if (!element) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  element.scrollIntoView({ block, behavior: reduced ? "auto" : "smooth" });
}
