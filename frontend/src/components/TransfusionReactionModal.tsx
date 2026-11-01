import { useMemo, useState, type FormEvent } from "react";
import { useAddTransfusionReaction, useTransfusionPerformDetail } from "../api/queries";
import { splitPerformBundle } from "../fhir/radResultHelpers";
import {
  REACTION_SYMPTOM_OPTIONS,
  buildDelayedReactionObservation,
  transfusionHubOf,
  type DelayedReactionValues,
} from "../fhir/transfusionResultHelpers";
import { nowDateTimeInput } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// 実施済みの輸血への副作用の追記(遅発性副作用。輸血後 24 時間以降〜数日で出るもの)。
// 実施記録は「実施取消 → 実施」でしか直せないが、副作用だけは後から分かるので、
// 実施記録のハブに副作用の Observation を 1 件足す(ガイド 7.5.3-3 ③)。

interface Props {
  orderId: string;
  patientName?: string;
  onClose: () => void;
}

export function TransfusionReactionModal({ orderId, patientName, onClose }: Props) {
  const perform = useTransfusionPerformDetail(orderId);
  const hub = useMemo(
    () => transfusionHubOf(splitPerformBundle(perform.data?.data).procedures, orderId),
    [perform.data, orderId],
  );
  const add = useAddTransfusionReaction();
  const [values, setValues] = useState<DelayedReactionValues>({
    onsetAt: nowDateTimeInput(),
    symptoms: [],
    note: "",
  });
  const [validationError, setValidationError] = useState<string | null>(null);

  function toggleSymptom(code: string) {
    setValues((prev) => ({
      ...prev,
      symptoms: prev.symptoms.includes(code)
        ? prev.symptoms.filter((c) => c !== code)
        : [...prev.symptoms, code],
    }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!hub) return;
    if (!values.onsetAt) {
      setValidationError("発症日時を入れてください。");
      return;
    }
    if (values.symptoms.length === 0 && !values.note.trim()) {
      setValidationError("症状を選ぶか内容を入れてください。");
      return;
    }
    setValidationError(null);
    add.mutate(buildDelayedReactionObservation(values, hub), { onSuccess: onClose });
  }

  return (
    <Modal
      title={`輸血副作用の追記${patientName ? ` - ${patientName}` : ""}`}
      onClose={onClose}
      className="modal--wide"
    >
      {perform.isLoading ? (
        <p>読み込み中...</p>
      ) : !hub ? (
        <p className="patient-table__empty">実施記録がありません。</p>
      ) : (
        <form className="transfusion-perform" onSubmit={handleSubmit}>
          {validationError && (
            <div className="error-banner" role="alert">
              <p className="error-banner__line error-banner__line--error">{validationError}</p>
            </div>
          )}
          <ErrorBanner error={add.error} />
          <div className="lab-order-item__fields">
            <label>
              発症日時 *
              <input
                type="datetime-local"
                value={values.onsetAt}
                onChange={(e) => setValues((prev) => ({ ...prev, onsetAt: e.target.value }))}
                required
              />
            </label>
          </div>
          <div className="transfusion-perform__symptoms" role="group" aria-label="症状">
            {REACTION_SYMPTOM_OPTIONS.map((option) => {
              const selected = values.symptoms.includes(option.code);
              return (
                <button
                  key={option.code}
                  type="button"
                  aria-pressed={selected}
                  className={`transfusion-chip transfusion-chip--symptom${
                    selected ? " transfusion-chip--selected transfusion-chip--reaction-present" : ""
                  }`}
                  onClick={() => toggleSymptom(option.code)}
                >
                  {option.display}
                </button>
              );
            })}
          </div>
          <div className="lab-order-item__fields">
            <label className="transfusion-perform__reaction-note">
              内容
              <input
                type="text"
                value={values.note}
                onChange={(e) => setValues((prev) => ({ ...prev, note: e.target.value }))}
              />
            </label>
          </div>
          <div className="lab-order-item__actions">
            <button type="submit" disabled={add.isPending}>
              {add.isPending ? "保存中..." : "登録"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
