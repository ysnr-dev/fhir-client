import { useMemo } from "react";
import DOMPurify from "dompurify";
import {
  KARTE_LINK_ATTR,
  parseKarteLink,
  parseKarteLinkAnchor,
  type KarteLink,
} from "../fhir/karteLinkHelpers";
import { useKarteLinkActions } from "./KarteLinkContext";

// 描画時にリンクの参照先を載せる属性(保存形式の href の代わり)。
const LINK_REFERENCE_ATTR = "data-karte-ref";

// サーバー由来の narrative(XHTML)を安全に表示するビュー。
// React の自動エスケープを通らない dangerouslySetInnerHTML を使うため、
// DOMPurify でホワイトリスト方式のサニタイズを必ず通す。

// 診療記録エディタ(Tiptap + StarterKit)が生成しうるタグに限定する。
const ALLOWED_TAGS = [
  "div", "p", "br", "strong", "b", "em", "i", "s", "u", "span",
  "img", "ul", "ol", "li", "blockquote", "pre", "code", "hr", "a",
];
const ALLOWED_ATTR = ["style", "src", "alt", "width", "height", "href", KARTE_LINK_ATTR];
// img の src は data: の画像、a の href は FHIR の相対参照(カルテ内リンク)に限定する。
// 外部 URL(トラッキング・混在コンテンツ)と javascript: 等の危険スキームをまとめて遮断できる。
const ALLOWED_URI_REGEXP =
  /^(?:data:image\/(?:png|jpe?g|gif|webp);base64,|[A-Z][A-Za-z]+\/[A-Za-z0-9\-.]{1,64}$)/;

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

// 描画したリンク(span)から開く先を読み戻す。
function linkOf(target: EventTarget): KarteLink | null {
  if (!(target instanceof Element)) return null;
  const element = target.closest(`span[${KARTE_LINK_ATTR}]`);
  if (!element) return null;
  return parseKarteLink(
    element.getAttribute(LINK_REFERENCE_ATTR) ?? "",
    element.getAttribute(KARTE_LINK_ATTR) ?? "",
    element.textContent ?? "",
  );
}

export function RichTextView({ html }: RichTextViewProps) {
  const linkActions = useKarteLinkActions();
  const openLink = linkActions?.openLink;
  const linkable = Boolean(openLink);
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
    // リンクは <a> のままだと中クリック・Ctrl+クリックで相対 URL へ飛んでしまうので、
    // span に置き換えてクリックをこちらで受ける。開く口が無い場所では文字だけにする。
    fragment.querySelectorAll("a").forEach((anchor) => {
      const link = parseKarteLinkAnchor(anchor);
      if (!link || !linkable) {
        anchor.replaceWith(...Array.from(anchor.childNodes));
        return;
      }
      const span = document.createElement("span");
      span.className = "rich-text__link";
      span.setAttribute(KARTE_LINK_ATTR, link.kind);
      span.setAttribute(LINK_REFERENCE_ATTR, `${link.resourceType}/${link.id}`);
      span.setAttribute("role", "link");
      span.setAttribute("tabindex", "0");
      span.append(...Array.from(anchor.childNodes));
      anchor.replaceWith(span);
    });
    const holder = document.createElement("div");
    holder.append(fragment);
    return holder.innerHTML;
  }, [html, linkable]);

  return (
    <div
      className="rich-text"
      onClick={(event) => {
        if (event.target instanceof HTMLImageElement) {
          openImageInNewTab(event.target.src);
          return;
        }
        const link = linkOf(event.target);
        if (!link || !openLink) return;
        // カード自体のクリック(選択など)に伝えない。
        event.stopPropagation();
        openLink(link);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const link = linkOf(event.target);
        if (link && openLink) {
          event.preventDefault();
          event.stopPropagation();
          openLink(link);
          return;
        }
        if (!(event.target instanceof HTMLImageElement)) return;
        // Space でのページスクロールを止める。
        event.preventDefault();
        openImageInNewTab(event.target.src);
      }}
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
}
