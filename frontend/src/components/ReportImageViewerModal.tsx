import { useEffect, useState } from "react";
import { useBinaryImage } from "../api/queries";
import { Modal } from "./Modal";

// レポートに添えた画像の拡大表示。サムネイルでは所見が読めないので、画面に収まる
// 最大の大きさで出し、同じレポートの画像を前後に送れるようにする。描き込みのある画像は
// 元画像と切り替えて見られる(描き込みで隠れた部分を確かめるため)。

/** 画像の実体。保存済みは binaryId、未保存は dataUrl。 */
export interface ViewerImageData {
  binaryId: string | null;
  dataUrl: string | null;
}

export interface ViewerImage {
  key: string;
  caption: string;
  /** 表示する画像(描き込みがあれば描き込み画像)。 */
  image: ViewerImageData;
  /** 描き込みの元画像。描き込みが無ければ null。 */
  original: ViewerImageData | null;
}

export function ReportImageViewerModal({
  images,
  initialIndex,
  onClose,
}: {
  images: ViewerImage[];
  initialIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(Math.min(initialIndex, Math.max(images.length - 1, 0)));
  const [showOriginal, setShowOriginal] = useState(false);
  const current = images[index];
  const hasPrev = index > 0;
  const hasNext = index < images.length - 1;

  function move(delta: number) {
    setIndex((i) => Math.min(Math.max(i + delta, 0), images.length - 1));
    setShowOriginal(false);
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") move(-1);
      else if (e.key === "ArrowRight") move(1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // move は images.length にしか依存しない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images.length]);

  if (!current) return null;
  const shown = showOriginal && current.original ? current.original : current.image;

  return (
    <Modal
      title={`画像 ${index + 1} / ${images.length}`}
      onClose={onClose}
      className="modal--image-viewer"
    >
      <div className="image-viewer">
        <ViewerPicture data={shown} alt={current.caption || `画像${index + 1}`} />
        <div className="image-viewer__footer">
          <button type="button" disabled={!hasPrev} onClick={() => move(-1)} aria-label="前の画像">
            ◀
          </button>
          <span className="image-viewer__caption">{current.caption}</span>
          {current.original && (
            <span className="image-viewer__toggle" role="group" aria-label="表示する画像">
              <button
                type="button"
                className={showOriginal ? "" : "image-viewer__toggle--active"}
                onClick={() => setShowOriginal(false)}
              >
                描き込み
              </button>
              <button
                type="button"
                className={showOriginal ? "image-viewer__toggle--active" : ""}
                onClick={() => setShowOriginal(true)}
              >
                元画像
              </button>
            </span>
          )}
          <button type="button" disabled={!hasNext} onClick={() => move(1)} aria-label="次の画像">
            ▶
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ViewerPicture({ data, alt }: { data: ViewerImageData; alt: string }) {
  const { data: fetched, isLoading } = useBinaryImage(
    data.dataUrl ? undefined : (data.binaryId ?? undefined),
  );
  const src = data.dataUrl ?? fetched;
  return (
    <div className="image-viewer__stage">
      {src ? (
        <img className="image-viewer__image" src={src} alt={alt} />
      ) : (
        <p className="image-viewer__empty">
          {isLoading ? "画像を読み込み中..." : "画像を表示できません。"}
        </p>
      )}
    </div>
  );
}
