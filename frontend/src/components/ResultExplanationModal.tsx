import { useState, type FormEvent } from "react";
import { useRecordExplanation } from "../api/queries";
import { displayName, patientNumberOf } from "../fhir/patientHelpers";
import {
  EXPLANATION_RESOLUTIONS,
  resolutionHasDate,
  type ExplanationResolution,
  type ExplanationRow,
} from "../fhir/resultExplanationHelpers";
import { REVIEW_REPORT_KIND_LABEL } from "../fhir/resultReviewHelpers";
import { today } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// 患者説明の記録(fhir/resultExplanationHelpers)。検査結果フォローの一覧とカルテの検査結果タブで共用する。

export function ResultExplanationModal({ row, onClose }: { row: ExplanationRow; onClose: () => void }) {
  const [resolution, setResolution] = useState<ExplanationResolution>("explained");
  const [explainedOn, setExplainedOn] = useState(today());
  const [memo, setMemo] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const record = useRecordExplanation();
  const withDate = resolutionHasDate(resolution);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (withDate && !explainedOn) {
      setValidationError("説明日を入力してください。");
      return;
    }
    setValidationError(null);
    record.mutate(
      { row, input: { resolution, explainedOn: withDate ? explainedOn : "", memo } },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal title="患者説明の記録" onClose={onClose}>
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={record.error} />
      <dl className="prescription-detail__common">
        {row.patient && (
          <>
            <dt>患者</dt>
            <dd>{`${patientNumberOf(row.patient)} ${displayName(row.patient)}`}</dd>
          </>
        )}
        <dt>検査</dt>
        <dd>
          {[REVIEW_REPORT_KIND_LABEL[row.kind], row.date, row.importance, row.statusLabel, row.summary]
            .filter(Boolean)
            .join(" ")}
        </dd>
      </dl>
      <form className="prescription-form" onSubmit={handleSubmit}>
        <fieldset>
          <label>
            対応
            <select
              value={resolution}
              onChange={(e) => setResolution(e.target.value as ExplanationResolution)}
            >
              {EXPLANATION_RESOLUTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.display}
                </option>
              ))}
            </select>
          </label>
          {withDate && (
            <label>
              説明日
              <input type="date" value={explainedOn} onChange={(e) => setExplainedOn(e.target.value)} />
            </label>
          )}
          <label className="result-followup__memo-field">
            メモ
            <input type="text" value={memo} onChange={(e) => setMemo(e.target.value)} />
          </label>
        </fieldset>
        <div className="prescription-form__submit">
          <button type="submit" disabled={record.isPending}>
            {record.isPending ? "送信中..." : "登録"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
