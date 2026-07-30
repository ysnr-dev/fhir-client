import { useEffect, useRef, useState } from "react";
import { ReactSketchCanvas, type ReactSketchCanvasRef } from "react-sketch-canvas";
import { Modal } from "./Modal";

// シェーマ画像への描き込みモーダル。背景画像の上にフリーハンドで描画し、
// 保存時に背景込みの合成 PNG(dataURL)を返す。ストロークは保持しない
// (再編集は保存済みの合成画像への追記になる)。

interface SchemaImageAnnotatorProps {
  title: string;
  backgroundDataUrl: string;
  onSave: (dataUrl: string) => void;
  onClose: () => void;
}

const PEN_COLORS = [
  { code: "#1f1f1f", label: "黒" },
  { code: "#d32f2f", label: "赤" },
  { code: "#1565c0", label: "青" },
  { code: "#2e7d32", label: "緑" },
] as const;

const PEN_WIDTHS = [2, 4, 8] as const;

// 描画キャンバスの長辺上限(px)。合成 PNG のサイズを有界に保つ。
const MAX_CANVAS_DIMENSION = 1200;

interface CanvasSize {
  width: number;
  height: number;
}

export function SchemaImageAnnotator({
  title,
  backgroundDataUrl,
  onSave,
  onClose,
}: SchemaImageAnnotatorProps) {
  const canvasRef = useRef<ReactSketchCanvasRef>(null);
  const [size, setSize] = useState<CanvasSize | null>(null);
  const [strokeColor, setStrokeColor] = useState<string>(PEN_COLORS[0].code);
  const [strokeWidth, setStrokeWidth] = useState<number>(4);
  const [erasing, setErasing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 背景画像のアスペクト比に一致するキャンバスサイズを決める(余白を作らない)。
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_CANVAS_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
      setSize({
        width: Math.round(img.naturalWidth * scale),
        height: Math.round(img.naturalHeight * scale),
      });
    };
    img.onerror = () => setError("背景画像を読み込めませんでした。");
    img.src = backgroundDataUrl;
  }, [backgroundDataUrl]);

  function setEraseMode(enabled: boolean) {
    setErasing(enabled);
    canvasRef.current?.eraseMode(enabled);
  }

  async function handleSave() {
    if (!canvasRef.current) return;
    setSaving(true);
    try {
      const dataUrl = await canvasRef.current.exportImage("png");
      onSave(dataUrl);
    } catch {
      setError("画像の書き出しに失敗しました。");
      setSaving(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose} className="modal--schema">
      {error && <p className="schema-image__error">{error}</p>}
      {!size && !error && <p>読み込み中...</p>}
      {size && (
        <>
          <div className="schema-annotator__toolbar">
            <span className="schema-annotator__tool-group" role="group" aria-label="ペン色">
              {PEN_COLORS.map((color) => (
                <button
                  key={color.code}
                  type="button"
                  aria-label={color.label}
                  className={`schema-annotator__swatch${
                    !erasing && strokeColor === color.code ? " schema-annotator__swatch--active" : ""
                  }`}
                  style={{ backgroundColor: color.code }}
                  onClick={() => {
                    setStrokeColor(color.code);
                    setEraseMode(false);
                  }}
                />
              ))}
            </span>
            <span className="schema-annotator__tool-group" role="group" aria-label="太さ">
              {PEN_WIDTHS.map((width) => (
                <button
                  key={width}
                  type="button"
                  className={strokeWidth === width ? "schema-annotator__tool--active" : ""}
                  onClick={() => setStrokeWidth(width)}
                >
                  {width}px
                </button>
              ))}
            </span>
            <span className="schema-annotator__tool-group">
              <button
                type="button"
                className={erasing ? "schema-annotator__tool--active" : ""}
                onClick={() => setEraseMode(!erasing)}
              >
                消しゴム
              </button>
              <button type="button" onClick={() => canvasRef.current?.undo()}>
                元に戻す
              </button>
              <button type="button" onClick={() => canvasRef.current?.clearCanvas()}>
                クリア
              </button>
            </span>
          </div>
          <div className="schema-annotator__canvas" style={{ maxWidth: size.width }}>
            <ReactSketchCanvas
              ref={canvasRef}
              width={`${size.width}px`}
              height={`${size.height}px`}
              strokeColor={strokeColor}
              strokeWidth={strokeWidth}
              eraserWidth={strokeWidth * 4}
              canvasColor="white"
              backgroundImage={backgroundDataUrl}
              exportWithBackgroundImage
              preserveBackgroundImageAspectRatio="none"
            />
          </div>
          <div className="schema-annotator__footer">
            <button type="button" onClick={onClose}>
              キャンセル
            </button>
            <button type="button" disabled={saving} onClick={handleSave}>
              {saving ? "保存中..." : "編集を保存"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
