import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { CtcaeTerm, Disease, LabItem, Medicine, MedicineUsage } from "../api/masterClient";
import { useRegimen, useRegimenMutations } from "../api/masterQueries";
import { useSelfDepartments } from "../api/queries";
import { DiseaseSearchModal } from "../components/DiseaseSearchModal";
import { ErrorBanner } from "../components/ErrorBanner";
import { CtcaeTermSearchModal } from "../components/CtcaeTermSearchModal";
import { LabItemSearchModal } from "../components/LabItemSearchModal";
import { MedicineSearchModal } from "../components/MedicineSearchModal";
import { UsageSearchModal } from "../components/UsageSearchModal";
import { departmentCode, departmentDisplayName } from "../fhir/departmentHelpers";
import { LINE_OPTIONS, METHOD_OPTIONS, ROUTE_OPTIONS, methodForRoute } from "../fhir/injectionHelpers";
import {
  CTCAE_GRADE_OPTIONS,
  REGIMEN_DOSE_BASIS_OPTIONS,
  REGIMEN_DRUG_ROLE_OPTIONS,
  REGIMEN_EMETIC_RISK_OPTIONS,
  REGIMEN_LAB_CATEGORY_OPTIONS,
  REGIMEN_PURPOSE_OPTIONS,
  REGIMEN_SETTING_OPTIONS,
  REGIMEN_STATUS_OPTIONS,
  REGIMEN_STEP_USAGE_TYPE_OPTIONS,
  cycleDaysOf,
  doseUnitSuffix,
  draftFromRegimen,
  emptyAdverseEventDraft,
  defaultDrugSettings,
  emptyDrugDraft,
  emptyLabCriterionDraft,
  emptyRegimenDraft,
  emptyStepDraft,
  newDraftKey,
  parseDays,
  payloadFromDraft,
  validateRegimenDraft,
  type RegimenAdverseEventDraft,
  type RegimenDraft,
  type RegimenDrugDraft,
  type RegimenLabCriterionDraft,
  type RegimenStepDraft,
} from "../fhir/regimenHelpers";
import type { RegimenEmeticRisk, RegimenPurpose, RegimenSetting, RegimenStatus } from "../api/masterClient";
import { useValidationError } from "../hooks/useValidationError";
import { makeFieldUpdater } from "../lib/form";

// 化学療法レジメンの登録・編集。1 レジメン 1 ページで、本体と子(適応疾患・投与
// ステップ・薬剤・検査基準・副作用)をローカルの draft に持ち、「保存」で 1 リクエスト
// にまとめる。薬剤・病名・検査項目の検索モーダルを開くので、外側は <form> にしない
// (Modal は非ポータルで、入れ子の form が外側の submit を誘発する)。
// 設計は docs/chemo-regimen-design.md。

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L12 4M6.5 6.5v5M9.5 6.5v5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type Picker =
  | { kind: "disease" }
  | { kind: "medicine"; stepKey: number }
  | { kind: "usage"; stepKey: number }
  | { kind: "lab"; criterionKey: number }
  | { kind: "ctcae"; adverseEventKey: number }
  | null;

function moveItem<T>(items: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= items.length) return items;
  const next = items.slice();
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function RegimenEditorPage() {
  const { regimenId } = useParams<{ regimenId: string }>();
  const navigate = useNavigate();
  const isNew = regimenId === undefined;
  const detail = useRegimen(isNew ? null : regimenId);
  const mutations = useRegimenMutations();
  const { departments } = useSelfDepartments();

  const [draft, setDraft] = useState<RegimenDraft>(emptyRegimenDraft);
  // 読み込んだレジメンの id。同じ id の再取得(フォーカス復帰など)で入力中の draft を
  // 上書きしないよう、id が変わったときだけ draft を作り直す。
  const [loadedId, setLoadedId] = useState<number | null>(null);
  const [validationError, setValidationError, validationErrorRef] = useValidationError();
  const [picker, setPicker] = useState<Picker>(null);
  const update = makeFieldUpdater(setDraft);

  useEffect(() => {
    if (!detail.data || detail.data.id === loadedId) return;
    setDraft(draftFromRegimen(detail.data));
    setLoadedId(detail.data.id);
    // 複製で別のレジメンに移ったとき、前の画面の入力エラーを持ち越さない。
    setValidationError(null);
  }, [detail.data, loadedId, setValidationError]);

  const savedId = detail.data?.id ?? null;
  const cycleDays = cycleDaysOf(draft);

  async function handleSave() {
    const message = validateRegimenDraft(draft);
    setValidationError(message);
    if (message) return;

    const payload = payloadFromDraft(draft);
    if (savedId === null) {
      const created = await mutations.create.mutateAsync(payload);
      navigate(`/regimens/${created.id}`, { replace: true });
    } else {
      const updated = await mutations.update.mutateAsync({ id: savedId, payload });
      // 採番されたコードや解決された名称を draft に戻す(行の key は作り直る)。
      setDraft(draftFromRegimen(updated));
    }
  }

  async function handleCopy() {
    if (savedId === null) return;
    const copied = await mutations.copy.mutateAsync({ id: savedId });
    navigate(`/regimens/${copied.id}`);
  }

  async function handleDelete() {
    if (savedId === null) return;
    if (!window.confirm(`${draft.name} を削除しますか？（投与内容・基準もすべて削除されます）`)) return;
    await mutations.remove.mutateAsync(savedId);
    navigate("/regimens");
  }

  function handleDepartmentChange(id: string) {
    const department = departments.find((d) => d.id === id);
    setDraft({
      ...draft,
      departmentCode: department ? departmentCode(department) : "",
      departmentName: department ? departmentDisplayName(department) : "",
    });
  }
  const selectedDepartmentId = departments.find((d) => departmentCode(d) === draft.departmentCode)?.id ?? "";

  // ---- 子の更新 ----

  function updateStep(key: number, patch: Partial<RegimenStepDraft>) {
    setDraft((d) => ({ ...d, steps: d.steps.map((s) => (s.key === key ? { ...s, ...patch } : s)) }));
  }

  function updateDrug(stepKey: number, drugKey: number, patch: Partial<RegimenDrugDraft>) {
    setDraft((d) => ({
      ...d,
      steps: d.steps.map((s) =>
        s.key === stepKey
          ? { ...s, drugs: s.drugs.map((g) => (g.key === drugKey ? { ...g, ...patch } : g)) }
          : s,
      ),
    }));
  }

  function addMedicine(stepKey: number, medicine: Medicine) {
    const step = draft.steps.find((s) => s.key === stepKey);
    // 種類と算出基準の既定は薬効分類から決める(`defaultDrugSettings`)。どちらも後から直せる。
    const drug = { ...emptyDrugDraft(), ...defaultDrugSettings(medicine, step?.usageType ?? "drip") };
    drug.medicine = { code: medicine.medicine_code, name: medicine.name, unitName: medicine.unit_name ?? "" };
    setDraft((d) => ({
      ...d,
      steps: d.steps.map((s) => (s.key === stepKey ? { ...s, drugs: [...s.drugs, drug] } : s)),
    }));
  }

  function updateLabCriterion(key: number, patch: Partial<RegimenLabCriterionDraft>) {
    setDraft((d) => ({
      ...d,
      labCriteria: d.labCriteria.map((c) => (c.key === key ? { ...c, ...patch } : c)),
    }));
  }

  function updateAdverseEvent(key: number, patch: Partial<RegimenAdverseEventDraft>) {
    setDraft((d) => ({
      ...d,
      adverseEvents: d.adverseEvents.map((a) => (a.key === key ? { ...a, ...patch } : a)),
    }));
  }

  const saving = mutations.create.isPending || mutations.update.isPending;
  const pickerStep = picker && "stepKey" in picker ? draft.steps.find((s) => s.key === picker.stepKey) : undefined;

  if (!isNew && detail.isPending) {
    return (
      <div className="page">
        <p>読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="page regimen-editor">
      <div className="page__header">
        <h1>{isNew ? "レジメンを追加" : "レジメンを編集"}</h1>
        <div className="page__header-actions">
          <Link to="/regimens" className="button">
            一覧へ戻る
          </Link>
        </div>
      </div>

      {validationError && (
        <div className="error-banner" role="alert" ref={validationErrorRef}>
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={detail.error} />
      <ErrorBanner
        error={mutations.create.error ?? mutations.update.error ?? mutations.copy.error ?? mutations.remove.error}
      />

      {/* ---- 基本情報 ---- */}
      <section className="lab-order-item__section">
        <div className="lab-order-item__section-head">
          <h3>基本情報</h3>
        </div>
        <div className="lab-order-item__fields">
          <label>
            レジメンコード
            <input
              type="text"
              value={draft.regimenCode}
              onChange={(e) => update("regimenCode", e.target.value)}
              placeholder={isNew ? "空欄なら自動採番" : undefined}
              disabled={!isNew}
            />
          </label>
          <label>
            レジメン名
            <input
              type="text"
              className="regimen-editor__name"
              value={draft.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="mFOLFOX6 など"
            />
          </label>
          <label>
            略称
            <input type="text" value={draft.shortName} onChange={(e) => update("shortName", e.target.value)} />
          </label>
          <label>
            カナ(検索用)
            <input type="text" value={draft.nameKana} onChange={(e) => update("nameKana", e.target.value)} />
          </label>
          <label>
            診療科
            <select value={selectedDepartmentId} onChange={(e) => handleDepartmentChange(e.target.value)}>
              <option value="">未指定</option>
              {draft.departmentCode && !selectedDepartmentId && (
                <option value="">{draft.departmentName || draft.departmentCode}</option>
              )}
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {departmentDisplayName(d)}
                </option>
              ))}
            </select>
          </label>
          <label>
            治療目的
            <select value={draft.purpose} onChange={(e) => update("purpose", e.target.value as RegimenPurpose | "")}>
              <option value="">未指定</option>
              {REGIMEN_PURPOSE_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.display}
                </option>
              ))}
            </select>
          </label>
          <label>
            実施区分
            <select value={draft.setting} onChange={(e) => update("setting", e.target.value as RegimenSetting | "")}>
              <option value="">未指定</option>
              {REGIMEN_SETTING_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.display}
                </option>
              ))}
            </select>
          </label>
          <label>
            制吐リスク
            <select
              value={draft.emeticRisk}
              onChange={(e) => update("emeticRisk", e.target.value as RegimenEmeticRisk | "")}
            >
              <option value="">未指定</option>
              {REGIMEN_EMETIC_RISK_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.display}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="lab-order-item__fields">
          <label>
            状態
            <select value={draft.status} onChange={(e) => update("status", e.target.value as RegimenStatus)}>
              {REGIMEN_STATUS_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.display}
                </option>
              ))}
            </select>
          </label>
          <label>
            承認日
            <input type="date" value={draft.approvedOn} onChange={(e) => update("approvedOn", e.target.value)} />
          </label>
          <label>
            承認者
            <input
              type="text"
              value={draft.approvedBy}
              onChange={(e) => update("approvedBy", e.target.value)}
              placeholder="レジメン審査委員会 など"
            />
          </label>
          <label>
            有効開始日
            <input type="date" value={draft.validFrom} onChange={(e) => update("validFrom", e.target.value)} />
          </label>
          <label>
            有効終了日
            <input type="date" value={draft.validTo} onChange={(e) => update("validTo", e.target.value)} />
          </label>
          <label>
            表示順
            <input
              type="number"
              value={draft.displayOrder}
              onChange={(e) => update("displayOrder", e.target.value)}
            />
          </label>
          <label>
            備考
            <input type="text" value={draft.note} onChange={(e) => update("note", e.target.value)} />
          </label>
        </div>
      </section>

      {/* ---- 適応疾患 ---- */}
      <section className="lab-order-item__section">
        <div className="lab-order-item__section-head">
          <h3>適応疾患</h3>
          <button type="button" onClick={() => setPicker({ kind: "disease" })}>
            病名を追加
          </button>
        </div>
        <table className="master-search__table regimen-editor__rows">
          <thead>
            <tr>
              <th>病名</th>
              <th className="rad-item__compact">ICD10</th>
              <th className="rad-item__compact">管理番号</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {draft.indications.map((row) => (
              <tr key={row.key}>
                <td>{row.name}</td>
                <td className="rad-item__compact">{row.icd10}</td>
                <td className="rad-item__compact">{row.managementNumber}</td>
                <td className="master-search__actions">
                  <button
                    type="button"
                    className="rp-card__icon-button"
                    title="外す"
                    aria-label="外す"
                    onClick={() =>
                      update(
                        "indications",
                        draft.indications.filter((i) => i.key !== row.key),
                      )
                    }
                  >
                    <TrashIcon />
                  </button>
                </td>
              </tr>
            ))}
            {draft.indications.length === 0 && (
              <tr>
                <td colSpan={4} className="master-search__empty">
                  登録がありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* ---- スケジュール ---- */}
      <section className="lab-order-item__section">
        <div className="lab-order-item__section-head">
          <h3>スケジュール</h3>
        </div>
        <div className="lab-order-item__fields">
          <label>
            投与期間(日)
            <input
              type="number"
              min="0"
              value={draft.treatmentDays}
              onChange={(e) => update("treatmentDays", e.target.value)}
            />
          </label>
          <label>
            休薬期間(日)
            <input type="number" min="0" value={draft.restDays} onChange={(e) => update("restDays", e.target.value)} />
          </label>
          <div className="regimen-editor__derived">
            1 クール
            <strong>{cycleDays > 0 ? `${cycleDays} 日` : "—"}</strong>
          </div>
          <label>
            予定クール数
            <input
              type="number"
              min="1"
              value={draft.plannedCycles}
              onChange={(e) => update("plannedCycles", e.target.value)}
              placeholder="空欄は継続"
            />
          </label>
        </div>
      </section>

      {/* ---- 投与内容 ---- */}
      <section className="lab-order-item__section">
        <div className="lab-order-item__section-head">
          <h3>投与内容</h3>
        </div>
        {draft.steps.map((step, index) => (
          <StepCard
            key={step.key}
            step={step}
            index={index}
            count={draft.steps.length}
            onChange={(patch) => updateStep(step.key, patch)}
            onDrugChange={(drugKey, patch) => updateDrug(step.key, drugKey, patch)}
            onRemoveDrug={(drugKey) =>
              updateStep(step.key, { drugs: step.drugs.filter((g) => g.key !== drugKey) })
            }
            onAddMedicine={() => setPicker({ kind: "medicine", stepKey: step.key })}
            onPickUsage={() => setPicker({ kind: "usage", stepKey: step.key })}
            onMove={(delta) => update("steps", moveItem(draft.steps, index, delta))}
            onRemove={() =>
              update(
                "steps",
                draft.steps.filter((s) => s.key !== step.key),
              )
            }
          />
        ))}
        <div className="lab-order-item__actions">
          <button type="button" onClick={() => update("steps", [...draft.steps, emptyStepDraft("drip")])}>
            ＋ 注射のステップ
          </button>
          <button type="button" onClick={() => update("steps", [...draft.steps, emptyStepDraft("oral")])}>
            ＋ 内服のステップ
          </button>
        </div>
      </section>

      {/* ---- Day 表 ---- */}
      {draft.steps.length > 0 && cycleDays > 0 && <DayTable steps={draft.steps} cycleDays={cycleDays} />}

      {/* ---- 適応基準 ---- */}
      <section className="lab-order-item__section">
        <div className="lab-order-item__section-head">
          <h3>適応基準(検査結果値)</h3>
          <button type="button" onClick={() => update("labCriteria", [...draft.labCriteria, emptyLabCriterionDraft()])}>
            検査基準を追加
          </button>
        </div>
        <div className="lab-order-item__table-wrap">
          <table className="master-search__table regimen-editor__rows">
            <thead>
              <tr>
                <th className="rad-item__compact">区分</th>
                <th>検査項目</th>
                <th className="rad-item__compact">分析物</th>
                <th className="rad-item__compact">単位</th>
                <th className="rad-item__compact">下限</th>
                <th className="rad-item__compact">上限</th>
                <th>備考</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {draft.labCriteria.map((row) => (
                <tr key={row.key}>
                  <td className="rad-item__compact">
                    <select
                      value={row.category}
                      onChange={(e) =>
                        updateLabCriterion(row.key, {
                          category: e.target.value as RegimenLabCriterionDraft["category"],
                        })
                      }
                    >
                      {REGIMEN_LAB_CATEGORY_OPTIONS.map((o) => (
                        <option key={o.code} value={o.code}>
                          {o.display}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <div className="regimen-editor__pick">
                      <input
                        type="text"
                        value={row.itemName}
                        onChange={(e) => updateLabCriterion(row.key, { itemName: e.target.value })}
                        placeholder="好中球数 / CCr など"
                      />
                      <button
                        type="button"
                        className="rp-card__compact-button"
                        onClick={() => setPicker({ kind: "lab", criterionKey: row.key })}
                      >
                        選択
                      </button>
                    </div>
                  </td>
                  <td className="rad-item__compact">
                    <input
                      type="text"
                      className="regimen-editor__code-input"
                      value={row.analyteCode}
                      onChange={(e) => updateLabCriterion(row.key, { analyteCode: e.target.value })}
                      placeholder="JLAC11"
                    />
                  </td>
                  <td className="rad-item__compact">
                    <input
                      type="text"
                      className="regimen-editor__unit-input"
                      value={row.unit}
                      onChange={(e) => updateLabCriterion(row.key, { unit: e.target.value })}
                    />
                  </td>
                  <td className="rad-item__compact">
                    <input
                      type="number"
                      step="any"
                      className="regimen-editor__num-input"
                      value={row.lowerLimit}
                      onChange={(e) => updateLabCriterion(row.key, { lowerLimit: e.target.value })}
                    />
                  </td>
                  <td className="rad-item__compact">
                    <input
                      type="number"
                      step="any"
                      className="regimen-editor__num-input"
                      value={row.upperLimit}
                      onChange={(e) => updateLabCriterion(row.key, { upperLimit: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={row.note}
                      onChange={(e) => updateLabCriterion(row.key, { note: e.target.value })}
                    />
                  </td>
                  <td className="master-search__actions">
                    <button
                      type="button"
                      className="rp-card__icon-button"
                      title="外す"
                      aria-label="外す"
                      onClick={() =>
                        update(
                          "labCriteria",
                          draft.labCriteria.filter((c) => c.key !== row.key),
                        )
                      }
                    >
                      <TrashIcon />
                    </button>
                  </td>
                </tr>
              ))}
              {draft.labCriteria.length === 0 && (
                <tr>
                  <td colSpan={8} className="master-search__empty">
                    登録がありません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="regimen-editor__texts">
          <label>
            適応の補足
            <textarea
              rows={3}
              value={draft.indicationNote}
              onChange={(e) => update("indicationNote", e.target.value)}
            />
          </label>
          <label>
            中止基準
            <textarea
              rows={3}
              value={draft.discontinuationCriteria}
              onChange={(e) => update("discontinuationCriteria", e.target.value)}
            />
          </label>
          <label>
            減量基準
            <textarea
              rows={3}
              value={draft.doseReductionCriteria}
              onChange={(e) => update("doseReductionCriteria", e.target.value)}
            />
          </label>
        </div>
      </section>

      {/* ---- 副作用 ---- */}
      <section className="lab-order-item__section">
        <div className="lab-order-item__section-head">
          <h3>副作用</h3>
          <button
            type="button"
            onClick={() => update("adverseEvents", [...draft.adverseEvents, emptyAdverseEventDraft()])}
          >
            副作用を追加
          </button>
        </div>
        <table className="master-search__table regimen-editor__rows">
          <thead>
            <tr>
              <th>用語(CTCAE)</th>
              <th className="rad-item__compact">Grade</th>
              <th>対処</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {draft.adverseEvents.map((row) => (
              <tr key={row.key}>
                <td>
                  <div className="regimen-editor__with-picker">
                    <input
                      type="text"
                      value={row.term}
                      onChange={(e) => updateAdverseEvent(row.key, { term: e.target.value })}
                      placeholder="末梢性感覚ニューロパチー など"
                    />
                    <button
                      type="button"
                      className="rp-card__compact-button"
                      onClick={() => setPicker({ kind: "ctcae", adverseEventKey: row.key })}
                    >
                      選択
                    </button>
                  </div>
                </td>
                <td className="rad-item__compact">
                  <select value={row.grade} onChange={(e) => updateAdverseEvent(row.key, { grade: e.target.value })}>
                    <option value="">—</option>
                    {CTCAE_GRADE_OPTIONS.map((g) => (
                      <option key={g} value={g}>
                        Grade {g}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="text"
                    value={row.note}
                    onChange={(e) => updateAdverseEvent(row.key, { note: e.target.value })}
                  />
                </td>
                <td className="master-search__actions">
                  <button
                    type="button"
                    className="rp-card__icon-button"
                    title="外す"
                    aria-label="外す"
                    onClick={() =>
                      update(
                        "adverseEvents",
                        draft.adverseEvents.filter((a) => a.key !== row.key),
                      )
                    }
                  >
                    <TrashIcon />
                  </button>
                </td>
              </tr>
            ))}
            {draft.adverseEvents.length === 0 && (
              <tr>
                <td colSpan={4} className="master-search__empty">
                  登録がありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* ---- 参考文献 ---- */}
      <section className="lab-order-item__section lab-order-item__section--tail">
        <div className="lab-order-item__section-head">
          <h3>参考文献</h3>
        </div>
        <div className="regimen-editor__texts">
          <label>
            <textarea
              rows={3}
              value={draft.referencesNote}
              onChange={(e) => update("referencesNote", e.target.value)}
              placeholder="論文・ガイドライン・添付文書など(1 行 1 件)"
            />
          </label>
        </div>
      </section>

      <div className="lab-order-item__actions regimen-editor__footer">
        <button type="button" onClick={handleSave} disabled={saving}>
          保存
        </button>
        {savedId !== null && (
          <>
            <button type="button" onClick={handleCopy} disabled={mutations.copy.isPending}>
              複製
            </button>
            <button type="button" onClick={handleDelete} disabled={mutations.remove.isPending}>
              削除
            </button>
          </>
        )}
      </div>

      {picker?.kind === "disease" && (
        <DiseaseSearchModal
          onSelect={(disease: Disease) => {
            setPicker(null);
            if (draft.indications.some((i) => i.managementNumber === disease.management_number)) return;
            update("indications", [
              ...draft.indications,
              {
                key: newDraftKey(),
                managementNumber: disease.management_number,
                name: disease.name,
                icd10: disease.icd10_2013 ?? "",
              },
            ]);
          }}
          onClose={() => setPicker(null)}
        />
      )}
      {picker?.kind === "medicine" && (
        <MedicineSearchModal
          title={pickerStep?.usageType === "oral" ? "内服薬を選択" : "注射薬を選択"}
          dosageForm={pickerStep?.usageType === "oral" ? "1" : "4"}
          onSelect={(medicine: Medicine) => {
            setPicker(null);
            addMedicine(picker.stepKey, medicine);
          }}
          onClose={() => setPicker(null)}
        />
      )}
      {picker?.kind === "usage" && (
        <UsageSearchModal
          initialFilters={{ basicUsageCategory: "内服" }}
          onSelect={(usage: MedicineUsage) => {
            setPicker(null);
            updateStep(picker.stepKey, { usage: { code: usage.usage_code, name: usage.usage_name } });
          }}
          onClose={() => setPicker(null)}
        />
      )}
      {picker?.kind === "ctcae" && (
        <CtcaeTermSearchModal
          onSelect={(term: CtcaeTerm) => {
            setPicker(null);
            updateAdverseEvent(picker.adverseEventKey, { term: term.term_ja });
          }}
          onClose={() => setPicker(null)}
        />
      )}
      {picker?.kind === "lab" && (
        <LabItemSearchModal
          onSelect={(item: LabItem) => {
            setPicker(null);
            updateLabCriterion(picker.criterionKey, {
              // 材料・測定法の違いをまとめるため分析物(先頭 5 桁)だけを持つ。
              analyteCode: item.jlac11_code.slice(0, 5),
              itemName: item.fhir_item_name ?? item.abbreviation ?? item.major_item ?? "",
              unit: item.display_unit ?? "",
            });
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

// ---- 投与ステップ ----

interface StepCardProps {
  step: RegimenStepDraft;
  index: number;
  count: number;
  onChange: (patch: Partial<RegimenStepDraft>) => void;
  onDrugChange: (drugKey: number, patch: Partial<RegimenDrugDraft>) => void;
  onRemoveDrug: (drugKey: number) => void;
  onAddMedicine: () => void;
  onPickUsage: () => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}

function StepCard({
  step,
  index,
  count,
  onChange,
  onDrugChange,
  onRemoveDrug,
  onAddMedicine,
  onPickUsage,
  onMove,
  onRemove,
}: StepCardProps) {
  const oral = step.usageType === "oral";
  const drip = step.usageType === "drip";

  function handleUsageTypeChange(usageType: RegimenStepDraft["usageType"]) {
    const patch: Partial<RegimenStepDraft> = { usageType };
    if (usageType === "oral") {
      patch.routeCode = "";
      patch.methodCode = "";
      patch.lineCode = "";
    } else if (!step.routeCode) {
      patch.routeCode = "IV";
    }
    onChange(patch);
  }

  return (
    <section className="regimen-step">
      <div className="regimen-step__head">
        {/* 番号は見出し欄のラベル位置に置き、投与日・用法種別のラベルと高さを揃える。 */}
        <label className="regimen-step__field regimen-step__name-field">
          {index + 1}
          <input
            type="text"
            className="regimen-step__name"
            value={step.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="見出し(前投薬 / オキサリプラチン など)"
          />
        </label>
        <label className="regimen-step__field">
          投与日
          <input
            type="text"
            className="regimen-step__days"
            value={step.daysText}
            onChange={(e) => onChange({ daysText: e.target.value })}
            placeholder="1, 8, 15"
          />
        </label>
        <label className="regimen-step__field">
          用法種別
          <select
            value={step.usageType}
            onChange={(e) => handleUsageTypeChange(e.target.value as RegimenStepDraft["usageType"])}
          >
            {REGIMEN_STEP_USAGE_TYPE_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
        <span className="regimen-step__tools">
          <button
            type="button"
            className="rp-card__icon-button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            title="上へ"
            aria-label="上へ"
          >
            ↑
          </button>
          <button
            type="button"
            className="rp-card__icon-button"
            onClick={() => onMove(1)}
            disabled={index === count - 1}
            title="下へ"
            aria-label="下へ"
          >
            ↓
          </button>
          <button
            type="button"
            className="rp-card__icon-button"
            onClick={onRemove}
            title="ステップを削除"
            aria-label="ステップを削除"
          >
            <TrashIcon />
          </button>
        </span>
      </div>

      <table className="master-search__table regimen-editor__rows regimen-step__drugs">
        {/* 医薬品名は長く、他の入力欄と同じ行に置くと必ず折り返す。薬剤 1 件を
            2 行(1 行目 = 医薬品名、2 行目 = 種類ほかの入力)に分け、行の組は
            tbody で括って区切りを見せる。 */}
        <thead>
          <tr>
            <th className="rad-item__compact">種類</th>
            <th className="rad-item__compact">算出基準</th>
            <th className="rad-item__compact">基準値</th>
            <th className="rad-item__compact">単位</th>
            <th className="rad-item__compact">上限値</th>
            <th>コメント</th>
            <th></th>
          </tr>
        </thead>
        {step.drugs.map((drug) => (
          <tbody key={drug.key} className="regimen-drug">
            <tr className="regimen-drug__name">
              <td colSpan={7}>
                {drug.medicine?.name}
                {drug.medicine?.unitName && (
                  <span className="lab-order-item__code">（{drug.medicine.unitName}）</span>
                )}
              </td>
            </tr>
            <tr>
              <td className="rad-item__compact">
                <select
                  value={drug.drugRole}
                  onChange={(e) => onDrugChange(drug.key, { drugRole: e.target.value as RegimenDrugDraft["drugRole"] })}
                >
                  {REGIMEN_DRUG_ROLE_OPTIONS.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.display}
                    </option>
                  ))}
                </select>
              </td>
              <td className="rad-item__compact">
                <select
                  value={drug.doseBasis}
                  onChange={(e) => {
                    const doseBasis = e.target.value as RegimenDrugDraft["doseBasis"];
                    onDrugChange(drug.key, {
                      doseBasis,
                      // 製剤単位に切り替えたら単位は薬価算定単位、それ以外は mg を既定にする。
                      doseUnit:
                        doseBasis === "unit"
                          ? (drug.medicine?.unitName ?? "")
                          : drug.doseBasis === "unit"
                            ? "mg"
                            : drug.doseUnit,
                    });
                  }}
                >
                  {REGIMEN_DOSE_BASIS_OPTIONS.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.display}
                    </option>
                  ))}
                </select>
              </td>
              <td className="rad-item__compact">
                <input
                  type="number"
                  step="any"
                  min="0"
                  className="regimen-editor__num-input"
                  value={drug.doseValue}
                  onChange={(e) => onDrugChange(drug.key, { doseValue: e.target.value })}
                />
              </td>
              <td className="rad-item__compact">
                <input
                  type="text"
                  className="regimen-editor__unit-input"
                  value={drug.doseUnit}
                  onChange={(e) => onDrugChange(drug.key, { doseUnit: e.target.value })}
                />
                <span className="regimen-editor__suffix">{doseUnitSuffix(drug.doseBasis, drug.doseUnit)}</span>
              </td>
              <td className="rad-item__compact">
                <input
                  type="number"
                  step="any"
                  min="0"
                  className="regimen-editor__num-input"
                  value={drug.doseMax}
                  onChange={(e) => onDrugChange(drug.key, { doseMax: e.target.value })}
                />
              </td>
              <td>
                <input
                  type="text"
                  value={drug.note}
                  onChange={(e) => onDrugChange(drug.key, { note: e.target.value })}
                />
              </td>
              <td className="master-search__actions">
                <button
                  type="button"
                  className="rp-card__icon-button"
                  title="外す"
                  aria-label="外す"
                  onClick={() => onRemoveDrug(drug.key)}
                >
                  <TrashIcon />
                </button>
              </td>
            </tr>
          </tbody>
        ))}
        {step.drugs.length === 0 && (
          <tbody>
            <tr>
              <td colSpan={7} className="master-search__empty">
                薬剤がありません
              </td>
            </tr>
          </tbody>
        )}
      </table>
      <div className="lab-order-item__actions">
        <button type="button" className="rp-card__compact-button" onClick={onAddMedicine}>
          ＋ 医薬品
        </button>
      </div>
      {/* 用法は処方・注射のオーダー画面と同じく医薬品の下に置く。 */}
      {!oral && (
        <div className="injection-usage regimen-step__usage">
        {!oral && (
          <>
            <label>
              投与経路
              <select
                value={step.routeCode}
                onChange={(e) =>
                  onChange({
                    routeCode: e.target.value,
                    methodCode: methodForRoute(e.target.value, step.methodCode),
                  })
                }
              >
                <option value="">未指定</option>
                {ROUTE_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.display}
                  </option>
                ))}
              </select>
            </label>
            <label>
              手技
              <select value={step.methodCode} onChange={(e) => onChange({ methodCode: e.target.value })}>
                <option value="">未指定</option>
                {METHOD_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.display}
                  </option>
                ))}
              </select>
            </label>
            <label>
              ライン
              <select value={step.lineCode} onChange={(e) => onChange({ lineCode: e.target.value })}>
                <option value="">未指定</option>
                {LINE_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.display}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {drip && (
          <>
            <label>
              点滴時間(分)
              <input
                type="number"
                min="1"
                value={step.infusionMinutes}
                onChange={(e) => onChange({ infusionMinutes: e.target.value })}
              />
            </label>
            <label>
              投与速度(mL/h)
              <input
                type="number"
                min="0"
                step="0.1"
                value={step.rate}
                onChange={(e) => onChange({ rate: e.target.value })}
                placeholder="指定時のみ"
              />
            </label>
          </>
        )}
        {!oral && (
          <label>
            器材
            <input
              type="text"
              value={step.deviceNote}
              onChange={(e) => onChange({ deviceNote: e.target.value })}
              placeholder="インラインフィルター / 遮光 など"
            />
          </label>
        )}
        </div>
      )}
      {oral && (
        <div className="rp-card__usage regimen-step__oral-usage">
          <span className="rp-card__usage-label">用法</span>
          <div className="rp-card__usage-row">
            <button type="button" className="rp-card__compact-button" onClick={onPickUsage}>
              {step.usage ? "用法を変更" : "用法を選択"}
            </button>
            {step.usage ? (
              <span className="rp-card__usage-value">{step.usage.name || step.usage.code}</span>
            ) : (
              <span className="rp-card__usage-value rp-card__usage-value--empty">未選択</span>
            )}
            <span className="rp-card__dose-count">
              <span className="rp-card__dose-count-label">投与日数</span>
              <input
                type="number"
                min="1"
                className="rp-card__dose-count-input"
                value={step.doseDays}
                onChange={(e) => onChange({ doseDays: e.target.value })}
              />
              <span className="rp-card__dose-count-suffix">日分</span>
            </span>
          </div>
        </div>
      )}
      <label className="regimen-step__note-field">
        投与時注意
        <input
          type="text"
          value={step.note}
          onChange={(e) => onChange({ note: e.target.value })}
          placeholder="血管外漏出注意 / 冷感刺激を避ける など"
        />
      </label>
    </section>
  );
}

// ---- Day 表 ----

// 1 クールの各日にどのステップが入るかを ● で示す(入力確認用、保存しない)。
// 内服は開始相対日から投与日数ぶんを連続で塗る。
function DayTable({ steps, cycleDays }: { steps: RegimenStepDraft[]; cycleDays: number }) {
  const days = Array.from({ length: cycleDays }, (_, i) => i + 1);
  const marks = steps.map((step) => {
    const set = new Set<number>();
    for (const d of parseDays(step.daysText)) {
      if (!Number.isInteger(d) || d < 1) continue;
      const span = step.usageType === "oral" ? Math.max(1, Number(step.doseDays) || 1) : 1;
      for (let i = 0; i < span; i += 1) set.add(d + i);
    }
    return set;
  });

  return (
    <section className="lab-order-item__section">
      <div className="lab-order-item__section-head">
        <h3>Day 表</h3>
      </div>
      <div className="lab-order-item__table-wrap">
        <table className="master-search__table regimen-day-table">
          <thead>
            <tr>
              <th>ステップ</th>
              {days.map((d) => (
                <th key={d} className="regimen-day-table__day">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {steps.map((step, i) => (
              <tr key={step.key}>
                {/* 薬剤名まで出すと横に長く、日の列が押し出される。名前だけにする。 */}
                <td className="regimen-day-table__label">
                  {i + 1}. {step.name}
                </td>
                {days.map((d) => (
                  <td
                    key={d}
                    className={`regimen-day-table__day${marks[i].has(d) ? " regimen-day-table__day--on" : ""}`}
                  >
                    {marks[i].has(d) ? "●" : ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
