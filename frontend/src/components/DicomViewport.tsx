import { Enums, RenderingEngine, utilities, type Types } from "@cornerstonejs/core";
import {
  AngleTool,
  annotation,
  Enums as ToolEnums,
  LengthTool,
  PanTool,
  StackScrollTool,
  ToolGroupManager,
  WindowLevelTool,
  ZoomTool,
} from "@cornerstonejs/tools";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { initCornerstone } from "../imaging/cornerstoneSetup";

// DICOM を描く領域 1 つ。左ドラッグの道具(ウィンドウ・移動・拡大・計測)は選んで
// 切り替え、中ドラッグ = 移動、右ドラッグ = 拡大、ホイール = コマ送りは常に効く。

export type ViewerTool = "window" | "pan" | "zoom" | "length" | "angle";

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
  clearMeasurements: () => void;
  scroll: (delta: number) => void;
}

const TOOL_NAMES: Record<ViewerTool, string> = {
  window: WindowLevelTool.toolName,
  pan: PanTool.toolName,
  zoom: ZoomTool.toolName,
  length: LengthTool.toolName,
  angle: AngleTool.toolName,
};
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
    // 計測は、選ばれていない間も描いた線を残して動かせるよう passive にする。
    if (bindings.length > 0) group.setToolActive(TOOL_NAMES[tool], { bindings });
    else group.setToolPassive(TOOL_NAMES[tool]);
  });
}

export const DicomViewport = forwardRef<
  DicomViewportHandle,
  {
    imageIds: string[];
    tool: ViewerTool;
    onStateChange: (state: ViewportState) => void;
    onError: (error: Error | null) => void;
  }
>(function DicomViewport({ imageIds, tool, onStateChange, onError }, ref) {
  const elementRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<Session | null>(null);
  const [ready, setReady] = useState(false);

  const toolRef = useRef(tool);
  toolRef.current = tool;
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

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
          Object.values(TOOL_NAMES).forEach((name) => group.addTool(name));
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
        // 計測はこのビューアを開いている間だけのもの。閉じたら残さない。
        annotation.state.removeAllAnnotations();
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
    annotation.state.removeAllAnnotations();
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
    clearMeasurements() {
      annotation.state.removeAllAnnotations();
      sessionRef.current?.viewport.render();
    },
    scroll(delta) {
      const viewport = sessionRef.current?.viewport;
      if (viewport) utilities.scroll(viewport, { delta });
    },
  }));

  return <div ref={elementRef} className="dicom-viewer__viewport" />;
});
