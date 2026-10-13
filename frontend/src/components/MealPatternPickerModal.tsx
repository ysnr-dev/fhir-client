import type { MealPattern } from "../api/masterClient";
import { mealFastingReasonDisplay } from "../fhir/mealOrderHelpers";
import { mealCountLabel, mealPatternStepText, mealPatternStepsOf } from "../fhir/mealPatternHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

interface Props {
  patterns: MealPattern[];
  error?: unknown;
  onSelect: (pattern: MealPattern) => void;
  onClose: () => void;
}

// 食事オーダー画面のパターン食の選択。施設のパターンは数件〜十数件なので絞り込みは持たず、
// パターンごとに段階を縦に並べて「何を何食ずつ、最後はどうなるか」が一目で読めるようにする。
// ブロック全体がボタンで、押すとそのパターンを選ぶ。
export function MealPatternPickerModal({ patterns, error, onSelect, onClose }: Props) {
  return (
    <Modal title="パターン食" onClose={onClose} className="modal--wide">
      <ErrorBanner error={error} />
      <div className="meal-pattern-picker">
        {patterns.map((pattern) => {
          const steps = mealPatternStepsOf(pattern);
          return (
            <button
              key={pattern.id}
              type="button"
              className="meal-pattern-picker__item"
              onClick={() => onSelect(pattern)}
            >
              <span className="meal-pattern-picker__name">{pattern.name}</span>
              <span className="meal-pattern-picker__steps">
                {steps.map((step, index) => {
                  const reason = mealFastingReasonDisplay(step.values.fastingReason);
                  return (
                    <span key={index} className="meal-pattern-picker__step">
                      <span className="meal-pattern-picker__index">{index + 1}</span>
                      <span className="meal-pattern-picker__text">
                        {mealPatternStepText(step)}
                        {reason && <span className="meal-pattern-picker__reason">{reason}</span>}
                      </span>
                      <span className="meal-pattern-picker__meals">{mealCountLabel(step.meals)}</span>
                    </span>
                  );
                })}
              </span>
            </button>
          );
        })}
        {patterns.length === 0 && <p className="master-search__empty">パターン食がありません</p>}
      </div>
    </Modal>
  );
}
