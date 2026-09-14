import { useEffect, useMemo, useState } from "react";
import { useNursingObservationsByManageNos } from "../api/masterQueries";
import {
  useNursingPerformsOf,
  usePathwayApplicationTree,
  usePathwayObservations,
  useRecordPathwayEvaluation,
  useVitalFlowsheet,
} from "../api/queries";
import { useCurrentPractitioner } from "../api/authQueries";
import {
  ACHIEVEMENT_OPTIONS,
  SOAP_ITEMS,
  assessmentCandidate,
  assessmentInputSpec,
  buildEvaluationState,
  buildPathwayEvaluationBundle,
  evaluationValuesOf,
  type Achievement,
  type EvaluationField,
  type EvaluationMode,
  type PathwayEvaluationValues,
} from "../fhir/pathwayEvaluationHelpers";
import {
  questionnaireResponsePlainText,
  type TemplateDraft,
} from "../fhir/questionnaireResponseHelpers";
import { eventDayStepLabel, taskCategoryLabel } from "../fhir/pathwayHelpers";
import {
  isOrderDrivenTask,
  nursingPerformDates,
  pathwayTaskPerformedOn,
} from "../fhir/pathwaySheetHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { useValidationError } from "../hooks/useValidationError";
import { toDateTimeInputValue, toFhirDateTime } from "../lib/dates";
import { usePathwayVarianceNotice } from "../hooks/usePathwayVarianceNotice";
import { ErrorBanner } from "./ErrorBanner";
import { ObservationInput } from "./NursingPerformModal";
import { TemplateEntryModal } from "./TemplateEntryModal";
import { TemplateTextField } from "./TemplateTextField";

// 「クリニカルパス(評価)」。パスシートのアウトカムのセルからモーダルで開き、その病日 × OAT ユニットの
// 観察項目の実績値・タスクの実施・アウトカムの達成状態(バリアンス)と記載を 1 回で記録する。
// 記載は SOAP と自由記載を選べ、欄ごとにテンプレートを結べる。
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
  const nursingPerforms = useNursingPerformsOf(patientId);
  const performDates = useMemo(() => nursingPerformDates(nursingPerforms.data), [nursingPerforms.data]);
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const record = useRecordPathwayEvaluation();
  const variance = usePathwayVarianceNotice(patientId, tree.data?.application);
  const [validationError, setValidationError, validationErrorRef] = useValidationError();
  // テンプレート記入を開いている欄(S/O/A/P か自由記載)。
  const [templateTarget, setTemplateTarget] = useState<EvaluationField | null>(null);

  // Escape はテンプレートから先に閉じる。パスシート側もモーダルを閉じる listener を
  // 持つので、こちらで拾ったときはそれ以上伝えない(重なりの外側から閉じる)。
  useEffect(() => {
    if (!templateTarget) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopImmediatePropagation();
      setTemplateTarget(null);
    }
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [templateTarget]);

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
  // 看護観察に結んだ観察項目の候補(その日の経過表の値)。
  const vitals = useVitalFlowsheet(patientId, found?.event.date ?? "", found?.event.date ?? "");
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

  /** テンプレートの紐付けを外す(書いた文言は残して直接入力に戻す)。 */
  function clearTemplate(field: EvaluationField) {
    setValues((prev) => (prev ? { ...prev, templates: { ...prev.templates, [field]: null } } : prev));
  }

  /** テンプレート記入の反映。平文を欄に入れ、以後その欄はテンプレートからのみ直す。 */
  function applyTemplate(field: EvaluationField, draft: TemplateDraft) {
    const text = questionnaireResponsePlainText(draft.questionnaire, draft.response);
    setValues((prev) => {
      if (!prev) return prev;
      const binding = { responseId: prev.templates[field]?.responseId ?? null, draft };
      const templates = { ...prev.templates, [field]: binding };
      return field === "free"
        ? { ...prev, freeText: text, templates }
        : { ...prev, soap: { ...prev.soap, [field]: text }, templates };
    });
    setTemplateTarget(null);
  }

  function handleSave() {
    if (!values || !unitCarePlan || !variance.ready) return;
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
        variance: variance.noticeFor(event),
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
  const hasProperValue = unit.assessments.some((a) => a.name && a.properValue);

  return (
    <div className="pathway-evaluate">
      {validationError && (
        <div className="error-banner" role="alert" ref={validationErrorRef}>
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={record.error ?? masters.error ?? variance.error} />

      <div className="chemo-calendar__summary pathway-evaluate__head">
        <span className="pathway-sheet__name">{tree.data.application.title}</span>
        <span>
          病日 {event.elapsedDays} {eventDayStepLabel(event.elapsedDays, event.title, event.pathStep, event.pathStepName)} {event.date}
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
                    {hasProperValue && <td className="pathway-evaluate__proper">{assessment.properValue}</td>}
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
                    <td className="pathway-day__candidate-cell">
                      {(() => {
                        const candidate = assessmentCandidate(
                          assessment.nursingObservationManageNo,
                          event.date,
                          vitals.data ?? [],
                        );
                        return candidate ? (
                          <button
                            type="button"
                            className="pathway-evaluate__candidate"
                            onClick={() => {
                              const next = new Map(values.results);
                              next.set(assessment.id, candidate.values);
                              update("results", next);
                            }}
                          >
                            {candidate.label}
                          </button>
                        ) : null;
                      })()}
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
              // 看護指示を結んだ・オーダーが実施済みのタスクは、実施がオーダーの側で決まるのでここでは変えない。
              const orderDriven = isOrderDrivenTask(task, tree.data?.orders, tree.data?.orderProgress);
              const checked = orderDriven
                ? pathwayTaskPerformedOn(task, event.date, tree.data?.orders, performDates, tree.data?.orderProgress)
                : (values.tasksDone.get(task.id) ?? task.done);
              return (
                <li key={task.id}>
                  <label className="pathway-apply__check">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={orderDriven}
                      onChange={(e) => {
                        const next = new Map(values.tasksDone);
                        next.set(task.id, e.target.checked);
                        update("tasksDone", next);
                      }}
                    />
                    <span className="pathway-task__template-label">{taskCategoryLabel(task.categoryLv1, task.categoryLv2)}</span>
                    {task.name}
                    {order?.id && tree.data?.orderProgress.get(order.id) && (
                      <span className="lab-order-item__code">{tree.data.orderProgress.get(order.id)?.label}</span>
                    )}
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
        <div className="pathway-evaluate__mode" role="radiogroup" aria-label="記載形式">
          <label className="pathway-apply__check">
            <input
              type="radio"
              name="pathway-evaluate-mode"
              checked={values.mode === "soap"}
              onChange={() => update("mode", "soap" as EvaluationMode)}
            />
            SOAP
          </label>
          <label className="pathway-apply__check">
            <input
              type="radio"
              name="pathway-evaluate-mode"
              checked={values.mode === "free"}
              onChange={() => update("mode", "free" as EvaluationMode)}
            />
            自由記載
          </label>
        </div>
        <div className="regimen-editor__texts">
          {values.mode === "soap" ? (
            SOAP_ITEMS.map((item) => (
              <TemplateTextField
                key={item.code}
                label={item.label}
                value={values.soap[item.code]}
                template={values.templates[item.code]}
                onChange={(text) => update("soap", { ...values.soap, [item.code]: text })}
                onOpenTemplate={() => setTemplateTarget(item.code)}
                onClearTemplate={() => clearTemplate(item.code)}
              />
            ))
          ) : (
            <TemplateTextField
              label="記載"
              value={values.freeText}
              template={values.templates.free}
              onChange={(text) => update("freeText", text)}
              onOpenTemplate={() => setTemplateTarget("free")}
              onClearTemplate={() => clearTemplate("free")}
            />
          )}
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
        <button type="button" onClick={handleSave} disabled={record.isPending || !variance.ready}>
          {record.isPending ? "送信中..." : "記録"}
        </button>
      </div>

      {/* テンプレート記入。回答は評価と同じ transaction で保存する(評価を保存しなければ回答も残らない)。 */}
      {templateTarget && (
        <TemplateEntryModal
          patientId={patientId}
          draft={values.templates[templateTarget]?.draft ?? null}
          responseId={values.templates[templateTarget]?.responseId ?? null}
          onSubmit={(draft) => applyTemplate(templateTarget, draft)}
          onClose={() => setTemplateTarget(null)}
        />
      )}
    </div>
  );
}
