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

export function RichTextView({ html }: RichTextViewProps) {
  const sanitized = useMemo(
    () =>
      DOMPurify.sanitize(html, {
        ALLOWED_TAGS,
        ALLOWED_ATTR,
        ALLOWED_URI_REGEXP,
      }),
    [html],
  );

  return <div className="rich-text" dangerouslySetInnerHTML={{ __html: sanitized }} />;
}
