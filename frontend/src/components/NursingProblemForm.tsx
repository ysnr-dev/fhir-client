import { useState, type FormEvent } from "react";
import type { NursingPlanActivityType, NursingStandardPlan, NursingTaxonomy, NursingTerm } from "../api/masterClient";
import { fetchNursingTerms } from "../api/masterClient";
import { useNursingStandardPlans, useNursingTermsByCode } from "../api/masterQueries";
import {
  NURSING_ACTIVITY_TYPES,
  NURSING_ACTIVITY_TYPE_LABELS,
  NURSING_ITEM_TYPE_LABELS,
  addIntervention,
  applyStandardPlan,
  emptyNursingActivity,
  emptyNursingGoal,
  interventionGroups,
  startFromStandardPlan,
  toggleFactor,
  validateNursingProblemForm,
  withDiagnosis,
  type NursingActivityValues,
  type NursingFactorKind,
  type NursingGoalValues,
  type NursingProblemEntry,
  type NursingProblemFormValues,
  type TermNames,
} from "../fhir/nursingCarePlanHelpers";
import type { NursingItemRef } from "../fhir/nursingOrderHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { NursingTermGuidance } from "./NursingTermGuidance";
import { NursingItemSearchModal } from "./NursingItemSearchModal";
import { NursingStandardPlanPickerModal, NursingTermPickerModal } from "./NursingProblemPickerModal";
import { TrashIcon } from "./icons/TrashIcon";

const FACTOR_KINDS: NursingFactorKind[] = ["defining_characteristic", "related_factor", "risk_factor"];

interface Props {
  /**
   * 立案の入口。standard_plan = 標準看護計画を選んで目標と OP/TP/EP を写す。
   * diagnosis = 看護診断を選び、目標に看護成果(NOC)、計画に看護介入(NIC)を選ぶ。
   */
  entry: NursingProblemEntry;
  initialValues: NursingProblemFormValues;
  /** 編集(計画の行に「中止」を出す)。 */
  editing?: boolean;
  onSubmit: (values: NursingProblemFormValues) => void;
  submitting: boolean;
  submitError: unknown;
  submitLabel?: string;
}

type Picker =
  | { kind: "standard_plan" }
  | { kind: "term"; taxonomy: NursingTaxonomy; goalIndex?: number }
  | { kind: "item"; activityId: string };

/** 標準看護計画が参照する看護成果・看護介入の名称をまとめて引く。 */
async function termNamesOf(plan: NursingStandardPlan): Promise<TermNames> {
  const lookup = async (taxonomy: NursingTaxonomy, codes: string[]) => {
    const unique = [...new Set(codes.filter(Boolean))];
    if (unique.length === 0) return new Map<string, string>();
    const result = await fetchNursingTerms({ taxonomy, level: "term", codes: unique });
    return new Map(result.items.map((t) => [t.code, t.name]));
  };
  const [outcomes, interventions] = await Promise.all([
    lookup("outcome", plan.goals.map((g) => g.outcome_code)),
    lookup("intervention", plan.activities.map((a) => a.intervention_code ?? "")),
  ]);
  return { outcomes, interventions };
}

// 看護問題の立案・編集。入口(標準看護計画 / 看護診断)ごとに流れが違う。
// - 標準看護計画: 計画を選ぶと目標と OP/TP/EP が写る。計画に看護診断があればそれが看護問題になる。
// - 看護診断: 看護診断を選び(ガイダンス・因子)、目標に看護成果、計画に看護介入を選ぶ。介入の行動が計画の行になる。
//   その診断に結びついた標準看護計画を反映することもできる(OP/TP/EP の行が入る)。
export function NursingProblemForm({
  entry,
  initialValues,
  editing = false,
  onSubmit,
  submitting,
  submitError,
  submitLabel = "登録",
}: Props) {
  const [values, setValues] = useState(initialValues);
  const [validationError, setValidationError] = useState("");
  const [picker, setPicker] = useState<Picker | null>(null);
  const [pickError, setPickError] = useState<unknown>(null);
  // 標準看護計画から選んだときの計画名(看護問題名は診断名になることがあるので別に持つ)。
  const [pickedPlanName, setPickedPlanName] = useState("");
  const diagnosisTerms = useNursingTermsByCode("diagnosis", values.diagnosis ? [values.diagnosis.code] : []);
  const term = diagnosisTerms.data?.items.find((t) => t.code === values.diagnosis?.code);
  const groups = interventionGroups(values.activities);
  const hasTyped = values.activities.some((a) => a.type !== null);
  const showOpTpEp = entry === "standard_plan" || hasTyped;
  const showInterventions = entry === "diagnosis" || groups.length > 0;

  async function handlePlanPicked(plan: NursingStandardPlan) {
    setPicker(null);
    try {
      const [names, diagnosis] = await Promise.all([
        termNamesOf(plan),
        plan.diagnosis_code
          ? fetchNursingTerms({ taxonomy: "diagnosis", level: "term", codes: [plan.diagnosis_code] }).then(
              (r) => r.items[0],
            )
          : Promise.resolve(undefined),
      ]);
      setPickError(null);
      setPickedPlanName(plan.name);
      setValues((v) => startFromStandardPlan(v, plan, diagnosis, names));
    } catch (error) {
      setPickError(error);
    }
  }

  async function handleApplyPlan(plan: NursingStandardPlan) {
    try {
      const names = await termNamesOf(plan);
      setPickError(null);
      setValues((v) => applyStandardPlan(v, plan, names));
    } catch (error) {
      setPickError(error);
    }
  }

  function handleTermPicked(selected: NursingTerm) {
    if (picker?.kind !== "term") return;
    const { taxonomy, goalIndex } = picker;
    setPicker(null);
    if (taxonomy === "diagnosis") {
      setValues((v) => withDiagnosis(v, selected));
    } else if (taxonomy === "intervention") {
      setValues((v) => addIntervention(v, selected));
    } else if (goalIndex !== undefined) {
      setValues((v) => ({
        ...v,
        goals: v.goals.map((g, i) =>
          i === goalIndex
            ? { ...g, outcomeCode: selected.code, outcomeName: selected.name, text: g.text.trim() ? g.text : selected.name }
            : g,
        ),
      }));
    }
  }

  function setGoal(index: number, patch: Partial<NursingGoalValues>) {
    setValues((v) => ({ ...v, goals: v.goals.map((g, i) => (i === index ? { ...g, ...patch } : g)) }));
  }

  function setActivity(id: string, patch: Partial<NursingActivityValues>) {
    setValues((v) => ({ ...v, activities: v.activities.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
  }

  function addActivity(type: NursingPlanActivityType | null, intervention?: { code: string; name: string }) {
    setValues((v) => ({ ...v, activities: [...v.activities, emptyNursingActivity(type, intervention)] }));
  }

  function removeActivity(id: string) {
    setValues((v) => ({ ...v, activities: v.activities.filter((a) => a.id !== id) }));
  }

  function removeIntervention(code: string, name: string) {
    setValues((v) => ({
      ...v,
      activities: v.activities.filter(
        (a) => !(a.type === null && (a.interventionCode || a.interventionName) === (code || name)),
      ),
    }));
  }

  function handleItemPicked(id: string, item: NursingItemRef, display: string) {
    const current = values.activities.find((a) => a.id === id);
    setActivity(id, { item, ...(display && !current?.text.trim() ? { text: display } : {}) });
    setPicker(null);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validateNursingProblemForm(values);
    setValidationError(error);
    if (!error) onSubmit(values);
  }

  function activityRow(activity: NursingActivityValues, label: string) {
    return (
      <div key={activity.id} className="nursing-problem-form__row">
        <input
          type="text"
          value={activity.text}
          onChange={(e) => setActivity(activity.id, { text: e.target.value })}
          aria-label={`${label} の内容`}
        />
        {activity.item ? (
          <span className="nursing-term-chip">
            {activity.item.kind === "act" ? "行為" : "観察"}: {activity.item.display}
            <button
              type="button"
              className="nursing-term-chip__remove"
              onClick={() => setActivity(activity.id, { item: null })}
              title={`${activity.item.display} を外す`}
              aria-label={`${activity.item.display} を外す`}
            >
              ×
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="rp-card__compact-button"
            onClick={() => setPicker({ kind: "item", activityId: activity.id })}
          >
            用語
          </button>
        )}
        {editing && (
          <label className="nursing-problem-form__inline">
            <input
              type="checkbox"
              checked={activity.stopped}
              onChange={(e) => setActivity(activity.id, { stopped: e.target.checked })}
            />
            中止
          </label>
        )}
        <button
          type="button"
          className="rp-card__icon-button"
          onClick={() => removeActivity(activity.id)}
          title="行を削除"
          aria-label="行を削除"
        >
          <TrashIcon />
        </button>
      </div>
    );
  }

  return (
    <>
      <form className="prescription-form" onSubmit={handleSubmit}>
        {validationError && (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">{validationError}</p>
          </div>
        )}
        <ErrorBanner error={submitError ?? pickError ?? diagnosisTerms.error} />

        <fieldset>
          <legend>看護問題</legend>
          <div className="nursing-problem-form__block">
            <div className="nursing-problem-form__row">
              {entry === "standard_plan" ? (
                <>
                  <button
                    type="button"
                    className="rp-card__compact-button"
                    onClick={() => setPicker({ kind: "standard_plan" })}
                  >
                    標準看護計画
                  </button>
                  {pickedPlanName && <span className="nursing-problem-form__selected">{pickedPlanName}</span>}
                </>
              ) : (
                !values.diagnosis && (
                  <button
                    type="button"
                    className="rp-card__compact-button"
                    onClick={() => setPicker({ kind: "term", taxonomy: "diagnosis" })}
                  >
                    看護診断（NANDA）
                  </button>
                )
              )}
              {values.diagnosis && (
                <span className="nursing-term-chip">
                  {values.diagnosis.code} {values.diagnosis.name}
                  <button
                    type="button"
                    className="nursing-term-chip__remove"
                    onClick={() => setValues((v) => ({ ...v, diagnosis: null, factors: [] }))}
                    title={`${values.diagnosis.name} を外す`}
                    aria-label={`${values.diagnosis.name} を外す`}
                  >
                    ×
                  </button>
                </span>
              )}
            </div>
            <label>
              名称
              <input type="text" value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} />
            </label>
            {term && <NursingTermGuidance term={term} />}
            <label className="nursing-problem-form__date">
              立案日
              <input
                type="date"
                value={values.onsetDate}
                onChange={(e) => setValues({ ...values, onsetDate: e.target.value })}
              />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>因子</legend>
          <FactorEditor term={term} values={values} onChange={setValues} />
        </fieldset>

        {entry === "diagnosis" && values.diagnosis && (
          <fieldset>
            <legend>標準看護計画</legend>
            <StandardPlanPicker
              diagnosisCode={values.diagnosis.code}
              selectedCode={values.standardPlanCode}
              onApply={(plan) => void handleApplyPlan(plan)}
            />
          </fieldset>
        )}

        <fieldset>
          <legend>{entry === "diagnosis" ? "目標（NOC）" : "目標"}</legend>
          <div className="nursing-problem-form__block">
            {values.goals.map((goal, index) => (
              <div key={goal.goalId || index} className="nursing-problem-form__row">
                <input
                  type="text"
                  value={goal.text}
                  onChange={(e) => setGoal(index, { text: e.target.value })}
                  aria-label={`目標 ${index + 1}`}
                />
                {goal.outcomeCode ? (
                  <span className="nursing-term-chip">
                    成果: {goal.outcomeName || goal.outcomeCode}
                    <button
                      type="button"
                      className="nursing-term-chip__remove"
                      onClick={() => setGoal(index, { outcomeCode: "", outcomeName: "" })}
                      title={`${goal.outcomeName || goal.outcomeCode} を外す`}
                      aria-label={`${goal.outcomeName || goal.outcomeCode} を外す`}
                    >
                      ×
                    </button>
                  </span>
                ) : (
                  entry === "diagnosis" && (
                    <button
                      type="button"
                      className="rp-card__compact-button"
                      onClick={() => setPicker({ kind: "term", taxonomy: "outcome", goalIndex: index })}
                    >
                      成果
                    </button>
                  )
                )}
                <label className="nursing-problem-form__inline">
                  評価予定日
                  <input type="date" value={goal.dueDate} onChange={(e) => setGoal(index, { dueDate: e.target.value })} />
                </label>
                <button
                  type="button"
                  className="rp-card__icon-button"
                  onClick={() => setValues((v) => ({ ...v, goals: v.goals.filter((_, i) => i !== index) }))}
                  title="目標を削除"
                  aria-label="目標を削除"
                >
                  <TrashIcon />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="rp-card__compact-button"
              onClick={() => setValues((v) => ({ ...v, goals: [...v.goals, emptyNursingGoal()] }))}
            >
              追加
            </button>
          </div>
        </fieldset>

        {showInterventions && (
          <fieldset>
            <legend>看護介入（NIC）</legend>
            <div className="nursing-problem-form__block">
              {groups.map((group) => (
                <div key={group.code || group.name} className="nursing-problem-form__intervention">
                  <div className="nursing-problem-form__row">
                    <span className="nursing-problem-form__intervention-name">{group.name || group.code}</span>
                    <button
                      type="button"
                      className="rp-card__compact-button"
                      onClick={() => addActivity(null, { code: group.code, name: group.name })}
                    >
                      行追加
                    </button>
                    <button
                      type="button"
                      className="rp-card__icon-button"
                      onClick={() => removeIntervention(group.code, group.name)}
                      title={`${group.name} を削除`}
                      aria-label={`${group.name} を削除`}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                  {group.rows.map((activity) => activityRow(activity, group.name))}
                </div>
              ))}
              <button
                type="button"
                className="rp-card__compact-button"
                onClick={() => setPicker({ kind: "term", taxonomy: "intervention" })}
              >
                介入追加
              </button>
            </div>
          </fieldset>
        )}

        {showOpTpEp &&
          NURSING_ACTIVITY_TYPES.map((type) => (
            <fieldset key={type}>
              <legend>{NURSING_ACTIVITY_TYPE_LABELS[type]}</legend>
              <div className="nursing-problem-form__block">
                {values.activities
                  .filter((a) => a.type === type)
                  .map((activity) => activityRow(activity, NURSING_ACTIVITY_TYPE_LABELS[type]))}
                <button type="button" className="rp-card__compact-button" onClick={() => addActivity(type)}>
                  追加
                </button>
              </div>
            </fieldset>
          ))}

        <div className="prescription-form__actions">
          <button type="submit" disabled={submitting}>
            {submitting ? "送信中..." : submitLabel}
          </button>
        </div>
      </form>

      {picker?.kind === "term" && (
        <NursingTermPickerModal taxonomy={picker.taxonomy} onSelect={handleTermPicked} onClose={() => setPicker(null)} />
      )}
      {picker?.kind === "standard_plan" && (
        <NursingStandardPlanPickerModal
          onSelect={(plan) => void handlePlanPicked(plan)}
          onClose={() => setPicker(null)}
        />
      )}
      {picker?.kind === "item" && (
        <NursingItemSearchModal
          onSelect={(item, display) => handleItemPicked(picker.activityId, item, display)}
          onClose={() => setPicker(null)}
        />
      )}
    </>
  );
}

function FactorEditor({
  term,
  values,
  onChange,
}: {
  term: NursingTerm | undefined;
  values: NursingProblemFormValues;
  onChange: (values: NursingProblemFormValues) => void;
}) {
  const [kind, setKind] = useState<NursingFactorKind>("related_factor");
  const [text, setText] = useState("");
  const masterFactors = (term?.items ?? []).filter((i): i is typeof i & { item_type: NursingFactorKind } =>
    FACTOR_KINDS.includes(i.item_type as NursingFactorKind),
  );
  const checked = (k: NursingFactorKind, name: string) => values.factors.some((f) => f.kind === k && f.name === name);
  const freeFactors = values.factors.filter(
    (f) => !masterFactors.some((m) => m.item_type === f.kind && m.name === f.name),
  );

  return (
    <div className="nursing-problem-form__block">
      {masterFactors.map((item) => (
        <label key={`${item.item_type}:${item.name}`} className="nursing-problem-form__check">
          <input
            type="checkbox"
            checked={checked(item.item_type, item.name)}
            onChange={(e) =>
              onChange(
                toggleFactor(values, { kind: item.item_type, code: item.code, name: item.name }, e.target.checked),
              )
            }
          />
          {NURSING_ITEM_TYPE_LABELS[item.item_type]}: {item.name}
        </label>
      ))}
      {freeFactors.map((factor) => (
        <div key={`${factor.kind}:${factor.name}`} className="nursing-problem-form__row">
          <span>
            {NURSING_ITEM_TYPE_LABELS[factor.kind]}: {factor.name}
          </span>
          <button
            type="button"
            className="rp-card__icon-button"
            onClick={() => onChange(toggleFactor(values, factor, false))}
            title="因子を削除"
            aria-label="因子を削除"
          >
            <TrashIcon />
          </button>
        </div>
      ))}
      <div className="nursing-problem-form__row">
        <select value={kind} onChange={(e) => setKind(e.target.value as NursingFactorKind)} aria-label="因子の種類">
          {FACTOR_KINDS.map((k) => (
            <option key={k} value={k}>
              {NURSING_ITEM_TYPE_LABELS[k]}
            </option>
          ))}
        </select>
        <input type="text" value={text} onChange={(e) => setText(e.target.value)} aria-label="因子" />
        <button
          type="button"
          className="rp-card__compact-button"
          disabled={!text.trim()}
          onClick={() => {
            onChange(toggleFactor(values, { kind, code: "", name: text.trim() }, true));
            setText("");
          }}
        >
          追加
        </button>
      </div>
    </div>
  );
}

function StandardPlanPicker({
  diagnosisCode,
  selectedCode,
  onApply,
}: {
  diagnosisCode: string;
  selectedCode: string;
  onApply: (plan: NursingStandardPlan) => void;
}) {
  const plans = useNursingStandardPlans([diagnosisCode]);
  const items = (plans.data?.items ?? []).filter((p) => p.active);
  const [code, setCode] = useState(selectedCode || "");
  const chosen = items.find((p) => p.code === code) ?? items[0];

  if (plans.isPending) return <p>読み込み中...</p>;
  if (items.length === 0) return <p className="karte-tabpanel__empty">標準看護計画はありません。</p>;
  return (
    <div className="nursing-problem-form__row">
      <select value={chosen?.code ?? ""} onChange={(e) => setCode(e.target.value)} aria-label="標準看護計画">
        {items.map((plan) => (
          <option key={plan.code} value={plan.code}>
            {plan.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="rp-card__compact-button"
        disabled={!chosen}
        onClick={() => chosen && onApply(chosen)}
      >
        反映
      </button>
    </div>
  );
}
