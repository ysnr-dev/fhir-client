import { useState } from "react";
import { emptyMealOrderForm, type MealOrderFormValues } from "../fhir/mealOrderHelpers";
import {
  formValuesOfStep,
  stepValuesFromForm,
  type MealPatternStep,
} from "../fhir/mealPatternHelpers";
import { MealOrderForm } from "./MealOrderForm";
import { Modal } from "./Modal";

interface Props {
  /** 直す段階。null なら新しい段階。 */
  step: MealPatternStep | null;
  onSave: (step: MealPatternStep) => void;
  onClose: () => void;
}

/**
 * パターン食の段階の編集。食事内容は食事オーダーのフォームをそのまま使う(食種選択・主食・
 * 副食形態・塩分制限・欠食理由)。期間は段階に持たせないので隠し、代わりに食数をフォームの
 * 外に置く(フォームの submit で両方を拾う)。
 */
export function MealPatternStepModal({ step, onSave, onClose }: Props) {
  const [meals, setMeals] = useState(step?.meals === null || step === null ? "" : String(step.meals));
  const [mealsError, setMealsError] = useState("");

  const initialValues: MealOrderFormValues = step
    ? formValuesOfStep(step.values)
    : emptyMealOrderForm();

  function handleSubmit(values: MealOrderFormValues) {
    const count = meals.trim() === "" ? null : Number(meals);
    if (count !== null && (!Number.isInteger(count) || count < 1)) {
      setMealsError("食数は 1 以上の整数で入れてください。");
      return;
    }
    setMealsError("");
    onSave({ meals: count, values: stepValuesFromForm(values) });
  }

  return (
    <Modal title={step ? "段階を編集" : "段階を追加"} onClose={onClose} className="modal--wide">
      {mealsError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{mealsError}</p>
        </div>
      )}
      <div className="prescription-form">
        <fieldset>
          <legend>段階</legend>
          <label>
            食数
            <input
              type="number"
              min="1"
              step="1"
              value={meals}
              placeholder="空欄なら継続"
              onChange={(e) => setMeals(e.target.value)}
            />
          </label>
        </fieldset>
      </div>
      <MealOrderForm
        patientId=""
        initialValues={initialValues}
        onSubmit={handleSubmit}
        submitting={false}
        submitLabel="確定"
        setMode
        hidePeriod
      />
    </Modal>
  );
}
