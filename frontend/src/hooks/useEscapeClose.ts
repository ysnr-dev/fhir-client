import { useEffect, useRef } from "react";

/**
 * Escape で閉じるものの重なり。モーダル・ケバブメニュー・吹き出し・ドロワー・全画面が
 * 開いた順に積まれ、Escape は一番上(あとから開いたもの)だけを閉じる。
 * 重ねたモーダルは内側から順に、全画面の上に開いたモーダルはモーダル → 全画面の順に閉じる。
 */
const stack: Array<{ close: () => void }> = [];

function handleKeyDown(event: KeyboardEvent) {
  // 入力欄や部品が自分で使った Escape(テンプレート選択のメニューを畳むなど)と、
  // IME の変換中の Escape は横取りしない。
  if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
  const top = stack[stack.length - 1];
  if (!top) return;
  event.preventDefault();
  top.close();
}

/**
 * 開いている間(active)だけ重なりに載せ、一番上にいるときの Escape で onClose を呼ぶ。
 * onClose は毎描画で作り直されてよい(押した時点の最新のものを呼ぶ)。
 */
export function useEscapeClose(onClose: () => void, active = true) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const entry = { close: () => onCloseRef.current() };
    stack.push(entry);
    // window の bubble で受けるので、要素側の React ハンドラや document の購読より後に回る。
    if (stack.length === 1) window.addEventListener("keydown", handleKeyDown);
    return () => {
      const index = stack.indexOf(entry);
      if (index >= 0) stack.splice(index, 1);
      if (stack.length === 0) window.removeEventListener("keydown", handleKeyDown);
    };
  }, [active]);
}
