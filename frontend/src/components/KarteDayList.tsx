import { useState } from "react";
import { karteItemKey, type KarteDayGroup } from "../fhir/karteTimeline";

// カルテ左端の診療日パネル。データが存在する診療日を並べ、展開するとその日の
// 情報(処方・診療記録など)が出る。クリックでタイムラインの該当位置へスクロールする。

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

  return (
    <nav className="karte-daylist">
      <h3 className="karte-daylist__title">診療日</h3>
      {groups.length === 0 ? (
        <p className="karte-daylist__empty">-</p>
      ) : (
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
                  <button
                    type="button"
                    className="karte-daylist__date"
                    onClick={() => onSelect(day)}
                  >
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
      )}
    </nav>
  );
}
