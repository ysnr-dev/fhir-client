import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import {
  NURSING_CARE_PLAN_KEY,
  useCloseNursingProblem,
  useCreatePrescription,
  useNursingCarePlans,
  usePatientAdmission,
  useSaveNursingProblem,
} from "../api/queries";
import { displayJapaneseName } from "../fhir/humanName";
import {
  NURSING_ACHIEVEMENT_OPTIONS,
  NURSING_DECISION_OPTIONS,
  buildNursingEvaluationBundle,
  buildNursingProblemBundle,
  emptyNursingEvaluation,
  emptyNursingProblemForm,
  nursingActivityLabel,
  nextNursingPriority,
  parseNursingProblemForm,
  planActivityOrderLines,
  validateNursingEvaluation,
  type NursingAchievement,
  type NursingCareContext,
  type NursingDecision,
  type NursingEvaluationValues,
  type NursingProblemEntry,
  type NursingProblemFormValues,
  type NursingProblemView,
} from "../fhir/nursingCarePlanHelpers";
import {
  buildNursingOrderBundle,
  nursingOrderState,
  type NursingOrderFormValues,
} from "../fhir/nursingOrderHelpers";
import { withOrderWard } from "../fhir/orderHeader";
import { useDefaultOrderSetting } from "../hooks/useDefaultOrderSetting";
import { useEditSnapshot } from "../hooks/useEditSnapshot";
import { useOrderContext } from "../hooks/useOrderContext";
import { today } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { NursingOrderForm } from "./NursingOrderForm";
import { NursingProblemForm } from "./NursingProblemForm";

// 看護計画の右ペイン(docs/nursing-care-plan-design.md)。立案・編集・評価・看護指示への展開。

/** 立案者・評価者(ログイン中の医療従事者)と入院。 */
function useNursingCareContext(patientId: string): { ctx: NursingCareContext; ready: boolean } {
  const me = useCurrentPractitioner();
  const admission = usePatientAdmission(patientId);
  const ctx = useMemo(
    () => ({
      patientId,
      encounterId: admission.data?.encounter.id,
      recorder: {
        practitionerId: me.practitionerId ?? "",
        display: me.practitioner ? displayJapaneseName(me.practitioner.name) : "",
      },
    }),
    [patientId, admission.data, me.practitionerId, me.practitioner],
  );
  return { ctx, ready: !admission.isPending && !me.practitionerLoading };
}

function useNursingProblem(patientId: string, carePlanId: string) {
  const plans = useEditSnapshot(useNursingCarePlans(patientId), carePlanId);
  const view = plans.data?.items.find((p) => p.carePlan.id === carePlanId);
  return { plans, view };
}

export function NursingProblemCreatePanel({
  patientId,
  entry,
  onSaved,
}: {
  patientId: string;
  entry: NursingProblemEntry;
  onSaved: () => void;
}) {
  const save = useSaveNursingProblem();
  const plans = useNursingCarePlans(patientId);
  const { ctx, ready } = useNursingCareContext(patientId);
  const initialValues = useMemo(() => emptyNursingProblemForm(entry), [entry]);

  function handleSubmit(values: NursingProblemFormValues) {
    const priority = nextNursingPriority(plans.data?.items ?? []);
    save.mutate(buildNursingProblemBundle(values, ctx, priority), { onSuccess: onSaved });
  }

  if (!ready || plans.isPending) return <p>読み込み中...</p>;
  return (
    <NursingProblemForm
      entry={entry}
      initialValues={initialValues}
      onSubmit={handleSubmit}
      submitting={save.isPending}
      submitError={save.error ?? plans.error}
    />
  );
}

export function NursingProblemEditPanel({
  patientId,
  carePlanId,
  onSaved,
}: {
  patientId: string;
  carePlanId: string;
  onSaved: () => void;
}) {
  const save = useSaveNursingProblem();
  const { plans, view } = useNursingProblem(patientId, carePlanId);
  const { ctx, ready } = useNursingCareContext(patientId);
  const initialValues = useMemo(() => (view ? parseNursingProblemForm(view) : undefined), [view]);

  function handleSubmit(values: NursingProblemFormValues) {
    if (!view) return;
    save.mutate(buildNursingProblemBundle(values, ctx, view.priority, view), { onSuccess: onSaved });
  }

  if (!ready || plans.isLoading) return <p>読み込み中...</p>;
  if (!view || !initialValues) return <ErrorBanner error={plans.error ?? new Error("看護問題が見つかりません。")} />;
  return (
    <NursingProblemForm
      entry={initialValues.entry}
      initialValues={initialValues}
      editing
      onSubmit={handleSubmit}
      submitting={save.isPending}
      submitError={save.error}
      submitLabel="更新"
    />
  );
}

export function NursingEvaluationPanel({
  patientId,
  carePlanId,
  onSaved,
}: {
  patientId: string;
  carePlanId: string;
  onSaved: () => void;
}) {
  const { plans, view } = useNursingProblem(patientId, carePlanId);
  const { ready } = useNursingCareContext(patientId);

  if (!ready || plans.isLoading) return <p>読み込み中...</p>;
  if (!view) return <ErrorBanner error={plans.error ?? new Error("看護問題が見つかりません。")} />;
  return <NursingEvaluationForm patientId={patientId} view={view} onSaved={onSaved} />;
}

function NursingEvaluationForm({
  patientId,
  view,
  onSaved,
}: {
  patientId: string;
  view: NursingProblemView;
  onSaved: () => void;
}) {
  const close = useCloseNursingProblem();
  const { ctx } = useNursingCareContext(patientId);
  const [values, setValues] = useState<NursingEvaluationValues>(() => emptyNursingEvaluation(view));
  const [validationError, setValidationError] = useState("");
  const goalsById = new Map(view.goals.map((g) => [g.id ?? "", g]));

  function setGoal(index: number, patch: Partial<NursingEvaluationValues["goals"][number]>) {
    setValues((v) => ({ ...v, goals: v.goals.map((g, i) => (i === index ? { ...g, ...patch } : g)) }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validateNursingEvaluation(values);
    setValidationError(error);
    if (error) return;
    const orders = [...view.ordersByActivity.values()].flat();
    close.mutate(buildNursingEvaluationBundle(view, values, ctx, orders), { onSuccess: onSaved });
  }

  return (
    <form className="prescription-form" onSubmit={handleSubmit}>
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={close.error} />
      <p className="nursing-problem-form__selected">{view.name}</p>
      <label className="nursing-problem-form__date">
        評価日
        <input type="date" value={values.date} onChange={(e) => setValues({ ...values, date: e.target.value })} />
      </label>

      {values.goals.map((item, index) => (
        <fieldset key={item.goalId}>
          <legend>{goalsById.get(item.goalId)?.description.text}</legend>
          <div className="nursing-problem-form__block">
            <label>
              達成度
              <select
                value={item.achievement}
                onChange={(e) => setGoal(index, { achievement: e.target.value as NursingAchievement | "" })}
              >
                <option value="">-</option>
                {NURSING_ACHIEVEMENT_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.display}
                  </option>
                ))}
              </select>
            </label>
            <label>
              内容
              <textarea rows={2} value={item.note} onChange={(e) => setGoal(index, { note: e.target.value })} />
            </label>
            {values.decision !== "resolve" && item.achievement !== "achieved" && (
              <label className="nursing-problem-form__date">
                次回評価予定日
                <input
                  type="date"
                  value={item.nextDueDate}
                  onChange={(e) => setGoal(index, { nextDueDate: e.target.value })}
                />
              </label>
            )}
          </div>
        </fieldset>
      ))}

      <fieldset>
        <legend>看護問題</legend>
        <div className="nursing-problem-form__block">
          <div className="nursing-problem-form__row">
            {NURSING_DECISION_OPTIONS.map((o) => (
              <label key={o.code} className="nursing-problem-form__inline">
                <input
                  type="radio"
                  name="nursing-decision"
                  checked={values.decision === o.code}
                  onChange={() => setValues({ ...values, decision: o.code as NursingDecision })}
                />
                {o.display}
              </label>
            ))}
          </div>
          <label>
            評価
            <textarea rows={3} value={values.note} onChange={(e) => setValues({ ...values, note: e.target.value })} />
          </label>
        </div>
      </fieldset>

      <div className="prescription-form__actions">
        <button type="submit" disabled={close.isPending}>
          {close.isPending ? "送信中..." : "登録"}
        </button>
      </div>
    </form>
  );
}

export function NursingPlanOrderPanel({
  patientId,
  carePlanId,
  onSaved,
}: {
  patientId: string;
  carePlanId: string;
  onSaved: () => void;
}) {
  const plans = useNursingCarePlans(patientId);
  const view = plans.data?.items.find((p) => p.carePlan.id === carePlanId);
  const admission = useDefaultOrderSetting(patientId);
  const { ctx, ready } = useNursingCareContext(patientId);
  const orderContext = useOrderContext();
  const create = useCreatePrescription();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [formValues, setFormValues] = useState<NursingOrderFormValues | null>(null);
  const at = today();

  if (!ready || plans.isPending || !admission.ready) return <p>読み込み中...</p>;
  if (!view) return <ErrorBanner error={plans.error ?? new Error("看護問題が見つかりません。")} />;
  if (admission.setting !== "inpatient") return <p>看護指示は入院中の患者にだけ登録できます。</p>;
  if (!ctx.recorder.practitionerId) return <p>医療従事者に紐づくアカウントでログインしてください。</p>;

  const activities = view.activities.filter((a) => !a.stopped && a.text.trim());
  const ordered = (id: string) => (view.ordersByActivity.get(id) ?? []).some((sr) => nursingOrderState(sr, at) === "active");
  const checked = selected ?? new Set(activities.filter((a) => !ordered(a.id)).map((a) => a.id));

  function toggle(id: string) {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function handleSubmit(values: NursingOrderFormValues) {
    // 看護計画から出す指示は看護師本人が依頼者で、出した時点で指示受け済みにする。
    const requester = {
      departmentId: orderContext.departmentId,
      departmentName: orderContext.departmentName,
      practitionerId: ctx.recorder.practitionerId,
      practitionerName: ctx.recorder.display,
    };
    const attribution = withOrderWard(requester, "inpatient", admission);
    create.mutate(buildNursingOrderBundle(values, patientId, attribution, ctx.encounterId, ctx.recorder), {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: NURSING_CARE_PLAN_KEY });
        onSaved();
      },
    });
  }

  if (formValues) {
    return (
      <NursingOrderForm
        patientId={patientId}
        initialValues={formValues}
        fixedProblem
        onSubmit={handleSubmit}
        submitting={create.isPending}
        submitError={create.error}
      />
    );
  }

  return (
    <div className="prescription-form">
      <p className="nursing-problem-form__selected">{view.name}</p>
      {activities.length === 0 ? (
        <p className="karte-tabpanel__empty">計画の行がありません。</p>
      ) : (
        <div className="nursing-problem-form__block">
          {activities.map((activity) => (
            <label key={activity.id} className="nursing-problem-form__check">
              <input type="checkbox" checked={checked.has(activity.id)} onChange={() => toggle(activity.id)} />
              {nursingActivityLabel(activity)}: {activity.text}
              {ordered(activity.id) && <span className="nursing-tab__plan-badge">指示中</span>}
            </label>
          ))}
        </div>
      )}
      <div className="prescription-form__actions">
        <button
          type="button"
          disabled={checked.size === 0}
          onClick={() =>
            setFormValues({
              lines: planActivityOrderLines(
                activities.filter((a) => checked.has(a.id)),
                carePlanId,
              ),
              problem: { conditionId: view.condition.id ?? "", display: view.name },
            })
          }
        >
          次へ
        </button>
      </div>
    </div>
  );
}
