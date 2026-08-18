// 検査結果タブ・細菌検査タブの左端に置く検体採取日ペイン。
// 同じ日に複数の検査結果があっても 1 件 1 行で並べる。

interface SpecimenDateEntry {
  id: string;
  date: string;
}

export function SpecimenDateList({
  entries,
  selectedId,
  isLoading,
  onSelect,
}: {
  entries: readonly SpecimenDateEntry[];
  selectedId: string | undefined;
  isLoading: boolean;
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
        <ul className="karte-daylist__days">
          {entries.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className={`karte-daylist__date${
                  entry.id === selectedId ? " karte-daylist__date--selected" : ""
                }`}
                aria-current={entry.id === selectedId || undefined}
                onClick={() => onSelect(entry.id)}
              >
                {entry.date || "日付なし"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
