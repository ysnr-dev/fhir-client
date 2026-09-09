// 病棟マップの表示倍率の保存。病棟を切り替えても同じ倍率で開けるようにする
// (カルテのペイン比率と同じ localStorage の三点セット)。

const ZOOM_STORAGE_KEY = "fhir-client.wardMap.zoom";

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2;
export const DEFAULT_ZOOM = 1;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return DEFAULT_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function readZoom(): number {
  try {
    const value = localStorage.getItem(ZOOM_STORAGE_KEY);
    return value ? clampZoom(Number(value)) : DEFAULT_ZOOM;
  } catch {
    return DEFAULT_ZOOM;
  }
}

export function storeZoom(zoom: number) {
  try {
    localStorage.setItem(ZOOM_STORAGE_KEY, String(zoom));
  } catch {
    // 保存できなくてもその場の表示は変える。
  }
}
