import type { PointerEvent as ReactPointerEvent, KeyboardEvent, RefObject } from "react";
import { clampTopRatio } from "../karteLayout";

// 左ペインを上下分割したときの境界。ドラッグで上ペインの高さ比率を変える。

interface KarteSplitterProps {
  // 上下ペインを包む要素。この要素の高さに対する比率としてドラッグ位置を解釈する。
  containerRef: RefObject<HTMLDivElement | null>;
  topRatio: number;
  onChange: (ratio: number) => void;
  // ドラッグ / キー操作が終わった時点。保存はここでだけ行う。
  onChangeEnd: () => void;
}

const KEY_STEP = 0.05;

export function KarteSplitter({
  containerRef,
  topRatio,
  onChange,
  onChangeEnd,
}: KarteSplitterProps) {
  // ドラッグ中はポインタをこの要素に固定し、素早く動かして要素外に出ても追従させる。
  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    // 押下時のテキスト選択を止める。
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.height === 0) return;
    onChange(clampTopRatio((event.clientY - rect.top) / rect.height));
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    onChangeEnd();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    onChange(clampTopRatio(topRatio + (event.key === "ArrowUp" ? -KEY_STEP : KEY_STEP)));
    onChangeEnd();
  }

  return (
    <div
      className="karte-splitter"
      role="separator"
      aria-orientation="horizontal"
      aria-label="カルテと他タブの高さ"
      aria-valuenow={Math.round(topRatio * 100)}
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
