import { useEffect, useMemo, useState } from "react";
import { useNursingObservationsByManageNos } from "../api/masterQueries";
import { usePathwayApplicationTree, usePathwayObservations, useRecordPathwayEvaluation } from "../api/queries";
import { useCurrentPractitioner } from "../api/authQueries";
import {
  ACHIEVEMENT_OPTIONS,
  SOAP_ITEMS,
  assessmentInputSpec,
  buildEvaluationState,
  buildPathwayEvaluationBundle,
  evaluationValuesOf,
  type Achievement,
  type PathwayEvaluationValues,
} from "../fhir/pathwayEvaluationHelpers";
import { eventDayLabel, taskCategoryLabel } from "../fhir/pathwayHelpers";
import { orderStatusLabel } from "../fhir/pathwaySheetHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { useValidationError } from "../hooks/useValidationError";
import { toDateTimeInputValue, toFhirDateTime } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { ObservationInput } from "./NursingPerformModal";

// カルテ右ペインの「クリニカルパス(評価)」。パスシートのセルから開き、その病日 × OAT ユニットの
// 観察項目の実績値・タスクの実施・アウトカムの達成状態(バリアンス)と S/O/A/P を 1 回で記録する。
// 設計は docs/clinical-pathway-design.md §7.4。

interface PathwayEvaluatePanelProps {
  patientId: string;
  applyId: string;
  unitId: string;
  onSaved: () => void;
}

export function PathwayEvaluatePanel({ patientId, applyId, unitId, onSaved }: PathwayEvaluatePanelProps) {
  const tree = usePathwayApplicationTree(applyId);
  const observations = usePathwayObservations(patientId);
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const record = useRecordPathwayEvaluation();
  const [validationError, setValidationError, validationErrorRef] = useValidationError();

  const found = useMemo(() => {
    const application = tree.data?.application;
    if (!application) return null;
    for (const event of application.events) {
      const unit = event.units.find((u) => u.id === unitId);
      if (unit) return { event, unit };
    }
    return null;
  }, [tree.data, unitId]);

  const evaluation =
    tree.data && observations.data
      ? buildEvaluationState(observations.data, tree.data.goals, [...tree.data.carePlans.values()])
      : null;

  const manageNos = useMemo(
    () => (found?.unit.assessments ?? []).map((a) => a.nursingObservationManageNo).filter(Boolean),
    [found],
  );
  const masters = useNursingObservationsByManageNos(manageNos);
  const specs = useMemo(() => {
    const map = new Map<string, ReturnType<typeof assessmentInputSpec>>();
    for (const assessment of found?.unit.assessments ?? []) {
      map.set(assessment.id, assessmentInputSpec(assessment.nursingObservationManageNo, masters.data));
    }
    return map;
  }, [found, masters.data]);

  // 保存済みの評価が読めたら、その値をフォームに入れる(セルを切り替えたときも作り直す)。
  const [values, setValues] = useState<PathwayEvaluationValues | null>(null);
  const [loadedFor, setLoadedFor] = useState("");
  useEffect(() => {
    if (!found || !evaluation) return;
    const key = `${unitId}:${observations.dataUpdatedAt}:${tree.dataUpdatedAt}`;
    if (loadedFor === key) return;
    setValues(evaluationValuesOf(found.unit, evaluation));
    setLoadedFor(key);
  }, [found, evaluation, unitId, loadedFor, observations.dataUpdatedAt, tree.dataUpdatedAt]);

  if (tree.isPending || observations.isPending) return <p>読み込み中...</p>;
  if (!tree.data?.application) return <ErrorBanner error={tree.error} />;
  if (!found || !values) return <p>この OAT ユニットは見つかりません。</p>;
  const { event, unit } = found;
  const unitCarePlan = tree.data.carePlans.get(unit.id);

  function update<K extends keyof PathwayEvaluationValues>(key: K, value: PathwayEvaluationValues[K]) {
    setValues((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function handleSave() {
    if (!values || !unitCarePlan) return;
    if (!values.recordedAt) {
      setValidationError("記録日時を入力してください");
      return;
    }
    setValidationError(null);
    const bundle = buildPathwayEvaluationBundle(
      {
        patientId,
        unit,
        unitCarePlan,
        specs,
        procedures: tree.data?.procedures ?? new Map(),
        existing: evaluation,
        performer:
          practitionerId && practitioner
            ? { practitionerId, display: practitionerDisplayName(practitioner) }
            : null,
      },
      values,
    );
    if ((bundle.entry ?? []).length === 0) {
      setValidationError("記録する内容がありません");
      return;
    }
    record.mutate(bundle, { onSuccess: onSaved });
  }

  const tasks = unit.assessments.flatMap((a) => a.tasks);

  return (
    <div className="pathway-evaluate">
      {validationError && (
        <div className="error-banner" role="alert" ref={validationErrorRef}>
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={record.error ?? masters.error} />

      <div className="chemo-calendar__summary pathway-evaluate__head">
        <span className="pathway-sheet__name">{tree.data.application.title}</span>
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

      {unit.assessments.some((a) => a.name) && (
        <fieldset className="regimen-apply__fields">
          <legend>観察項目</legend>
          <table className="master-search__table pathway-evaluate__rows">
            <tbody>
              {unit.assessments
                .filter((a) => a.name)
                .map((assessment) => (
                  <tr key={assessment.id}>
                    <th scope="row">{assessment.name}</th>
                    <td>
                      <ObservationInput
                        spec={specs.get(assessment.id) ?? { kind: "text" }}
                        values={values.results.get(assessment.id) ?? ["", ""]}
                        onChange={(index, value) => {
                          const next = new Map(values.results);
                          const current: [string, string] = [...(next.get(assessment.id) ?? ["", ""])] as [string, string];
                          current[index] = value;
                          next.set(assessment.id, current);
                          update("results", next);
                        }}
                      />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </fieldset>
      )}

      {tasks.length > 0 && (
        <fieldset className="regimen-apply__fields">
          <legend>タスク</legend>
          <ul className="pathway-apply__conditions">
            {tasks.map((task) => {
              const order = task.orderIds.map((id) => tree.data?.orders.get(id)).find(Boolean);
              return (
                <li key={task.id}>
                  <label className="pathway-apply__check">
                    <input
                      type="checkbox"
                      checked={values.tasksDone.get(task.id) ?? task.done}
                      onChange={(e) => {
                        const next = new Map(values.tasksDone);
                        next.set(task.id, e.target.checked);
                        update("tasksDone", next);
                      }}
                    />
                    <span className="pathway-task__template-label">{taskCategoryLabel(task.categoryLv1, task.categoryLv2)}</span>
                    {task.name}
                    {order && <span className="lab-order-item__code">{orderStatusLabel(order.status)}</span>}
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}

      <fieldset className="regimen-apply__fields">
        <legend>アウトカム評価</legend>
        <div className="pathway-evaluate__achievement" role="radiogroup" aria-label="達成状態">
          {ACHIEVEMENT_OPTIONS.map((option) => (
            <label key={option.code} className="pathway-apply__check">
              <input
                type="radio"
                name="pathway-achievement"
                value={option.code}
                checked={values.achievement === option.code}
                onChange={() => update("achievement", option.code as Achievement)}
              />
              {option.display}
            </label>
          ))}
        </div>
        <div className="regimen-editor__texts">
          {SOAP_ITEMS.map((item) => (
            <label key={item.code}>
              {item.label}
              <textarea
                rows={2}
                value={values.soap[item.code]}
                onChange={(e) => update("soap", { ...values.soap, [item.code]: e.target.value })}
              />
            </label>
          ))}
          <label>
            コメント
            <textarea rows={2} value={values.comment} onChange={(e) => update("comment", e.target.value)} />
          </label>
        </div>
        <div className="lab-order-item__fields">
          <label>
            記録日時
            <input
              type="datetime-local"
              value={toDateTimeInputValue(values.recordedAt)}
              onChange={(e) => update("recordedAt", e.target.value ? toFhirDateTime(e.target.value) : "")}
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
