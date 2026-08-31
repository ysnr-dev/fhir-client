import { useState } from "react";
import {
  karteDayLabel,
  karteDayShortLabel,
  karteDayYear,
  karteItemKey,
  type KarteDayEntry,
} from "../fhir/karteTimeline";

// カルテ左端のペインの「診療日」表示。タイムラインの読み込み状況に関係なく、
// データが存在する全診療日(インデックス)を並べる。日付は年ごとにまとめ、行には
// 月日と曜日だけを出す(年が変わる境目だけ見出しで示す)。展開するとその日の情報
// (処方・診療記録など)が出る。クリックでタイムラインの該当位置へスクロールする。
// まだ読み込んでいない日はクリック・展開で読み込みを進めてもらう(親が行う)。
// ペインの枠と見出しは KarteSidePane 側が描く。

interface KarteDayListProps {
  entries: KarteDayEntry[];
  onSelect: (targetKey: string) => void;
  /** まだ読み込んでいない日が展開されたとき、その日までの読み込みを進めてもらう。 */
  onLoadDay: (dayKey: string) => void;
  /** 読み込みを進めている対象の日。読み込み中の表示に使う。 */
  loadingKey: string | null;
}

export function KarteDayList({ entries, onSelect, onLoadDay, loadingKey }: KarteDayListProps) {
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

  if (entries.length === 0) return <p className="karte-daylist__empty">-</p>;

  return (
    <div className="karte-daylist__years">
      {groupByYear(entries).map((group) => (
        // 日付未定・日付なしは年が無いので、キーは先頭の日付から作る。
        <section key={group.year ?? (group.entries[0].day || "no-date")} className="karte-daylist__year">
          {group.year !== undefined && (
            <h4 className="karte-daylist__year-title">{group.year}年</h4>
          )}
          <ul className="karte-daylist__days">
            {group.entries.map((entry) => {
              const day = entry.day || "no-date";
              const isOpen = expanded.has(day);
              const isLoading = loadingKey === day;
              return (
                <li key={day}>
                  <div className="karte-daylist__day">
                    <button
                      type="button"
                      className="karte-daylist__toggle"
                      aria-expanded={isOpen}
                      aria-label={`${karteDayLabel(entry.day)} の情報を${isOpen ? "閉じる" : "開く"}`}
                      onClick={() => {
                        // まだ読み込んでいない日は、展開と同時に読み込みを進めてもらう
                        // (項目はタイムラインの読み込みが追いつくと現れる)。
                        if (!isOpen && entry.items === null) onLoadDay(day);
                        toggle(day);
                      }}
                    >
                      {isOpen ? "▾" : "▸"}
                    </button>
                    <button
                      type="button"
                      className={`karte-daylist__date${isLoading ? " karte-daylist__date--loading" : ""}`}
                      aria-busy={isLoading}
                      // 行は月日だけなので、年を含む日付は読み上げ・ツールチップで補う。
                      title={karteDayLabel(entry.day)}
                      aria-label={karteDayLabel(entry.day)}
                      onClick={() => onSelect(day)}
                    >
                      {karteDayShortLabel(entry.day)}
                    </button>
                  </div>
                  {isOpen &&
                    (entry.items === null ? (
                      <p className="karte-daylist__pending">読み込み中...</p>
                    ) : entry.items.length === 0 ? (
                      // 読み込んだが項目が無い日(インデックスと実データの食い違い)。
                      <p className="karte-daylist__pending">-</p>
                    ) : (
                      <ul className="karte-daylist__items">
                        {entry.items.map((item) => (
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
                    ))}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

interface KarteDayYearGroup {
  /** 年(YYYY)。日付未定・日付なしは年が無いので undefined(見出しを出さない)。 */
  year: string | undefined;
  entries: KarteDayEntry[];
}

/**
 * 並び順(降順・日付未定が先頭・日付なしが末尾)を保ったまま、年の変わり目で区切る。
 * 年を持たない日付未定・日付なしはそれぞれ単独の区切りになる。
 */
function groupByYear(entries: KarteDayEntry[]): KarteDayYearGroup[] {
  const groups: KarteDayYearGroup[] = [];
  for (const entry of entries) {
    const year = karteDayYear(entry.day);
    const last = groups[groups.length - 1];
    if (last && year !== undefined && last.year === year) last.entries.push(entry);
    else groups.push({ year, entries: [entry] });
  }
  return groups;
}
