import { useMemo, useState } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import { useNursingObservationsByManageNos } from "../api/masterQueries";
import { useRecordPathwayEvaluation, useVitalFlowsheet } from "../api/queries";
import type { PathwayApplicationRecord, PathwayTaskRecord } from "../fhir/pathwayApplyHelpers";
import {
  ACHIEVEMENT_OPTIONS,
  assessmentCandidate,
  assessmentInputSpec,
  buildPathwayDayAssessmentBundle,
  buildPathwayEvaluationBundle,
  evaluationValuesOf,
  hasEvaluationWriting,
  judgeAssessment,
  proposeAchievement,
  type Achievement,
  type PathwayEvaluationState,
} from "../fhir/pathwayEvaluationHelpers";
import { eventDayStepLabel, taskCategoryLabel } from "../fhir/pathwayHelpers";
import type { OrderProgress } from "../fhir/orderProgressHelpers";
import { isOrderDrivenTask, pathwayTaskPerformedOn } from "../fhir/pathwaySheetHelpers";
import { majorEventLabel, type PathwayMajorEvent } from "../fhir/pathwayMajorEventHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { nowFhirDateTime } from "../lib/dates";
import { usePathwayVarianceNotice } from "../hooks/usePathwayVarianceNotice";
import { useOrderContext } from "../hooks/useOrderContext";
import { ErrorBanner } from "./ErrorBanner";
import { ObservationInput } from "./NursingPerformModal";
import { AssessmentJudgeMark } from "./PathwayEvaluatePanel";

// パスタブの「日めくり」。1 病日(分けた日はステップごと)をめくりながら、その日のアウトカムを縦に並べて
// まとめて記録する。達成状態・観察項目の実績・タスクの実施と、病日の総合評価はここで入れ、記載(SOAP・自由記載)は
// アウトカムごとの評価モーダルで書く。記録は変えたアウトカム・病日の分だけを 1 transaction にまとめる。
// 未達成にしたアウトカムに記載が無ければ、記録の前に件数を出して確かめる(ePath の「バリアンス記録を促す」)。
// 設計は docs/clinical-pathway-design.md §6(日めくり)・§7.12。

/** アウトカム 1 件ぶんの入力中の値(達成状態・実績・タスクの実施)。 */
interface UnitDraft {
  achievement: Achievement | "";
  /** 達成状態を人が選んでいない(実績値を基準に当てた提案を入れてよい)。 */
  achievementAuto: boolean;
  results: Map<string, [string, string]>;
  tasksDone: Map<string, boolean>;
}

interface PathwayDayViewProps {
  patientId: string;
  application: PathwayApplicationRecord;
  carePlans: Map<string, fhir4.CarePlan>;
  procedures: Map<string, fhir4.Procedure>;
  /** 木に含めた Goal(観察項目の達成状態を書く先)。 */
  goals: Map<string, fhir4.Goal>;
  orders: Map<string, fhir4.ServiceRequest>;
  /** オーダーのヘッダの id → 進み具合(進捗の Task から)。 */
  orderProgress: Map<string, OrderProgress>;
  evaluation: PathwayEvaluationState | null;
  performDates: Map<string, Set<string>>;
  eventId: string;
  today: string;
  /** 病日 CarePlan の id → 主要イベント(見出しに出す)。 */
  majorEvents: Map<string, PathwayMajorEvent>;
  onEventChange: (eventId: string) => void;
  /** 記載(SOAP・自由記載)を評価モーダルで開く。 */
  onOpenEvaluation: (unitId: string) => void;
  /** タスクに結んだオーダーの詳細(看護指示は実施入力)を開く。 */
  onOpenTask: (task: PathwayTaskRecord, date: string) => void;
}

function sameDraft(a: UnitDraft, b: UnitDraft): boolean {
  if (a.achievement !== b.achievement) return false;
  for (const [id, value] of a.results) {
    const other = b.results.get(id) ?? ["", ""];
    if (value[0] !== other[0] || value[1] !== other[1]) return false;
  }
  for (const [id, done] of a.tasksDone) if (done !== (b.tasksDone.get(id) ?? false)) return false;
  return true;
}

export function PathwayDayView({
  patientId,
  application,
  carePlans,
  procedures,
  goals,
  orders,
  orderProgress,
  evaluation,
  performDates,
  eventId,
  today,
  majorEvents,
  onEventChange,
  onOpenEvaluation,
  onOpenTask,
}: PathwayDayViewProps) {
  const events = application.events;
  const index = Math.max(
    0,
    events.findIndex((e) => e.id === eventId),
  );
  const event = events[index];
  const record = useRecordPathwayEvaluation();
  const variance = usePathwayVarianceNotice(patientId, application);
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const orderContext = useOrderContext();
  // 入力中の値はアウトカムごとに持ち、病日をめくっても残す(記録で全部まとめて送る)。
  const [drafts, setDrafts] = useState<Map<string, UnitDraft>>(new Map());
  // 病日の総合評価の入力中の値(病日 CarePlan の id → 本文)。
  const [dayDrafts, setDayDrafts] = useState<Map<string, string>>(new Map());
  // 記載の無いバリアンスを確かめている最中(該当するアウトカムの id)。
  const [confirmUnwritten, setConfirmUnwritten] = useState<string[] | null>(null);

  const manageNos = useMemo(
    () =>
      events.flatMap((e) =>
        e.units.flatMap((u) => u.assessments.map((a) => a.nursingObservationManageNo).filter(Boolean)),
      ),
    [events],
  );
  const masters = useNursingObservationsByManageNos(manageNos);
  const vitals = useVitalFlowsheet(patientId, event?.date ?? "", event?.date ?? "");

  const initialOf = (unitId: string): UnitDraft | null => {
    const unit = events.flatMap((e) => e.units).find((u) => u.id === unitId);
    if (!unit) return null;
    const values = evaluationValuesOf(unit, evaluation);
    return {
      achievement: values.achievement,
      achievementAuto: !values.achievement,
      results: values.results,
      tasksDone: values.tasksDone,
    };
  };

  function specsOf(unitId: string): Map<string, ReturnType<typeof assessmentInputSpec>> {
    const unit = events.flatMap((e) => e.units).find((u) => u.id === unitId);
    const specs = new Map<string, ReturnType<typeof assessmentInputSpec>>();
    for (const a of unit?.assessments ?? []) specs.set(a.id, assessmentInputSpec(a.nursingObservationManageNo, masters.data));
    return specs;
  }

  /** 実績値を直したあと、達成状態を選んでいなければ基準に当てた提案を入れる。 */
  function withProposal(unitId: string, draft: UnitDraft): UnitDraft {
    if (!draft.achievementAuto) return draft;
    const unit = events.flatMap((e) => e.units).find((u) => u.id === unitId);
    return unit ? { ...draft, achievement: proposeAchievement(unit, specsOf(unitId), draft.results) } : draft;
  }
  const dirtyUnitIds = [...drafts].filter(([id, draft]) => {
    const initial = initialOf(id);
    return initial && !sameDraft(draft, initial);
  }).map(([id]) => id);
  const dirtyDayIds = [...dayDrafts]
    .filter(([id, text]) => text.trim() !== (evaluation?.days.get(id)?.text ?? "").trim())
    .map(([id]) => id);
  const dirtyCount = dirtyUnitIds.length + dirtyDayIds.length;

  if (!event) return <p className="order-set__empty">病日がありません。</p>;
  const todayIndex = events.findIndex((e) => e.date === today);
  const isToday = event.date === today;

  function draftOf(unitId: string): UnitDraft {
    return (
      drafts.get(unitId) ??
      initialOf(unitId) ?? { achievement: "", achievementAuto: true, results: new Map(), tasksDone: new Map() }
    );
  }

  function patchDraft(unitId: string, patch: (draft: UnitDraft) => UnitDraft) {
    setConfirmUnwritten(null);
    setDrafts((prev) => {
      const next = new Map(prev);
      const current = prev.get(unitId) ?? initialOf(unitId);
      if (current) {
        next.set(unitId, patch({ ...current, results: new Map(current.results), tasksDone: new Map(current.tasksDone) }));
      }
      return next;
    });
  }

  const performer =
    practitionerId && practitioner ? { practitionerId, display: practitionerDisplayName(practitioner) } : null;

  /** 未達成にしたうち、記載(S/O/A/P・自由記載・コメント)の無いアウトカム。 */
  function unwrittenVariances(): string[] {
    return dirtyUnitIds.filter(
      (id) => drafts.get(id)?.achievement === "2" && !hasEvaluationWriting(evaluation?.units.get(id)),
    );
  }

  function handleRecord() {
    const unwritten = unwrittenVariances();
    if (unwritten.length > 0 && !confirmUnwritten) {
      setConfirmUnwritten(unwritten);
      return;
    }
    submit();
  }

  function submit(after?: () => void) {
    const specs = new Map<string, ReturnType<typeof assessmentInputSpec>>();
    const entry: fhir4.BundleEntry[] = [];
    for (const dayId of dirtyDayIds) {
      const dayEvent = events.find((e) => e.id === dayId);
      if (!dayEvent) continue;
      const bundle = buildPathwayDayAssessmentBundle(
        { patientId, event: dayEvent, existing: evaluation?.days.get(dayId), performer, department: orderContext },
        dayDrafts.get(dayId) ?? "",
        nowFhirDateTime(),
      );
      entry.push(...(bundle.entry ?? []));
    }
    for (const unitId of dirtyUnitIds) {
      const unitEvent = events.find((e) => e.units.some((u) => u.id === unitId));
      const unit = unitEvent?.units.find((u) => u.id === unitId);
      const unitCarePlan = carePlans.get(unitId);
      const draft = drafts.get(unitId);
      if (!unitEvent || !unit || !unitCarePlan || !draft) continue;
      for (const a of unit.assessments) specs.set(a.id, assessmentInputSpec(a.nursingObservationManageNo, masters.data));
      const base = evaluationValuesOf(unit, evaluation);
      const bundle = buildPathwayEvaluationBundle(
        {
          patientId,
          unit,
          unitCarePlan,
          specs,
          procedures,
          goals,
          existing: evaluation,
          performer,
          department: orderContext,
          variance: variance.noticeFor(unitEvent),
        },
        {
          ...base,
          achievement: draft.achievement,
          results: draft.results,
          tasksDone: draft.tasksDone,
          recordedAt: nowFhirDateTime(),
        },
      );
      entry.push(...(bundle.entry ?? []));
    }
    const reset = () => {
      setDrafts(new Map());
      setDayDrafts(new Map());
      setConfirmUnwritten(null);
    };
    if (entry.length === 0) {
      reset();
      return;
    }
    record.mutate(
      { resourceType: "Bundle", type: "transaction", entry },
      {
        onSuccess: () => {
          reset();
          after?.();
        },
      },
    );
  }

  const savedDay = evaluation?.days.get(event.id);
  const dayText = dayDrafts.get(event.id) ?? savedDay?.text ?? "";

  return (
    <div className="pathway-day">
      <ErrorBanner error={record.error ?? masters.error ?? vitals.error ?? variance.error} />

      <div className="pathway-day__nav">
        <button type="button" onClick={() => onEventChange(events[index - 1].id)} disabled={index === 0}>
          ‹ 前の日
        </button>
        <div className={`pathway-day__title${isToday ? " pathway-day__title--today" : ""}`}>
          {event.phaseName && <span className="pathway-day__date">{event.phaseName}</span>}
          <strong>{`病日 ${event.elapsedDays}`}</strong>
          <span>{eventDayStepLabel(event.elapsedDays, event.title, event.pathStep, event.pathStepName)}</span>
          <span className="pathway-day__date">{event.date}</span>
          {majorEvents.get(event.id) && (
            <span className="pathway-day__major icon-tooltip" data-tooltip="主要イベント">
              {majorEventLabel(majorEvents.get(event.id) as PathwayMajorEvent)}
            </span>
          )}
          {isToday && <span className="pathway-day__today">今日</span>}
        </div>
        <button
          type="button"
          onClick={() => onEventChange(events[index + 1].id)}
          disabled={index === events.length - 1}
        >
          次の日 ›
        </button>
        {todayIndex >= 0 && !isToday && (
          <button type="button" onClick={() => onEventChange(events[todayIndex].id)}>
            今日
          </button>
        )}
      </div>

      {/* 病日ごとの医師の総合評価(ePath の compAssessment)。病日に 1 件で、書き直すと上書き。 */}
      <section className="pathway-day__unit pathway-day__assessment">
        <header className="pathway-day__unit-head">
          <h4>総合評価</h4>
          {savedDay && (
            <span className="pathway-day__date">
              {savedDay.performerName} {savedDay.recordedAt.slice(0, 16).replace("T", " ")}
            </span>
          )}
        </header>
        <textarea
          rows={2}
          aria-label="総合評価"
          value={dayText}
          onChange={(e) => {
            const value = e.target.value;
            setDayDrafts((prev) => new Map(prev).set(event.id, value));
          }}
        />
      </section>

      {event.units.map((unit) => {
        const draft = draftOf(unit.id);
        const dirty = dirtyUnitIds.includes(unit.id);
        const hasWriting = hasEvaluationWriting(evaluation?.units.get(unit.id));
        const tasks = unit.assessments.flatMap((a) => a.tasks);
        const named = unit.assessments.filter((a) => a.name);
        return (
          <section key={unit.id} className={`pathway-day__unit${unit.critical ? " pathway-day__unit--critical" : ""}`}>
            <header className="pathway-day__unit-head">
              <h4>
                {unit.critical && (
                  <span className="pathway-sheet__critical" title="重要アウトカム">
                    ★
                  </span>
                )}
                {unit.name}
                {unit.unplanned && <span className="pathway-sheet__unplanned">予定外</span>}
              </h4>
              <div className="pathway-day__achievement" role="radiogroup" aria-label={`${unit.name} の達成状態`}>
                {ACHIEVEMENT_OPTIONS.map((option) => (
                  <label key={option.code} className="pathway-apply__check">
                    <input
                      type="radio"
                      name={`pathway-day-${unit.id}`}
                      checked={draft.achievement === option.code}
                      onChange={() =>
                        patchDraft(unit.id, (d) => ({ ...d, achievement: option.code as Achievement, achievementAuto: false }))
                      }
                    />
                    {option.display}
                  </label>
                ))}
                {draft.achievementAuto && draft.achievement && <span className="pathway-evaluate__proposed">提案</span>}
              </div>
              <button
                type="button"
                className="pathway-sheet__close-button"
                onClick={() => onOpenEvaluation(unit.id)}
                disabled={dirty}
              >
                {hasWriting ? "記載あり" : "記載"}
              </button>
            </header>

            {named.length > 0 && (
              <table className="master-search__table pathway-evaluate__rows pathway-day__rows">
                <tbody>
                  {named.map((assessment) => {
                    const spec = assessmentInputSpec(assessment.nursingObservationManageNo, masters.data);
                    const candidate = assessmentCandidate(
                      assessment.nursingObservationManageNo,
                      event.date,
                      vitals.data ?? [],
                    );
                    const values = draft.results.get(assessment.id) ?? ["", ""];
                    return (
                      <tr key={assessment.id}>
                        <th scope="row">{assessment.name}</th>
                        <td className="pathway-evaluate__proper">{assessment.properValue}</td>
                        <td>
                          <ObservationInput
                            spec={spec}
                            values={values}
                            onChange={(i, value) =>
                              patchDraft(unit.id, (d) => {
                                const current: [string, string] = [...(d.results.get(assessment.id) ?? ["", ""])] as [
                                  string,
                                  string,
                                ];
                                current[i] = value;
                                d.results.set(assessment.id, current);
                                return withProposal(unit.id, d);
                              })
                            }
                          />
                          <AssessmentJudgeMark status={judgeAssessment(assessment, spec, values)} />
                        </td>
                        <td className="pathway-day__candidate-cell">
                          {candidate && (
                            <button
                              type="button"
                              className="pathway-evaluate__candidate"
                              onClick={() =>
                                patchDraft(unit.id, (d) => {
                                  d.results.set(assessment.id, candidate.values);
                                  return withProposal(unit.id, d);
                                })
                              }
                            >
                              {candidate.label}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            {tasks.length > 0 && (
              <ul className="pathway-apply__conditions pathway-day__tasks">
                {tasks.map((task) => {
                  const order = task.orderIds.map((id) => orders.get(id)).find(Boolean);
                  const orderDriven = isOrderDrivenTask(task, orders, orderProgress);
                  const checked = orderDriven
                    ? pathwayTaskPerformedOn(task, event.date, orders, performDates, orderProgress)
                    : (draft.tasksDone.get(task.id) ?? task.done);
                  return (
                    <li key={task.id}>
                      <label className="pathway-apply__check">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={orderDriven}
                          onChange={(e) =>
                            patchDraft(unit.id, (d) => {
                              d.tasksDone.set(task.id, e.target.checked);
                              return d;
                            })
                          }
                        />
                        <span className="pathway-task__template-label">
                          {taskCategoryLabel(task.categoryLv1, task.categoryLv2)}
                        </span>
                      </label>
                      {task.orderIds.length > 0 ? (
                        <button type="button" className="pathway-day__task-link" onClick={() => onOpenTask(task, event.date)}>
                          {task.name}
                        </button>
                      ) : (
                        <span>{task.name}</span>
                      )}
                      {order?.id && orderProgress.get(order.id) && (
                        <span className="lab-order-item__code">{orderProgress.get(order.id)?.label}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}

      {confirmUnwritten && confirmUnwritten.length > 0 && (
        <div className="error-banner pathway-day__confirm" role="alert">
          <p className="error-banner__line error-banner__line--warning">
            {`記載なしのバリアンスが ${confirmUnwritten.length} 件あります`}
          </p>
          <div className="lab-order-item__actions">
            <button type="button" className="rp-card__compact-button" onClick={() => submit()} disabled={record.isPending}>
              このまま記録
            </button>
            <button
              type="button"
              className="rp-card__compact-button"
              onClick={() => submit(() => onOpenEvaluation(confirmUnwritten[0]))}
              disabled={record.isPending}
            >
              記載を書く
            </button>
            <button type="button" className="rp-card__compact-button" onClick={() => setConfirmUnwritten(null)}>
              取消
            </button>
          </div>
        </div>
      )}
      <div className="lab-order-item__actions pathway-day__actions">
        <button type="button" onClick={handleRecord} disabled={record.isPending || dirtyCount === 0 || !variance.ready}>
          {record.isPending ? "送信中..." : dirtyCount > 0 ? `記録(${dirtyCount} 件)` : "記録"}
        </button>
      </div>
    </div>
  );
}
