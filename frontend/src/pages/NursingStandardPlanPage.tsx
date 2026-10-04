import { useState } from "react";
import type {
  NursingPlanActivityType,
  NursingStandardPlan,
  NursingStandardPlanActivity,
  NursingStandardPlanGoal,
} from "../api/masterClient";
import {
  useNursingStandardPlanMutations,
  useNursingStandardPlans,
  useNursingTermTree,
} from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";
import { NursingItemSearchModal } from "../components/NursingItemSearchModal";
import { NURSING_ACTIVITY_TYPES, NURSING_ACTIVITY_TYPE_LABELS } from "../fhir/nursingCarePlanHelpers";
import { TrashIcon } from "../components/icons/TrashIcon";

// 標準看護計画。看護診断 1 件に目標と OP/TP/EP の雛形を結びつける。看護問題の立案で選ぶと写る。
export function NursingStandardPlanPage() {
  const [editing, setEditing] = useState<NursingStandardPlan | "new" | null>(null);
  const list = useNursingStandardPlans();
  const diagnoses = useNursingTermTree("diagnosis");
  const diagnosisName = (code: string | null) =>
    diagnoses.data?.items.find((t) => t.level === "term" && t.code === code)?.name ?? code ?? "";

  return (
    <div className="page">
      <div className="page__header">
        <h1>標準看護計画</h1>
        <div className="page__header-actions">
          <button type="button" onClick={() => setEditing("new")}>
            追加
          </button>
        </div>
      </div>

      <ErrorBanner error={list.error ?? diagnoses.error} />

      <table className="master-search__table">
        <thead>
          <tr>
            <th className="rad-code__compact">コード</th>
            <th>名称</th>
            <th>看護診断</th>
            <th className="rad-code__compact">目標</th>
            <th className="rad-code__compact">計画</th>
            <th className="rad-code__compact">有効</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((plan) => (
            <tr key={plan.id} className="master-search__row" onClick={() => setEditing(plan)}>
              <td className="rad-code__compact">{plan.code}</td>
              <td>{plan.name}</td>
              <td>{diagnosisName(plan.diagnosis_code)}</td>
              <td className="rad-code__compact">{plan.goals.length}</td>
              <td className="rad-code__compact">{plan.activities.length}</td>
              <td className="rad-code__compact">{plan.active ? "" : "無効"}</td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr>
              <td colSpan={6} className="master-search__empty">
                標準看護計画がありません。
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing !== null && (
        <PlanEditModal item={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

// 看護行為・看護観察の検索モーダルを重ねるので、この編集モーダルには <form> を書かない
// (Modal はポータルではなく、入れ子の form になる)。保存はボタンの onClick で行う。
function PlanEditModal({ item, onClose }: { item: NursingStandardPlan | null; onClose: () => void }) {
  const mutations = useNursingStandardPlanMutations();
  const diagnoses = useNursingTermTree("diagnosis");
  const outcomes = useNursingTermTree("outcome");
  const interventions = useNursingTermTree("intervention");
  const [code, setCode] = useState(item?.code ?? "");
  const [name, setName] = useState(item?.name ?? "");
  const [nameKana, setNameKana] = useState(item?.name_kana ?? "");
  const [diagnosisCode, setDiagnosisCode] = useState(item?.diagnosis_code ?? "");
  const [note, setNote] = useState(item?.note ?? "");
  const [active, setActive] = useState(item?.active ?? true);
  const [displayOrder, setDisplayOrder] = useState(item?.display_order != null ? String(item.display_order) : "");
  const [goals, setGoals] = useState<NursingStandardPlanGoal[]>(item?.goals ?? []);
  const [activities, setActivities] = useState<NursingStandardPlanActivity[]>(item?.activities ?? []);
  const [picking, setPicking] = useState<number | null>(null);

  const termsOf = (data: typeof diagnoses.data) => (data?.items ?? []).filter((t) => t.level === "term");

  function setGoal(index: number, patch: Partial<NursingStandardPlanGoal>) {
    setGoals((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function setActivity(index: number, patch: Partial<NursingStandardPlanActivity>) {
    setActivities((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function handleSave() {
    if (!code.trim() || !name.trim()) return;
    const payload = {
      code: code.trim(),
      name: name.trim(),
      name_kana: nameKana.trim() || null,
      diagnosis_code: diagnosisCode || null,
      note: note.trim() || null,
      active,
      display_order: displayOrder ? Number(displayOrder) : null,
      goals: goals.filter((g) => g.text.trim()),
      activities: activities.filter((a) => a.text.trim()),
    };
    if (item === null) await mutations.create.mutateAsync(payload);
    else await mutations.update.mutateAsync({ id: item.id, payload });
    onClose();
  }

  async function handleDelete() {
    if (item === null) return;
    if (!window.confirm(`${item.name} を削除しますか？`)) return;
    await mutations.remove.mutateAsync(item.id);
    onClose();
  }

  return (
    <Modal title="標準看護計画" onClose={onClose} className="modal--wide">
      <div className="prescription-form">
        <div className="lab-order-item__fields">
          <label>
            コード
            <input type="text" value={code} onChange={(e) => setCode(e.target.value)} disabled={item !== null} />
          </label>
          <label>
            名称
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            カナ
            <input type="text" value={nameKana} onChange={(e) => setNameKana(e.target.value)} />
          </label>
          <label>
            看護診断
            <select value={diagnosisCode} onChange={(e) => setDiagnosisCode(e.target.value)}>
              <option value="">-</option>
              {termsOf(diagnoses.data).map((t) => (
                <option key={t.code} value={t.code}>
                  {t.code} {t.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            表示順
            <input type="number" value={displayOrder} onChange={(e) => setDisplayOrder(e.target.value)} />
          </label>
          <label className="nursing-problem-form__check">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            有効
          </label>
        </div>

        <fieldset>
          <legend>目標</legend>
          <div className="nursing-problem-form__block">
            {goals.map((goal, index) => (
              <div key={index} className="nursing-problem-form__row">
                <input type="text" value={goal.text} onChange={(e) => setGoal(index, { text: e.target.value })} aria-label="目標" />
                <select
                  value={goal.outcome_code ?? ""}
                  onChange={(e) => setGoal(index, { outcome_code: e.target.value })}
                  aria-label="看護成果"
                >
                  <option value="">-</option>
                  {termsOf(outcomes.data).map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="rp-card__icon-button"
                  onClick={() => setGoals((rows) => rows.filter((_, i) => i !== index))}
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
              onClick={() => setGoals((rows) => [...rows, { text: "", outcome_code: "" }])}
            >
              追加
            </button>
          </div>
        </fieldset>

        {NURSING_ACTIVITY_TYPES.map((type: NursingPlanActivityType) => (
          <fieldset key={type}>
            <legend>{NURSING_ACTIVITY_TYPE_LABELS[type]}</legend>
            <div className="nursing-problem-form__block">
              {activities.map((activity, index) =>
                activity.activity_type !== type ? null : (
                  <div key={index} className="nursing-problem-form__row">
                    <input
                      type="text"
                      value={activity.text}
                      onChange={(e) => setActivity(index, { text: e.target.value })}
                      aria-label="内容"
                    />
                    <select
                      value={activity.intervention_code ?? ""}
                      onChange={(e) => setActivity(index, { intervention_code: e.target.value })}
                      aria-label="看護介入"
                    >
                      <option value="">-</option>
                      {termsOf(interventions.data).map((t) => (
                        <option key={t.code} value={t.code}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                    {activity.item_kind ? (
                      <span className="nursing-term-chip">
                        {activity.item_kind === "act" ? "行為" : "観察"}: {activity.item_name ?? ""}
                        <button
                          type="button"
                          className="nursing-term-chip__remove"
                          onClick={() => setActivity(index, { item_kind: "", code16: "", manage_no: "", item_name: "" })}
                          title={`${activity.item_name ?? ""} を外す`}
                          aria-label={`${activity.item_name ?? ""} を外す`}
                        >
                          ×
                        </button>
                      </span>
                    ) : (
                      <button type="button" className="rp-card__compact-button" onClick={() => setPicking(index)}>
                        用語
                      </button>
                    )}
                    <button
                      type="button"
                      className="rp-card__icon-button"
                      onClick={() => setActivities((rows) => rows.filter((_, i) => i !== index))}
                      title="行を削除"
                      aria-label="行を削除"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                ),
              )}
              <button
                type="button"
                className="rp-card__compact-button"
                onClick={() => setActivities((rows) => [...rows, { activity_type: type, text: "" }])}
              >
                追加
              </button>
            </div>
          </fieldset>
        ))}

        <label>
          備考
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>

        <ErrorBanner error={mutations.create.error ?? mutations.update.error ?? mutations.remove.error} />

        <div className="lab-order-item__actions">
          <button
            type="button"
            onClick={handleSave}
            disabled={!code.trim() || !name.trim() || mutations.create.isPending || mutations.update.isPending}
          >
            保存
          </button>
          {item !== null && (
            <button type="button" onClick={handleDelete} disabled={mutations.remove.isPending}>
              削除
            </button>
          )}
        </div>
      </div>

      {picking !== null && (
        <NursingItemSearchModal
          onSelect={(picked, display) => {
            const current = activities[picking];
            if (picked?.kind === "act") {
              setActivity(picking, {
                item_kind: "act",
                code16: picked.code16,
                manage_no: picked.manageNo,
                item_name: picked.display,
                ...(current && !current.text.trim() ? { text: display } : {}),
              });
            } else if (picked?.kind === "observation") {
              setActivity(picking, {
                item_kind: "observation",
                code16: "",
                manage_no: picked.manageNo,
                item_name: picked.display,
                ...(current && !current.text.trim() ? { text: display } : {}),
              });
            }
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </Modal>
  );
}
