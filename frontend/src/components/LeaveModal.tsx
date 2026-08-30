import { useMemo, useState } from "react";
import { useUpdateEncounter } from "../api/queries";
import {
  buildLeaveAddedEncounter,
  buildLeaveRemovedEncounter,
  encounterLeaves,
  newLeaveId,
  validateLeaveForm,
  type LeaveValues,
} from "../fhir/encounterHelpers";
import {
  buildLeaveCancelEntries,
  buildLeaveStartEntries,
  previewLeaveSync,
} from "../fhir/mealEncounterSync";
import { mealPointDisplay } from "../fhir/mealOrderHelpers";
import { displayName } from "../fhir/patientHelpers";
import { useMealSyncContext } from "../hooks/useMealSyncContext";
import { dateTimeLabel, nowDateTimeInput } from "../lib/dates";
import { makeFieldUpdater } from "../lib/form";
import { ErrorBanner } from "./ErrorBanner";
import { MealSyncSummary } from "./MealSyncSummary";
import { Modal } from "./Modal";

// 外出泊。開始日時・終了日時・理由を入院(Encounter)に書き足す。複数回ぶんを
// 並べて持てるので、登録済みの外出泊も一緒に見せて、間違えたものは外せるようにする。
//
// 食事オーダーは出発までに出た最後の食事で止め、外出泊中は食止めオーダーを出し、
// 帰院後に出る最初の食事から元の食事に戻す(帰院が未定なら帰院実施で戻す)。
// 削除すると食止め・再開オーダーも消えて元の食事に戻る。

export function LeaveModal({
  encounter,
  patient,
  onClose,
}: {
  encounter: fhir4.Encounter;
  patient?: fhir4.Patient;
  onClose: () => void;
}) {
  const [values, setValues] = useState<LeaveValues>(() => ({
    id: newLeaveId(),
    start: nowDateTimeInput(),
    end: "",
    reason: "",
  }));
  const [syncMeals, setSyncMeals] = useState(true);
  const [validationError, setValidationError] = useState<string | null>(null);
  const save = useUpdateEncounter();

  const update = makeFieldUpdater(setValues);
  const leaves = encounterLeaves(encounter);

  const meal = useMealSyncContext(encounter);
  const valid = !validateLeaveForm(values);
  const preview = useMemo(
    () => (valid ? previewLeaveSync(meal.ctx, values) : null),
    [meal.ctx, values, valid],
  );
  const mealEntries = useMemo(
    () => (valid ? buildLeaveStartEntries(meal.ctx, values) : []),
    [meal.ctx, values, valid],
  );

  function handleSubmit() {
    const error = validateLeaveForm(values);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    save.mutate(
      {
        encounter: buildLeaveAddedEncounter(encounter, values),
        extraEntries: syncMeals ? mealEntries : [],
      },
      { onSuccess: onClose },
    );
  }

  function handleRemove(leave: LeaveValues) {
    if (
      !window.confirm(
        `${dateTimeLabel(leave.start)} からの外出泊を削除します(外出泊で止めた食事は元に戻ります)。よろしいですか?`,
      )
    ) {
      return;
    }
    // 親が持つ encounter は再取得まで古いままなので、書いたら閉じて取り直させる。
    save.mutate(
      {
        encounter: buildLeaveRemovedEncounter(encounter, leave.id),
        extraEntries: leave.id ? buildLeaveCancelEntries(meal.ctx, leave.id) : [],
      },
      { onSuccess: onClose },
    );
  }

  const previewNote = preview
    ? [
        preview.fasting
          ? meal.ctx.fastingDiet
            ? `食止め: ${mealPointDisplay(preview.fasting.start)}食〜${preview.fasting.end ? `${mealPointDisplay(preview.fasting.end)}食` : "帰院まで"}`
            : "食止めの食種がマスタに無いため、食止めオーダーは作りません(終了と再開だけ行います)。"
          : "",
        preview.resume ? `復帰: ${mealPointDisplay(preview.resume)}食から` : "",
      ]
        .filter(Boolean)
        .join(" / ")
    : "";

  return (
    <Modal title="外出泊" onClose={onClose}>
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

        {leaves.length > 0 && (
          <ul className="leave-list">
            {leaves.map((leave, index) => (
              <li key={leave.id || `${leave.start}-${index}`}>
                <span>
                  {dateTimeLabel(leave.start)} 〜 {leave.end ? dateTimeLabel(leave.end) : "未定"}
                  {leave.reason && `（${leave.reason}）`}
                </span>
                <button type="button" onClick={() => handleRemove(leave)} disabled={save.isPending}>
                  削除
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="walk-in__fields">
          <label>
            外出泊開始日時(必須)
            <input
              type="datetime-local"
              value={values.start}
              onChange={(e) => update("start", e.target.value)}
            />
          </label>
          <label>
            外出泊終了日時(帰院予定)
            <input
              type="datetime-local"
              value={values.end}
              onChange={(e) => update("end", e.target.value)}
            />
          </label>
          <label className="admission__note">
            外出泊理由
            <textarea
              rows={2}
              value={values.reason}
              onChange={(e) => update("reason", e.target.value)}
            />
          </label>
        </div>

        <MealSyncSummary
          title="食事オーダーを外出泊に合わせる"
          entries={mealEntries}
          orders={meal.ctx.orders}
          enabled={syncMeals}
          onToggle={setSyncMeals}
          note={previewNote}
        />

        <div className="walk-in__actions">
          <button type="button" onClick={handleSubmit} disabled={save.isPending || !meal.ready}>
            {save.isPending ? "登録中..." : "外出泊を登録"}
          </button>
          <button type="button" onClick={onClose} disabled={save.isPending}>
            キャンセル
          </button>
        </div>
      </div>
    </Modal>
  );
}
