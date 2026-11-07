import { useState } from "react";
import { useDeleteLineDrainSiteObservation, useOrderEnterer, useSaveLineDrainSiteObservation } from "../api/queries";
import {
  buildSiteObservation,
  DRESSING_KEY,
  emptySiteForm,
  lineDrainLabel,
  siteFindingItemsFor,
  siteFindingLevel,
  validateSiteObservation,
  type LineDrainRecord,
  type LineDrainSiteFormValues,
} from "../fhir/lineDrainHelpers";
import { clockTime, dateTimeLabel, localDay, nowDateTimeInput, shortDate } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { TrashIcon } from "./icons/TrashIcon";
import { Modal } from "./Modal";

/**
 * 刺入部観察(docs/line-drain-design.md §4.3)。1 枚の表の行 = 項目、左の列が今回の入力、右へ新しい順に過去の観察。
 * 入力できるのは留置中だけで、抜去済みは履歴の表示のみ。
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
  const latest = history[0];
  const canEnter = record.status === "in-progress";

  function handleSubmit() {
    const message = validateSiteObservation(values);
    setValidationError(message);
    if (message) return;
    save.mutate(buildSiteObservation(values, record, patientId), {
      onSuccess: () => setValues((prev) => ({ ...emptySiteForm(nowDateTimeInput()), performerId: prev.performerId, performerName: prev.performerName })),
    });
  }

  /** 変わりのない観察を 1 回で入れるため、前回の項目を写す。ドレッシング交換と所見はその回の出来事なので写さない。 */
  function handleCopyLatest() {
    if (!latest) return;
    setValues({ ...values, findings: Object.fromEntries(items.map((item) => [item.key, latest.findings[item.key] ?? ""])) });
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

      {!canEnter && history.length === 0 ? (
        <p className="patient-table__empty">観察の記録がありません。</p>
      ) : (
        <div className="line-drain-site__wrap">
          <table className="line-drain-site__table">
            <thead>
              <tr>
                <th scope="row">観察日時</th>
                {canEnter && (
                  <th className="line-drain-site__entry">
                    <input
                      type="datetime-local"
                      aria-label="観察日時"
                      value={values.effectiveAt}
                      onChange={(e) => setValues({ ...values, effectiveAt: e.target.value })}
                    />
                  </th>
                )}
                {history.map((o) => (
                  <th key={o.id} className="line-drain-site__past" title={dateTimeLabel(o.effectiveAt)}>
                    <div className="line-drain-site__past-head">
                      <span>
                        {shortDate(localDay(o.effectiveAt))}
                        <br />
                        {clockTime(o.effectiveAt)}
                      </span>
                      {canEnter && (
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
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.key}>
                  <th scope="row">{item.label}</th>
                  {canEnter && (
                    <td className="line-drain-site__entry">
                      <div className="line-drain-site__options" role="group" aria-label={item.label}>
                        {item.options.map((o) => {
                          const selected = values.findings[item.key] === o.code;
                          return (
                            <button
                              key={o.code}
                              type="button"
                              aria-pressed={selected}
                              className={selected ? "line-drain-site__option is-active" : "line-drain-site__option"}
                              onClick={() =>
                                setValues({ ...values, findings: { ...values.findings, [item.key]: selected ? "" : o.code } })
                              }
                            >
                              {o.display}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                  )}
                  {history.map((o) => {
                    const code = o.findings[item.key];
                    const level = siteFindingLevel(item, code);
                    return (
                      <td key={o.id} className={level > 0 ? `line-drain-site__past line-drain-site__level-${level}` : "line-drain-site__past"}>
                        {item.options.find((opt) => opt.code === code)?.display ?? ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <th scope="row">ドレッシング交換</th>
                {canEnter && (
                  <td className="line-drain-site__entry">
                    <input
                      type="checkbox"
                      name={DRESSING_KEY}
                      aria-label="ドレッシング交換"
                      checked={values.dressing}
                      onChange={(e) => setValues({ ...values, dressing: e.target.checked })}
                    />
                  </td>
                )}
                {history.map((o) => (
                  <td key={o.id} className="line-drain-site__past">
                    {o.dressing ? "○" : ""}
                  </td>
                ))}
              </tr>
              <tr className="line-drain-site__note">
                <th scope="row">所見・処置</th>
                {canEnter && (
                  <td className="line-drain-site__entry">
                    <input
                      type="text"
                      aria-label="所見・処置"
                      value={values.note}
                      onChange={(e) => setValues({ ...values, note: e.target.value })}
                    />
                  </td>
                )}
                {history.map((o) => (
                  <td key={o.id} className="line-drain-site__past">
                    {o.note}
                  </td>
                ))}
              </tr>
              <tr>
                <th scope="row">観察者</th>
                {canEnter && <td className="line-drain-site__entry">{values.performerName}</td>}
                {history.map((o) => (
                  <td key={o.id} className="line-drain-site__past">
                    {o.performer?.display ?? ""}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="walk-in__actions">
        {canEnter && (
          <button type="button" onClick={handleSubmit} disabled={save.isPending}>
            登録
          </button>
        )}
        {canEnter && latest && (
          <button type="button" onClick={handleCopyLatest} disabled={save.isPending}>
            前回値複写
          </button>
        )}
        <button type="button" onClick={onClose} disabled={save.isPending}>
          閉じる
        </button>
      </div>
    </Modal>
  );
}
