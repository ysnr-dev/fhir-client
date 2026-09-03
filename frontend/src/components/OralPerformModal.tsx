import { useMemo, useState, type FormEvent } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import { useRegisterOralPerform } from "../api/queries";
import {
  OUTCOME_OPTIONS,
  buildOralPerformBundle,
  emptyOralPerformForm,
  validateOralPerformForm,
  type OralPerformFormValues,
  type OralPerformOutcome,
} from "../fhir/oralPerformHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { groupByRp } from "../fhir/prescriptionHelpers";
import { isOralUsage } from "../fhir/medicationScheduleHelpers";
import { flowsheetTimeLabel } from "../fhir/flowsheetInjectionHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

interface Props {
  /** 与薬する処方。 */
  order: fhir4.ServiceRequest;
  /** その処方の薬剤(RP ごと)。 */
  medicationRequests: fhir4.MedicationRequest[];
  /** どの予定枠の与薬か "YYYY-MM-DDTHH:mm"。 */
  slotAt: string;
  onClose: () => void;
}

// 内服の与薬入力。**押した予定枠 1 つ**を記録する(経過表で押した枠のものだけ。
// 看護の実施入力を経過表から開くときと同じ絞り方)。
//
// 注射の実施入力との違い:
// - 結果は 与薬 / 与薬せず の 2 つ(内服に「途中で中止」は無い)
// - 与薬量は変えられない(内服は 1 回量が決まっており、量を刻む運用が無い)。
//   一部の薬だけ飲ませなかったときは行のチェックを外す
// - 時刻の既定は**予定枠の時刻**(注射は「今」)。配薬は枠に沿うので、ずれたら手で直す
export function OralPerformModal({ order, medicationRequests, slotAt, onClose }: Props) {
  const register = useRegisterOralPerform();
  const { practitionerId, practitioner } = useCurrentPractitioner();

  const [values, setValues] = useState<OralPerformFormValues>(() =>
    emptyOralPerformForm(medicationRequests, slotAt),
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  // 用法を見出しに出すために RP を引き直す(内服の RP だけ)。
  const rps = useMemo(
    () => groupByRp(medicationRequests).filter((rp) => isOralUsage(rp.usageCode)),
    [medicationRequests],
  );

  function update<K extends keyof OralPerformFormValues>(
    key: K,
    value: OralPerformFormValues[K],
  ) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function toggleSkipped(index: number) {
    setValues((prev) => ({
      ...prev,
      medicines: prev.medicines.map((line, i) =>
        i === index ? { ...line, skipped: !line.skipped } : line,
      ),
    }));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const error = validateOralPerformForm(values);
    setValidationError(error);
    if (error) return;

    register.mutate(
      buildOralPerformBundle(
        {
          ...values,
          performerId: practitionerId ?? "",
          performerName: practitioner ? practitionerDisplayName(practitioner) : "",
        },
        order,
        medicationRequests,
        slotAt,
      ),
      { onSuccess: onClose },
    );
  }

  return (
    <Modal title={`与薬（${flowsheetTimeLabel(slotAt)}）`} onClose={onClose} className="modal--wide">
      <form className="transfusion-perform" onSubmit={handleSubmit}>
        {validationError && (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">{validationError}</p>
          </div>
        )}
        <ErrorBanner error={register.error} />

        <div className="lab-order-item__fields">
          <label>
            与薬した時刻 *
            <input
              type="datetime-local"
              value={values.performedAt}
              onChange={(e) => update("performedAt", e.target.value)}
              required
            />
          </label>
          <label>
            実施者
            <input
              type="text"
              value={practitioner ? practitionerDisplayName(practitioner) : "(未設定)"}
              readOnly
              disabled
            />
          </label>
        </div>

        <section className="lab-order-item__section">
          <div className="lab-order-item__section-head">
            <h3>結果 *</h3>
          </div>
          <div className="transfusion-order__chips" role="group" aria-label="与薬の結果">
            {OUTCOME_OPTIONS.map((option) => {
              const selected = values.outcome === option.code;
              return (
                <button
                  key={option.code}
                  type="button"
                  aria-pressed={selected}
                  className={`transfusion-chip${selected ? " transfusion-chip--selected" : ""}`}
                  onClick={() => update("outcome", option.code as OralPerformOutcome)}
                >
                  {option.display}
                </button>
              );
            })}
          </div>
          {values.outcome !== "completed" && (
            <label className="transfusion-perform__reaction-note">
              理由 *
              <input
                type="text"
                value={values.reason}
                onChange={(e) => update("reason", e.target.value)}
                placeholder="患者拒否・絶食・検査 など"
              />
            </label>
          )}
        </section>

        {values.outcome !== "not-done" &&
          rps.map((rp) => (
            <section className="lab-order-item__section" key={rp.rpNumber}>
              <div className="lab-order-item__section-head">
                <h3>{`RP${rp.rpNumber}`}</h3>
                <span className="order-select__muted">{rp.usageName ?? ""}</span>
              </div>
              <table className="rp-card__medicines rp-card__medicines--detail">
                <thead>
                  <tr>
                    <th>医薬品</th>
                    <th>用量</th>
                    <th>単位</th>
                    <th>与薬</th>
                  </tr>
                </thead>
                <tbody>
                  {values.medicines.map((line, index) =>
                    line.rpNumber !== rp.rpNumber ? null : (
                      <tr key={index} className={line.skipped ? "karte-card--dimmed" : undefined}>
                        <td>{line.name}</td>
                        <td>{line.dose ?? "-"}</td>
                        <td>{line.unit}</td>
                        <td>
                          <input
                            type="checkbox"
                            checked={!line.skipped}
                            onChange={() => toggleSkipped(index)}
                            aria-label={`${line.name} を与薬`}
                          />
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </section>
          ))}

        <div className="lab-order-item__fields">
          <label className="transfusion-perform__comment">
            コメント
            <textarea
              value={values.comment}
              onChange={(e) => update("comment", e.target.value)}
              rows={2}
            />
          </label>
        </div>

        <div className="lab-order-item__actions">
          <button type="submit" disabled={register.isPending}>
            {register.isPending ? "保存中..." : "与薬を登録"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
