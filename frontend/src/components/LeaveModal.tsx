import { useState } from "react";
import { useUpdateEncounter } from "../api/queries";
import {
  buildLeaveAddedEncounter,
  buildLeaveRemovedEncounter,
  encounterLeaves,
  validateLeaveForm,
  type LeaveValues,
} from "../fhir/encounterHelpers";
import { displayName } from "../fhir/patientHelpers";
import { today } from "../lib/dates";
import { makeFieldUpdater } from "../lib/form";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// 外出泊。開始日・終了日・理由を入院(Encounter)に書き足す。複数回ぶんを
// 並べて持てるので、登録済みの外出泊も一緒に見せて、間違えたものは外せるようにする。

export function LeaveModal({
  encounter,
  patient,
  onClose,
}: {
  encounter: fhir4.Encounter;
  patient?: fhir4.Patient;
  onClose: () => void;
}) {
  const [values, setValues] = useState<LeaveValues>({ start: today(), end: "", reason: "" });
  const [validationError, setValidationError] = useState<string | null>(null);
  const save = useUpdateEncounter();

  const update = makeFieldUpdater(setValues);
  const leaves = encounterLeaves(encounter);

  function handleSubmit() {
    const error = validateLeaveForm(values);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    save.mutate(buildLeaveAddedEncounter(encounter, values), { onSuccess: onClose });
  }

  function handleRemove(index: number) {
    const leave = leaves[index];
    if (!window.confirm(`${leave.start} からの外出泊を削除します。よろしいですか?`)) return;
    // 親が持つ encounter は再取得まで古いままなので、書いたら閉じて取り直させる。
    save.mutate(buildLeaveRemovedEncounter(encounter, index), { onSuccess: onClose });
  }

  return (
    <Modal title="外出泊" onClose={onClose}>
      <ErrorBanner error={save.error} />
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
              <li key={`${leave.start}-${index}`}>
                <span>
                  {leave.start} 〜 {leave.end || "未定"}
                  {leave.reason && `（${leave.reason}）`}
                </span>
                <button type="button" onClick={() => handleRemove(index)} disabled={save.isPending}>
                  削除
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="walk-in__fields">
          <label>
            外出泊開始日(必須)
            <input
              type="date"
              value={values.start}
              onChange={(e) => update("start", e.target.value)}
            />
          </label>
          <label>
            外出泊終了日
            <input
              type="date"
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

        <div className="walk-in__actions">
          <button type="button" onClick={handleSubmit} disabled={save.isPending}>
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
