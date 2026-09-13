import { useEffect, useState } from "react";
import {
  useAddUnplannedUnit,
  useKarteConditions,
  usePathwayApplicationTree,
  usePatient,
} from "../api/queries";
import {
  mergeTransactionBundles,
  type OrderSetOrderType,
} from "../fhir/orderSetHelpers";
import {
  PATHWAY_EVENT_ID_SYSTEM,
  buildUnplannedUnitBundle,
  orderHeaderUrlsOf,
  stampPathwayOrders,
} from "../fhir/pathwayApplyHelpers";
import {
  TASK_CATEGORY_LV1_OPTIONS,
  defaultOrderTypeOfTask,
  eventDayLabel,
  taskCategoryLv2Options,
} from "../fhir/pathwayHelpers";
import { useDefaultOrderSetting } from "../hooks/useDefaultOrderSetting";
import { useOrderContext } from "../hooks/useOrderContext";
import { useStackedOrderForms } from "../hooks/useStackedOrderForms";
import { useValidationError } from "../hooks/useValidationError";
import { ErrorBanner } from "./ErrorBanner";
import { ORDER_SET_TYPE_LABELS, ORDER_SET_TYPE_ORDER, ORDER_SET_TYPES } from "./orderSetRegistry";

// 予定外のアウトカム(OAT ユニット)の追加。パスシートの見出しから開き、選んだ病日に
// アウトカム 1 件と、任意で観察項目・タスクを足す。タスクには適用パネルと同じ器で
// オーダーを付けられる。設計は docs/clinical-pathway-design.md §7.6。

/** タスクに付けられるオーダーの種別(病名はオーダーではないので外す)。 */
const TASK_ORDER_TYPES: OrderSetOrderType[] = ORDER_SET_TYPE_ORDER.filter((t) => t !== "condition");

interface PathwayUnplannedPanelProps {
  patientId: string;
  applyId: string;
  /** 既定で選ぶ病日(今日の病日)。無ければ最初の病日。 */
  defaultEventId?: string;
  onSaved: () => void;
}

interface TaskRow {
  /** 積んだフォームを引くキー(行を消しても他の行とずれない)。 */
  key: number;
  name: string;
  categoryLv1: string;
  categoryLv2: string;
  /** 空ならチェックリスト項目(オーダーを出さない)。 */
  orderType: OrderSetOrderType | "";
  /** オーダーフォームの初期値。種別を選んだときに空のフォーム値で作る。 */
  initialValues: unknown;
  /** フォームに入れる開始日(病日の日付)。積んだ次の描画で入る。 */
  bulkDate: string;
  collapsed: boolean;
}

export function PathwayUnplannedPanel({
  patientId,
  applyId,
  defaultEventId,
  onSaved,
}: PathwayUnplannedPanelProps) {
  // オーダーフォームは初回描画で初期値が決まるので、在院状況と患者が揃ってから積む。
  const defaultSetting = useDefaultOrderSetting(patientId);
  const patient = usePatient(patientId);
  if (!defaultSetting.ready || patient.isPending) return <p>読み込み中...</p>;
  return (
    <UnplannedForm
      patientId={patientId}
      applyId={applyId}
      defaultEventId={defaultEventId}
      defaultSetting={defaultSetting}
      patient={patient.data?.data}
      onSaved={onSaved}
    />
  );
}

function UnplannedForm({
  patientId,
  applyId,
  defaultEventId,
  defaultSetting,
  patient,
  onSaved,
}: PathwayUnplannedPanelProps & {
  defaultSetting: ReturnType<typeof useDefaultOrderSetting>;
  patient?: fhir4.Patient;
}) {
  const tree = usePathwayApplicationTree(applyId);
  const { conditions } = useKarteConditions(patientId);
  const requester = useOrderContext();
  const add = useAddUnplannedUnit();
  const stack = useStackedOrderForms<number>();
  const [validationError, setValidationError, validationErrorRef] = useValidationError();
  const [eventId, setEventId] = useState(defaultEventId ?? "");
  const [name, setName] = useState("");
  const [critical, setCritical] = useState(false);
  const [assessments, setAssessments] = useState<string[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [nextKey, setNextKey] = useState(1);

  const events = tree.data?.application?.events ?? [];
  const selected = events.find((e) => e.id === eventId) ?? events[0];
  const eventDate = selected?.date ?? "";

  // 開始日は積んだ次の描画で渡す。useBulkStartDate は値が変わったときだけ効くので、
  // 最初から渡すとフォームが持つ当日の既定のままになる(病日を変えたときもここで追随する)。
  useEffect(() => {
    setTasks((rows) =>
      rows.every((row) => row.bulkDate === eventDate) ? rows : rows.map((row) => ({ ...row, bulkDate: eventDate })),
    );
  }, [eventDate, tasks]);

  if (tree.isPending) return <p>読み込み中...</p>;
  if (tree.error || !tree.data?.application) return <ErrorBanner error={tree.error} />;
  const application = tree.data.application;

  function updateTask(key: number, patch: Partial<TaskRow>) {
    setTasks((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  /** 分類を変えると、オーダーを出す行の既定の種別も追随させる(まだ選び直していない間だけ)。 */
  function changeCategory(row: TaskRow, patch: { categoryLv1?: string; categoryLv2?: string }) {
    const next = { ...row, ...patch };
    if (!row.orderType) {
      updateTask(row.key, patch);
      return;
    }
    const suggested = defaultOrderTypeOfTask(next.categoryLv1, next.categoryLv2);
    updateTask(row.key, { ...patch, ...orderTypePatch(suggested as OrderSetOrderType) });
  }

  /** 種別を選び直したときの初期値。空のフォーム値を作って積む。 */
  function orderTypePatch(orderType: OrderSetOrderType | ""): Partial<TaskRow> {
    const def = orderType ? ORDER_SET_TYPES[orderType] : undefined;
    return {
      orderType,
      initialValues: def ? def.emptyValues(defaultSetting.setting) : null,
      collapsed: false,
    };
  }

  function addTask() {
    setTasks((rows) => [
      ...rows,
      {
        key: nextKey,
        name: "",
        categoryLv1: "TP",
        categoryLv2: "",
        orderType: "",
        initialValues: null,
        bulkDate: "",
        collapsed: false,
      },
    ]);
    setNextKey((n) => n + 1);
  }

  function handleSave() {
    if (!selected) return;
    if (!name.trim()) {
      setValidationError("アウトカムを入力してください");
      return;
    }
    if (tasks.some((t) => !t.name.trim())) {
      setValidationError("タスクの名称を入力してください");
      return;
    }
    const withOrder = tasks.filter((t) => t.orderType);
    if (withOrder.length > 0 && !requester.practitionerId) {
      setValidationError("依頼医師を選択してください");
      return;
    }
    setValidationError(null);

    // オーダーのフォームを外から submit して値を集める。検証に落ちたら何も登録しない。
    const result = stack.submitAll(withOrder.map((t) => t.key));
    if (!result.ok) {
      const failed = tasks.find((t) => t.key === result.failedKey);
      setValidationError(`「${failed?.name ?? ""}」のオーダーの入力を確認してください`);
      if (failed) {
        updateTask(failed.key, { collapsed: false });
        stack.scrollTo(failed.key);
      }
      return;
    }

    const orderBundles: fhir4.Bundle[] = [];
    const invalidate = [];
    const orderUrlsByKey = new Map<number, string[]>();
    for (const row of withOrder) {
      const def = ORDER_SET_TYPES[row.orderType as OrderSetOrderType]!;
      const submitted = result.collected.get(row.key)!;
      const built = def.buildBundle({
        values: submitted.values,
        extra: submitted.extra,
        patientId,
        requester,
        defaultSetting,
        patient,
        encounterId: application.encounterId || defaultSetting.encounterId || undefined,
        // パスのタスクは病名を伴わない(プロブレム番号は使わない)。
        allocateProblemNumber: () => 0,
      });
      orderBundles.push(built.bundle);
      invalidate.push(...built.invalidate);
      orderUrlsByKey.set(row.key, orderHeaderUrlsOf(built.bundle));
    }

    const eventCarePlan = tree.data?.carePlans.get(selected.id);
    const eventIdentifier =
      eventCarePlan?.identifier?.find((i) => i.system === PATHWAY_EVENT_ID_SYSTEM)?.value ?? "";
    const unit = buildUnplannedUnitBundle({
      patientId,
      encounterId: application.encounterId || undefined,
      applyCarePlanId: application.id,
      eventCarePlanId: selected.id,
      eventId: eventIdentifier,
      date: selected.date,
      name: name.trim(),
      critical,
      assessments: assessments.map((a) => a.trim()).filter(Boolean),
      tasks: tasks.map((t) => ({ ...t, name: t.name.trim(), orderUrls: orderUrlsByKey.get(t.key) ?? [] })),
      existingUnitCount: selected.units.length,
    });

    // 予定外のオーダーも適用と同じ印を焼く(束ねる uuid は適用の識別子の後半)。
    const bundle = stampPathwayOrders(
      mergeTransactionBundles([unit, ...orderBundles]),
      { code: application.pathwayCode, name: application.title },
      application.applyId.slice(application.applyId.indexOf(".") + 1),
    );
    add.mutate({ bundle, invalidate }, { onSuccess: onSaved });
  }

  const orderCount = tasks.filter((t) => t.orderType).length;

  return (
    <div className="pathway-evaluate">
      {validationError && (
        <div className="error-banner" role="alert" ref={validationErrorRef}>
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={add.error} />

      <div className="chemo-calendar__summary pathway-evaluate__head">
        <span className="pathway-sheet__name">{application.title}</span>
        <span>入院 {application.periodStart}</span>
      </div>

      <fieldset className="regimen-apply__fields">
        <legend>アウトカム</legend>
        <div className="lab-order-item__fields">
          <label>
            病日
            <select value={selected?.id ?? ""} onChange={(e) => setEventId(e.target.value)}>
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.elapsedDays} {eventDayLabel(event.elapsedDays, event.title)} {event.date}
                </option>
              ))}
            </select>
          </label>
          <label className="pathway-apply__check">
            <input type="checkbox" checked={critical} onChange={(e) => setCritical(e.target.checked)} />
            重要アウトカム
          </label>
        </div>
        <input
          type="text"
          className="pathway-unplanned__name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="アウトカム"
        />
      </fieldset>

      <fieldset className="regimen-apply__fields">
        <legend>観察項目</legend>
        <table className="master-search__table pathway-evaluate__rows">
          <tbody>
            {assessments.map((value, index) => (
              <tr key={index}>
                <td>
                  <input
                    type="text"
                    value={value}
                    onChange={(e) =>
                      setAssessments((rows) => rows.map((row, i) => (i === index ? e.target.value : row)))
                    }
                    aria-label={`観察項目 ${index + 1}`}
                  />
                </td>
                <td className="pathway-rows__tools">
                  <button
                    type="button"
                    onClick={() => setAssessments((rows) => rows.filter((_, i) => i !== index))}
                  >
                    外す
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="lab-order-item__actions">
          <button type="button" onClick={() => setAssessments((rows) => [...rows, ""])}>
            ＋ 観察項目
          </button>
        </div>
      </fieldset>

      <fieldset className="regimen-apply__fields">
        <legend>タスク</legend>
        <div className="order-set-stack">
          {tasks.map((task) => {
            const def = task.orderType ? ORDER_SET_TYPES[task.orderType] : undefined;
            return (
              <section className="order-set-stack__item pathway-unplanned__task" key={task.key}>
                <div className="order-set-stack__head pathway-unplanned__task-head">
                  {def && (
                    <button
                      type="button"
                      className="schema-master__cat-toggle"
                      aria-label={task.collapsed ? "展開" : "折りたたむ"}
                      onClick={() => updateTask(task.key, { collapsed: !task.collapsed })}
                    >
                      {task.collapsed ? "▶" : "▼"}
                    </button>
                  )}
                  <select
                    value={task.categoryLv1}
                    onChange={(e) => changeCategory(task, { categoryLv1: e.target.value, categoryLv2: "" })}
                    aria-label="タスクの分類"
                  >
                    {TASK_CATEGORY_LV1_OPTIONS.map((option) => (
                      <option key={option.code} value={option.code}>
                        {option.display}
                      </option>
                    ))}
                  </select>
                  <select
                    value={task.categoryLv2}
                    onChange={(e) => changeCategory(task, { categoryLv2: e.target.value })}
                    aria-label="タスクの中分類"
                  >
                    <option value="">(未指定)</option>
                    {taskCategoryLv2Options(task.categoryLv1 as never).map((option) => (
                      <option key={option.code} value={option.code}>
                        {option.display}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    className="pathway-unplanned__task-name"
                    value={task.name}
                    onChange={(e) => updateTask(task.key, { name: e.target.value })}
                    aria-label="タスクの名称"
                  />
                  <select
                    value={task.orderType}
                    onChange={(e) => updateTask(task.key, orderTypePatch(e.target.value as OrderSetOrderType | ""))}
                    aria-label="オーダー"
                  >
                    <option value="">オーダーなし</option>
                    {TASK_ORDER_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {ORDER_SET_TYPE_LABELS[type]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setTasks((rows) => rows.filter((row) => row.key !== task.key))}
                  >
                    外す
                  </button>
                </div>
                {/* 折りたたみはアンマウントせず隠すだけ(入力中の値を保つ)。 */}
                {def && (
                  <div
                    className="order-set-stack__body"
                    ref={stack.registerContainer(task.key)}
                    hidden={task.collapsed}
                  >
                    {def.renderForm({
                      patientId,
                      initialValues: task.initialValues,
                      onSubmit: (values, ...extra) => stack.collect(task.key, values, ...extra),
                      submitting: add.isPending,
                      mode: "order",
                      bulkStartDate: task.bulkDate || undefined,
                      conditions,
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
        <div className="lab-order-item__actions">
          <button type="button" onClick={addTask}>
            ＋ タスク
          </button>
        </div>
      </fieldset>

      <div className="lab-order-item__actions">
        <button type="button" onClick={handleSave} disabled={add.isPending}>
          {add.isPending ? "追加中..." : orderCount > 0 ? `追加する(オーダー ${orderCount} 件)` : "追加する"}
        </button>
      </div>
    </div>
  );
}
