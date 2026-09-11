import {
  groupByKarteDayYear,
  karteDayLabel,
  karteDayShortLabel,
} from "../fhir/karteTimeline";

// 検査結果タブ・細菌検査タブの左端に置く検体採取日ペイン。
// 同じ日に複数の検査結果があっても 1 件 1 行で並べる。
// カルテの診療日ペイン(KarteDayList)と同じ見せ方で、日付は年ごとにまとめ、
// 行には月日と曜日だけを出す(年が変わる境目だけ見出しで示す)。

interface SpecimenDateEntry {
  id: string;
  date: string;
}

export function SpecimenDateList({
  entries,
  selectedId,
  isLoading,
  unreviewedIds,
  onSelect,
}: {
  entries: readonly SpecimenDateEntry[];
  selectedId: string | undefined;
  isLoading: boolean;
  /** まだ誰も確認していない結果の id。行の右肩に印を出す。 */
  unreviewedIds?: ReadonlySet<string>;
  onSelect: (reportId: string) => void;
}) {
  return (
    <nav className="karte-daylist" aria-label="検体採取日">
      <div className="karte-daylist__header">
        <h4 className="karte-daylist__title">検体採取日</h4>
      </div>
      {isLoading ? (
        <p className="karte-daylist__empty">読み込み中...</p>
      ) : entries.length === 0 ? (
        <p className="karte-daylist__empty">-</p>
      ) : (
        <div className="karte-daylist__years">
          {groupByKarteDayYear(entries, (entry) => entry.date).map((group) => (
            // 日付なしは年が無いので、キーは先頭の検査結果 id から作る。
            <section
              key={group.year ?? `no-date-${group.entries[0].id}`}
              className="karte-daylist__year"
            >
              {group.year !== undefined && (
                <h5 className="karte-daylist__year-title">{group.year}年</h5>
              )}
              <ul className="karte-daylist__days">
                {group.entries.map((entry) => {
                  const unreviewed = unreviewedIds?.has(entry.id) ?? false;
                  const label = `${karteDayLabel(entry.date)}${unreviewed ? "（未確認）" : ""}`;
                  return (
                    <li key={entry.id}>
                      <button
                        type="button"
                        className={`karte-daylist__date${
                          entry.id === selectedId ? " karte-daylist__date--selected" : ""
                        }`}
                        aria-current={entry.id === selectedId || undefined}
                        // 行は月日だけなので、年を含む日付は読み上げ・ツールチップで補う。
                        title={label}
                        aria-label={label}
                        onClick={() => onSelect(entry.id)}
                      >
                        {karteDayShortLabel(entry.date)}
                        {unreviewed && (
                          <span className="karte-daylist__unreviewed" aria-hidden="true" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </nav>
  );
}
