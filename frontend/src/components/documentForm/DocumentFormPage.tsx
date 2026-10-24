import type { ReactNode, RefObject } from "react";
import type { DocumentFormPageMeta } from "../../fhir/documentFormLayout";

// 様式の 1 ページ。背景のページ画像の上に、px 座標で絶対配置した子(デザイナの箱・入力欄)を重ねる。
// 拡大縮小は内側の要素の transform(scale)で行い、外側は拡大後の大きさを持ってスクロール領域を作る
// (病棟マップのキャンバスと同じ組み立て)。

export function DocumentFormPage({
  page,
  imageUrl,
  zoom,
  innerRef,
  onPointerDown,
  className,
  children,
}: {
  page: DocumentFormPageMeta;
  imageUrl: string;
  zoom: number;
  /** 内側(scale の掛かる)要素。当たり判定に使う。 */
  innerRef?: RefObject<HTMLDivElement | null>;
  onPointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={`document-form-page__outer${className ? ` ${className}` : ""}`}
      style={{ width: page.width_px * zoom, height: page.height_px * zoom }}
    >
      <div
        ref={innerRef}
        className="document-form-page"
        style={{ width: page.width_px, height: page.height_px, transform: `scale(${zoom})` }}
        onPointerDown={onPointerDown}
      >
        <img className="document-form-page__image" src={imageUrl} alt="" draggable={false} />
        {children}
      </div>
    </div>
  );
}
