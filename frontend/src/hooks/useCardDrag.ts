import { useCallback, useEffect, useRef, useState } from "react";

// カレンダーのカード/チップを掴んで動かす土台。
//
// HTML5 の Drag and Drop は使わない。ドラッグ像の見た目を制御できず、
// タッチでの挙動もブラウザ任せになるため。既存の前例(KarteSplitter)と同じく
// Pointer Events + setPointerCapture で自前で追う。
//
// 位置の解釈(どの列・何分)は呼び出し側が持つ。ここが持つのは「掴んでいるか」
// 「どこまで動いたか」「離した/やめた」の 3 つだけ。

/** これ未満の移動はクリックとして扱い、ドラッグを始めない。 */
const DRAG_THRESHOLD_PX = 4;

export interface DragState<T> {
  /** 掴んでいる対象。呼び出し側が渡した値をそのまま返す。 */
  item: T;
  /** 今のポインタ位置(clientX/Y)。 */
  x: number;
  y: number;
  /** 掴んだ時点の位置。 */
  startX: number;
  startY: number;
  /** 閾値を超えて、実際に動かし始めたか。 */
  moved: boolean;
}

export interface CardDragOptions<T> {
  /**
   * 離したときに呼ばれる。閾値を超えて動いていたときだけ(= クリックでは呼ばれない)。
   * 掴んだ位置(startX/Y)も渡す。掴んだ場所とカードの頭のずれを保ったまま
   * 落とすために、呼び出し側がそれを要るため。
   */
  onDrop: (state: DragState<T>) => void;
}

export function useCardDrag<T>({ onDrop }: CardDragOptions<T>) {
  const [drag, setDrag] = useState<DragState<T> | null>(null);
  // ドラッグ直後の click を飲むためのフラグ(週ビューのセルは押すと日ビューへ
  // 降りるので、掴んで離しただけで画面が変わってしまうのを防ぐ)。
  const justDragged = useRef(false);
  // onDrop を effect の依存から外すための箱(毎レンダー作り直される関数のため)。
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  const start = useCallback((item: T, event: React.PointerEvent) => {
    // 左ボタン以外(右クリック・ペンの副ボタン)では始めない。
    if (event.button !== 0) return;
    event.preventDefault();
    setDrag({
      item,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    });
  }, []);

  // move / up / cancel は window で拾う。掴んだ要素の外へ出ても追えるようにするため
  // (setPointerCapture だと、移動先の列の上で pointermove が要素に届かない)。
  useEffect(() => {
    if (!drag) return;

    function handleMove(event: PointerEvent) {
      setDrag((current) => {
        if (!current) return current;
        const moved =
          current.moved ||
          Math.abs(event.clientX - current.startX) >= DRAG_THRESHOLD_PX ||
          Math.abs(event.clientY - current.startY) >= DRAG_THRESHOLD_PX;
        return { ...current, x: event.clientX, y: event.clientY, moved };
      });
    }

    function finish(event: PointerEvent, dropped: boolean) {
      setDrag((current) => {
        if (current?.moved) {
          justDragged.current = true;
          if (dropped) {
            onDropRef.current({ ...current, x: event.clientX, y: event.clientY });
          }
        }
        return null;
      });
    }

    function handleUp(event: PointerEvent) {
      finish(event, true);
    }

    function handleCancel(event: PointerEvent) {
      finish(event, false);
    }

    // Escape でやめられる(掴んだまま迷ったときの逃げ道)。
    function handleKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setDrag((current) => {
        if (current?.moved) justDragged.current = true;
        return null;
      });
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleCancel);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleCancel);
      window.removeEventListener("keydown", handleKey);
    };
  }, [drag]);

  /** ドラッグ直後の click なら true を返して、フラグを下ろす。 */
  const consumeClick = useCallback(() => {
    if (!justDragged.current) return false;
    justDragged.current = false;
    return true;
  }, []);

  return {
    /** 掴んでいる間の状態。閾値を超える前は moved: false。 */
    drag: drag?.moved ? drag : null,
    start,
    consumeClick,
  };
}
