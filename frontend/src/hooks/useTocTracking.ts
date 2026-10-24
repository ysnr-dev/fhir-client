import { useEffect, useRef, useState, type RefObject } from "react";

// 目次(nav)の現在位置の追従と、押した位置への移動。移動先は文書順に並べた要素の id。
// スクロールは目次の最寄りのスクロール領域(無ければウィンドウ)で追うので、モーダルの中でも使える。

/** 目次から飛んだあと、利用者が自分でスクロールし始めたとみなす操作。
 *  それまでは飛んだ先を現在位置のままにする(ページ末尾の項目は上端まで送れないので、
 *  スクロール位置から求めると手前の項目になるため)。 */
const USER_SCROLL_EVENTS = ["wheel", "touchmove", "keydown", "pointerdown"] as const;

function scrollParentOf(element: HTMLElement): HTMLElement | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const overflowY = getComputedStyle(parent).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return parent;
  }
  return null;
}

/**
 * @param anchorIds 移動先の id(文書順)
 * @param activeLine 移動先の上端がスクロール領域の上端からこの px 以内に来たら「読んでいる」とみなす
 */
export function useTocTracking(
  navRef: RefObject<HTMLElement | null>,
  anchorIds: string[],
  activeLine: number,
): { activeId: string; jumpTo: (id: string) => void } {
  const anchorKey = anchorIds.join("\n");
  const [activeId, setActiveId] = useState(anchorIds[0] ?? "");
  const holding = useRef(false);

  // 並びが変わったとき(追加・削除・並べ替え、条件付きの出入り)も求め直す。
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const ids = anchorKey ? anchorKey.split("\n") : [];
    const container = scrollParentOf(nav);
    const target: HTMLElement | Window = container ?? window;
    const update = () => {
      if (holding.current) return;
      const top = container ? container.getBoundingClientRect().top : 0;
      let active = ids[0] ?? "";
      for (const id of ids) {
        const anchor = document.getElementById(id);
        if (!anchor) continue;
        if (anchor.getBoundingClientRect().top - top > activeLine) break;
        active = id;
      }
      setActiveId(active);
    };
    const release = () => {
      holding.current = false;
    };
    update();
    target.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    for (const type of USER_SCROLL_EVENTS) window.addEventListener(type, release, { passive: true });
    return () => {
      target.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      for (const type of USER_SCROLL_EVENTS) window.removeEventListener(type, release);
    };
  }, [navRef, anchorKey, activeLine]);

  // 強調した行が目次の表示範囲から外れていたら、目次の中だけを送って見せる
  // (scrollIntoView はページ全体まで動かしうるので使わない)。
  useEffect(() => {
    const nav = navRef.current;
    const button = nav?.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(activeId)}"]`);
    if (!nav || !button) return;
    const navRect = nav.getBoundingClientRect();
    const rect = button.getBoundingClientRect();
    if (rect.top < navRect.top) nav.scrollTop -= navRect.top - rect.top + 8;
    else if (rect.bottom > navRect.bottom) nav.scrollTop += rect.bottom - navRect.bottom + 8;
  }, [navRef, activeId]);

  // 自動化環境では smooth スクロールが動かないことがあるので、即時に移動する。
  function jumpTo(id: string) {
    holding.current = true;
    setActiveId(id);
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  }

  return { activeId, jumpTo };
}
