import { problemLabel, summarizeCondition } from "../fhir/conditionHelpers";

// カルテタブの上に常時出すプロブレムリスト(POMR)。
// 番号付きのチップを並べ、選択すると関連する診療記録がタイムラインで強調される。
// 登録・編集は「病名」タブ側で行う(区分ラジオでプロブレムを選ぶ)。

interface KarteProblemListProps {
  problems: fhir4.Condition[];
  selectedId: string | null;
  onSelect: (conditionId: string | null) => void;
  visible: boolean;
  onToggleVisible: () => void;
  resolvedVisible: boolean;
  onToggleResolved: () => void;
}

// 継続(active)以外は解決済み・中止として扱う。
function isActiveProblem(problem: fhir4.Condition): boolean {
  return problem.clinicalStatus?.coding?.[0]?.code === "active";
}

export function KarteProblemList({
  problems,
  selectedId,
  onSelect,
  visible,
  onToggleVisible,
  resolvedVisible,
  onToggleResolved,
}: KarteProblemListProps) {
  const toggleLabel = visible ? "プロブレムリストを隠す" : "プロブレムリストを表示する";
  const toggleButton = (
    <button
      type="button"
      className="karte-problems__toggle"
      aria-pressed={visible}
      title={toggleLabel}
      aria-label={toggleLabel}
      onClick={onToggleVisible}
    >
      {visible ? "▾" : "▸"}
    </button>
  );

  // 非表示でも見出しと切替ボタンは残す(でないと表示に戻せない)。
  if (!visible) {
    return (
      <div className="karte-problems karte-problems--collapsed">
        {toggleButton}
        <h3 className="karte-problems__title">プロブレム</h3>
        <span className="karte-problems__count">{problems.length}</span>
      </div>
    );
  }

  const resolvedCount = problems.filter((problem) => !isActiveProblem(problem)).length;
  // 解決済みを隠していても、選択中のものはタイムラインの減光の理由が分かるよう残す。
  const shownProblems = problems.filter(
    (problem) => isActiveProblem(problem) || resolvedVisible || problem.id === selectedId,
  );
  const resolvedLabel = resolvedVisible
    ? "解決済みを隠す"
    : `解決済み ${resolvedCount} 件を表示`;

  return (
    <div className="karte-problems">
      {toggleButton}
      <h3 className="karte-problems__title">プロブレム</h3>
      {problems.length === 0 ? (
        <p className="karte-problems__empty">未登録</p>
      ) : (
        <ul className="karte-problems__list">
          {shownProblems.map((problem) => {
            const summary = summarizeCondition(problem);
            const isActive = isActiveProblem(problem);
            const isSelected = selectedId === summary.id;
            return (
              <li key={summary.id}>
                <button
                  type="button"
                  className={[
                    "karte-problems__chip",
                    isSelected ? "karte-problems__chip--selected" : "",
                    isActive ? "" : "karte-problems__chip--inactive",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  aria-pressed={isSelected}
                  title={
                    isSelected
                      ? "強調表示を解除"
                      : `${summary.name} に紐付く診療記録を強調表示`
                  }
                  onClick={() => onSelect(isSelected ? null : summary.id)}
                >
                  {problemLabel(problem)}
                  {!isActive && summary.outcomeDisplay && (
                    <span className="karte-problems__outcome">{summary.outcomeDisplay}</span>
                  )}
                </button>
              </li>
            );
          })}
          {resolvedCount > 0 && (
            <li>
              <button
                type="button"
                className="karte-problems__resolved-toggle"
                aria-pressed={resolvedVisible}
                title={resolvedLabel}
                onClick={onToggleResolved}
              >
                {resolvedLabel}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
