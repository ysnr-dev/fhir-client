import { useQueryClient } from "@tanstack/react-query";
import {
  lazy,
  Suspense,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
} from "react";
import { fetchBinaryImage } from "../api/fhirClient";
import {
  radReportImageRefs,
  radReportViewerImages,
  type RadReportImageData,
  type RadReportImageValues,
} from "../fhir/radReportHelpers";
import { normalizeImageFile } from "../fhir/schemaImage";
import { DARK_IMAGE_PEN_COLORS } from "./penColors";
import { ReportImageViewerModal } from "./ReportImageViewerModal";
import { RowMenu } from "./RowMenu";
import { SchemaImageGallery } from "./SchemaImageGallery";

// 描き込みモーダル(fabric.js)は重いので、開くまで読み込まない。
const SchemaPaintModal = lazy(() => import("./SchemaPaintModal"));

// 読影レポートの画像欄(docs/rad-report-design.md §4.2)。
//
// 追加はファイル選択(複数可)・ドラッグ&ドロップ・貼り付けの 3 経路。読影端末では
// ビューアのスクリーンショットをファイルに保存せず貼る運用が最も手数が少ない。
// 画像は CT・MR の濃淡画像なので JPEG にする(PNG のままだと Bundle が上流の上限に届く)。
//
// 描き込みは元画像を書き換えず、合成画像を別に持つ。描き直すときは元画像から始められる。

/** 描き込みの台紙の選び方。 */
type PaintMode = "source" | "annotated";

interface PaintTarget {
  index: number;
  background: string;
}

export function RadReportImagesEditor({
  images,
  onChange,
  onError,
}: {
  images: RadReportImageValues[];
  onChange: (images: RadReportImageValues[]) => void;
  onError: (message: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [adding, setAdding] = useState(false);
  const [paint, setPaint] = useState<PaintTarget | null>(null);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  // 非同期の読み込み中に他の操作で配列が変わっても、最新の並びに足すための参照。
  const imagesRef = useRef(images);
  imagesRef.current = images;

  async function addFiles(files: File[]) {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    const skipped = files.length - imageFiles.length;
    if (imageFiles.length === 0) {
      if (skipped > 0) onError("画像ファイルを選択してください。");
      return;
    }
    setAdding(true);
    const added: RadReportImageValues[] = [];
    const errors: string[] = [];
    for (const file of imageFiles) {
      try {
        const { dataUrl, contentType } = await normalizeImageFile(file, { format: "jpeg" });
        added.push({ source: { binaryId: "", dataUrl, contentType }, annotated: null, caption: "" });
      } catch (err) {
        errors.push(`${file.name || "画像"}: ${err instanceof Error ? err.message : "読み込めませんでした。"}`);
      }
    }
    setAdding(false);
    if (skipped > 0) errors.push(`画像以外のファイル ${skipped} 件は追加していません。`);
    onError(errors.length > 0 ? errors.join(" ") : null);
    if (added.length > 0) onChange([...imagesRef.current, ...added]);
  }

  function handleFileInput(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    // 同じファイルを続けて選び直せるよう、読み込み前に入力を空にしておく。
    e.target.value = "";
    void addFiles(files);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    void addFiles(Array.from(e.dataTransfer.files));
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    setDragging(true);
  }

  // キャプションの入力欄などへの文字の貼り付けは妨げない。画像があるときだけ受け取る。
  function handlePaste(e: ClipboardEvent<HTMLDivElement>) {
    const files = Array.from(e.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (files.length === 0) return;
    e.preventDefault();
    void addFiles(files);
  }

  function update(index: number, patch: Partial<RadReportImageValues>) {
    onChange(images.map((image, i) => (i === index ? { ...image, ...patch } : image)));
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= images.length) return;
    const next = [...images];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  function remove(index: number) {
    onChange(images.filter((_, i) => i !== index));
  }

  async function dataUrlOf(data: RadReportImageData): Promise<string> {
    if (data.dataUrl) return data.dataUrl;
    return queryClient.fetchQuery({
      queryKey: ["Binary", data.binaryId, "image"],
      queryFn: () => fetchBinaryImage(data.binaryId),
      staleTime: Infinity,
    });
  }

  async function openPaint(index: number, mode: PaintMode) {
    const image = images[index];
    if (!image) return;
    const base = mode === "annotated" && image.annotated ? image.annotated : image.source;
    try {
      setPaint({ index, background: await dataUrlOf(base) });
      onError(null);
    } catch {
      onError("画像を読み込めませんでした。");
    }
  }

  function savePaint(dataUrl: string) {
    if (!paint) return;
    update(paint.index, { annotated: { binaryId: "", dataUrl, contentType: "image/jpeg" } });
    setPaint(null);
  }

  const refs = radReportImageRefs(images);

  return (
    <div
      className={`rad-report-images${dragging ? " rad-report-images--dragging" : ""}`}
      tabIndex={0}
      aria-label="画像"
      onPaste={handlePaste}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      {images.map((image, index) => (
        <div className="rad-report-images__row" key={index}>
          <span className="patho-result__image-number">{index + 1}</span>
          <SchemaImageGallery
            refs={[{ ...refs[index], label: "" }]}
            onOpen={() => setViewerIndex(index)}
          />
          <input
            type="text"
            value={image.caption}
            aria-label={`画像${index + 1}のキャプション`}
            placeholder="キャプション"
            onChange={(e) => update(index, { caption: e.target.value })}
          />
          {image.annotated ? (
            <RowMenu label={`画像${index + 1}の描き込み`}>
              <button
                type="button"
                className="row-menu__item"
                onClick={() => void openPaint(index, "annotated")}
              >
                描き足す
              </button>
              <button
                type="button"
                className="row-menu__item"
                onClick={() => void openPaint(index, "source")}
              >
                元画像から描き直す
              </button>
              <button
                type="button"
                className="row-menu__item row-menu__item--danger"
                onClick={() => update(index, { annotated: null })}
              >
                描き込みを外す
              </button>
            </RowMenu>
          ) : (
            <button type="button" onClick={() => void openPaint(index, "source")}>
              描き込み
            </button>
          )}
          <button
            type="button"
            className="rp-card__icon-button"
            disabled={index === 0}
            title="上へ"
            aria-label={`画像${index + 1}を上へ`}
            onClick={() => move(index, -1)}
          >
            ↑
          </button>
          <button
            type="button"
            className="rp-card__icon-button"
            disabled={index === images.length - 1}
            title="下へ"
            aria-label={`画像${index + 1}を下へ`}
            onClick={() => move(index, 1)}
          >
            ↓
          </button>
          <button
            type="button"
            className="rp-card__icon-button"
            title="この画像を外す"
            aria-label={`画像${index + 1}を外す`}
            onClick={() => remove(index)}
          >
            ×
          </button>
        </div>
      ))}
      <div className="patho-result__image-actions">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="patho-result__file-input"
          onChange={handleFileInput}
        />
        <button type="button" disabled={adding} onClick={() => fileInputRef.current?.click()}>
          {adding ? "読み込み中..." : "＋画像を添付"}
        </button>
      </div>

      {paint && (
        <Suspense fallback={null}>
          <SchemaPaintModal
            title={`画像${paint.index + 1}への描き込み`}
            backgroundDataUrl={paint.background}
            saveLabel="描き込みを確定"
            colors={DARK_IMAGE_PEN_COLORS}
            exportFormat="jpeg"
            onSave={savePaint}
            onClose={() => setPaint(null)}
          />
        </Suspense>
      )}
      {viewerIndex !== null && (
        <ReportImageViewerModal
          images={radReportViewerImages(images)}
          initialIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      )}
    </div>
  );
}
