import type { BodyMeasureSummary } from "../fhir/bodyMeasureHelpers";
import {
  MEAL_TARGET_COMPARISON_LABELS,
  type MealTargetComparison,
  type MealNutritionTarget,
} from "../fhir/mealNutritionTarget";
import { InfoIcon } from "./icons/InfoIcon";

/**
 * 患者の身長・体重・BMI と栄養量の目安を 1 行で出す。食種の主成分量と見比べるための行で、
 * 食事オーダーの食種欄と食種選択の表の上に置く。体重は測り直すものなので測定日を添える。
 */
export function MealNutritionTargetLine({
  body,
  target,
}: {
  body: BodyMeasureSummary;
  target: MealNutritionTarget | null;
}) {
  return (
    <div className="meal-nutrition-target" role="note">
      <span className="meal-nutrition-target__icon">
        <InfoIcon />
      </span>
      {!body.height && !body.weight ? (
        <div className="meal-nutrition-target__row">身長・体重 未測定</div>
      ) : (
        <div className="meal-nutrition-target__rows">
          <dl className="meal-nutrition-target__row">
            {body.height && <Item label="身長" value={`${body.height.value}cm`} />}
            {body.weight && (
              <Item
                label="体重"
                value={`${body.weight.value}kg`}
                note={body.weight.date}
              />
            )}
            {body.bmi !== null && <Item label="BMI" value={String(body.bmi)} />}
            {target && <Item label="標準体重" value={`${target.standardWeight}kg`} />}
          </dl>
          {target && (
            <dl className="meal-nutrition-target__row">
              <Item label="目安 熱量" value={`${target.energy[0]}〜${target.energy[1]}kcal`} />
              <Item label="蛋白質" value={`${target.protein[0]}〜${target.protein[1]}g`} />
            </dl>
          )}
        </div>
      )}
    </div>
  );
}

function Item({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="meal-nutrition-target__item">
      <dt>{label}</dt>
      <dd>
        {value}
        {note && <small>({note})</small>}
      </dd>
    </div>
  );
}

/** 食種の値が目安を外れているときの印。外れていなければ何も出さない。 */
export function MealTargetBadge({ comparison }: { comparison: MealTargetComparison }) {
  if (!comparison) return null;
  return <span className="dose-conversion__badge">{MEAL_TARGET_COMPARISON_LABELS[comparison]}</span>;
}
