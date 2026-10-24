import { useRef } from "react";
import { flattenAnchorIds, useTocTracking } from "../hooks/useTocTracking";
import { EditorTocEntries, type EditorTocEntry } from "./EditorToc";

// テンプレート記入フォームの左に出す目次。見出しのあるグループのツリーを並べ、押すとその位置へ移動する。
// 区画を持たないので、EditorToc の項目のツリーだけを使う。モーダルの中でも使えるよう、
// スクロールはウィンドウではなく最寄りのスクロール領域で追う。

export function responseTocAnchorId(key: string): string {
  return `qr-toc-${key}`;
}

/** 移動先の上端がスクロール領域の上端からこの px 以内に来たら「読んでいる」とみなす。 */
const ACTIVE_LINE = 24;

export function QuestionnaireResponseToc({ entries }: { entries: EditorTocEntry[] }) {
  const navRef = useRef<HTMLElement>(null);
  const { activeId, jumpTo } = useTocTracking(navRef, flattenAnchorIds(entries), ACTIVE_LINE);

  return (
    <nav className="qe-toc qr-toc" aria-label="目次" ref={navRef}>
      <p className="qr-toc__caption">目次</p>
      <EditorTocEntries entries={entries} activeId={activeId} onJump={jumpTo} />
    </nav>
  );
}
