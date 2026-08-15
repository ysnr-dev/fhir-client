import { useState } from "react";
import { karteItemKey, type KarteDayGroup } from "../fhir/karteTimeline";

// カルテ左端のペインの「診療日」表示。データが存在する診療日を並べ、展開すると
// その日の情報(処方・診療記録など)が出る。クリックでタイムラインの該当位置へ
// スクロールする。ペインの枠と見出しは KarteSidePane 側が描く。

interface KarteDayListProps {
  groups: KarteDayGroup[];
  onSelect: (targetKey: string) => void;
}

export function KarteDayList({ groups, onSelect }: KarteDayListProps) {
  // ツリービューのイメージに合わせて既定は閉じた状態。
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(day: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  if (groups.length === 0) return <p className="karte-daylist__empty">-</p>;

  return (
    <ul className="karte-daylist__days">
      {groups.map((group) => {
        const day = group.day || "no-date";
        const isOpen = expanded.has(day);
        return (
          <li key={day}>
            <div className="karte-daylist__day">
              <button
                type="button"
                className="karte-daylist__toggle"
                aria-expanded={isOpen}
                aria-label={`${group.day || "日付なし"} の情報を${isOpen ? "閉じる" : "開く"}`}
                onClick={() => toggle(day)}
              >
                {isOpen ? "▾" : "▸"}
              </button>
              <button type="button" className="karte-daylist__date" onClick={() => onSelect(day)}>
                {group.day || "日付なし"}
              </button>
            </div>
            {isOpen && (
              <ul className="karte-daylist__items">
                {group.items.map((item) => (
                  <li key={karteItemKey(item)}>
                    <button
                      type="button"
                      className="karte-daylist__item"
                      onClick={() => onSelect(karteItemKey(item))}
                    >
                      {item.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
