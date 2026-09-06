import { useEffect, useMemo, useState } from "react";
import type { Regimen, RegimenDetail } from "../api/masterClient";
import { useApplicableRegimens, useMedicineDoseFactors, useRegimen } from "../api/masterQueries";
import {
  useActiveAllergies,
  useBodyMeasures,
  useCreatePrescription,
  usePatient,
  useRecentLabResults,
  useRegimenAdverseEvents,
} from "../api/queries";
import { adverseEventsOf, type AdverseEventRecord } from "../fhir/adverseEventHelpers";
import { allergyMatchLabel, matchMedicationAllergies, type AllergyMatch } from "../fhir/allergyHelpers";
import { summarizeBodyMeasures, summarizeRenal, uncorrectedGfr } from "../fhir/bodyMeasureHelpers";
import type { ProblemRef } from "../fhir/conditionHelpers";
import { calculateAge } from "../fhir/patientHelpers";
import { checkLabCriteria, compareWeight, summarizeLabChecks } from "../fhir/regimenCheckHelpers";
import { CATEGORY_OPTIONS as INJECTION_CATEGORY_OPTIONS } from "../fhir/injectionHelpers";
import {
  CATEGORY_OPTIONS as PRESCRIPTION_CATEGORY_OPTIONS,
  withOrderWard,
  type PrescriptionSetting,
} from "../fhir/prescriptionHelpers";
import {
  REGIMEN_DRUG_ROLE_OPTIONS,
  REGIMEN_PURPOSE_OPTIONS,
  REGIMEN_STEP_USAGE_TYPE_OPTIONS,
  displayOfOption,
  doseBasisLabel,
} from "../fhir/regimenHelpers";
import {
  MAX_REGIMEN_CYCLES_AT_ONCE,
  bsaOf,
  buildRegimenApplicationBundle,
  buildRegimenCycleBundle,
  GFR_SOURCE_OPTIONS,
  canReduceDose,
  gfrOf,
  hasReducedDose,
  planDrugDose,
  planPacks,
  planSteps,
  regimenHasAuc,
  regimenHasInjection,
  regimenHasOral,
  validateRegimenApply,
  type GfrSource,
  type PreviousCycle,
  type RegimenApplication,
  type RegimenApplyValues,
  type RegimenDrugPlan,
} from "../fhir/regimenOrderHelpers";
import { SETTING_OPTIONS } from "../fhir/shared";
import { useDefaultOrderSetting } from "../hooks/useDefaultOrderSetting";
import { useOrderContext } from "../hooks/useOrderContext";
import { useProblemOptions } from "../hooks/useProblemOptions";
import { useValidationError } from "../hooks/useValidationError";
import { today } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { ProblemSelect } from "./ProblemSelect";
import { RegimenBodyChange, RegimenInfoView, RegimenLabCheck, RegimenPreviousAdverseEvents } from "./RegimenPreCheck";

// カルテ右ペインの「化学療法」。レジメンを選び、開始日(Day 1)と体格から投与量を
// 出して、クール単位で注射・処方オーダーに展開して登録する。クールの追加登録も
// 同じフォーム(ヘッダは既存のものを指す)。設計は docs/chemo-regimen-design.md §7。

interface RegimenApplyPanelProps {
  patientId: string;
  /** 未選択ならレジメン選択の一覧を出す。 */
  regimenId?: number;
  defaultProblem?: ProblemRef;
  onSelectRegimen: (regimenId: number) => void;
  onBack: () => void;
  onSaved: () => void;
}

export function RegimenApplyPanel({
  patientId,
  regimenId,
  defaultProblem,
  onSelectRegimen,
  onBack,
  onSaved,
}: RegimenApplyPanelProps) {
  if (!regimenId) return <RegimenPicker onSelect={onSelectRegimen} />;
  return (
    <RegimenApplyLoader
      patientId={patientId}
      regimenId={regimenId}
      defaultProblem={defaultProblem}
      onBack={onBack}
      onSaved={onSaved}
    />
  );
}

/** 承認済で有効期間内のレジメンから選ぶ。 */
function RegimenPicker({ onSelect }: { onSelect: (regimenId: number) => void }) {
  const [name, setName] = useState("");
  const list = useApplicableRegimens(name);
  const items = list.data?.items ?? [];

  return (
    <div className="regimen-picker">
      <label className="regimen-picker__search">
        レジメン名
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="部分一致で検索(かな・全半角の違いは無視)"
        />
      </label>
      <ErrorBanner error={list.error} />
      <ul className="regimen-picker__list">
        {items.map((regimen: Regimen) => (
          <li key={regimen.id}>
            <button type="button" className="regimen-picker__item" onClick={() => onSelect(regimen.id)}>
              <span className="regimen-picker__name">
                {regimen.name}
                {regimen.short_name && <span className="lab-order-item__code">（{regimen.short_name}）</span>}
              </span>
              <span className="regimen-picker__meta">
                {[
                  regimen.department_name,
                  displayOfOption(REGIMEN_PURPOSE_OPTIONS, regimen.purpose),
                  regimen.cycle_days > 0 ? `${regimen.cycle_days} 日/クール` : "",
                  regimen.planned_cycles !== null ? `${regimen.planned_cycles} クール` : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </button>
          </li>
        ))}
        {list.data && items.length === 0 && (
          <li className="regimen-picker__empty">承認済のレジメンがありません</li>
        )}
      </ul>
    </div>
  );
}

function RegimenApplyLoader({
  patientId,
  regimenId,
  defaultProblem,
  onBack,
  onSaved,
}: {
  patientId: string;
  regimenId: number;
  defaultProblem?: ProblemRef;
  onBack: () => void;
  onSaved: () => void;
}) {
  const detail = useRegimen(regimenId);
  const create = useCreatePrescription();
  const requester = useOrderContext();
  const defaultSetting = useDefaultOrderSetting(patientId);

  if (detail.isPending) return <p>読み込み中...</p>;
  if (!detail.data) return <ErrorBanner error={detail.error} />;
  const regimen = detail.data;

  return (
    <>
      <div className="order-set-apply__head">
        <span className="regimen-apply__title">{regimen.name}</span>
        <button type="button" className="order-set-apply__back" onClick={onBack}>
          ← レジメン選択
        </button>
      </div>
      <RegimenApplyForm
        patientId={patientId}
        regimen={regimen}
        mode="apply"
        firstCycle={1}
        defaultStartDate={today()}
        defaultProblem={defaultProblem}
        submitting={create.isPending}
        submitError={create.error}
        onSubmit={(values) => {
          const attribution = withOrderWard(requester, values.setting, defaultSetting);
          create.mutate(buildRegimenApplicationBundle(values, regimen, patientId, attribution), {
            onSuccess: onSaved,
          });
        }}
      />
    </>
  );
}

interface RegimenCyclePanelProps {
  patientId: string;
  application: RegimenApplication;
  cycle: number;
  startDate: string;
  /** 前クールの投与量(既定でこれを引き継ぐ)。 */
  previousCycle: PreviousCycle | null;
  onSaved: () => void;
}

/**
 * 適用済みのレジメンに次のクールを登録する。投与量は**前クールと同じ量**が既定で、
 * 「いまの体格で出し直す」を選べる(§7.6 B-2)。
 */
export function RegimenCyclePanel({
  patientId,
  application,
  cycle,
  startDate,
  previousCycle,
  onSaved,
}: RegimenCyclePanelProps) {
  const detail = useRegimen(application.code || null);
  const adverseEvents = useRegimenAdverseEvents(patientId);
  const previousAdverse = previousCycle
    ? adverseEventsOf(adverseEvents.data ?? [], application.id, previousCycle.cycle)
    : [];
  const create = useCreatePrescription();
  const requester = useOrderContext();
  const defaultSetting = useDefaultOrderSetting(patientId);

  if (detail.isPending) return <p>読み込み中...</p>;
  if (!detail.data) return <ErrorBanner error={detail.error} />;
  const regimen = detail.data;

  return (
    <>
      <div className="order-set-apply__head">
        <span className="regimen-apply__title">
          {application.name} 第 {cycle} クール
        </span>
      </div>
      <RegimenApplyForm
        patientId={patientId}
        regimen={regimen}
        mode="cycle"
        firstCycle={cycle}
        defaultStartDate={startDate}
        defaultProblem={application.problem ?? undefined}
        defaultSettingOverride={application.setting || undefined}
        previousBody={{ height: application.height, weight: application.weight, bsa: application.bsa }}
        previousCycle={previousCycle}
        previousAdverse={previousAdverse}
        submitting={create.isPending}
        submitError={create.error}
        onSubmit={(values) => {
          const attribution = withOrderWard(requester, values.setting, defaultSetting);
          create.mutate(buildRegimenCycleBundle(values, regimen, application, patientId, attribution), {
            onSuccess: onSaved,
          });
        }}
      />
    </>
  );
}

interface RegimenApplyFormProps {
  patientId: string;
  regimen: RegimenDetail;
  mode: "apply" | "cycle";
  firstCycle: number;
  defaultStartDate: string;
  defaultProblem?: ProblemRef;
  /** クール追加では最初の適用の入外区分を既定にする。 */
  defaultSettingOverride?: PrescriptionSetting;
  /** クール追加では前回の投与量を出した体格。体重の変化を出して見直しを促す。 */
  previousBody?: { height: number | null; weight: number | null; bsa: number | null };
  /** クール追加では前クールの投与量。既定でこれを引き継ぐ(§7.6 B-2)。 */
  previousCycle?: PreviousCycle | null;
  /** 前クールの有害事象(減量・継続の判断材料)。 */
  previousAdverse?: AdverseEventRecord[];
  submitting: boolean;
  submitError: unknown;
  onSubmit: (values: RegimenApplyValues) => void;
}

function RegimenApplyForm({
  patientId,
  regimen,
  mode,
  firstCycle,
  defaultStartDate,
  defaultProblem,
  defaultSettingOverride,
  previousBody,
  previousCycle,
  previousAdverse = [],
  submitting,
  submitError,
  onSubmit,
}: RegimenApplyFormProps) {
  const defaultSetting = useDefaultOrderSetting(patientId);
  const body = useBodyMeasures(patientId);
  const codes = useMemo(() => regimen.steps.flatMap((s) => s.drugs.map((d) => d.medicine_code)), [regimen]);
  const factors = useMedicineDoseFactors(codes);
  const problems = useProblemOptions(patientId);
  // 投与前チェック(§7.6 A-1)。CCr は年齢・性別と、この画面で直した体重から出す。
  const labResults = useRecentLabResults(patientId);
  const patient = usePatient(patientId).data?.data;
  // アレルギー照合(§7.6 A-4)。薬剤の YJ コードで銘柄・成分の両方を見る。
  const allergies = useActiveAllergies(patientId);
  const allergyMatches = useMemo(() => {
    const map = new Map<number, AllergyMatch[]>();
    for (const step of regimen.steps) {
      for (const drug of step.drugs) {
        const matches = matchMedicationAllergies(drug.yj_code, allergies.allergies);
        if (matches.length > 0) map.set(drug.id, matches);
      }
    }
    return map;
  }, [regimen, allergies.allergies]);
  const [validationError, setValidationError, validationErrorRef] = useValidationError();

  const measures = useMemo(() => summarizeBodyMeasures(body.observations), [body.observations]);
  const setting: PrescriptionSetting = defaultSettingOverride ?? defaultSetting.setting;

  const [values, setValues] = useState<RegimenApplyValues | null>(null);
  function update<K extends keyof RegimenApplyValues>(key: K, value: RegimenApplyValues[K]) {
    setValues((v) => (v ? { ...v, [key]: value } : v));
  }

  // 体格と換算係数が読めてから初期値を作る(投与量は最初から埋まっている状態で出す)。
  useEffect(() => {
    if (values || body.isPending || labResults.isPending || !defaultSetting.ready) return;
    if (codes.length > 0 && factors.isPending) return;
    const height = measures.height ? String(measures.height.value) : "";
    const weight = measures.weight ? String(measures.weight.value) : "";
    const bsa = bsaOf({ height, weight });
    // Calvert 式の GFR。CCr(非補正)を既定にし、無ければ eGFR を非補正に換算して使う。
    const initialRenal = summarizeRenal(labResults.observations, {
      age: patient?.birthDate ? calculateAge(patient.birthDate) : undefined,
      gender: patient?.gender,
      weight: Number(weight) || null,
    });
    const initialGfr = initialRenal.ccr ?? uncorrectedGfr(initialRenal.egfr, bsa);
    const gfrSource: GfrSource = initialRenal.ccr !== null ? "ccr" : "egfr";
    const injectionOptions = setting ? INJECTION_CATEGORY_OPTIONS[setting] : [];
    const prescriptionOptions = setting ? PRESCRIPTION_CATEGORY_OPTIONS[setting] : [];
    // ［決定］前クールがあれば**既定で引き継ぐ**。2 クール目以降で体格から出し直すと、
    // 手で入れた減量が黙って標準量に戻る(いちばん危ない側に倒れる)ため。
    const carryOver = Boolean(previousCycle);
    setValues({
      startDate: defaultStartDate,
      firstCycle,
      cycleCount: "1",
      plannedCycles: regimen.planned_cycles !== null ? String(regimen.planned_cycles) : "",
      setting,
      injectionCategory: injectionOptions.length === 1 ? injectionOptions[0].code : "",
      prescriptionCategory: prescriptionOptions.length === 1 ? prescriptionOptions[0].code : "",
      problem: defaultProblem ?? null,
      height,
      weight,
      gfr: initialGfr !== null ? String(initialGfr) : "",
      gfrSource,
      comment: "",
      reductionReason: previousCycle?.reduction ?? "",
      carryOver,
      steps: planSteps(
        regimen,
        { bsa, weight: Number(weight) || null, gfr: initialGfr },
        factors.data?.factors ?? new Map(),
        carryOver ? previousCycle?.doses : undefined,
      ),
    });
  }, [
    values,
    body.isPending,
    defaultSetting.ready,
    factors.isPending,
    factors.data,
    codes.length,
    measures,
    setting,
    defaultStartDate,
    firstCycle,
    regimen,
    defaultProblem,
    previousCycle,
    // 検査結果は「読めたか」だけを見る(observations は毎回新しい配列で、依存に入れると
    // 毎レンダリングで効果が走る)。値そのものは values を作る 1 回だけ使う。
    labResults.isPending,
  ]);

  if (!values) {
    return (
      <>
        <ErrorBanner error={body.error ?? factors.error} />
        <p>読み込み中...</p>
      </>
    );
  }

  const bsa = bsaOf(values);
  const weightValue = Number(values.weight) || null;
  const renal = summarizeRenal(labResults.observations, {
    age: patient?.birthDate ? calculateAge(patient.birthDate) : undefined,
    gender: patient?.gender,
    weight: weightValue,
  });
  const checks = checkLabCriteria(
    regimen.lab_criteria,
    labResults.observations,
    {
      ccr: renal.ccr,
      egfr: renal.egfr,
      date: renal.creatinine?.date ?? "",
      unavailable: renal.ccrUnavailable || renal.egfrUnavailable || "クレアチニンの結果がありません",
    },
    values.startDate,
  );
  const checkSummary = summarizeLabChecks(checks);
  const weightChange = previousBody ? compareWeight(previousBody.weight, weightValue) : null;
  const reduced = hasReducedDose(values);
  const hasAuc = regimenHasAuc(regimen);
  const hasInjection = regimenHasInjection(regimen);
  const hasOral = regimenHasOral(regimen);
  const injectionOptions = values.setting ? INJECTION_CATEGORY_OPTIONS[values.setting] : [];
  const prescriptionOptions = values.setting ? PRESCRIPTION_CATEGORY_OPTIONS[values.setting] : [];
  const cycleDays = (regimen.treatment_days ?? 0) + (regimen.rest_days ?? 0);

  /**
   * 身長・体重を変えたら投与量を出し直す(手で直した投与量も上書きされる)。
   * 前クールを引き継いでいる間は量を動かさない(体格は体表面積と CCr の表示に効く)。
   */
  function recalc(next: Pick<RegimenApplyValues, "height" | "weight">) {
    setValues((v) => {
      if (!v) return v;
      const bsa = bsaOf(next);
      const weight = Number(next.weight) || null;
      // CCr は体重で、eGFR の非補正換算は体表面積で変わる。手入力の GFR は動かさない。
      const nextRenal = summarizeRenal(labResults.observations, {
        age: patient?.birthDate ? calculateAge(patient.birthDate) : undefined,
        gender: patient?.gender,
        weight,
      });
      const derived =
        v.gfrSource === "ccr"
          ? nextRenal.ccr
          : v.gfrSource === "egfr"
            ? uncorrectedGfr(nextRenal.egfr, bsa)
            : null;
      const gfr = v.gfrSource === "manual" ? v.gfr : derived !== null ? String(derived) : "";
      return {
        ...v,
        ...next,
        gfr,
        steps: planSteps(
          regimen,
          { bsa, weight, gfr: Number(gfr) || null },
          factors.data?.factors ?? new Map(),
          v.carryOver ? previousCycle?.doses : undefined,
        ),
      };
    });
  }

  /** GFR の出どころを変える(値を入れ直して投与量を出し直す)。 */
  function changeGfrSource(source: GfrSource) {
    setValues((v) => {
      if (!v) return v;
      const bsa = bsaOf(v);
      const derived = source === "ccr" ? renal.ccr : source === "egfr" ? uncorrectedGfr(renal.egfr, bsa) : null;
      const gfr = source === "manual" ? v.gfr : derived !== null ? String(derived) : "";
      return {
        ...v,
        gfrSource: source,
        gfr,
        steps: planSteps(
          regimen,
          { bsa, weight: Number(v.weight) || null, gfr: Number(gfr) || null },
          factors.data?.factors ?? new Map(),
          v.carryOver ? previousCycle?.doses : undefined,
        ),
      };
    });
  }

  /** GFR を手で直す(出どころは手入力になる)。 */
  function changeGfr(gfr: string) {
    setValues((v) =>
      v
        ? {
            ...v,
            gfr,
            gfrSource: "manual",
            steps: planSteps(
              regimen,
              { bsa: bsaOf(v), weight: Number(v.weight) || null, gfr: Number(gfr) || null },
              factors.data?.factors ?? new Map(),
              v.carryOver ? previousCycle?.doses : undefined,
            ),
          }
        : v,
    );
  }

  /** 前クールと同じ量にする / いまの体格で出し直す(§7.6 B-2)。 */
  function changeCarryOver(carryOver: boolean) {
    setValues((v) =>
      v
        ? {
            ...v,
            carryOver,
            steps: planSteps(
              regimen,
              { bsa: bsaOf(v), weight: Number(v.weight) || null, gfr: gfrOf(v) },
              factors.data?.factors ?? new Map(),
              carryOver ? previousCycle?.doses : undefined,
            ),
          }
        : v,
    );
  }

  /** 投与率を変えたら、その薬剤だけ基準 × 体格 × 率 で出し直す。 */
  function changeRatio(stepIndex: number, drugIndex: number, ratio: string) {
    setValues((v) => {
      if (!v) return v;
      const body = { bsa: bsaOf(v), weight: Number(v.weight) || null, gfr: gfrOf(v) };
      return {
        ...v,
        carryOver: false,
        steps: v.steps.map((plan, si) =>
          si === stepIndex
            ? {
                ...plan,
                drugs: plan.drugs.map((d, di) =>
                  di === drugIndex
                    ? // 入力途中の文字列(空欄・「8」)はそのまま持つ。量は 100% として出す。
                      { ...planDrugDose(d.drug, body, factors.data?.factors ?? new Map(), Number(ratio) || 100), ratio }
                    : d,
                ),
              }
            : plan,
        ),
      };
    });
  }

  function changeSetting(next: PrescriptionSetting) {
    const inj = next ? INJECTION_CATEGORY_OPTIONS[next] : [];
    const rx = next ? PRESCRIPTION_CATEGORY_OPTIONS[next] : [];
    setValues((v) =>
      v
        ? {
            ...v,
            setting: next,
            injectionCategory: inj.length === 1 ? inj[0].code : "",
            prescriptionCategory: rx.length === 1 ? rx[0].code : "",
          }
        : v,
    );
  }

  function updateDrug(stepIndex: number, drugIndex: number, patch: Partial<RegimenDrugPlan>) {
    setValues((v) =>
      v
        ? {
            ...v,
            steps: v.steps.map((plan, si) =>
              si === stepIndex
                ? { ...plan, drugs: plan.drugs.map((d, di) => (di === drugIndex ? { ...d, ...patch } : d)) }
                : plan,
            ),
          }
        : v,
    );
  }

  function handleSubmit() {
    if (!values) return;
    const message = validateRegimenApply(values, regimen);
    setValidationError(message);
    if (message) return;
    onSubmit(values);
  }

  const count = Number(values.cycleCount) || 1;
  const lastCycle = values.firstCycle + count - 1;

  return (
    <div className="regimen-apply">
      {validationError && (
        <div className="error-banner" role="alert" ref={validationErrorRef}>
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={submitError ?? labResults.error} />

      <RegimenLabCheck checks={checks} summary={checkSummary} />
      {allergyMatches.size > 0 && (
        <p className="regimen-apply__allergy-summary">
          {`アレルギーに当たる薬剤が ${allergyMatches.size} 件あります(投与内容の欄に出しています)。`}
        </p>
      )}
      {previousCycle && <RegimenPreviousAdverseEvents cycle={previousCycle.cycle} records={previousAdverse} />}

      <fieldset className="regimen-apply__fields">
        <legend>スケジュール</legend>
        <div className="lab-order-item__fields">
          <label>
            開始日(第 {values.firstCycle} クール Day 1)
            <input type="date" value={values.startDate} onChange={(e) => update("startDate", e.target.value)} />
          </label>
          <label>
            登録するクール数
            <select value={values.cycleCount} onChange={(e) => update("cycleCount", e.target.value)}>
              {Array.from({ length: MAX_REGIMEN_CYCLES_AT_ONCE }, (_, i) => String(i + 1)).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          {mode === "apply" && (
            <label>
              予定クール数
              <input
                type="number"
                min="1"
                value={values.plannedCycles}
                onChange={(e) => update("plannedCycles", e.target.value)}
                placeholder="空欄は継続"
              />
            </label>
          )}
          <div className="regimen-editor__derived">
            1 クール
            <strong>{cycleDays > 0 ? `${cycleDays} 日` : "—"}</strong>
          </div>
          {count > 1 && (
            <div className="regimen-editor__derived">
              登録範囲
              <strong>
                第 {values.firstCycle}〜{lastCycle} クール
              </strong>
            </div>
          )}
        </div>
      </fieldset>

      <fieldset className="regimen-apply__fields">
        <legend>オーダー</legend>
        <div className="lab-order-item__fields">
          <label>
            入外区分
            <select value={values.setting} onChange={(e) => changeSetting(e.target.value as PrescriptionSetting)}>
              <option value="">選択</option>
              {SETTING_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.display}
                </option>
              ))}
            </select>
          </label>
          {hasInjection && (
            <label>
              注射区分
              <select value={values.injectionCategory} onChange={(e) => update("injectionCategory", e.target.value)}>
                <option value="">選択</option>
                {injectionOptions.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.display}
                  </option>
                ))}
              </select>
            </label>
          )}
          {hasOral && (
            <label>
              処方区分
              <select
                value={values.prescriptionCategory}
                onChange={(e) => update("prescriptionCategory", e.target.value)}
              >
                <option value="">選択</option>
                {prescriptionOptions.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.display}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            対象プロブレム
            <ProblemSelect value={values.problem} options={problems} onChange={(p) => update("problem", p)} />
          </label>
          <label>
            コメント
            <input type="text" value={values.comment} onChange={(e) => update("comment", e.target.value)} />
          </label>
        </div>
      </fieldset>

      <fieldset className="regimen-apply__fields">
        <legend>体格</legend>
        <div className="lab-order-item__fields">
          <label>
            身長(cm)
            <input
              type="number"
              step="0.1"
              min="0"
              value={values.height}
              onChange={(e) => recalc({ height: e.target.value, weight: values.weight })}
            />
          </label>
          <label>
            体重(kg)
            <input
              type="number"
              step="0.1"
              min="0"
              value={values.weight}
              onChange={(e) => recalc({ height: values.height, weight: e.target.value })}
            />
          </label>
          <div className="regimen-editor__derived">
            体表面積
            <strong>{bsa !== null ? `${bsa} m²` : "—"}</strong>
          </div>
          {hasAuc && (
            <>
              <label>
                GFR(mL/分)
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={values.gfr}
                  onChange={(e) => changeGfr(e.target.value)}
                />
              </label>
              <label>
                GFR の出どころ
                <select value={values.gfrSource} onChange={(e) => changeGfrSource(e.target.value as GfrSource)}>
                  {GFR_SOURCE_OPTIONS.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.display}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {previousBody && <RegimenBodyChange previous={previousBody} change={weightChange} />}
          {(measures.height || measures.weight) && (
            <div className="regimen-editor__derived">
              直近の測定
              <strong>
                {[
                  measures.height ? `身長 ${measures.height.value}${measures.height.unit}(${measures.height.date})` : "",
                  measures.weight ? `体重 ${measures.weight.value}${measures.weight.unit}(${measures.weight.date})` : "",
                ]
                  .filter(Boolean)
                  .join(" / ")}
              </strong>
            </div>
          )}
        </div>
      </fieldset>

      <RegimenInfoView regimen={regimen} />

      <fieldset className="regimen-apply__fields">
        <legend>投与内容</legend>
        {previousCycle && (
          <div className="regimen-apply__carry">
            <label>
              <input
                type="radio"
                name="regimen-carry-over"
                checked={values.carryOver}
                onChange={() => changeCarryOver(true)}
              />
              第 {previousCycle.cycle} クールと同じ量
              {previousCycle.reduced && <span className="regimen-check__verdict--out">減量中</span>}
            </label>
            <label>
              <input
                type="radio"
                name="regimen-carry-over"
                checked={!values.carryOver}
                onChange={() => changeCarryOver(false)}
              />
              いまの体格で出し直す
            </label>
          </div>
        )}
        {values.steps.map((plan, stepIndex) => (
          <section key={plan.step.id} className="regimen-apply__step">
            <div className="regimen-apply__step-head">
              <span className="regimen-apply__step-index">{stepIndex + 1}</span>
              <span className="regimen-apply__step-name">{plan.step.name || "(見出しなし)"}</span>
              <span className="regimen-apply__step-meta">
                {[
                  `Day ${plan.step.days.join(", ")}`,
                  displayOfOption(REGIMEN_STEP_USAGE_TYPE_OPTIONS, plan.step.usage_type),
                  plan.step.usage_type === "drip" && plan.step.infusion_minutes ? `${plan.step.infusion_minutes} 分` : "",
                  plan.step.usage_type === "oral" && plan.step.usage ? plan.step.usage.usage_name : "",
                  plan.step.usage_type === "oral" && plan.step.dose_days ? `${plan.step.dose_days} 日分` : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
            {/* マスタの投与時注意。同時に開始する組(混注ではない)もここに書いてある。 */}
            {plan.step.note && <p className="regimen-apply__step-note">{plan.step.note}</p>}
            <table className="master-search__table regimen-apply__drugs">
              <thead>
                <tr>
                  <th>種類</th>
                  <th>医薬品</th>
                  <th>基準</th>
                  <th>投与率・投与量</th>
                </tr>
              </thead>
              <tbody>
                {plan.drugs.map((d, drugIndex) => (
                  <tr key={d.drug.id}>
                    <td>{displayOfOption(REGIMEN_DRUG_ROLE_OPTIONS, d.drug.drug_role)}</td>
                    <td>{d.drug.resolved_name ?? d.drug.medicine_code}</td>
                    <td>
                      {d.drug.dose_value !== null
                        ? doseBasisLabel(d.drug.dose_basis, Number(d.drug.dose_value), d.drug.dose_unit ?? "")
                        : ""}
                      {d.drug.dose_max !== null && (
                        <span className="lab-order-item__code">（上限 {Number(d.drug.dose_max)}）</span>
                      )}
                    </td>
                    {/* 抗がん剤の指示は力価(mg)なので入力欄は力価にし、オーダーに載る
                        製剤数(瓶・錠)は換算して下に添える。製剤単位が基準の補液などは
                        製剤数をそのまま入れる。 */}
                    <td>
                      {canReduceDose(d.drug) && (
                        <span className="regimen-apply__ratio">
                          <input
                            type="number"
                            step="1"
                            min="1"
                            max="100"
                            className="regimen-editor__num-input"
                            value={d.ratio}
                            onChange={(e) => changeRatio(stepIndex, drugIndex, e.target.value)}
                          />
                          %
                        </span>
                      )}
                      {d.input === "amount" ? (
                        <>
                          <span className="regimen-apply__dose">
                            <input
                              type="number"
                              step="any"
                              min="0"
                              className="regimen-editor__num-input"
                              value={d.amount}
                              onChange={(e) => updateDrug(stepIndex, drugIndex, { amount: e.target.value })}
                            />
                            {d.unit}
                          </span>
                          <span className="regimen-apply__packs-hint">
                            ≒ {planPacks(d) || "—"} {d.packUnit}
                            <span className="regimen-apply__strength">
                              （1 {d.packUnit} = {d.factor} {d.unit}）
                            </span>
                          </span>
                          {d.capped && <span className="regimen-apply__packs-hint">上限で止めています</span>}
                        </>
                      ) : (
                        <>
                          <span className="regimen-apply__dose">
                            <input
                              type="number"
                              step="any"
                              min="0"
                              className="regimen-editor__num-input"
                              value={d.packs}
                              onChange={(e) => updateDrug(stepIndex, drugIndex, { packs: e.target.value })}
                            />
                            {d.packUnit}
                          </span>
                          {d.amount && (
                            <span className="regimen-apply__packs-hint">
                              {d.amount} {d.unit} 相当
                            </span>
                          )}
                        </>
                      )}
                      {d.manualReason && <span className="regimen-apply__manual">{d.manualReason}</span>}
                      {(allergyMatches.get(d.drug.id) ?? []).map((m) => (
                        <span
                          key={m.allergyId}
                          className={`regimen-apply__allergy${m.high ? " regimen-apply__allergy--high" : ""}`}
                          title={m.reaction}
                        >
                          アレルギー {allergyMatchLabel(m)}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </fieldset>

      {reduced && (
        <fieldset className="regimen-apply__fields">
          <legend>減量</legend>
          <div className="lab-order-item__fields">
            <label className="regimen-apply__reason">
              減量理由
              <input
                type="text"
                value={values.reductionReason}
                onChange={(e) => update("reductionReason", e.target.value)}
              />
            </label>
          </div>
        </fieldset>
      )}

      <div className="lab-order-item__actions">
        <button type="button" onClick={handleSubmit} disabled={submitting}>
          {mode === "apply" ? "レジメンを適用" : "クールを登録"}
        </button>
      </div>
    </div>
  );
}
