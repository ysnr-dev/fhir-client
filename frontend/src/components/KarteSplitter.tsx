import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent, KeyboardEvent, RefObject } from "react";

// ペインの境界。ドラッグで手前側(上 / 左)のペインが占める比率を変える。
// orientation はスプリッタ自身の向き。上下分割なら横線 = horizontal、
// 左右分割なら縦線 = vertical。

interface KarteSplitterProps {
  // 両ペインを包む要素。この要素の大きさに対する比率としてドラッグ位置を解釈する。
  containerRef: RefObject<HTMLDivElement | null>;
  orientation: "horizontal" | "vertical";
  ratio: number;
  label: string;
  // 値の制限は呼び出し側で行う(ペインごとに下限・上限が違うため)。
  onChange: (ratio: number) => void;
  // ドラッグ / キー操作が終わった時点。保存はここでだけ行う。
  // キー操作は onChange の再描画を待たずに続けて呼ぶため、最後に出した値を渡す。
  onChangeEnd: (ratio: number) => void;
}

const KEY_STEP = 0.05;

// 手前側のペインを狭める / 広げるキー。
const KEYS = {
  horizontal: { shrink: "ArrowUp", grow: "ArrowDown" },
  vertical: { shrink: "ArrowLeft", grow: "ArrowRight" },
} as const;

export function KarteSplitter({
  containerRef,
  orientation,
  ratio,
  label,
  onChange,
  onChangeEnd,
}: KarteSplitterProps) {
  const isVertical = orientation === "vertical";
  // 最後に onChange で出した値。props の ratio は再描画後にしか届かない。
  const latestRatio = useRef(ratio);

  function emit(next: number) {
    latestRatio.current = next;
    onChange(next);
  }

  // ドラッグ中はポインタをこの要素に固定し、素早く動かして要素外に出ても追従させる。
  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    // 押下時のテキスト選択を止める。
    event.preventDefault();
    latestRatio.current = ratio;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const size = isVertical ? rect.width : rect.height;
    if (size === 0) return;
    const offset = isVertical ? event.clientX - rect.left : event.clientY - rect.top;
    emit(offset / size);
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    onChangeEnd(latestRatio.current);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const keys = KEYS[orientation];
    if (event.key !== keys.shrink && event.key !== keys.grow) return;
    event.preventDefault();
    emit(ratio + (event.key === keys.shrink ? -KEY_STEP : KEY_STEP));
    onChangeEnd(latestRatio.current);
  }

  return (
    <div
      className={`karte-splitter karte-splitter--${orientation}`}
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
    />
  );
}
