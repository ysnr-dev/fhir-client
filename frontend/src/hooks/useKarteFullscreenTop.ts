import { useEffect, useState, type RefObject } from "react";

/**
 * カルテのタブの全画面の上端。全画面はビューポート全体ではなく「患者情報の下」から始めるので、
 * カルテのレイアウト(左右ペインの上端 .karte-layout)を実測して返す。全画面の間だけ測り、
 * ウィンドウの大きさが変わったら測り直す。
 */
export function useKarteFullscreenTop(panelRef: RefObject<HTMLElement | null>, fullscreen: boolean): number {
  const [top, setTop] = useState(0);
  useEffect(() => {
    if (!fullscreen) return;
    function measure() {
      const layout = panelRef.current?.closest(".karte-layout");
      setTop(layout ? Math.max(0, layout.getBoundingClientRect().top) : 0);
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [fullscreen, panelRef]);
  return top;
}
