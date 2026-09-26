import { Enums, eventTarget, init as initCore } from "@cornerstonejs/core";
import { init as initDicomImageLoader } from "@cornerstonejs/dicom-image-loader";
import {
  addTool,
  AngleTool,
  ArrowAnnotateTool,
  BidirectionalTool,
  CircleROITool,
  CobbAngleTool,
  EllipticalROITool,
  init as initTools,
  LabelTool,
  LengthTool,
  PanTool,
  PlanarFreehandROITool,
  ProbeTool,
  RectangleROITool,
  StackScrollTool,
  WindowLevelTool,
  ZoomTool,
} from "@cornerstonejs/tools";
import { notifyUnauthorized } from "../api/session";

// cornerstone(DICOM の復号と描画)の初期化。ライブラリが大きいので、このファイルは
// ビューア側(lazy で読むコンポーネント)からだけ import する。

export const VIEWER_TOOLS = [
  WindowLevelTool,
  PanTool,
  ZoomTool,
  StackScrollTool,
  LengthTool,
  AngleTool,
  CobbAngleTool,
  BidirectionalTool,
  ProbeTool,
  RectangleROITool,
  EllipticalROITool,
  CircleROITool,
  PlanarFreehandROITool,
  ArrowAnnotateTool,
  LabelTool,
] as const;

let ready: Promise<void> | null = null;

/** 何度呼んでも初期化は 1 回だけ。 */
export function initCornerstone(): Promise<void> {
  ready ??= (async () => {
    await initCore();
    // 画像は同一オリジンの /imaging から取るので、ログインの Cookie がそのまま載る。
    initDicomImageLoader({ maxWebWorkers: Math.min(navigator.hardwareConcurrency || 2, 4) });
    initTools();
    VIEWER_TOOLS.forEach((tool) => addTool(tool));

    eventTarget.addEventListener(Enums.Events.IMAGE_LOAD_FAILED, (event: Event) => {
      const error = (event as CustomEvent<{ error?: { status?: number } }>).detail?.error;
      if (error?.status === 401) notifyUnauthorized();
    });
  })();
  return ready;
}

/** cornerstone が画像を引くときの ID。frame は 1 始まり(マルチフレームのとき)。 */
export function wadouriImageId(url: string, frame?: number): string {
  const absolute = new URL(url, window.location.origin).toString();
  return `wadouri:${absolute}${frame ? `&frame=${frame}` : ""}`;
}
