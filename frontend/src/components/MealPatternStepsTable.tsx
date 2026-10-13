import {
  mealPatternSpanLabel,
  mealPatternStepText,
  type MealPatternSpan,
  type MealPatternStep,
} from "../fhir/mealPatternHelpers";
import { TrashIcon } from "./icons/TrashIcon";

interface Props {
  steps: MealPatternStep[];
  /** 開始日が決まっているとき(オーダー登録)に、段階ごとの期間を出す。 */
  spans?: MealPatternSpan[];
  onChange: (steps: MealPatternStep[]) => void;
  /** 渡したときだけ「編集」ボタンを出す(マスタの編集)。 */
  onEdit?: (index: number) => void;
}

/**
 * パターン食の段階の表。マスタの編集とオーダー登録の両方で使い、食数と削除はどちらでも直せる。
 * 段階の中身(食種・主食)を直せるのはマスタ側だけ。食数を空にすると「継続」。
 */
export function MealPatternStepsTable({ steps, spans, onChange, onEdit }: Props) {
  function updateMeals(index: number, raw: string) {
    const meals = raw.trim() === "" ? null : Number(raw);
    onChange(steps.map((step, i) => (i === index ? { ...step, meals } : step)));
  }

  return (
    <table className="insulin-scale__table meal-pattern-steps">
      <thead>
        <tr>
          <th className="meal-pattern-steps__index">段階</th>
          <th>内容</th>
          <th>食数</th>
          {spans && <th>期間</th>}
          <th></th>
        </tr>
      </thead>
      <tbody>
        {steps.map((step, index) => {
          const span = spans?.[index];
          return (
            <tr key={index}>
              <td className="meal-pattern-steps__index">{index + 1}</td>
              <td>{mealPatternStepText(step)}</td>
              <td>
                <input
                  type="number"
                  min="1"
                  step="1"
                  className="meal-pattern-steps__meals"
                  aria-label={`${index + 1} 段階目の食数`}
                  value={step.meals ?? ""}
                  placeholder="継続"
                  onChange={(e) => updateMeals(index, e.target.value)}
                />
              </td>
              {spans && <td className="meal-pattern-steps__span">{span ? mealPatternSpanLabel(span) : ""}</td>}
              <td className="meal-pattern-steps__actions">
                {onEdit && (
                  <button type="button" className="rp-card__compact-button" onClick={() => onEdit(index)}>
                    編集
                  </button>
                )}
                <button
                  type="button"
                  className="rp-card__icon-button"
                  title="段階を削除"
                  aria-label="段階を削除"
                  onClick={() => onChange(steps.filter((_, i) => i !== index))}
                >
                  <TrashIcon />
                </button>
              </td>
            </tr>
          );
        })}
        {steps.length === 0 && (
          <tr>
            <td colSpan={spans ? 5 : 4} className="master-search__empty">
              段階がありません
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
