import { useState, type FormEvent } from "react";
import { useRecordPathoCollection } from "../api/queries";
import {
  LATERALITY_OPTIONS,
  isPositiveCount,
  pathoCollectedDateTime,
  pathoContainerTotal,
  pathoOrderSpecimens,
  type PathoSpecimenValues,
} from "../fhir/pathoOrderHelpers";
import { nowDateTimeInput, toDateTimeInputValue, toFhirDateTime } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { PathoOrganSearchModal } from "./PathoOrganSearchModal";

// 病理検査の採取の記録(docs/patho-order-design.md §4.9)。カルテの病理検査オーダーのカードから、
// 部門が受け付けるまでのあいだ開ける。
//
// 依頼時の検体個数・容器数は採取するまで分からない仮の値のことが多く、直さずにラベルを出して搬送すると
// 受付で数が合わない(JAHIS 患者安全ガイド 病理編 7.1.2)。採取した場で検体ごとの個数・容器数と、
// 採取臓器・左右を直し、採取日時を残す。

export function PathoCollectionModal({
  serviceRequest,
  itemRequests,
  onClose,
}: {
  serviceRequest: fhir4.ServiceRequest;
  itemRequests: fhir4.ServiceRequest[];
  onClose: () => void;
}) {
  const [specimens, setSpecimens] = useState<PathoSpecimenValues[]>(() => pathoOrderSpecimens(itemRequests));
  const [collectedAt, setCollectedAt] = useState(
    () => toDateTimeInputValue(pathoCollectedDateTime(specimens)) || nowDateTimeInput(),
  );
  const [organSearchIndex, setOrganSearchIndex] = useState<number | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const record = useRecordPathoCollection();

  function update(index: number, patch: Partial<PathoSpecimenValues>) {
    setSpecimens((current) => current.map((specimen, i) => (i === index ? { ...specimen, ...patch } : specimen)));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!collectedAt) {
      setValidationError("採取日時を入力してください。");
      return;
    }
    const bad = specimens.findIndex(
      (specimen) => !isPositiveCount(specimen.pieceCount) || !isPositiveCount(specimen.containerCount),
    );
    if (bad >= 0) {
      setValidationError(`検体${bad + 1}の検体個数・容器数を 1 以上の整数で入力してください。`);
      return;
    }
    setValidationError(null);
    record.mutate(
      { header: serviceRequest, itemRequests, specimens, collectedDateTime: toFhirDateTime(collectedAt) },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal title="病理検査の採取" onClose={onClose} className="modal--wide">
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={record.error} />
      <form className="prescription-form" onSubmit={handleSubmit}>
        <fieldset>
          <label>
            採取日時
            <input type="datetime-local" value={collectedAt} onChange={(e) => setCollectedAt(e.target.value)} />
          </label>
        </fieldset>
        <fieldset className="rp-card">
          <legend>検体</legend>
          <table className="rp-card__medicines rp-card__medicines--patho patho-collection__table">
            <thead>
              <tr>
                <th>№</th>
                <th>臓器・検査材料</th>
                <th>左右</th>
                <th>検体個数</th>
                <th>容器数</th>
              </tr>
            </thead>
            <tbody>
              {specimens.map((specimen, index) => (
                <tr key={specimen.id || index}>
                  <td>{index + 1}</td>
                  <td>
                    <span className="patho-collection__organ">{specimen.organName || "臓器未設定"}</span>
                    <button
                      type="button"
                      className="rp-card__compact-button"
                      onClick={() => setOrganSearchIndex(index)}
                    >
                      変更
                    </button>
                  </td>
                  <td>
                    <select
                      value={specimen.lateralityCode}
                      aria-label={`検体${index + 1}の左右`}
                      onChange={(e) => update(index, { lateralityCode: e.target.value })}
                    >
                      <option value="">指定なし</option>
                      {LATERALITY_OPTIONS.map((o) => (
                        <option key={o.code} value={o.code}>
                          {o.display}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      inputMode="numeric"
                      className="patho-collection__count"
                      aria-label={`検体${index + 1}の検体個数`}
                      value={specimen.pieceCount}
                      onChange={(e) => update(index, { pieceCount: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      inputMode="numeric"
                      className="patho-collection__count"
                      aria-label={`検体${index + 1}の容器数`}
                      value={specimen.containerCount}
                      onChange={(e) => update(index, { containerCount: e.target.value })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="patho-order__container-total">{`容器 計${pathoContainerTotal(specimens)}`}</p>
        </fieldset>
        <div className="prescription-form__submit">
          <button type="submit" disabled={record.isPending || specimens.length === 0}>
            {record.isPending ? "送信中..." : "採取"}
          </button>
        </div>
      </form>

      {/* 検索モーダルは自前の入力を持つので、採取のフォームの外に置く(Enter が外側の送信に漏れないように)。 */}
      {organSearchIndex !== null && (
        <PathoOrganSearchModal
          onSelect={(organ) => {
            update(organSearchIndex, { organCode: organ.code, organName: organ.name });
            setOrganSearchIndex(null);
          }}
          onClose={() => setOrganSearchIndex(null)}
        />
      )}
    </Modal>
  );
}
