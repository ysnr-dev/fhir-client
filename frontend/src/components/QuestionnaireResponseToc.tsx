import { useEffect, useRef, useState } from "react";

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

/** 目次から飛んだあと、利用者が自分でスクロールし始めたとみなす操作(QuestionnaireEditorToc と同じ)。 */
const USER_SCROLL_EVENTS = ["wheel", "touchmove", "keydown", "pointerdown"] as const;

function flatten(entries: ResponseTocEntry[]): string[] {
  return entries.flatMap((entry) => [entry.anchorId, ...flatten(entry.children)]);
}

function scrollParentOf(element: HTMLElement): HTMLElement | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const overflowY = getComputedStyle(parent).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return parent;
  }
  return null;
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
  const anchorIds = flatten(entries);
  const anchorKey = anchorIds.join("\n");
  const [activeId, setActiveId] = useState(anchorIds[0] ?? "");
  const navRef = useRef<HTMLElement>(null);
  const holding = useRef(false);

  // 条件付きグループの出入りで並びが変わるので、並びが変わったときも求め直す。
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const ids = anchorKey ? anchorKey.split("\n") : [];
    const container = scrollParentOf(nav);
    const target: HTMLElement | Window = container ?? window;

    const update = () => {
      if (holding.current) return;
      const top = container ? container.getBoundingClientRect().top : 0;
      let active = ids[0] ?? "";
      for (const id of ids) {
        const anchor = document.getElementById(id);
        if (!anchor) continue;
        if (anchor.getBoundingClientRect().top - top > ACTIVE_LINE) break;
        active = id;
      }
      setActiveId(active);
    };
    const release = () => {
      holding.current = false;
    };
    update();
    target.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    for (const type of USER_SCROLL_EVENTS) window.addEventListener(type, release, { passive: true });
    return () => {
      target.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      for (const type of USER_SCROLL_EVENTS) window.removeEventListener(type, release);
    };
  }, [anchorKey]);

  // 強調した行が目次の表示範囲から外れていたら、目次の中だけを送って見せる。
  useEffect(() => {
    const nav = navRef.current;
    const button = nav?.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(activeId)}"]`);
    if (!nav || !button) return;
    const navRect = nav.getBoundingClientRect();
    const rect = button.getBoundingClientRect();
    if (rect.top < navRect.top) nav.scrollTop -= navRect.top - rect.top + 8;
    else if (rect.bottom > navRect.bottom) nav.scrollTop += rect.bottom - navRect.bottom + 8;
  }, [activeId]);

  // 自動化環境では smooth スクロールが動かないことがあるので、即時に移動する。
  function jumpTo(id: string) {
    holding.current = true;
    setActiveId(id);
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  }

  return (
    <nav className="qe-toc qr-toc" aria-label="目次" ref={navRef}>
      <p className="qr-toc__caption">目次</p>
      <EntryTree entries={entries} activeId={activeId} onJump={jumpTo} />
    </nav>
  );
}
