import { useRef } from "react";
import { useTocTracking } from "../hooks/useTocTracking";

// テンプレート記入フォームの左に出す目次。見出しのあるグループのツリーを並べ、押すとその位置へ移動する。
// モーダルの中でも使えるよう、スクロールはウィンドウではなく最寄りのスクロール領域で追う。
// 見た目はテンプレート編集画面の目次(.qe-toc)と揃える。

export interface ResponseTocEntry {
  anchorId: string;
  text: string;
  children: ResponseTocEntry[];
}

export function responseTocAnchorId(key: string): string {
  return `qr-toc-${key}`;
}

/** 移動先の上端がスクロール領域の上端からこの px 以内に来たら「読んでいる」とみなす。 */
const ACTIVE_LINE = 24;

function flatten(entries: ResponseTocEntry[]): string[] {
  return entries.flatMap((entry) => [entry.anchorId, ...flatten(entry.children)]);
}

function EntryTree({
  entries,
  activeId,
  onJump,
}: {
  entries: ResponseTocEntry[];
  activeId: string;
  onJump: (id: string) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <ul className="qe-toc__items">
      {entries.map((entry) => (
        <li key={entry.anchorId}>
          <button
            type="button"
            className={`qe-toc__item${entry.anchorId === activeId ? " qe-toc__item--active" : ""}`}
            title={entry.text}
            aria-current={entry.anchorId === activeId ? "location" : undefined}
            data-anchor={entry.anchorId}
            onClick={() => onJump(entry.anchorId)}
          >
            <span className="qe-toc__item-text">{entry.text}</span>
          </button>
          <EntryTree entries={entry.children} activeId={activeId} onJump={onJump} />
        </li>
      ))}
    </ul>
  );
}

export function QuestionnaireResponseToc({ entries }: { entries: ResponseTocEntry[] }) {
  const navRef = useRef<HTMLElement>(null);
  const { activeId, jumpTo } = useTocTracking(navRef, flatten(entries), ACTIVE_LINE);

  return (
    <nav className="qe-toc qr-toc" aria-label="目次" ref={navRef}>
      <p className="qr-toc__caption">目次</p>
      <EntryTree entries={entries} activeId={activeId} onJump={jumpTo} />
    </nav>
  );
}
