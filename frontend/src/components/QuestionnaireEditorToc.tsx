import { useEffect, useRef, useState } from "react";
import { ITEM_TYPE_LABELS, type EditorItem } from "../fhir/questionnaireHelpers";

// テンプレート編集画面の左に出す目次。区画と項目のツリーを並べ、押すとその位置へ移動する。
// 移動先は QuestionnaireEditor の区画と QuestionnaireItemEditor の項目に振った id。
// 本文のスクロールに合わせて、いま読んでいる区画・項目を強調する。

export const QE_SECTIONS = [
  { id: "qe-section-meta", label: "テンプレート情報" },
  { id: "qe-section-observation", label: "回答から Observation を生成" },
  { id: "qe-section-variables", label: "変数(FHIRPath)" },
  { id: "qe-section-items", label: "項目" },
] as const;

export function qeItemAnchorId(itemId: string): string {
  return `qe-item-${itemId}`;
}

/** 移動先の上端がここ(ビューポート上端からの px)より上にあれば「読んでいる」とみなす。
 *  追従するヘッダーの高さ(.qe-section の scroll-margin-top)に少し余裕を足した値。 */
const ACTIVE_LINE = 96;

/** 目次から飛んだあと、利用者が自分でスクロールし始めたとみなす操作。
 *  それまでは飛んだ先を現在位置のままにする(ページ末尾の項目は上端まで送れないので、
 *  スクロール位置から求めると手前の項目になるため)。 */
const USER_SCROLL_EVENTS = ["wheel", "touchmove", "keydown", "pointerdown"] as const;

// 区画と項目の移動先を文書順に並べ、上端が基準線を越えた最後のものを現在位置にする。
function findActiveId(): string {
  const anchors = document.querySelectorAll<HTMLElement>(".qe-layout .qe-section, .qe-layout .qe-item");
  let active = "";
  for (const anchor of anchors) {
    if (anchor.getBoundingClientRect().top > ACTIVE_LINE) break;
    active = anchor.id;
  }
  return active || QE_SECTIONS[0].id;
}

function ItemTree({
  items,
  activeId,
  onJump,
}: {
  items: EditorItem[];
  activeId: string;
  onJump: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <ul className="qe-toc__items">
      {items.map((item) => {
        const anchorId = qeItemAnchorId(item.id);
        return (
          <li key={item.id}>
            <button
              type="button"
              className={`qe-toc__item${anchorId === activeId ? " qe-toc__item--active" : ""}`}
              title={item.text || item.linkId}
              aria-current={anchorId === activeId ? "location" : undefined}
              data-anchor={anchorId}
              onClick={() => onJump(anchorId)}
            >
              <span className="qe-toc__item-type">{ITEM_TYPE_LABELS[item.type]}</span>
              <span className="qe-toc__item-text">{item.text || item.linkId}</span>
            </button>
            <ItemTree items={item.children} activeId={activeId} onJump={onJump} />
          </li>
        );
      })}
    </ul>
  );
}

export function QuestionnaireEditorToc({ items }: { items: EditorItem[] }) {
  const [activeId, setActiveId] = useState<string>(QE_SECTIONS[0].id);
  const navRef = useRef<HTMLElement>(null);
  const holding = useRef(false);

  // 項目の追加・削除・並べ替えで位置が変わるので、items が変わったときも求め直す。
  useEffect(() => {
    const update = () => {
      if (holding.current) return;
      setActiveId(findActiveId());
    };
    const release = () => {
      holding.current = false;
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    for (const type of USER_SCROLL_EVENTS) window.addEventListener(type, release, { passive: true });
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      for (const type of USER_SCROLL_EVENTS) window.removeEventListener(type, release);
    };
  }, [items]);

  // 強調した行が目次の表示範囲から外れていたら、目次の中だけを送って見せる
  // (scrollIntoView はページ全体まで動かしうるので使わない)。
  useEffect(() => {
    const nav = navRef.current;
    const button = nav?.querySelector<HTMLElement>(`[data-anchor="${activeId}"]`);
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
    <nav className="qe-toc" aria-label="目次" ref={navRef}>
      <ul className="qe-toc__sections">
        {QE_SECTIONS.map((section) => (
          <li key={section.id}>
            <button
              type="button"
              className={`qe-toc__section${section.id === activeId ? " qe-toc__section--active" : ""}`}
              aria-current={section.id === activeId ? "location" : undefined}
              data-anchor={section.id}
              onClick={() => jumpTo(section.id)}
            >
              {section.label}
            </button>
            {section.id === "qe-section-items" && (
              <ItemTree items={items} activeId={activeId} onJump={jumpTo} />
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
