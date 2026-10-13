import type { MealPattern } from "../api/masterClient";
import { mealPatternStepsOf, mealPatternStepsSummary } from "../fhir/mealPatternHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

interface Props {
  patterns: MealPattern[];
  error?: unknown;
  onSelect: (pattern: MealPattern) => void;
  onClose: () => void;
}

// 食事オーダー画面のパターン食の選択。施設のパターンは数件〜十数件なので絞り込みは持たない。
export function MealPatternPickerModal({ patterns, error, onSelect, onClose }: Props) {
  return (
    <Modal title="パターン食" onClose={onClose} className="modal--wide">
      <ErrorBanner error={error} />
      <table className="master-search__table">
        <thead>
          <tr>
            <th>名称</th>
            <th>内容</th>
          </tr>
        </thead>
        <tbody>
          {patterns.map((pattern) => (
            <tr key={pattern.id} className="master-search__row" onClick={() => onSelect(pattern)}>
              <td>{pattern.name}</td>
              <td>{mealPatternStepsSummary(mealPatternStepsOf(pattern))}</td>
            </tr>
          ))}
          {patterns.length === 0 && (
            <tr>
              <td colSpan={2} className="master-search__empty">
                パターン食がありません
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Modal>
  );
}
