import { Enums, RenderingEngine, utilities, type Types } from "@cornerstonejs/core";
import {
  AngleTool,
  annotation,
  ArrowAnnotateTool,
  BidirectionalTool,
  CircleROITool,
  CobbAngleTool,
  EllipticalROITool,
  Enums as ToolEnums,
  LabelTool,
  LengthTool,
  PanTool,
  PlanarFreehandROITool,
  ProbeTool,
  RectangleROITool,
  StackScrollTool,
  ToolGroupManager,
  WindowLevelTool,
  ZoomTool,
} from "@cornerstonejs/tools";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  captureViewportJpeg,
  type CapturedImage,
  type CaptureRect,
  type CornerTexts,
} from "../imaging/captureViewport";
import { initCornerstone } from "../imaging/cornerstoneSetup";

// DICOM を描く領域 1 つ。左ドラッグの道具(ウィンドウ・移動・拡大・計測・注釈)は選んで
// 切り替え、中ドラッグ = 移動、右ドラッグ = 拡大、ホイール = コマ送りは常に効く。

export type ViewerTool =
  | "window"
  | "pan"
  | "zoom"
  | "length"
  | "angle"
  | "cobbAngle"
  | "bidirectional"
  | "probe"
  | "rectangle"
  | "ellipse"
  | "circle"
  | "freehand"
  | "arrow"
  | "label";

/** 矢印・文字の注釈に書く文字を尋ねる。取りやめは null で返す。 */
export type RequestAnnotationText = (current: string, done: (text: string | null) => void) => void;

export interface ViewportState {
  index: number;
  total: number;
  windowWidth: number | null;
  windowCenter: number | null;
  zoom: number | null;
}

export interface DicomViewportHandle {
  reset: () => void;
  toggleInvert: () => void;
  /** null は画像に書かれた既定のウィンドウに戻す。 */
  setWindow: (window: { width: number; center: number } | null) => void;
  clearAnnotations: () => void;
  undo: () => void;
  deleteSelectedAnnotations: () => void;
  scroll: (delta: number) => void;
  /** 見えているまま(注釈と四隅の文字を含む)を JPEG にする。 */
  captureJpeg: (corners: CornerTexts) => Promise<CapturedImage>;
}

const TOOL_NAMES: Record<ViewerTool, string> = {
  window: WindowLevelTool.toolName,
  pan: PanTool.toolName,
  zoom: ZoomTool.toolName,
  length: LengthTool.toolName,
  angle: AngleTool.toolName,
  cobbAngle: CobbAngleTool.toolName,
  bidirectional: BidirectionalTool.toolName,
  probe: ProbeTool.toolName,
  rectangle: RectangleROITool.toolName,
  ellipse: EllipticalROITool.toolName,
  circle: CircleROITool.toolName,
  freehand: PlanarFreehandROITool.toolName,
  arrow: ArrowAnnotateTool.toolName,
  label: LabelTool.toolName,
};
const TEXT_TOOLS = new Set<string>([ArrowAnnotateTool.toolName, LabelTool.toolName]);

const { DefaultHistoryMemo } = utilities.HistoryMemo;

/** 注釈をまとめて消したあとに、消えた注釈の「元に戻す」が残らないようにする。 */
function clearAllAnnotations() {
  annotation.state.removeAllAnnotations();
  // size を入れ直すと履歴が空になる(HistoryMemo に clear が無いため)。
  DefaultHistoryMemo.size = DefaultHistoryMemo.size;
}
// 左ドラッグに選ばれていなくても効かせておく操作。
const FIXED_BINDINGS: Partial<Record<ViewerTool, ToolEnums.MouseBindings>> = {
  pan: ToolEnums.MouseBindings.Auxiliary,
  zoom: ToolEnums.MouseBindings.Secondary,
};

let mountCount = 0;

interface Session {
  engine: RenderingEngine;
  viewport: Types.IStackViewport;
  toolGroupId: string;
}

function applyTool(toolGroupId: string, active: ViewerTool) {
  const group = ToolGroupManager.getToolGroup(toolGroupId);
  if (!group) return;
  (Object.keys(TOOL_NAMES) as ViewerTool[]).forEach((tool) => {
    const bindings: { mouseButton: ToolEnums.MouseBindings }[] = [];
    if (tool === active) bindings.push({ mouseButton: ToolEnums.MouseBindings.Primary });
    const fixed = FIXED_BINDINGS[tool];
    if (fixed) bindings.push({ mouseButton: fixed });
    // 注釈は、選ばれていない間も描いたものを残して動かせるよう passive にする。
    if (bindings.length > 0) group.setToolActive(TOOL_NAMES[tool], { bindings });
    else group.setToolPassive(TOOL_NAMES[tool]);
  });
}

/**
 * 描画領域のうち画像が写っている範囲(CSS ピクセル)。描画領域からはみ出した部分は
 * 書き出す側で切り落とす。core の getViewportImageCornersInWorld は画像が描画領域より
 * 小さいときも描画領域の四隅を返すため使わない。
 */
function visibleImageRect(viewport: Types.IStackViewport): CaptureRect | undefined {
  const data = viewport.getImageData();
  const indexToWorld = data?.imageData.indexToWorld?.bind(data.imageData);
  if (!data || !indexToWorld) return undefined;
  const [columns, rows] = data.dimensions;
  // 画素の中心が整数の座標なので、端は 0.5 画素外側になる。
  const points = [
    [-0.5, -0.5],
    [columns - 0.5, -0.5],
    [-0.5, rows - 0.5],
    [columns - 0.5, rows - 0.5],
  ].map(([i, j]) => viewport.worldToCanvas(indexToWorld([i, j, 0]) as Types.Point3));
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const x = Math.floor(Math.min(...xs));
  const y = Math.floor(Math.min(...ys));
  return { x, y, width: Math.ceil(Math.max(...xs)) - x, height: Math.ceil(Math.max(...ys)) - y };
}

export const DicomViewport = forwardRef<
  DicomViewportHandle,
  {
    imageIds: string[];
    tool: ViewerTool;
    onStateChange: (state: ViewportState) => void;
    onError: (error: Error | null) => void;
    onRequestText: RequestAnnotationText;
  }
>(function DicomViewport({ imageIds, tool, onStateChange, onError, onRequestText }, ref) {
  const elementRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<Session | null>(null);
  const [ready, setReady] = useState(false);

  const toolRef = useRef(tool);
  toolRef.current = tool;
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onRequestTextRef = useRef(onRequestText);
  onRequestTextRef.current = onRequestText;

  function publishState() {
    const session = sessionRef.current;
    if (!session) return;
    const { viewport } = session;
    const range = viewport.getProperties().voiRange;
    // 表示範囲(下限・上限)から DICOM の窓幅・窓中心への換算は core に任せる
    // (DICOM の定義では幅が上限 - 下限 + 1 になる)。
    const level = range ? utilities.windowLevel.toWindowLevel(range.lower, range.upper) : null;
    onStateChangeRef.current({
      index: viewport.getCurrentImageIdIndex(),
      total: viewport.getImageIds().length,
      windowWidth: level?.windowWidth ?? null,
      windowCenter: level?.windowCenter ?? null,
      zoom: viewport.getZoom(),
    });
  }

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    let cancelled = false;
    mountCount += 1;
    const engineId = `dicom-viewer-engine-${mountCount}`;
    const viewportId = `dicom-viewer-viewport-${mountCount}`;
    const toolGroupId = `dicom-viewer-tools-${mountCount}`;
    const events = [
      Enums.Events.STACK_NEW_IMAGE,
      Enums.Events.VOI_MODIFIED,
      Enums.Events.CAMERA_MODIFIED,
    ];
    const preventMenu = (e: Event) => e.preventDefault();
    const handleResize = () => sessionRef.current?.engine.resize(true, true);
    let observer: ResizeObserver | null = null;

    initCornerstone()
      .then(() => {
        if (cancelled) return;
        const engine = new RenderingEngine(engineId);
        engine.enableElement({ viewportId, type: Enums.ViewportType.STACK, element });
        const viewport = engine.getViewport(viewportId) as Types.IStackViewport;

        const group = ToolGroupManager.createToolGroup(toolGroupId);
        if (group) {
          // 文字の入力は既定だと window.prompt になるので、ビューアの入力欄で尋ねる。
          const textConfig = {
            getTextCallback: (done: (text: string | null) => void) =>
              onRequestTextRef.current("", done),
            changeTextCallback: (
              target: { data: { label?: string } },
              _detail: unknown,
              done: (text: string) => void,
            ) => {
              const current = target.data.label ?? "";
              onRequestTextRef.current(current, (text) => done(text ?? current));
            },
          };
          Object.values(TOOL_NAMES).forEach((name) =>
            group.addTool(name, TEXT_TOOLS.has(name) ? textConfig : {}),
          );
          group.addTool(StackScrollTool.toolName);
          group.addViewport(viewportId, engineId);
          group.setToolActive(StackScrollTool.toolName, {
            bindings: [{ mouseButton: ToolEnums.MouseBindings.Wheel }],
          });
        }
        applyTool(toolGroupId, toolRef.current);

        sessionRef.current = { engine, viewport, toolGroupId };
        events.forEach((name) => element.addEventListener(name, publishState));
        // 右ドラッグを拡大に使うので、右クリックのメニューは出さない。
        element.addEventListener("contextmenu", preventMenu);
        window.addEventListener("resize", handleResize);
        observer = new ResizeObserver(handleResize);
        observer.observe(element);
        setReady(true);
      })
      .catch((err) => onErrorRef.current(err instanceof Error ? err : new Error(String(err))));

    return () => {
      cancelled = true;
      events.forEach((name) => element.removeEventListener(name, publishState));
      element.removeEventListener("contextmenu", preventMenu);
      window.removeEventListener("resize", handleResize);
      observer?.disconnect();
      if (sessionRef.current) {
        // 注釈はこのビューアを開いている間だけのもの。閉じたら残さない。
        clearAllAnnotations();
        ToolGroupManager.destroyToolGroup(toolGroupId);
        sessionRef.current.engine.destroy();
        sessionRef.current = null;
      }
      setReady(false);
    };
    // 描画領域は開いてから閉じるまで 1 つ。表示する画像は下の effect で差し替える。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const session = sessionRef.current;
    if (!ready || !session || imageIds.length === 0) return;
    let cancelled = false;
    onErrorRef.current(null);
    clearAllAnnotations();
    session.viewport
      .setStack(imageIds, Math.floor(imageIds.length / 2))
      .then(() => {
        if (cancelled) return;
        session.viewport.render();
        publishState();
      })
      .catch((err) => {
        if (!cancelled) onErrorRef.current(err instanceof Error ? err : new Error(String(err)));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, imageIds]);

  useEffect(() => {
    if (ready && sessionRef.current) applyTool(sessionRef.current.toolGroupId, tool);
  }, [ready, tool]);

  useImperativeHandle(ref, () => ({
    reset() {
      const viewport = sessionRef.current?.viewport;
      if (!viewport) return;
      viewport.resetCamera();
      viewport.resetProperties();
      viewport.render();
      publishState();
    },
    toggleInvert() {
      const viewport = sessionRef.current?.viewport;
      if (!viewport) return;
      viewport.setProperties({ invert: !viewport.getProperties().invert });
      viewport.render();
    },
    setWindow(window) {
      const viewport = sessionRef.current?.viewport;
      if (!viewport) return;
      if (window) {
        viewport.setProperties({
          voiRange: utilities.windowLevel.toLowHighRange(window.width, window.center),
        });
      } else {
        viewport.resetProperties();
      }
      viewport.render();
      publishState();
    },
    clearAnnotations() {
      clearAllAnnotations();
      sessionRef.current?.viewport.render();
    },
    undo() {
      DefaultHistoryMemo.undo();
      sessionRef.current?.viewport.render();
    },
    deleteSelectedAnnotations() {
      const selected = annotation.selection.getAnnotationsSelected();
      if (selected.length === 0) return;
      selected.forEach((uid) => annotation.state.removeAnnotation(uid));
      sessionRef.current?.viewport.render();
    },
    scroll(delta) {
      const viewport = sessionRef.current?.viewport;
      if (viewport) utilities.scroll(viewport, { delta });
    },
    captureJpeg(corners) {
      const element = elementRef.current;
      const viewport = sessionRef.current?.viewport;
      if (!element || !viewport) return Promise.reject(new Error("画像が表示されていません。"));
      return captureViewportJpeg(element, corners, visibleImageRect(viewport));
    },
  }));

  return <div ref={elementRef} className="dicom-viewer__viewport" />;
});
