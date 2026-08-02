import { useMemo } from "react";
import DOMPurify from "dompurify";

// サーバー由来の narrative(XHTML)を安全に表示するビュー。
// React の自動エスケープを通らない dangerouslySetInnerHTML を使うため、
// DOMPurify でホワイトリスト方式のサニタイズを必ず通す。

// 診療記録エディタ(Tiptap + StarterKit)が生成しうるタグに限定する。
const ALLOWED_TAGS = [
  "div", "p", "br", "strong", "b", "em", "i", "s", "u", "span",
  "img", "ul", "ol", "li", "blockquote", "pre", "code", "hr",
];
const ALLOWED_ATTR = ["style", "src", "alt", "width", "height"];
// img の src は data: の画像に限定する。外部 URL 画像(トラッキング・混在コンテンツ)と
// javascript: 等の危険スキームをまとめて遮断できる。
const ALLOWED_URI_REGEXP = /^data:image\/(?:png|jpe?g|gif|webp);base64,/i;

interface RichTextViewProps {
  html: string;
}

// 埋め込み画像を別タブで原寸表示する。data: URI はブラウザがトップレベル遷移を
// 禁止しているため、同一オリジンの blob: URL に変換してから開く。
// クリック直後に同期で開かないとポップアップブロックに掛かるので fetch は使わない。
function openImageInNewTab(src: string) {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(src);
  if (!match) return;

  let blob: Blob;
  try {
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    blob = new Blob([bytes], { type: match[1] });
  } catch {
    // 壊れた base64。表示できないので何もしない。
    return;
  }

  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
  // 即時 revoke すると開いたタブが読み込めないため、猶予を置いてから解放する。
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function RichTextView({ html }: RichTextViewProps) {
  const sanitized = useMemo(() => {
    // サムネイルが押せると分かるように img へ属性を足す。描画後に DOM を触ると
    // React が innerHTML を張り直した時に消えるため、HTML 文字列の段階で埋める。
    const fragment = DOMPurify.sanitize(html, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      ALLOWED_URI_REGEXP,
      RETURN_DOM_FRAGMENT: true,
    });
    fragment.querySelectorAll("img").forEach((image) => {
      image.setAttribute("role", "button");
      image.setAttribute("tabindex", "0");
      image.setAttribute("title", "クリックで原寸表示");
      if (!image.getAttribute("alt")) image.setAttribute("alt", "貼り付け画像");
    });
    const holder = document.createElement("div");
    holder.append(fragment);
    return holder.innerHTML;
  }, [html]);

  return (
    <div
      className="rich-text"
      onClick={(event) => {
        if (event.target instanceof HTMLImageElement) openImageInNewTab(event.target.src);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        if (!(event.target instanceof HTMLImageElement)) return;
        // Space でのページスクロールを止める。
        event.preventDefault();
        openImageInNewTab(event.target.src);
      }}
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
}
