import { useState, type FormEvent } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import { usePractitionerOptions, useSaveMealIntake } from "../api/queries";
import {
  MEAL_INTAKE_ROWS,
  MEAL_INTAKE_STEPS,
  buildMealIntakeBundle,
  mealIntakeSlotLabel,
  type MealIntakeInput,
  type MealIntakeKind,
  type MealIntakeSlot,
} from "../fhir/flowsheetMealHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

interface Props {
  slot: MealIntakeSlot;
  /** その食事の既存の記録(％)。 */
  recorded: Partial<Record<MealIntakeKind, { percent: number; observationId: string }>>;
  subject: fhir4.Reference;
  encounter?: fhir4.Reference;
  onSaved: () => void;
  onClose: () => void;
}

// 食事摂取量の入力。1 食ぶんの主食・副食だけを出す(経過表で押した食事のものだけ。
// 看護の実施入力を経過表から開くときと同じ絞り方)。
//
// 入力は 0〜10 割で、保存は％に直す(fhir/flowsheetMealHelpers.ts)。空にすると
// 記録を消す。0 割は「摂取なし」という記録なので、空とは別。
export function MealIntakeModal({ slot, recorded, subject, encounter, onSaved, onClose }: Props) {
  const save = useSaveMealIntake();
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const { practitioners, error: practitionersError } = usePractitionerOptions();

  const [values, setValues] = useState<MealIntakeInput>(() => ({
    staple: recorded.staple ? String(recorded.staple.percent / 10) : "",
    side: recorded.side ? String(recorded.side.percent / 10) : "",
  }));
  const [performerId, setPerformerId] = useState(practitionerId ?? "");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const selected = practitioners.find((p) => p.id === performerId);
    const bundle = buildMealIntakeBundle({
      slot,
      input: values,
      existing: {
        staple: recorded.staple?.observationId,
        side: recorded.side?.observationId,
      },
      subject,
      encounter,
      performer: performerId
        ? {
            id: performerId,
            name: selected
              ? practitionerDisplayName(selected)
              : practitioner
                ? practitionerDisplayName(practitioner)
                : "",
          }
        : null,
    });
    if ((bundle.entry ?? []).length === 0) {
      onClose();
      return;
    }
    save.mutate(bundle, { onSuccess: onSaved });
  }

  return (
    <Modal title={`食事摂取量（${mealIntakeSlotLabel(slot)}）`} onClose={onClose}>
      <form className="meal-intake" onSubmit={handleSubmit}>
        {MEAL_INTAKE_ROWS.map((row) => (
          <label key={row.kind}>
            <span className="meal-intake__label">{row.label}</span>
            <span className="meal-intake__steps">
              {MEAL_INTAKE_STEPS.map((step) => (
                <button
                  key={step}
                  type="button"
                  className={
                    values[row.kind] === step
                      ? "meal-intake__step meal-intake__step--on"
                      : "meal-intake__step"
                  }
                  onClick={() =>
                    setValues((prev) => ({
                      ...prev,
                      // 押し直しで解除(= 記録を消す)。
                      [row.kind]: prev[row.kind] === step ? "" : step,
                    }))
                  }
                >
                  {step}
                </button>
              ))}
              <span className="meal-intake__unit">割</span>
            </span>
          </label>
        ))}

        <label>
          <span className="meal-intake__label">記録者</span>
          <select value={performerId} onChange={(e) => setPerformerId(e.target.value)}>
            <option value="">（未選択）</option>
            {practitioners.map((p) => (
              <option key={p.id} value={p.id}>
                {practitionerDisplayName(p)}
              </option>
            ))}
          </select>
        </label>

        <div className="prescription-form__actions">
          <button type="submit" disabled={save.isPending}>
            {save.isPending ? "保存中..." : "記録"}
          </button>
          <button type="button" onClick={onClose} disabled={save.isPending}>
            キャンセル
          </button>
        </div>
        <ErrorBanner error={practitionersError} />
        <ErrorBanner error={save.error} />
      </form>
    </Modal>
  );
}
