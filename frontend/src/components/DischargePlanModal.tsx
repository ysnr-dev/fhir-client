import { useMemo, useState } from "react";
import { useUpdateEncounter } from "../api/queries";
import {
  buildDischargePlanEncounter,
  encounterAdmissionDate,
  encounterDischargePlan,
  validateDischargePlan,
} from "../fhir/encounterHelpers";
import {
  buildDischargeRestoreEntries,
  buildDischargeSyncEntries,
  dischargeStopPoint,
} from "../fhir/mealEncounterSync";
import { mealPointDisplay } from "../fhir/mealOrderHelpers";
import { displayName } from "../fhir/patientHelpers";
import { useMealSyncContext } from "../hooks/useMealSyncContext";
import { nowDateTimeInput, toDateTimeInputValue } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { MealSyncSummary } from "./MealSyncSummary";
import { Modal } from "./Modal";

// 退院予定。退院(DischargeModal)とは別で、予定日時と理由を入院(Encounter)に
// メモする。予定は 1 件だけで、登録し直すと置き換わる。
//
// 食事オーダーは予定の時点で止める(退院予定日時までに出た最後の食事まで)。予定を
// 動かせば終了も追随し、取り消せば元の食事に戻る。退院を実施すると理由が「退院」に変わる。

export function DischargePlanModal({
  encounter,
  patient,
  onClose,
}: {
  encounter: fhir4.Encounter;
  patient?: fhir4.Patient;
  onClose: () => void;
}) {
  const existing = encounterDischargePlan(encounter);
  const [at, setAt] = useState(existing?.at ? toDateTimeInputValue(existing.at) : nowDateTimeInput());
  const [reason, setReason] = useState(existing?.reason ?? "");
  const [syncMeals, setSyncMeals] = useState(true);
  const [validationError, setValidationError] = useState<string | null>(null);
  const save = useUpdateEncounter();

  const meal = useMealSyncContext(encounter);
  const mealEntries = useMemo(
    () => (at ? buildDischargeSyncEntries(meal.ctx, at, "discharge-plan") : []),
    [meal.ctx, at],
  );
  const stopPoint = at ? dischargeStopPoint(meal.ctx, at) : null;

  function handleSubmit() {
    const plan = { at, reason };
    const error = validateDischargePlan(encounter, plan);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    save.mutate(
      {
        encounter: buildDischargePlanEncounter(encounter, plan),
        extraEntries: syncMeals ? mealEntries : [],
      },
      { onSuccess: onClose },
    );
  }

  function handleClear() {
    if (!window.confirm("退院予定を取り消します(退院予定で止めた食事は元に戻ります)。よろしいですか?")) {
      return;
    }
    save.mutate(
      {
        encounter: buildDischargePlanEncounter(encounter, null),
        extraEntries: buildDischargeRestoreEntries(meal.ctx, ["discharge-plan"]),
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal title="退院予定" onClose={onClose}>
      <ErrorBanner error={save.error} />
      <ErrorBanner error={meal.error} />
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}

      <div className="walk-in">
        <div className="walk-in__patient">
          <span>{patient ? displayName(patient) : "(患者不明)"}</span>
        </div>

        <div className="walk-in__fields">
          <label>
            入院日
            <input type="text" value={encounterAdmissionDate(encounter)} readOnly />
          </label>
          <label>
            退院予定日時(必須)
            <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
          </label>
          <label className="admission__note">
            退院理由
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        </div>

        <MealSyncSummary
          title={`食事オーダーを ${stopPoint ? mealPointDisplay(stopPoint) : ""}食までで止める(退院食止め)`}
          entries={mealEntries}
          orders={meal.ctx.orders}
          enabled={syncMeals}
          onToggle={setSyncMeals}
        />

        <div className="walk-in__actions">
          <button type="button" onClick={handleSubmit} disabled={save.isPending || !meal.ready}>
            {save.isPending ? "登録中..." : existing ? "予定を更新" : "予定を登録"}
          </button>
          {existing && (
            <button type="button" onClick={handleClear} disabled={save.isPending || !meal.ready}>
              予定を取消
            </button>
          )}
          <button type="button" onClick={onClose} disabled={save.isPending}>
            キャンセル
          </button>
        </div>
      </div>
    </Modal>
  );
}
