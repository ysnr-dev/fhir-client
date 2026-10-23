import { useEffect, useRef, type PointerEvent } from "react";
import { DASHBOARD_COLUMNS, moveTile, resizeTile, type GridTile } from "../fhir/dashboardLayout";
import { useCardDrag } from "./useCardDrag";

// ダッシュボードのマス目でタイルを掴んで動かす・右下の角で大きさを変える処理。
// 途中経過は set で並びに直接反映し(取り消しの履歴には積まない)、離したときだけ
// commit で「掴む前 → 離した後」を 1 手として積む(病棟マップの編集と同じ)。
// 分析ダッシュボードの画面と診療ダッシュボードのタブが同じ hook を使う。

/** 1 行の高さと行間(px)。CSS の --dashboard-row / --dashboard-gap と合わせる。 */
const ROW_PX = 56;
const GAP_PX = 12;

export type GridDragItem = { kind: "move" | "resize"; id: string };

export function useGridTileDrag<T extends GridTile>({
  tiles,
  set,
  commit,
}: {
  tiles: T[];
  /** 途中経過を置く(履歴に積まない)。 */
  set: (next: T[]) => void;
  /** 離したときに 1 手として積む。 */
  commit: (before: T[], after: T[]) => void;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const dragBase = useRef<T[] | null>(null);
  const lastDelta = useRef({ dx: 0, dy: 0 });
  const tilesRef = useRef(tiles);
  tilesRef.current = tiles;
  const setRef = useRef(set);
  setRef.current = set;
  const commitRef = useRef(commit);
  commitRef.current = commit;

  const { drag, start } = useCardDrag<GridDragItem>({
    onDrop: () => {
      const base = dragBase.current;
      dragBase.current = null;
      if (base) commitRef.current(base, tilesRef.current);
    },
  });

  useEffect(() => {
    if (!drag) {
      // 掴まずに離した(クリック)か Escape で取りやめたときは、掴む前の形に戻す。
      if (dragBase.current) setRef.current(dragBase.current);
      dragBase.current = null;
      return;
    }
    const base = dragBase.current;
    const grid = gridRef.current;
    if (!base || !grid) return;
    const cell = (grid.getBoundingClientRect().width + GAP_PX) / DASHBOARD_COLUMNS;
    const dx = Math.round((drag.x - drag.startX) / cell);
    const dy = Math.round((drag.y - drag.startY) / (ROW_PX + GAP_PX));
    if (dx === lastDelta.current.dx && dy === lastDelta.current.dy) return;
    lastDelta.current = { dx, dy };
    setRef.current(
      drag.item.kind === "move" ? moveTile(base, drag.item.id, dx, dy) : resizeTile(base, drag.item.id, dx, dy),
    );
  }, [drag]);

  function beginDrag(item: GridDragItem, event: PointerEvent<HTMLElement>) {
    dragBase.current = tilesRef.current;
    lastDelta.current = { dx: 0, dy: 0 };
    start(item, event);
  }

  return { gridRef, beginDrag };
}
