import { useRef } from "react";
import { useTocTracking } from "../hooks/useTocTracking";

// マスタの編集画面(パス定義・レジメン)の左に出す目次。区画と、区画の下の項目のツリーを並べ、
// 押すとその位置へ移動する。見た目はテンプレート編集画面の目次(.qe-toc)と揃える。

export interface EditorTocEntry {
  anchorId: string;
  text: string;
  /** 項目の頭に小さく添える種別・番号。 */
  type?: string;
  children: EditorTocEntry[];
}

/** 移動先の上端がここ(ビューポート上端からの px)より上にあれば「読んでいる」とみなす。
 *  追従するヘッダーの高さ(scroll-margin-top)に少し余裕を足した値。 */
const ACTIVE_LINE = 96;

function flatten(entries: EditorTocEntry[]): string[] {
  return entries.flatMap((entry) => [entry.anchorId, ...flatten(entry.children)]);
}

function EntryTree({
  entries,
  activeId,
  onJump,
}: {
  entries: EditorTocEntry[];
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
            {entry.type && <span className="qe-toc__item-type">{entry.type}</span>}
            <span className="qe-toc__item-text">{entry.text}</span>
          </button>
          <EntryTree entries={entry.children} activeId={activeId} onJump={onJump} />
        </li>
      ))}
    </ul>
  );
}

export function EditorToc({ sections }: { sections: EditorTocEntry[] }) {
  const navRef = useRef<HTMLElement>(null);
  const { activeId, jumpTo } = useTocTracking(navRef, flatten(sections), ACTIVE_LINE);

  return (
    <nav className="qe-toc" aria-label="目次" ref={navRef}>
      <ul className="qe-toc__sections">
        {sections.map((section) => (
          <li key={section.anchorId}>
            <button
              type="button"
              className={`qe-toc__section${section.anchorId === activeId ? " qe-toc__section--active" : ""}`}
              aria-current={section.anchorId === activeId ? "location" : undefined}
              data-anchor={section.anchorId}
              onClick={() => jumpTo(section.anchorId)}
            >
              {section.text}
            </button>
            <EntryTree entries={section.children} activeId={activeId} onJump={jumpTo} />
          </li>
        ))}
      </ul>
    </nav>
  );
}
