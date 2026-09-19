import { useEffect, useMemo, useState } from "react";
import type { Pathway, PathwayDetail, PathwayEvent, PathwayPhaseBranch } from "../api/masterClient";
import { useApplicablePathways, usePathway } from "../api/masterQueries";
import {
  useApplyPathway,
  useKarteConditions,
  usePathwayApplicationTree,
  usePathwayApplications,
  usePatient,
  usePatientAdmission,
  usePatientPlannedAdmissions,
} from "../api/queries";
import { conditionManagementNumber, isActiveCondition, summarizeCondition } from "../fhir/conditionHelpers";
import { encounterAdmissionDate, plannedAdmissionDate } from "../fhir/encounterHelpers";
import {
  isOrderSetOrderType,
  mergeTransactionBundles,
  migrateEntryValues,
  type OrderSetOrderType,
} from "../fhir/orderSetHelpers";
import type { MealOrderFormValues } from "../fhir/mealOrderHelpers";
import {
  buildPathwayApplyBundle,
  buildPathwayPhaseBundle,
  firstPhaseOf,
  nextPhasesOf,
  orderHeaderUrlsOf,
  pathwayOfPhase,
  phaseEventDate,
  phaseNoteOf,
  pathwayEventDate,
  pathwayOrderEnd,
  pathwayOrderPlan,
  pathwayOrderStartOf,
  pathwayTaskOrderKey,
  stampPathwayOrders,
  withPathwayOrderEnd,
  type PathwayApplicationRecord,
  type PathwayOrderPlanEntry,
  type PathwayOrderStart,
} from "../fhir/pathwayApplyHelpers";
import { phaseClosingEntries, planPhaseOrderClosings } from "../fhir/pathwayScheduleHelpers";
import { PATHWAY_SETTING_OPTIONS, displayOfOption, eventDayStepLabel } from "../fhir/pathwayHelpers";
import { useDefaultOrderSetting } from "../hooks/useDefaultOrderSetting";
import { useOrderContext } from "../hooks/useOrderContext";
import { useSelfInstitutionNumber } from "../hooks/useSelfInstitutionNumber";
import { useStackedOrderForms } from "../hooks/useStackedOrderForms";
import { useValidationError } from "../hooks/useValidationError";
import { today } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { ORDER_SET_TYPE_LABELS, ORDER_SET_TYPES } from "./orderSetRegistry";

// カルテ右ペインの「パス」。承認済のクリニカルパスを選び、入院(または入院予定)と入院日を
// 決めて適用する。適用は CarePlan の木と未実施のタスクを 1 transaction で登録する
// (fhir/pathwayApplyHelpers.ts)。設計は docs/clinical-pathway-design.md §7。
// 適用はフェーズ単位で進める。最初は開始フェーズだけを登録し、続きは同じフォームを
// 「次のフェーズ」として開いて足す(PathwayPhasePanel)。

interface PathwayApplyPanelProps {
  patientId: string;
  /** 未選択ならパス選択の一覧を出す。 */
  pathwayId?: number;
  onSelectPathway: (pathwayId: number) => void;
  onBack: () => void;
  onSaved: () => void;
}

export function PathwayApplyPanel({ patientId, pathwayId, onSelectPathway, onBack, onSaved }: PathwayApplyPanelProps) {
  if (!pathwayId) return <PathwayPicker onSelect={onSelectPathway} />;
  return <PathwayApplyLoader patientId={patientId} pathwayId={pathwayId} onBack={onBack} onSaved={onSaved} />;
}

/** 承認済で有効期間内のパスから選ぶ。 */
function PathwayPicker({ onSelect }: { onSelect: (pathwayId: number) => void }) {
  const [name, setName] = useState("");
  const list = useApplicablePathways(name);
  const items = list.data?.items ?? [];

  return (
    <div className="regimen-picker">
      <label className="regimen-picker__search">
        パス名
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <ErrorBanner error={list.error} />
      <ul className="regimen-picker__list">
        {items.map((pathway: Pathway) => (
          <li key={pathway.id}>
            <button type="button" className="regimen-picker__item" onClick={() => onSelect(pathway.id)}>
              <span className="regimen-picker__name">
                {pathway.name}
                {pathway.short_name && <span className="lab-order-item__code">（{pathway.short_name}）</span>}
              </span>
              <span className="regimen-picker__meta">
                {[
                  pathway.department_name,
                  displayOfOption(PATHWAY_SETTING_OPTIONS, pathway.setting),
                  pathway.scheduled_days !== null ? `${pathway.scheduled_days} 日` : "",
                  pathway.event_count ? `病日 ${pathway.event_count} 日分` : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </button>
          </li>
        ))}
        {list.data && items.length === 0 && <li className="regimen-picker__empty">承認済のパスがありません</li>}
      </ul>
    </div>
  );
}

function PathwayApplyLoader({
  patientId,
  pathwayId,
  onBack,
  onSaved,
}: {
  patientId: string;
  pathwayId: number;
  onBack: () => void;
  onSaved: () => void;
}) {
  const detail = usePathway(pathwayId);
  // オーダー雛形のフォームは初回描画で初期値が決まるので、在院状況と患者が揃ってから積む。
  const defaultSetting = useDefaultOrderSetting(patientId);
  const { data: patientResult, isPending: patientPending } = usePatient(patientId);

  if (detail.isPending || !defaultSetting.ready || patientPending) return <p>読み込み中...</p>;
  if (!detail.data) return <ErrorBanner error={detail.error} />;

  return (
    <>
      <div className="order-set-apply__head">
        <span className="regimen-apply__title">{detail.data.name}</span>
        <button type="button" className="order-set-apply__back" onClick={onBack}>
          ← パス選択
        </button>
      </div>
      <PathwayApplyForm
        patientId={patientId}
        pathway={pathwayOfPhase(detail.data, firstPhaseOf(detail.data)?.phase_key ?? "")}
        defaultSetting={defaultSetting}
        patient={patientResult?.data}
        onSaved={onSaved}
      />
    </>
  );
}

/**
 * 適用済みのパスに次のフェーズを足す。どのフェーズへ進むかは呼ぶ側で選んである(分岐の候補から)。
 * 候補でないフェーズ(適用が進んだあとに開いたままのパネルなど)は登録させない。
 */
export function PathwayPhasePanel({
  patientId,
  applyId,
  phaseKey,
  onSaved,
}: {
  patientId: string;
  applyId: string;
  phaseKey: string;
  onSaved: () => void;
}) {
  const tree = usePathwayApplicationTree(applyId);
  const application = tree.data?.application ?? null;
  const detail = usePathway(application?.pathwayCode || null);
  const defaultSetting = useDefaultOrderSetting(patientId);
  const { data: patientResult, isPending: patientPending } = usePatient(patientId);

  if (tree.isPending || (application && detail.isPending) || !defaultSetting.ready || patientPending) {
    return <p>読み込み中...</p>;
  }
  if (!application || !tree.data) return <ErrorBanner error={tree.error} />;
  if (!detail.data) return <ErrorBanner error={detail.error} />;

  const next = nextPhasesOf(application, detail.data);
  const branch = next.candidates.find((b) => b.to_phase_key === phaseKey);
  const phase = detail.data.phases.find((p) => p.phase_key === phaseKey);
  if (!branch || !phase) return <p className="regimen-picker__empty">このフェーズは適用できません</p>;

  return (
    <>
      <div className="order-set-apply__head">
        <span className="regimen-apply__title">{`${detail.data.name} ${phase.name ?? ""}`}</span>
      </div>
      <PathwayApplyForm
        patientId={patientId}
        pathway={pathwayOfPhase(detail.data, phaseKey)}
        defaultSetting={defaultSetting}
        patient={patientResult?.data}
        phase={{ application, orders: tree.data.orders, branch, defaultStartDate: next.defaultStartDate }}
        onSaved={onSaved}
      />
    </>
  );
}

/** 次のフェーズとして開いたときの文脈。 */
interface PhaseApplyContext {
  application: PathwayApplicationRecord;
  /** 適用済みのタスクが指すオーダー(前のフェーズから続く食事・安静度を終えるのに使う)。 */
  orders: Map<string, fhir4.ServiceRequest>;
  branch: PathwayPhaseBranch;
  defaultStartDate: string;
}

/**
 * 出すオーダー 1 件ぶん(積むフォーム 1 つ)。病日ごとのタスク 1 件か、続く病日をまとめた
 * 継続するタスク(看護指示・食事・安静度)1 件。plan の並びと key は同じ(key = plan の添字)。
 */
interface TemplateEntry {
  key: number;
  plan: PathwayOrderPlanEntry;
  dayLabel: string;
  orderType: OrderSetOrderType;
  initialValues: unknown;
  unsupported: boolean;
  included: boolean;
  collapsed: boolean;
}

/** 病日の見出し(分けた日はステップ名を添える)。 */
function eventLabel(event: PathwayEvent): string {
  return eventDayStepLabel(event.elapsed_days, event.title, event.path_step, event.path_step_name);
}

/** 適用先の候補(入院中の Encounter と入院予定)。 */
interface EncounterOption {
  id: string;
  label: string;
  /** 入院日(予定で未定なら空)。 */
  date: string;
}

function PathwayApplyForm({
  patientId,
  pathway,
  defaultSetting,
  patient,
  phase,
  onSaved,
}: {
  patientId: string;
  /** 適用するフェーズに絞ったパス定義。 */
  pathway: PathwayDetail;
  defaultSetting: ReturnType<typeof useDefaultOrderSetting>;
  patient?: fhir4.Patient;
  /** 渡すと「次のフェーズ」の適用になる(入院・適応基準・対象病名は適用済みのものを使う)。 */
  phase?: PhaseApplyContext;
  onSaved: () => void;
}) {
  const admission = usePatientAdmission(patientId);
  const planned = usePatientPlannedAdmissions(patientId);
  const applications = usePathwayApplications(patientId);
  const { conditions } = useKarteConditions(patientId);
  const institutionNumber = useSelfInstitutionNumber();
  const requester = useOrderContext();
  const apply = useApplyPathway();
  const [validationError, setValidationError, validationErrorRef] = useValidationError();

  const encounterOptions = useMemo<EncounterOption[]>(() => {
    const options: EncounterOption[] = [];
    if (admission.data) {
      const encounter = admission.data.encounter;
      options.push({
        id: encounter.id ?? "",
        label: `入院中（${encounterAdmissionDate(encounter)} 入院）`,
        date: encounterAdmissionDate(encounter),
      });
    }
    for (const encounter of planned.data ?? []) {
      const date = plannedAdmissionDate(encounter);
      options.push({
        id: encounter.id ?? "",
        label: `入院予定（${date || "日付未定"}）`,
        date,
      });
    }
    return options;
  }, [admission.data, planned.data]);

  const [encounterId, setEncounterId] = useState(phase?.application.encounterId ?? "");
  // 次のフェーズでは、フェーズの最初の病日の日付(開始日)。
  const [admissionDate, setAdmissionDate] = useState(phase?.defaultStartDate ?? "");
  const [comment, setComment] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [conditionIds, setConditionIds] = useState<string[] | null>(null);
  const stack = useStackedOrderForms<number>();

  const events = useMemo(
    () => [...pathway.events].sort((a, b) => a.elapsed_days - b.elapsed_days || a.path_step - b.path_step),
    [pathway.events],
  );
  const firstDay = events[0]?.elapsed_days ?? 1;
  const eventDateOf = (event: PathwayEvent) =>
    phase ? phaseEventDate(admissionDate, firstDay, event.elapsed_days) : pathwayEventDate(admissionDate, event.elapsed_days);

  // 出すオーダーを病日順に積む(続く病日にまたがる継続するタスクは 1 件)。初期値は DO と同じ
  // 正規化(日付は当日、入外区分はパスのもの)で、開始日は後から病日の日付で上書きする(bulkStartDate)。
  const initialTemplates = useMemo<TemplateEntry[]>(
    () =>
      pathwayOrderPlan(pathway).map((plan, key) => {
        const { task } = plan;
        const orderType = task.order_type && isOrderSetOrderType(task.order_type) ? task.order_type : null;
        const def = orderType ? ORDER_SET_TYPES[orderType] : undefined;
        const migrated = orderType
          ? migrateEntryValues(orderType, task.order_schema_version ?? 1, task.order_values)
          : { values: task.order_values, unsupported: true };
        const unsupported = !def || migrated.unsupported;
        const first = plan.events[0];
        const last = plan.events[plan.events.length - 1];
        return {
          key,
          plan,
          dayLabel:
            plan.events.length > 1
              ? `${eventLabel(first)}〜${eventLabel(last)}`
              : eventLabel(first),
          orderType: orderType ?? "prescription",
          initialValues: def && !unsupported ? def.buildDoValues(migrated.values, pathway.setting) : null,
          unsupported,
          included: !unsupported,
          collapsed: true,
        };
      }),
    [pathway],
  );
  const [templates, setTemplates] = useState(initialTemplates);

  function patchTemplate(key: number, changes: Partial<TemplateEntry>) {
    setTemplates((prev) => prev.map((t) => (t.key === key ? { ...t, ...changes } : t)));
  }
  const anyOpen = templates.some((t) => !t.collapsed);

  // 入院中があればそれ、無ければ最初の入院予定を既定にする。入院日はその Encounter から入れる。
  useEffect(() => {
    if (phase || encounterId || encounterOptions.length === 0) return;
    const first = encounterOptions[0];
    setEncounterId(first.id);
    setAdmissionDate(first.date || today());
  }, [phase, encounterId, encounterOptions]);

  function changeEncounter(id: string) {
    setEncounterId(id);
    const option = encounterOptions.find((o) => o.id === id);
    if (option?.date) setAdmissionDate(option.date);
  }

  // 対象病名の既定は、パスの対象病名(管理番号)と一致する継続中の病名。
  const activeConditions = useMemo(() => conditions.filter(isActiveCondition), [conditions]);
  const indicationNumbers = useMemo(
    () => new Set(pathway.indications.map((i) => i.management_number)),
    [pathway.indications],
  );
  const selectedConditionIds =
    conditionIds ??
    activeConditions
      .filter((c) => indicationNumbers.has(conditionManagementNumber(c)))
      .map((c) => c.id ?? "")
      .filter(Boolean);

  function toggleCondition(id: string) {
    setConditionIds(
      selectedConditionIds.includes(id)
        ? selectedConditionIds.filter((x) => x !== id)
        : [...selectedConditionIds, id],
    );
  }

  // 同じ入院に同じパスが進行中なら二重適用なので止める。別のパスが進行中なら注意だけ。
  const activeOnEncounter = (applications.data?.applications ?? []).filter(
    (a) => a.status === "active" && encounterId && a.encounterId === encounterId,
  );
  const duplicate = activeOnEncounter.find((a) => a.pathwayCode === pathway.pathway_code);
  const others = activeOnEncounter.filter((a) => a.pathwayCode !== pathway.pathway_code);

  const unitCount = events.reduce((n, e) => n + e.oat_units.length, 0);
  const taskCount = events.reduce((n, e) => n + e.oat_units.reduce((m, u) => m + u.tasks.length, 0), 0);

  /** 次のフェーズが出す食事・安静度の最初の開始。前のフェーズから続くものをその直前で終える。 */
  function closingsOf(starts: (PathwayOrderStart | null)[]) {
    if (!phase) return [];
    const firstOf = (continuity: "meal" | "activity") =>
      templates
        .map((t, index) => (t.plan.continuity === continuity ? starts[index] : null))
        .filter((start): start is PathwayOrderStart => start !== null)
        .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
    const meal = firstOf("meal");
    return planPhaseOrderClosings(phase.application, phase.orders, {
      meal: meal ? { date: meal.date, timing: meal.mealTiming } : null,
      activity: firstOf("activity"),
    });
  }

  function handleApply() {
    const lastApplied = phase?.application.events.at(-1)?.date ?? "";
    const message = phase
      ? !admissionDate
        ? "開始日を入力してください"
        : admissionDate <= lastApplied
          ? `開始日は適用済みの最後の病日（${lastApplied}）より後にしてください`
          : !requester.practitionerId
            ? "依頼医師を選択してください"
            : null
      : !admissionDate
      ? "入院日を入力してください"
      : !confirmed
        ? "適応基準を確認してください"
        : duplicate
          ? `このパスは同じ入院に適用済みです（${duplicate.periodStart} 開始）`
          : !institutionNumber
            ? "自院の保険医療機関番号が未設定です（管理 > 施設設定）"
            : !requester.practitionerId
              ? "依頼医師を選択してください"
              : null;
    setValidationError(message);
    if (message) return;

    // 雛形のフォームを外から submit して値を集める。検証に落ちたら何も登録しない。
    const included = templates.filter((t) => t.included && !t.unsupported);
    const result = stack.submitAll(included.map((t) => t.key));
    if (!result.ok) {
      const failed = templates.find((t) => t.key === result.failedKey);
      setValidationError(`「${failed?.plan.task.name ?? ""}」のオーダーの入力を確認してください`);
      if (failed) {
        patchTemplate(failed.key, { collapsed: false });
        stack.scrollTo(failed.key);
      }
      return;
    }

    // 次のフェーズのオーダーも同じ適用の印で束ねる(識別子は「医療機関番号.適用 uuid」)。
    const applyKey = phase ? phase.application.applyId.slice(phase.application.applyId.indexOf(".") + 1) : crypto.randomUUID();
    const orderBundles: fhir4.Bundle[] = [];
    const invalidate = [];
    const orderHeaderUrls = new Map<string, string[]>();
    // 継続するオーダーの終了は、入力し終えた開始(食事は開始の区切りまで)から決める。
    const plan = templates.map((t) => t.plan);
    const starts = templates.map((t) => {
      const submitted = t.included && !t.unsupported ? result.collected.get(t.key) : undefined;
      return submitted ? pathwayOrderStartOf(t.orderType, submitted.values) : null;
    });
    for (const entry of included) {
      const def = ORDER_SET_TYPES[entry.orderType]!;
      const submitted = result.collected.get(entry.key)!;
      const end = pathwayOrderEnd(plan, entry.key, starts, eventDateOf);
      const built = def.buildBundle({
        values: withPathwayOrderEnd(entry.orderType, submitted.values, end),
        extra: submitted.extra,
        patientId,
        requester,
        defaultSetting,
        patient,
        // 入院にだけ出す種別(看護指示・食事)は適用先の入院(予定)に紐づける。
        encounterId: encounterId || defaultSetting.encounterId || undefined,
        // パスのタスクは病名を伴わない(プロブレム番号は使わない)。
        allocateProblemNumber: () => 0,
      });
      orderBundles.push(built.bundle);
      invalidate.push(...built.invalidate);
      const urls = orderHeaderUrlsOf(built.bundle);
      for (const event of entry.plan.events) {
        orderHeaderUrls.set(pathwayTaskOrderKey(event, entry.plan.task.task_key), urls);
      }
    }

    if (phase) {
      const phaseTree = buildPathwayPhaseBundle({
        pathway,
        application: phase.application,
        patientId,
        startDate: admissionDate,
        note: phaseNoteOf(phase.branch.criteria, comment),
        orderHeaderUrls,
      });
      const closing: fhir4.Bundle = {
        resourceType: "Bundle",
        type: "transaction",
        entry: phaseClosingEntries(closingsOf(starts)),
      };
      apply.mutate(
        {
          bundle: stampPathwayOrders(
            mergeTransactionBundles([phaseTree.bundle, ...orderBundles, closing]),
            { code: pathway.pathway_code, name: pathway.name },
            applyKey,
          ),
          applyFullUrl: phaseTree.firstEventUrl,
          requesterId: requester.practitionerId,
          invalidate,
        },
        { onSuccess: onSaved },
      );
      return;
    }

    const tree = buildPathwayApplyBundle({
      pathway,
      patientId,
      encounterId: encounterId || undefined,
      admissionDate,
      institutionNumber,
      adaptiveCriteriaConfirmed: confirmed,
      conditionIds: selectedConditionIds,
      applyKey,
      orderHeaderUrls,
    });
    // 計画の木とオーダーを 1 つの transaction にまとめ、オーダーのヘッダにパスの印を焼く。
    const bundle = stampPathwayOrders(
      mergeTransactionBundles([tree.bundle, ...orderBundles]),
      { code: pathway.pathway_code, name: pathway.name },
      applyKey,
    );
    apply.mutate(
      {
        bundle,
        applyFullUrl: tree.bundle.entry?.[0]?.fullUrl ?? "",
        requesterId: requester.practitionerId,
        invalidate,
      },
      { onSuccess: onSaved },
    );
  }

  const includedTemplateCount = templates.filter((t) => t.included && !t.unsupported).length;
  // 見出しに出す終了の見込み(開始は病日の日付と雛形の食事の区切り。適用時は入力した開始で決め直す)。
  const plannedStarts: (PathwayOrderStart | null)[] = templates.map((t) =>
    t.included && !t.unsupported && admissionDate
      ? {
          date: eventDateOf(t.plan.events[0]),
          mealTiming:
            t.orderType === "meal-order" ? (t.initialValues as MealOrderFormValues | null)?.startTiming : undefined,
        }
      : null,
  );

  const closings = admissionDate ? closingsOf(plannedStarts) : [];

  return (
    <div className="pathway-apply">
      {validationError && (
        <div className="error-banner" role="alert" ref={validationErrorRef}>
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={apply.error} />
      {others.length > 0 && (
        <p className="regimen-check__summary regimen-check__summary--out">
          {`この入院には別のパス「${others.map((a) => a.title).join("」「")}」が進行中です。`}
        </p>
      )}

      {phase ? (
        <fieldset className="regimen-apply__fields">
          <legend>フェーズ</legend>
          {phase.branch.criteria && <p className="pathway-apply__criteria">{phase.branch.criteria}</p>}
          <div className="lab-order-item__fields">
            <label>
              {`開始日（病日 ${firstDay}）`}
              <input type="date" value={admissionDate} onChange={(e) => setAdmissionDate(e.target.value)} />
            </label>
            <label>
              コメント
              <input type="text" value={comment} onChange={(e) => setComment(e.target.value)} />
            </label>
          </div>
        </fieldset>
      ) : (
        <>
          <fieldset className="regimen-apply__fields">
            <legend>入院</legend>
            <div className="lab-order-item__fields">
              <label>
                適用先
                <select value={encounterId} onChange={(e) => changeEncounter(e.target.value)}>
                  {encounterOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                  <option value="">指定しない</option>
                </select>
              </label>
              <label>
                入院日（病日 1）
                <input type="date" value={admissionDate} onChange={(e) => setAdmissionDate(e.target.value)} />
              </label>
            </div>
          </fieldset>

          <fieldset className="regimen-apply__fields">
            <legend>適応基準</legend>
            <p className="pathway-apply__criteria">{pathway.adaptive_criteria}</p>
            <label className="pathway-apply__check">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              適応基準を確認した
            </label>
          </fieldset>

          <fieldset className="regimen-apply__fields">
            <legend>対象病名</legend>
            {activeConditions.length === 0 ? (
              <p className="regimen-picker__empty">継続中の病名がありません</p>
            ) : (
              <ul className="pathway-apply__conditions">
                {activeConditions.map((condition) => {
                  const summary = summarizeCondition(condition);
                  return (
                    <li key={summary.id}>
                      <label className="pathway-apply__check">
                        <input
                          type="checkbox"
                          checked={selectedConditionIds.includes(summary.id)}
                          onChange={() => toggleCondition(summary.id)}
                        />
                        {summary.name}
                        {indicationNumbers.has(conditionManagementNumber(condition)) && (
                          <span className="pathway-task__template-label">対象病名</span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </fieldset>

        </>
      )}

      <fieldset className="regimen-apply__fields">
        <legend>予定</legend>
        <div className="lab-order-item__fields">
          <div className="regimen-editor__derived">
            病日
            <strong>{new Set(events.map((e) => e.elapsed_days)).size} 日分</strong>
          </div>
          <div className="regimen-editor__derived">
            OAT ユニット
            <strong>{unitCount}</strong>
          </div>
          <div className="regimen-editor__derived">
            タスク
            <strong>{taskCount}</strong>
          </div>
        </div>
        <table className="master-search__table pathway-apply__days">
          <thead>
            <tr>
              <th className="rad-item__compact">病日</th>
              <th>日付</th>
              <th className="rad-item__compact">アウトカム</th>
              <th className="rad-item__compact">タスク</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <td className="rad-item__compact">{eventLabel(event)}</td>
                <td>{admissionDate ? eventDateOf(event) : "—"}</td>
                <td className="rad-item__compact">{event.oat_units.length}</td>
                <td className="rad-item__compact">
                  {event.oat_units.reduce((m, u) => m + u.tasks.length, 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </fieldset>

      {templates.length > 0 && (
        <fieldset className="regimen-apply__fields">
          <legend>オーダー</legend>
          <div className="order-set-apply__head">
            <span className="regimen-apply__step-meta">{`${includedTemplateCount} / ${templates.length} 件`}</span>
            <button
              type="button"
              className="order-set-apply__toggle"
              onClick={() => setTemplates((prev) => prev.map((t) => ({ ...t, collapsed: anyOpen })))}
            >
              {anyOpen ? "すべて閉じる" : "すべて開く"}
            </button>
          </div>
          <div className="order-set-stack">
            {templates.map((entry) => {
              const def = ORDER_SET_TYPES[entry.orderType];
              const date = admissionDate ? eventDateOf(entry.plan.events[0]) : "";
              const end = pathwayOrderEnd(
                templates.map((t) => t.plan),
                entry.key,
                plannedStarts,
                eventDateOf,
              );
              return (
                <section
                  className={`order-set-stack__item${entry.included ? "" : " order-set-stack__item--excluded"}`}
                  key={entry.key}
                >
                  <div className="order-set-stack__head">
                    <button
                      type="button"
                      className="schema-master__cat-toggle"
                      aria-label={entry.collapsed ? "展開" : "折りたたむ"}
                      onClick={() => patchTemplate(entry.key, { collapsed: !entry.collapsed })}
                    >
                      {entry.collapsed ? "▶" : "▼"}
                    </button>
                    <label className="dose-conversion__checkbox order-set-stack__include">
                      <input
                        type="checkbox"
                        checked={entry.included}
                        disabled={entry.unsupported}
                        onChange={(e) => patchTemplate(entry.key, { included: e.target.checked })}
                      />
                      <span className="order-set-stack__type">{ORDER_SET_TYPE_LABELS[entry.orderType]}</span>
                    </label>
                    <span className="pathway-apply__task-day">
                      {`${entry.dayLabel}${date ? ` ${date}` : ""}${end ? `〜${end.date}` : ""}`}
                    </span>
                    <span className="order-set-stack__label">
                      {entry.plan.task.name}
                      {entry.plan.task.order_label && (
                        <span className="lab-order-item__code">{entry.plan.task.order_label}</span>
                      )}
                    </span>
                  </div>
                  {/* 除外・折りたたみはアンマウントせず隠すだけ(入力中の値を保つ)。 */}
                  <div
                    className="order-set-stack__body"
                    ref={stack.registerContainer(entry.key)}
                    hidden={entry.collapsed || !entry.included}
                  >
                    {entry.unsupported || !def ? (
                      <p className="order-set-stack__unsupported">この種別はパスからの登録にまだ対応していません。</p>
                    ) : (
                      def.renderForm({
                        patientId,
                        initialValues: entry.initialValues,
                        onSubmit: (values, ...extra) => stack.collect(entry.key, values, ...extra),
                        submitting: apply.isPending,
                        mode: "order",
                        bulkStartDate: date || undefined,
                        conditions,
                      })
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </fieldset>
      )}

      {closings.length > 0 && (
        <fieldset className="regimen-apply__fields">
          <legend>終了する指示</legend>
          <ul className="pathway-apply__conditions">
            {closings.map((c) => (
              <li key={c.order.id}>{`${c.taskName}（〜${c.endDate}）`}</li>
            ))}
          </ul>
        </fieldset>
      )}

      <div className="lab-order-item__actions">
        <button type="button" onClick={handleApply} disabled={apply.isPending}>
          {apply.isPending ? "送信中..." : includedTemplateCount > 0 ? `適用(オーダー ${includedTemplateCount} 件)` : "適用"}
        </button>
      </div>
    </div>
  );
}
