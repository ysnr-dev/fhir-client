import { useState } from "react";
import { karteItemKey, type KarteDayGroup } from "../fhir/karteTimeline";

// カルテ左端の診療日パネル。データが存在する診療日を並べ、展開するとその日の
// 情報(処方・診療記録など)が出る。クリックでタイムラインの該当位置へスクロールする。

interface KarteDayListProps {
  groups: KarteDayGroup[];
  onSelect: (targetKey: string) => void;
  visible: boolean;
  onToggleVisible: () => void;
}

export function KarteDayList({ groups, onSelect, visible, onToggleVisible }: KarteDayListProps) {
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

  const visibilityButton = (
    <KarteDayListVisibilityButton visible={visible} onToggle={onToggleVisible} />
  );

  // 非表示のときも切替ボタンだけは残さないと表示に戻せないので、細い帯にして残す。
  if (!visible) {
    return <div className="karte-daylist karte-daylist--collapsed">{visibilityButton}</div>;
  }

  return (
    <nav className="karte-daylist">
      <div className="karte-daylist__header">
        <h3 className="karte-daylist__title">診療日</h3>
        {visibilityButton}
      </div>
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

// 診療日パネルの表示・非表示を切り替えるアイコンボタン。
function KarteDayListVisibilityButton({
  visible,
  onToggle,
}: {
  visible: boolean;
  onToggle: () => void;
}) {
  const label = visible ? "診療日パネルを隠す" : "診療日パネルを表示する";
  return (
    <button
      type="button"
      className={`karte-daylist__visibility${visible ? " karte-daylist__visibility--active" : ""}`}
      aria-pressed={visible}
      title={label}
      aria-label={label}
      onClick={onToggle}
    >
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
        <rect
          x="1.5"
          y="2.5"
          width="13"
          height="11"
          rx="1.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
        />
        {/* 表示中は左カラム(診療日パネル)が出ているアイコン、非表示のときは 1 枚のアイコン。 */}
        {visible && <path d="M6 2.5v11" stroke="currentColor" strokeWidth="1.2" />}
      </svg>
    </button>
  );
}
