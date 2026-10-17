import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Canvas,
  Ellipse,
  FabricImage,
  Group,
  IText,
  Line,
  PencilBrush,
  Rect,
  Triangle,
  util,
  type FabricObject,
} from "fabric";
import { Modal } from "./Modal";
import { PHOTO_JPEG_QUALITY } from "../fhir/schemaImage";
import { PEN_COLORS, type PenColor } from "./penColors";
import { FitScreenIcon } from "./icons/FitScreenIcon";
import { ActualSizeIcon } from "./icons/ActualSizeIcon";

// シェーマのペイントモーダル(fabric.js)。台紙(backgroundDataUrl)を背景に、
// ペン・図形・矢印・テキストを描き込み、保存時に背景込みの合成画像(dataURL)を返す。
// オブジェクト情報は保持しない(保存後の再編集は画像への追記になる)。
// 診療記録のシェーマ挿入(ClinicalNoteForm)とテンプレート項目の描き込み
// (SchemaImageField)で共用する。

interface SchemaPaintModalProps {
  title: string;
  backgroundDataUrl: string;
  onSave: (dataUrl: string) => void;
  onClose: () => void;
  // 確定ボタンの文言。保存先が呼び出し側で異なる(記録への挿入 / 回答への添付)。
  saveLabel?: string;
  /** 描き込みの色。先頭が既定色。省略すると線画の台紙向けの PEN_COLORS。 */
  colors?: readonly PenColor[];
  /**
   * 書き出し形式。既定の png は線画の台紙を劣化させない。濃淡画像(CT・MR など)に
   * 描き込むときは jpeg にする(png だと 1 枚が数 MB になる)。
   */
  exportFormat?: "png" | "jpeg";
}

const PEN_WIDTHS = [2, 4, 8] as const;

// 線の太さ・文字の大きさの基準になる長辺(px)。台紙がこれより大きいときは太さを比例して増やす。
const STROKE_BASE_DIMENSION = 1200;
// キャンバス(=書き出し画像)の長辺上限。normalizeImageFile(登録時の縮小)と揃える。
const MAX_EXPORT_DIMENSION = 1600;
// 画面に合わせる表示での高さの上限(ビューポート比)。.schema-paint__canvas の max-height と揃える。
const FIT_MAX_HEIGHT_RATIO = 0.65;
// undo 履歴の上限(スナップショット方式なので無制限にしない)。
const MAX_HISTORY = 50;

type Tool = "select" | "pen" | "line" | "arrow" | "rect" | "ellipse" | "text";

const TOOLS: { id: Tool; label: string }[] = [
  { id: "select", label: "選択" },
  { id: "pen", label: "ペン" },
  { id: "line", label: "直線" },
  { id: "arrow", label: "矢印" },
  { id: "rect", label: "四角" },
  { id: "ellipse", label: "楕円" },
  { id: "text", label: "文字" },
];

// fit: 表示領域に合わせて拡大縮小、actual: 台紙の 1 画素を 1 CSS px で表示(はみ出たらスクロール)。
type ViewMode = "fit" | "actual";

interface CanvasSizes {
  canvasWidth: number;
  canvasHeight: number;
  naturalWidth: number;
  naturalHeight: number;
}

// ドラッグで作成中の図形(mouse:up で確定)。
interface DraftShape {
  object: FabricObject;
  startX: number;
  startY: number;
}

export function SchemaPaintModal({
  title,
  backgroundDataUrl,
  onSave,
  onClose,
  saveLabel = "保存",
  colors = PEN_COLORS,
  exportFormat = "png",
}: SchemaPaintModalProps) {
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = useRef<Canvas | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  // 線の太さ・文字の大きさに掛ける倍率(キャンバスが大きいほど太くする)。
  const strokeScaleRef = useRef(1);
  const [sizes, setSizes] = useState<CanvasSizes | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("fit");

  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState<string>(colors[0]?.code ?? PEN_COLORS[0].code);
  const [width, setWidth] = useState<number>(4);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // イベントハンドラは購読し直さず、最新のツール状態は ref で参照する。
  const toolStateRef = useRef({ tool, color, width });
  toolStateRef.current = { tool, color, width };

  // undo/redo はオブジェクト配列のスナップショット方式。背景画像は履歴に
  // 含めない(毎スナップショットに dataURL が入るとメモリを食うため)。
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(0);
  const restoringRef = useRef(false);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false, dirty: false });

  const syncHistoryState = useCallback(() => {
    setHistoryState({
      canUndo: historyIndexRef.current > 0,
      canRedo: historyIndexRef.current < historyRef.current.length - 1,
      // 履歴の先頭(空)以外にいる、または進み先がある=何か描いた形跡がある。
      dirty: historyRef.current.length > 1,
    });
  }, []);

  const pushHistory = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || restoringRef.current) return;
    const snapshot = JSON.stringify(canvas.toObject().objects);
    const history = historyRef.current.slice(0, historyIndexRef.current + 1);
    if (snapshot === history[history.length - 1]) return;
    history.push(snapshot);
    if (history.length > MAX_HISTORY) history.shift();
    historyRef.current = history;
    historyIndexRef.current = history.length - 1;
    syncHistoryState();
  }, [syncHistoryState]);

  const restoreHistory = useCallback(
    async (index: number) => {
      const canvas = canvasRef.current;
      const snapshot = historyRef.current[index];
      if (!canvas || snapshot === undefined) return;
      restoringRef.current = true;
      try {
        const objects = (await util.enlivenObjects(JSON.parse(snapshot))) as FabricObject[];
        canvas.remove(...canvas.getObjects());
        canvas.add(...objects);
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        historyIndexRef.current = index;
        syncHistoryState();
      } finally {
        restoringRef.current = false;
      }
    },
    [syncHistoryState],
  );

  // キャンバス初期化。台紙を読み込み、アスペクト比に合わせたサイズで作る。
  useEffect(() => {
    const el = canvasElRef.current;
    if (!el) return;
    let disposed = false;
    let canvas: Canvas | null = null;

    (async () => {
      let img: FabricImage;
      try {
        img = await FabricImage.fromURL(backgroundDataUrl);
      } catch {
        if (!disposed) setError("台紙画像を読み込めませんでした。");
        return;
      }
      if (disposed) return;

      const naturalWidth = img.width ?? 1;
      const naturalHeight = img.height ?? 1;
      // キャンバスは書き出し解像度で作り、画面上の大きさは CSS だけで変える。
      const naturalLong = Math.max(naturalWidth, naturalHeight);
      const scale = Math.min(1, MAX_EXPORT_DIMENSION / naturalLong);
      const canvasWidth = Math.round(naturalWidth * scale);
      const canvasHeight = Math.round(naturalHeight * scale);
      const canvasLong = Math.max(canvasWidth, canvasHeight);
      strokeScaleRef.current = canvasLong / Math.min(canvasLong, STROKE_BASE_DIMENSION);

      canvas = new Canvas(el, {
        width: canvasWidth,
        height: canvasHeight,
        backgroundColor: "#ffffff",
        // 枠からはみ出た描画も書き出しに含まれるよう既定のまま(クリップしない)。
      });
      // fabric v7 は originX/originY の既定が center。台紙は左上原点で敷く。
      img.set({
        left: 0,
        top: 0,
        originX: "left",
        originY: "top",
        scaleX: canvasWidth / naturalWidth,
        scaleY: canvasHeight / naturalHeight,
      });
      canvas.backgroundImage = img;

      canvas.freeDrawingBrush = new PencilBrush(canvas);
      canvasRef.current = canvas;

      // 履歴の起点(空の状態)。
      historyRef.current = [JSON.stringify(canvas.toObject().objects)];
      historyIndexRef.current = 0;

      attachHandlers(canvas);
      canvas.requestRenderAll();
      setSizes({ canvasWidth, canvasHeight, naturalWidth, naturalHeight });
      setReady(true);
    })();

    // ペン・図形の描画イベント。ツール状態は ref から読む(再購読しない)。
    // (関数宣言なので上の async 初期化からの呼び出しでも巻き上げが効く)
    function attachHandlers(target: Canvas) {
      let draft: DraftShape | null = null;

      target.on("mouse:down", (opt) => {
        const { tool: activeTool, color: activeColor } = toolStateRef.current;
        const activeWidth = toolStateRef.current.width * strokeScaleRef.current;
        const point = target.getScenePoint(opt.e);

        if (activeTool === "text") {
          const text = new IText("", {
            left: point.x,
            top: point.y,
            originX: "left",
            originY: "top",
            fill: activeColor,
            fontSize: 20 * strokeScaleRef.current,
          });
          target.add(text);
          target.setActiveObject(text);
          text.enterEditing();
          // 入力しやすいようテキスト追加後は選択ツールへ戻す。
          setTool("select");
          return;
        }

        if (activeTool !== "line" && activeTool !== "arrow" && activeTool !== "rect" && activeTool !== "ellipse") {
          return;
        }

        // v7 の既定原点(center)だとドラッグ作成の left/top 計算が狂うので明示する。
        const common = {
          stroke: activeColor,
          strokeWidth: activeWidth,
          fill: "transparent",
          originX: "left" as const,
          originY: "top" as const,
        };
        let object: FabricObject;
        if (activeTool === "rect") {
          object = new Rect({ ...common, left: point.x, top: point.y, width: 1, height: 1 });
        } else if (activeTool === "ellipse") {
          object = new Ellipse({ ...common, left: point.x, top: point.y, rx: 1, ry: 1 });
        } else {
          object = new Line([point.x, point.y, point.x, point.y], {
            stroke: activeColor,
            strokeWidth: activeWidth,
            originX: "left",
            originY: "top",
          });
        }
        target.add(object);
        draft = { object, startX: point.x, startY: point.y };
      });

      target.on("mouse:move", (opt) => {
        if (!draft) return;
        const point = target.getScenePoint(opt.e);
        const { startX, startY, object } = draft;

        if (object instanceof Line) {
          object.set({ x2: point.x, y2: point.y });
        } else if (object instanceof Ellipse) {
          object.set({
            left: Math.min(startX, point.x),
            top: Math.min(startY, point.y),
            rx: Math.abs(point.x - startX) / 2,
            ry: Math.abs(point.y - startY) / 2,
          });
        } else {
          object.set({
            left: Math.min(startX, point.x),
            top: Math.min(startY, point.y),
            width: Math.abs(point.x - startX),
            height: Math.abs(point.y - startY),
          });
        }
        object.setCoords();
        target.requestRenderAll();
      });

      target.on("mouse:up", (opt) => {
        if (!draft) return;
        const { object, startX, startY } = draft;
        const { tool: activeTool, color: activeColor } = toolStateRef.current;
        const activeWidth = toolStateRef.current.width * strokeScaleRef.current;
        draft = null;

        const point = target.getScenePoint(opt.e);
        const length = Math.hypot(point.x - startX, point.y - startY);
        // クリックしただけ(ドラッグなし)の残骸は捨てる。
        if (length < 3) {
          target.remove(object);
          target.requestRenderAll();
          return;
        }

        // 矢印は「直線 + 終端の三角形」をグループにして 1 オブジェクトとして扱う。
        if (activeTool === "arrow" && object instanceof Line) {
          const headSize = Math.max(10, activeWidth * 3.5);
          const angle = (Math.atan2(point.y - startY, point.x - startX) * 180) / Math.PI;
          const head = new Triangle({
            left: point.x,
            top: point.y,
            originX: "center",
            originY: "center",
            width: headSize,
            height: headSize,
            angle: angle + 90,
            fill: activeColor,
          });
          target.remove(object);
          target.add(new Group([object, head]));
        }
        target.requestRenderAll();
        pushHistory();
      });

      // ペンのストローク確定・オブジェクトの移動/変形で履歴を積む。
      target.on("path:created", () => pushHistory());
      target.on("object:modified", () => pushHistory());
      // テキスト編集終了時: 空のまま確定したものは残さない。
      target.on("text:editing:exited", (opt) => {
        const text = opt.target;
        if (text && text.text.trim() === "") {
          target.remove(text);
          target.requestRenderAll();
        }
        pushHistory();
      });
    }

    return () => {
      disposed = true;
      canvasRef.current = null;
      void canvas?.dispose();
    };
    // 背景が変わることはない(モーダルを開き直す)ので初回のみ。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backgroundDataUrl]);

  // ツール・色・太さの反映。
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !ready) return;
    canvas.isDrawingMode = tool === "pen";
    if (canvas.freeDrawingBrush) {
      canvas.freeDrawingBrush.color = color;
      canvas.freeDrawingBrush.width = width * strokeScaleRef.current;
    }
    // 図形・テキストツール中は既存オブジェクトを掴まない(ドラッグ=新規作成)。
    const drawing = tool !== "select" && tool !== "pen";
    canvas.selection = tool === "select";
    canvas.skipTargetFind = drawing;
    canvas.defaultCursor = drawing ? "crosshair" : "default";
    if (drawing) canvas.discardActiveObject();
    canvas.requestRenderAll();
  }, [tool, color, width, ready]);

  // 画面上の大きさ(CSS)の反映。描画座標はキャンバスの実寸のまま。
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const viewport = viewportRef.current;
    if (!canvas || !viewport || !sizes) return;
    const apply = () => {
      let cssWidth = sizes.naturalWidth;
      let cssHeight = sizes.naturalHeight;
      if (viewMode === "fit") {
        // 枠線(上下左右 1px)の分を差し引く。
        const availableWidth = Math.max(1, viewport.clientWidth - 2);
        const availableHeight = Math.max(1, window.innerHeight * FIT_MAX_HEIGHT_RATIO - 2);
        const scale = Math.min(availableWidth / sizes.canvasWidth, availableHeight / sizes.canvasHeight);
        cssWidth = Math.floor(sizes.canvasWidth * scale);
        cssHeight = Math.floor(sizes.canvasHeight * scale);
      }
      canvas.setDimensions({ width: `${cssWidth}px`, height: `${cssHeight}px` }, { cssOnly: true });
      canvas.calcOffset();
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, [sizes, viewMode]);

  const deleteSelection = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const objects = canvas.getActiveObjects();
    if (objects.length === 0) return;
    // テキスト編集中の Delete/Backspace は文字削除なので何もしない。
    if (objects.some((o) => o instanceof IText && o.isEditing)) return;
    canvas.remove(...objects);
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    pushHistory();
  }, [pushHistory]);

  // Delete / Backspace で選択オブジェクトを削除。
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      // fabric のテキスト編集は隠し textarea で行われるため、フォーム系に
      // フォーカスがあるときはブラウザ既定に任せる。
      const target = e.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      deleteSelection();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [deleteSelection]);

  function handleUndo() {
    if (historyIndexRef.current > 0) void restoreHistory(historyIndexRef.current - 1);
  }

  function handleRedo() {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      void restoreHistory(historyIndexRef.current + 1);
    }
  }

  function handleClear() {
    const canvas = canvasRef.current;
    if (!canvas || canvas.getObjects().length === 0) return;
    canvas.remove(...canvas.getObjects());
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    pushHistory();
  }

  // 描き込みがある状態での誤クローズ(オーバーレイクリック等)を確認で防ぐ。
  function guardedClose() {
    if (historyState.dirty && !window.confirm("編集内容を破棄して閉じますか？")) return;
    onClose();
  }

  function handleSave() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSaving(true);
    try {
      canvas.discardActiveObject();
      canvas.requestRenderAll();
      const dataUrl =
        exportFormat === "jpeg"
          ? canvas.toDataURL({
              format: "jpeg",
              quality: PHOTO_JPEG_QUALITY,
              multiplier: 1,
            })
          : canvas.toDataURL({ format: "png", multiplier: 1 });
      onSave(dataUrl);
    } catch {
      setError("画像の書き出しに失敗しました。");
      setSaving(false);
    }
  }

  return (
    <Modal title={title} onClose={guardedClose} className="modal--schema">
      {error && <p className="schema-image__error">{error}</p>}
      {!ready && !error && <p>読み込み中...</p>}
      <div ref={viewportRef} style={{ display: ready ? undefined : "none" }}>
        <div className="schema-annotator__toolbar">
          <span className="schema-annotator__tool-group" role="group" aria-label="ツール">
            {TOOLS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={tool === entry.id ? "schema-annotator__tool--active" : ""}
                onClick={() => setTool(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </span>
          <span className="schema-annotator__tool-group" role="group" aria-label="色">
            {colors.map((entry) => (
              <button
                key={entry.code}
                type="button"
                aria-label={entry.label}
                className={`schema-annotator__swatch${
                  color === entry.code ? " schema-annotator__swatch--active" : ""
                }`}
                style={{ backgroundColor: entry.code }}
                onClick={() => setColor(entry.code)}
              />
            ))}
          </span>
          <span className="schema-annotator__tool-group" role="group" aria-label="太さ">
            {PEN_WIDTHS.map((entry) => (
              <button
                key={entry}
                type="button"
                className={width === entry ? "schema-annotator__tool--active" : ""}
                onClick={() => setWidth(entry)}
              >
                {entry}px
              </button>
            ))}
          </span>
          <span className="schema-annotator__tool-group">
            <button type="button" disabled={!historyState.canUndo} onClick={handleUndo}>
              元に戻す
            </button>
            <button type="button" disabled={!historyState.canRedo} onClick={handleRedo}>
              やり直す
            </button>
            <button type="button" onClick={deleteSelection}>
              削除
            </button>
            <button type="button" onClick={handleClear}>
              クリア
            </button>
          </span>
          <span className="schema-annotator__tool-group" role="group" aria-label="表示">
            <button
              type="button"
              className={`rp-card__icon-button${viewMode === "fit" ? " schema-annotator__tool--active" : ""}`}
              title="画面に合わせる"
              aria-label="画面に合わせる"
              aria-pressed={viewMode === "fit"}
              onClick={() => setViewMode("fit")}
            >
              <FitScreenIcon />
            </button>
            <button
              type="button"
              className={`rp-card__icon-button${viewMode === "actual" ? " schema-annotator__tool--active" : ""}`}
              title="原寸大"
              aria-label="原寸大"
              aria-pressed={viewMode === "actual"}
              onClick={() => setViewMode("actual")}
            >
              <ActualSizeIcon />
            </button>
          </span>
        </div>
        <div className="schema-paint__canvas">
          <canvas ref={canvasElRef} />
        </div>
        <div className="schema-annotator__footer">
          <button type="button" onClick={guardedClose}>
            キャンセル
          </button>
          <button type="button" disabled={saving} onClick={handleSave}>
            {saving ? "保存中..." : saveLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default SchemaPaintModal;
