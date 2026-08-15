import {
  problemLabel,
  problemParentId,
  problemSucceededByIds,
  summarizeCondition,
} from "../fhir/conditionHelpers";
import type { KarteProblemMode } from "../karteLayout";
import { RowMenu } from "./RowMenu";

// カルテタブの上に常時出すプロブレムリスト(POMR)。
// 番号付きのチップを並べ、選択すると関連する診療記録がタイムラインで強調される
// (ケバブメニューで「関連する記録のみ表示」に切り替えると、そのプロブレムの
// 経過だけを縦に読める)。
// 登録・編集は「病名」タブ側で行う(区分ラジオでプロブレムを選ぶ)。

interface KarteProblemListProps {
  problems: fhir4.Condition[];
  selectedId: string | null;
  onSelect: (conditionId: string | null) => void;
  visible: boolean;
  onToggleVisible: () => void;
  resolvedVisible: boolean;
  onToggleResolved: () => void;
  /** プロブレムを選んだときの見せ方(減光 or 絞り込み)。 */
  mode: KarteProblemMode;
  onChangeMode: (mode: KarteProblemMode) => void;
  /** 実際に絞り込み表示中か。モードが filter でも未選択なら偽。 */
  filterActive: boolean;
}

const MODE_ITEMS: { mode: KarteProblemMode; label: string }[] = [
  { mode: "dim", label: "関連しない記録を減光" },
  { mode: "filter", label: "関連する記録のみ表示" },
];

// 継続(active)以外は解決済み・中止として扱う。
function isActiveProblem(problem: fhir4.Condition): boolean {
  return problem.clinicalStatus?.coding?.[0]?.code === "active";
}

/**
 * 親の直後に下位プロブレムを並べた順序。番号順のままだと親子が離れて読みにくい。
 * 親が一覧に無いもの(削除済みを指している等)は最上位として扱い、参照が輪になって
 * いても一度出したものは出さないので止まる。
 */
function orderByHierarchy(problems: fhir4.Condition[]): fhir4.Condition[] {
  const childrenByParent = new Map<string, fhir4.Condition[]>();
  const ids = new Set(problems.map((p) => p.id ?? ""));
  const roots: fhir4.Condition[] = [];

  for (const problem of problems) {
    const parentId = problemParentId(problem);
    if (parentId && ids.has(parentId)) {
      const siblings = childrenByParent.get(parentId);
      if (siblings) siblings.push(problem);
      else childrenByParent.set(parentId, [problem]);
    } else {
      roots.push(problem);
    }
  }

  const ordered: fhir4.Condition[] = [];
  const seen = new Set<string>();
  function visit(problem: fhir4.Condition) {
    const id = problem.id ?? "";
    if (seen.has(id)) return;
    seen.add(id);
    ordered.push(problem);
    for (const child of childrenByParent.get(id) ?? []) visit(child);
  }
  roots.forEach(visit);
  // 輪になっていて根から辿れなかったものも、落とさずに末尾へ出す。
  problems.forEach(visit);
  return ordered;
}

export function KarteProblemList({
  problems,
  selectedId,
  onSelect,
  visible,
  onToggleVisible,
  resolvedVisible,
  onToggleResolved,
  mode,
  onChangeMode,
  filterActive,
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

  // 表示の切り替えは帯の行を増やさないようケバブに畳む。リストを畳んでいるときも
  // 出しておく(絞り込み中に解除できなくならないように)。
  const modeMenu = (
    <div className="karte-problems__menu">
      {/* チップの一覧がスクロール領域なので、メニューは領域の外へはみ出させる。 */}
      <RowMenu label="プロブレムの表示設定" escapesClipping>
        {MODE_ITEMS.map((item) => (
          <button
            key={item.mode}
            type="button"
            className="row-menu__item"
            role="menuitemradio"
            aria-checked={mode === item.mode}
            onClick={() => onChangeMode(item.mode)}
          >
            {mode === item.mode ? "✓ " : "　"}
            {item.label}
          </button>
        ))}
      </RowMenu>
    </div>
  );

  const className = `karte-problems${filterActive ? " karte-problems--filtering" : ""}`;

  // 非表示でも見出しと切替ボタンは残す(でないと表示に戻せない)。
  if (!visible) {
    return (
      <div className={`${className} karte-problems--collapsed`}>
        {toggleButton}
        <h3 className="karte-problems__title">プロブレム</h3>
        <span className="karte-problems__count">{problems.length}</span>
        {modeMenu}
      </div>
    );
  }

  // 下位プロブレムは親の直後に寄せる(番号順のままだと親子が離れて読みにくい)。
  const ordered = orderByHierarchy(problems);
  const numbersById = new Map(problems.map((p) => [p.id ?? "", problemLabel(p)]));

  const resolvedCount = problems.filter((problem) => !isActiveProblem(problem)).length;
  // 解決済みを隠していても、選択中のものはタイムラインの減光・絞り込みの理由が
  // 分かるよう残す。
  const shownProblems = ordered.filter(
    (problem) => isActiveProblem(problem) || resolvedVisible || problem.id === selectedId,
  );
  const resolvedLabel = resolvedVisible
    ? "解決済みを隠す"
    : `解決済み ${resolvedCount} 件を表示`;
  // 絞り込み中はモードの設定にかかわらず、チップの選択も絞り込みの切り替えになる
  // (URL で開いた状態と操作の意味が食い違わないようにする)。
  const selectsFilter = filterActive || mode === "filter";

  return (
    <div className={className}>
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
            // 下位プロブレムは 1 段下げ、引き継がれたものは行き先を併記する。
            const isChild = Boolean(problemParentId(problem) && numbersById.has(problemParentId(problem) ?? ""));
            const successors = problemSucceededByIds(problem)
              .map((id) => numbersById.get(id))
              .filter(Boolean);
            return (
              <li key={summary.id}>
                <button
                  type="button"
                  className={[
                    "karte-problems__chip",
                    isSelected ? "karte-problems__chip--selected" : "",
                    isActive ? "" : "karte-problems__chip--inactive",
                    isChild ? "karte-problems__chip--child" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  aria-pressed={isSelected}
                  title={
                    isSelected
                      ? selectsFilter
                        ? "絞り込みを解除"
                        : "強調表示を解除"
                      : selectsFilter
                        ? `${summary.name} に紐付く診療情報だけを表示`
                        : `${summary.name} に紐付く診療記録を強調表示`
                  }
                  onClick={() => onSelect(isSelected ? null : summary.id)}
                >
                  {isChild && <span className="karte-problems__child-mark">└</span>}
                  {problemLabel(problem)}
                  {successors.length > 0 ? (
                    <span className="karte-problems__outcome">→ {successors.join(", ")}</span>
                  ) : (
                    !isActive &&
                    summary.outcomeDisplay && (
                      <span className="karte-problems__outcome">{summary.outcomeDisplay}</span>
                    )
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
      {modeMenu}
    </div>
  );
}
