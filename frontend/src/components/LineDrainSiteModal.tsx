import { useState } from "react";
import { useDeleteLineDrainSiteObservation, useOrderEnterer, useSaveLineDrainSiteObservation } from "../api/queries";
import {
  buildSiteObservation,
  DRESSING_KEY,
  emptySiteForm,
  lineDrainLabel,
  siteFindingItemsFor,
  validateSiteObservation,
  type LineDrainRecord,
  type LineDrainSiteFormValues,
} from "../fhir/lineDrainHelpers";
import { dateTimeLabel, nowDateTimeInput } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { TrashIcon } from "./icons/TrashIcon";
import { Modal } from "./Modal";

/**
 * 刺入部観察(docs/line-drain-design.md §4.3)。上に観察の履歴(列 = 日時、行 = 項目)、下に入力。
 * 1 回の観察 = 1 Observation(component に項目)で、留置の Procedure を partOf で指す。
 */
export function LineDrainSiteModal({
  patientId,
  record,
  onClose,
}: {
  patientId: string;
  record: LineDrainRecord;
  onClose: () => void;
}) {
  const save = useSaveLineDrainSiteObservation();
  const remove = useDeleteLineDrainSiteObservation();
  const enterer = useOrderEnterer();
  const [values, setValues] = useState<LineDrainSiteFormValues>(() => ({
    ...emptySiteForm(nowDateTimeInput()),
    performerId: enterer?.practitionerId ?? "",
    performerName: enterer?.display ?? "",
  }));
  const [validationError, setValidationError] = useState<string | null>(null);
  const items = siteFindingItemsFor(record.kind);
  const history = record.observations;

  function handleSubmit() {
    const message = validateSiteObservation(values);
    setValidationError(message);
    if (message) return;
    save.mutate(buildSiteObservation(values, record, patientId), {
      onSuccess: () => setValues((prev) => ({ ...emptySiteForm(nowDateTimeInput()), performerId: prev.performerId, performerName: prev.performerName })),
    });
  }

  function handleDelete(id: string) {
    if (!window.confirm("この観察を削除しますか？")) return;
    remove.mutate(id);
  }

  return (
    <Modal title={`刺入部観察 - ${lineDrainLabel(record)}`} onClose={onClose} className="modal--wide">
      <ErrorBanner error={save.error} />
      <ErrorBanner error={remove.error} />
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}

      {history.length > 0 && (
        <div className="lab-worklist-wrap line-drain-site__history">
          <table className="lab-worklist">
            <thead>
              <tr>
                <th></th>
                {history.map((o) => (
                  <th key={o.id} className="lab-worklist__compact">
                    <span>{dateTimeLabel(o.effectiveAt)}</span>
                    <button
                      type="button"
                      className="rp-card__icon-button"
                      title="観察を削除"
                      aria-label="観察を削除"
                      onClick={() => handleDelete(o.id)}
                      disabled={remove.isPending}
                    >
                      <TrashIcon />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.key}>
                  <th className="nursing-acuity-report__label">{item.label}</th>
                  {history.map((o) => (
                    <td key={o.id}>{item.options.find((opt) => opt.code === o.findings[item.key])?.display ?? ""}</td>
                  ))}
                </tr>
              ))}
              <tr>
                <th className="nursing-acuity-report__label">ドレッシング交換</th>
                {history.map((o) => (
                  <td key={o.id}>{o.dressing ? "○" : ""}</td>
                ))}
              </tr>
              <tr>
                <th className="nursing-acuity-report__label">所見・処置</th>
                {history.map((o) => (
                  <td key={o.id}>{o.note}</td>
                ))}
              </tr>
              <tr>
                <th className="nursing-acuity-report__label">観察者</th>
                {history.map((o) => (
                  <td key={o.id}>{o.performer?.display ?? ""}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="walk-in">
        <div className="walk-in__fields">
          <label>
            観察日時
            <input
              type="datetime-local"
              value={values.effectiveAt}
              onChange={(e) => setValues({ ...values, effectiveAt: e.target.value })}
            />
          </label>
          {items.map((item) => (
            <label key={item.key}>
              {item.label}
              <select
                value={values.findings[item.key] ?? ""}
                onChange={(e) => setValues({ ...values, findings: { ...values.findings, [item.key]: e.target.value } })}
              >
                <option value=""></option>
                {item.options.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.display}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label className="line-drain-site__check">
            <input
              type="checkbox"
              name={DRESSING_KEY}
              checked={values.dressing}
              onChange={(e) => setValues({ ...values, dressing: e.target.checked })}
            />
            ドレッシング交換
          </label>
          <label>
            所見・処置
            <input type="text" value={values.note} onChange={(e) => setValues({ ...values, note: e.target.value })} />
          </label>
        </div>

        <div className="walk-in__actions">
          <button type="button" onClick={handleSubmit} disabled={save.isPending}>
            登録
          </button>
          <button type="button" onClick={onClose} disabled={save.isPending}>
            閉じる
          </button>
        </div>
      </div>
    </Modal>
  );
}
