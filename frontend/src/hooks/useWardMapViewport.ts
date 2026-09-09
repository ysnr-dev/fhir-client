import { useCallback, useEffect, useState, type RefObject } from "react";
import { clampZoom, MAX_ZOOM, MIN_ZOOM, readZoom, storeZoom } from "../wardMapLayoutStorage";

// 病棟マップの表示倍率。拡大縮小は CSS transform(scale)で、はみ出しは
// スクロールコンテナに任せる(transform に平行移動を持たせると
// getBoundingClientRect と食い違うので持たない)。

const ZOOM_STEP = 0.1;

export function useWardMapViewport(scrollRef: RefObject<HTMLElement | null>) {
  const [zoom, setZoomState] = useState(readZoom);

  const setZoom = useCallback((next: number) => {
    const value = Math.round(clampZoom(next) * 100) / 100;
    setZoomState(value);
    storeZoom(value);
  }, []);

  const zoomIn = useCallback(() => setZoom(zoom + ZOOM_STEP), [setZoom, zoom]);
  const zoomOut = useCallback(() => setZoom(zoom - ZOOM_STEP), [setZoom, zoom]);
  const resetZoom = useCallback(() => setZoom(1), [setZoom]);

  /** キャンバス(px)が横に収まる倍率にする。 */
  const fitToWidth = useCallback(
    (canvasWidthPx: number) => {
      const container = scrollRef.current;
      if (!container || canvasWidthPx <= 0) return;
      setZoom((container.clientWidth - 16) / canvasWidthPx);
    },
    [scrollRef, setZoom],
  );

  // Ctrl+ホイールで拡大縮小(ブラウザのページズームは抑える)。
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    function handleWheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoomState((current) => {
        const value = Math.round(clampZoom(current - Math.sign(event.deltaY) * ZOOM_STEP) * 100) / 100;
        storeZoom(value);
        return value;
      });
    }
    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [scrollRef]);

  return {
    zoom,
    setZoom,
    zoomIn,
    zoomOut,
    resetZoom,
    fitToWidth,
    canZoomIn: zoom < MAX_ZOOM,
    canZoomOut: zoom > MIN_ZOOM,
  };
}
