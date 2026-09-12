import { useState } from "react";
import { usePathwayApplicationTree, useRecordPathwayEvaluation } from "../api/queries";
import { useCurrentPractitioner } from "../api/authQueries";
import { buildPathwayTaskBundle } from "../fhir/pathwayEvaluationHelpers";
import { eventDayLabel, taskCategoryLabel } from "../fhir/pathwayHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { useValidationError } from "../hooks/useValidationError";
import { nowFhirDateTime, toDateTimeInputValue, toFhirDateTime } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";

// カルテ右ペインの「クリニカルパス(タスク)」。パスシートでオーダーを持たないタスクのセルを
// 押したときに開き、そのタスク 1 件の実施 / 未実施を記録する。オーダーを持つタスクは
// そのオーダーの画面(編集・実施入力)が開くので、ここには来ない。
// アウトカムの評価は右ペインの「クリニカルパス(評価)」の担当。

interface PathwayTaskPanelProps {
  patientId: string;
  applyId: string;
  procedureId: string;
  onSaved: () => void;
}

export function PathwayTaskPanel({ applyId, procedureId, onSaved }: PathwayTaskPanelProps) {
  const tree = usePathwayApplicationTree(applyId);
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const record = useRecordPathwayEvaluation();
  const [validationError, setValidationError, validationErrorRef] = useValidationError();
  const [recordedAt, setRecordedAt] = useState(nowFhirDateTime());

  if (tree.isPending) return <p>読み込み中...</p>;
  if (tree.error || !tree.data?.application) return <ErrorBanner error={tree.error} />;
  const application = tree.data.application;

  const located = (() => {
    for (const event of application.events) {
      for (const unit of event.units) {
        for (const assessment of unit.assessments) {
          const task = assessment.tasks.find((t) => t.id === procedureId);
          if (task) return { event, unit, task };
        }
      }
    }
    return null;
  })();
  const procedure = tree.data.procedures.get(procedureId);
  if (!located || !procedure) return <p className="order-set__empty">タスクが見つかりません。</p>;
  const { event, unit, task } = located;

  function save(done: boolean) {
    if (!procedure) return;
    if (done && !recordedAt) {
      setValidationError("実施日時を入力してください");
      return;
    }
    setValidationError(null);
    const performer =
      practitionerId && practitioner ? { practitionerId, display: practitionerDisplayName(practitioner) } : null;
    record.mutate(buildPathwayTaskBundle(procedure, done, recordedAt, performer), { onSuccess: onSaved });
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
        <span className="pathway-sheet__name">{application.title}</span>
        <span>
          病日 {event.elapsedDays} {eventDayLabel(event.elapsedDays, event.title)} {event.date}
        </span>
      </div>
      <h4 className="pathway-evaluate__unit">
        {unit.critical && (
          <span className="pathway-sheet__critical" title="重要アウトカム">
            ★
          </span>
        )}
        {unit.name}
      </h4>

      <fieldset className="regimen-apply__fields">
        <legend>タスク</legend>
        <table className="master-search__table pathway-evaluate__rows">
          <tbody>
            <tr>
              <th scope="row">名称</th>
              <td>{task.name}</td>
            </tr>
            <tr>
              <th scope="row">分類</th>
              <td>{taskCategoryLabel(task.categoryLv1, task.categoryLv2)}</td>
            </tr>
            <tr>
              <th scope="row">状態</th>
              <td>{task.done ? `実施済 ${task.performedDateTime?.slice(0, 16).replace("T", " ") ?? ""}` : "未実施"}</td>
            </tr>
          </tbody>
        </table>
      </fieldset>

      {!task.done && (
        <fieldset className="regimen-apply__fields">
          <legend>実施</legend>
          <div className="lab-order-item__fields">
            <label>
              実施日時
              <input
                type="datetime-local"
                value={toDateTimeInputValue(recordedAt)}
                onChange={(e) => setRecordedAt(e.target.value ? toFhirDateTime(e.target.value) : "")}
              />
            </label>
          </div>
        </fieldset>
      )}

      <div className="lab-order-item__actions">
        {task.done ? (
          <button type="button" onClick={() => save(false)} disabled={record.isPending}>
            {record.isPending ? "保存中..." : "未実施に戻す"}
          </button>
        ) : (
          <button type="button" onClick={() => save(true)} disabled={record.isPending}>
            {record.isPending ? "保存中..." : "実施済にする"}
          </button>
        )}
      </div>
    </div>
  );
}
