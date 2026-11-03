import { useEffect, useState } from "react";
import { usePathwayApplicationTree, usePathwayObservations, useRecordPathwayEvaluation } from "../api/queries";
import { useCurrentPractitioner } from "../api/authQueries";
import { buildEvaluationState, buildPathwayDayAssessmentBundle } from "../fhir/pathwayEvaluationHelpers";
import { eventDayStepLabel } from "../fhir/pathwayHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { useValidationError } from "../hooks/useValidationError";
import { useOrderContext } from "../hooks/useOrderContext";
import { nowFhirDateTime, toDateTimeInputValue, toFhirDateTime } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";

// 「クリニカルパス(総合評価)」。オーバービューの最下段のセルからモーダルで開き、その病日の医師の
// 総合評価(ePath の compAssessment、病日に 1 件)を書く・書き直す。空にして記録すると消える。
// 設計は docs/clinical-pathway-design.md §7.12。

interface PathwayDayAssessmentPanelProps {
  patientId: string;
  applyId: string;
  eventId: string;
  onSaved: () => void;
}

export function PathwayDayAssessmentPanel({ patientId, applyId, eventId, onSaved }: PathwayDayAssessmentPanelProps) {
  const tree = usePathwayApplicationTree(applyId);
  const observations = usePathwayObservations(patientId);
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const orderContext = useOrderContext();
  const record = useRecordPathwayEvaluation();
  const [validationError, setValidationError, validationErrorRef] = useValidationError();
  const [text, setText] = useState("");
  const [recordedAt, setRecordedAt] = useState("");
  const [loadedFor, setLoadedFor] = useState("");

  const event = tree.data?.application?.events.find((e) => e.id === eventId);
  const evaluation =
    tree.data && observations.data
      ? buildEvaluationState(observations.data, tree.data.goals, [...tree.data.carePlans.values()])
      : null;
  const saved = evaluation?.days.get(eventId);

  useEffect(() => {
    if (!event || !evaluation) return;
    const key = `${eventId}:${observations.dataUpdatedAt}`;
    if (loadedFor === key) return;
    setText(saved?.text ?? "");
    setRecordedAt(saved?.recordedAt || nowFhirDateTime());
    setLoadedFor(key);
  }, [event, evaluation, saved, eventId, loadedFor, observations.dataUpdatedAt]);

  if (tree.isPending || observations.isPending) return <p>読み込み中...</p>;
  if (!tree.data?.application) return <ErrorBanner error={tree.error} />;
  if (!event) return <p>この病日は見つかりません。</p>;

  function handleSave() {
    if (!event) return;
    if (!recordedAt) {
      setValidationError("記録日時を入力してください");
      return;
    }
    setValidationError(null);
    const bundle = buildPathwayDayAssessmentBundle(
      {
        patientId,
        event,
        existing: saved,
        performer:
          practitionerId && practitioner ? { practitionerId, display: practitionerDisplayName(practitioner) } : null,
        department: orderContext,
      },
      text,
      recordedAt,
    );
    if ((bundle.entry ?? []).length === 0) {
      onSaved();
      return;
    }
    record.mutate(bundle, { onSuccess: onSaved });
  }

  return (
    <div className="pathway-evaluate">
      {validationError && (
        <div className="error-banner" role="alert" ref={validationErrorRef}>
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={record.error} />

      <div className="chemo-calendar__summary pathway-evaluate__head">
        <span className="pathway-sheet__name">{tree.data.application.title}</span>
        <span>
          病日 {event.elapsedDays} {eventDayStepLabel(event.elapsedDays, event.title, event.pathStep, event.pathStepName)}{" "}
          {event.date}
        </span>
        {saved && (
          <span className="pathway-day__date">
            {saved.performerName} {saved.recordedAt.slice(0, 16).replace("T", " ")}
          </span>
        )}
      </div>

      <fieldset className="regimen-apply__fields">
        <legend>総合評価</legend>
        <div className="regimen-editor__texts">
          <label>
            総合評価
            <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
        </div>
        <div className="lab-order-item__fields">
          <label>
            記録日時
            <input
              type="datetime-local"
              value={toDateTimeInputValue(recordedAt)}
              onChange={(e) => setRecordedAt(e.target.value ? toFhirDateTime(e.target.value) : "")}
            />
          </label>
        </div>
      </fieldset>

      <div className="lab-order-item__actions">
        <button type="button" onClick={handleSave} disabled={record.isPending}>
          {record.isPending ? "送信中..." : "記録"}
        </button>
      </div>
    </div>
  );
}
