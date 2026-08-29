import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/**
 * 入力エラー(必須未入力など)の文言と、その表示先のエラーバナーへ付ける ref。
 *
 * エラーバナーはフォームの先頭に出るので、下の方を入力していると画面外にあって
 * 気づけない。文言を出した時点でバナーを画面内へスクロールして見せる。
 *
 * 同じ文言を続けて出したとき(直さずにもう一度登録を押した場合など)にも
 * スクロールし直せるよう、文言の変化ではなく set した回数で発火する。
 *
 * 戻り値は useState と同じ並びで、3 つ目にバナー用の ref が付く。
 */
export function useValidationError(): [
  string | null,
  (message: string | null) => void,
  RefObject<HTMLDivElement | null>,
] {
  const [error, setError] = useState<string | null>(null);
  // set した回数。同じ文言でも再スクロールさせるために持つ。
  const [shownAt, setShownAt] = useState(0);
  const ref = useRef<HTMLDivElement | null>(null);

  const show = useCallback((message: string | null) => {
    setError(message);
    if (message) setShownAt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (shownAt === 0) return;
    // 上にヘッダーやタブがある画面でも隠れないよう、上端ではなく中央に寄せる。
    //
    // 動きを見せるためにアニメーションさせる。いきなり最上部に切り替わると、
    // 操作者には画面が変わったのかスクロールしたのかが分からず、バナーにも
    // 気づきにくい。動く様子が見えれば「上に何か出た」と伝わる。
    //
    // OS 側で視差効果を減らす設定にしているときは即時移動にする。
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ref.current?.scrollIntoView({
      block: "center",
      behavior: reduced ? "auto" : "smooth",
    });
  }, [shownAt]);

  return [error, show, ref];
}
