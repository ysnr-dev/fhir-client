import { useMemo, useState } from "react";
import { useUpdateEncounter } from "../api/queries";
import {
  buildLeaveReturnedEncounter,
  validateLeaveReturn,
  type LeaveValues,
} from "../fhir/encounterHelpers";
import { buildLeaveReturnEntries } from "../fhir/mealEncounterSync";
import { firstMealAtOrAfter, mealPointDisplay } from "../fhir/mealOrderHelpers";
import { displayName } from "../fhir/patientHelpers";
import { useMealSyncContext } from "../hooks/useMealSyncContext";
import { dateTimeLabel, nowDateTimeInput } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { MealSyncSummary } from "./MealSyncSummary";
import { Modal } from "./Modal";

// 帰院実施。外出泊の終了日時を、実際に戻った日時で確定する。
// 予定として入れてあった終了日時があれば、それを初期値にする。
// 食事は帰院後に出る最初の食事から元の食事に戻す(食止めオーダーの終了を書き、
// 再開オーダーを作る。帰院予定で既に作ってあれば開始を動かす)。

export function LeaveReturnModal({
  encounter,
  patient,
  leave,
  onClose,
}: {
  encounter: fhir4.Encounter;
  patient?: fhir4.Patient;
  leave: LeaveValues;
  onClose: () => void;
}) {
  const [returnAt, setReturnAt] = useState(leave.end || nowDateTimeInput());
  const [syncMeals, setSyncMeals] = useState(true);
  const [validationError, setValidationError] = useState<string | null>(null);
  const save = useUpdateEncounter();

  const meal = useMealSyncContext(encounter);
  const mealEntries = useMemo(
    () =>
      returnAt && leave.id ? buildLeaveReturnEntries(meal.ctx, { ...leave, end: returnAt }) : [],
    [meal.ctx, leave, returnAt],
  );
  const resume = returnAt ? firstMealAtOrAfter(returnAt, meal.ctx.schedule) : null;

  function handleSubmit() {
    const error = validateLeaveReturn(leave, returnAt);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    save.mutate(
      {
        encounter: buildLeaveReturnedEncounter(encounter, leave.id, returnAt),
        extraEntries: syncMeals ? mealEntries : [],
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal title="帰院実施" onClose={onClose}>
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
            外出泊開始日時
            <input type="text" value={dateTimeLabel(leave.start)} readOnly />
          </label>
          <label>
            帰院日時(必須)
            <input
              type="datetime-local"
              value={returnAt}
              onChange={(e) => setReturnAt(e.target.value)}
            />
          </label>
          {leave.reason && (
            <label className="admission__note">
              外出泊理由
              <textarea rows={2} value={leave.reason} readOnly />
            </label>
          )}
        </div>

        <MealSyncSummary
          title={`食事を ${resume ? mealPointDisplay(resume) : ""}食から元に戻す`}
          entries={mealEntries}
          orders={meal.ctx.orders}
          enabled={syncMeals}
          onToggle={setSyncMeals}
          note={
            leave.id
              ? undefined
              : "この外出泊は食事オーダーと結び付いていない(時刻を付ける前の登録)ため、食事は手で戻してください。"
          }
        />

        <div className="walk-in__actions">
          <button type="button" onClick={handleSubmit} disabled={save.isPending || !meal.ready}>
            {save.isPending ? "登録中..." : "帰院実施"}
          </button>
          <button type="button" onClick={onClose} disabled={save.isPending}>
            キャンセル
          </button>
        </div>
      </div>
    </Modal>
  );
}
