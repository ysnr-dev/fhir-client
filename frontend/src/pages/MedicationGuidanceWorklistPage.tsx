import { today } from "../lib/dates";
import { useEffect, useMemo, useState, type ComponentProps, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useCurrentPractitioner } from "../api/authQueries";
import { useReturnLinkState } from "../returnTo";
import {
  useAssignMedicationGuidancePharmacist,
  useDeleteMedicationGuidancePerform,
  useMedicationGuidanceWorklist,
  usePractitionerOptions,
  useSelfDepartments,
  useUpdateMedicationGuidanceTaskStatus,
  type MedicationGuidanceWorklistRow,
} from "../api/queries";
import { DateStepper } from "../components/DateStepper";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";
import { PatientProfileDrawer, useRowDrawer } from "../components/PatientProfileDrawer";
import { RowMenu } from "../components/RowMenu";
import { PatientKana, PatientProfileCells, PatientProfileHeadCells } from "../components/PatientRowCells";
import { MedicationGuidanceOrderDetailPanel } from "../components/MedicationGuidanceOrderDetailPanel";
import { MedicationGuidancePerformModal } from "../components/MedicationGuidancePerformModal";
import { displayName } from "../fhir/patientHelpers";
import { orderContextSummary, orderRequester, wardOf } from "../fhir/orderHeader";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { SETTING_OPTIONS } from "../fhir/prescriptionHelpers";
import { GUIDANCE_KIND_OPTIONS, summarizeMedicationGuidanceOrder } from "../fhir/medicationGuidanceOrderHelpers";
import {
  MEDICATION_GUIDANCE_TASK_STATUS_OPTIONS,
  medicationGuidanceAssignee,
  medicationGuidanceTaskActions,
  medicationGuidanceTaskStatus,
  medicationGuidanceTaskStatusDisplay,
  type MedicationGuidanceTaskStatus,
} from "../fhir/medicationGuidanceTaskHelpers";

// 服薬指導一覧(薬剤部の部門ワークリスト。docs/medication-guidance-order-design.md)。
//
// 軸は栄養指導一覧と同じで、基準日に効いている(始まっていて、まだ終わっていない)オーダーを並べる。
// 進捗(Task)は「部門の受け入れ状態」で、実施しても動かない(実施は Procedure が積み上がる)。
// 担当薬剤師は Task.owner に持ち、行のケバブから登録する。予約は持たないので予約のビューは無い。
//
// 「終了」はオーダーにも終了日を書く(書かないと status=active のまま一覧に出続ける)。

interface Filters {
  kind: string;
  setting: string;
  wardId: string;
  departmentId: string;
  /** "" すべて / "mine" 自分の担当 / "none" 担当未定。 */
  assignee: string;
  status: string;
}

const emptyFilters: Filters = { kind: "", setting: "", wardId: "", departmentId: "", assignee: "", status: "" };

export function MedicationGuidanceWorklistPage() {
  const [date, setDate] = useState(today);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  // 開いている対象は行そのものではなく id で覚えておき、読み直しのたびに引き直す。
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [performingId, setPerformingId] = useState<string | null>(null);
  const [finishingId, setFinishingId] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const { practitionerId } = useCurrentPractitioner();

  // 列が多いのでこの画面だけ幅を広げる(栄養指導一覧と同じ)。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const worklist = useMedicationGuidanceWorklist(date);
  const departments = useSelfDepartments();
  const updateStatus = useUpdateMedicationGuidanceTaskStatus();
  const assign = useAssignMedicationGuidancePharmacist();
  const deletePerform = useDeleteMedicationGuidancePerform();

  const allRows = useMemo(() => worklist.data?.rows ?? [], [worklist.data]);
  const rows = useMemo(
    () => allRows.filter((row) => matchesFilters(row, filters, practitionerId)),
    [allRows, filters, practitionerId],
  );

  const drawer = useRowDrawer("orders");
  const selectedRow = rows.find((row) => row.patient?.id && row.order.id === drawer.selectedKey);
  const viewing = allRows.find((row) => row.order.id === viewingId);
  const performingRow = allRows.find((row) => row.order.id === performingId);
  const finishingRow = allRows.find((row) => row.order.id === finishingId);
  const assigningRow = allRows.find((row) => row.order.id === assigningId);

  // 病棟の選択肢は読み込んだぶんのオーダーから拾う(栄養指導一覧と同じ考え方)。
  const wardOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const row of allRows) {
      const ward = wardOf(row.order);
      if (ward.wardId && !byId.has(ward.wardId)) byId.set(ward.wardId, ward.wardName || ward.wardId);
    }
    return Array.from(byId, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [allRows]);

  /** 進捗の変更。終了だけはオーダーにも終了日を書くので、日付を入れさせるモーダルに回す。 */
  function handleChangeStatus(row: MedicationGuidanceWorklistRow, status: MedicationGuidanceTaskStatus) {
    if (status === "completed") {
      setFinishingId(row.order.id ?? null);
      return;
    }
    updateStatus.mutate({ order: row.order, task: row.task, status });
  }

  function rowHandlers(row: MedicationGuidanceWorklistRow) {
    return {
      pending: updateStatus.isPending,
      onView: () => setViewingId(row.order.id ?? null),
      onPerform: () => setPerformingId(row.order.id ?? null),
      onAssign: () => setAssigningId(row.order.id ?? null),
      onChangeStatus: (status: MedicationGuidanceTaskStatus) => handleChangeStatus(row, status),
    };
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>服薬指導一覧</h1>
      </div>

      <FilterForm
        date={date}
        filters={filters}
        wards={wardOptions}
        departments={departments.departments}
        onDateChange={(value) => value && setDate(value)}
        onChange={setFilters}
      />

      <ErrorBanner error={worklist.error} />
      <ErrorBanner error={departments.error} />
      <ErrorBanner error={updateStatus.error ?? assign.error ?? deletePerform.error} />

      {worklist.data?.truncated && (
        <p className="error-banner__line error-banner__line--error" role="status">
          この日のオーダーが多いため、一部のみ表示しています。
        </p>
      )}

      {worklist.isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <div className="lab-worklist-wrap sticky-table-wrap">
            <table className="lab-worklist sticky-table">
              <thead>
                <tr>
                  {/* 横に送っても「誰の服薬指導か」は残す(左 2 列を固定する)。 */}
                  <th className="sticky-table__fix-1">患者番号</th>
                  <th className="sticky-table__fix-2">患者氏名</th>
                  <PatientProfileHeadCells />
                  <th className="lab-worklist__compact">区分</th>
                  <th className="lab-worklist__compact">指導条件</th>
                  <th className="lab-worklist__compact">対象薬剤</th>
                  <th className="lab-worklist__compact">期間</th>
                  <th className="lab-worklist__compact">本日</th>
                  <th className="lab-worklist__compact">担当薬剤師</th>
                  <th className="lab-worklist__compact">入外</th>
                  <th className="lab-worklist__compact">病棟</th>
                  <th>依頼科 | 依頼医師</th>
                  <th className="lab-worklist__compact">ステータス</th>
                  <th className="lab-worklist__actions sticky-table__fix-actions"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <OrderRow
                    key={row.order.id}
                    row={row}
                    rowProps={drawer.rowProps(row.patient?.id && row.order.id)}
                    {...rowHandlers(row)}
                  />
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={16} className="master-search__empty">
                      {allRows.length === 0
                        ? "この日に実施中の服薬指導オーダーはありません"
                        : "絞り込みに該当する服薬指導がありません"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="order-select__muted lab-worklist__count">{rows.length} 件</p>
        </>
      )}

      {selectedRow?.patient?.id && (
        <PatientProfileDrawer
          patientId={selectedRow.patient.id}
          patient={selectedRow.patient}
          actions={
            <>
              <OrderRowButtons row={selectedRow} {...rowHandlers(selectedRow)} />
              <OrderMenuItems row={selectedRow} {...rowHandlers(selectedRow)} />
            </>
          }
          onClose={drawer.close}
        />
      )}

      {viewing && (
        <Modal
          title={`服薬指導内容 - ${viewing.patient ? displayName(viewing.patient) : ""}`}
          onClose={() => setViewingId(null)}
          className="modal--wide"
        >
          {/* 一覧から開いたときだけ実施の取消も出す。実施履歴はその日ぶんしか読み込んでいない。 */}
          <MedicationGuidanceOrderDetailPanel
            serviceRequest={viewing.order}
            performs={viewing.todayPerforms}
            assigneeName={medicationGuidanceAssignee(viewing.task)?.name ?? ""}
            onDeletePerform={(perform) => {
              if (!window.confirm("この実施記録を取り消します。よろしいですか?")) return;
              deletePerform.mutate({ id: perform.id, recordResponseId: perform.recordResponseId });
            }}
            deletingPerformId={deletePerform.isPending ? deletePerform.variables?.id : undefined}
          />
          <p className="order-select__muted">
            実施履歴は {date} のぶんだけを表示しています(全期間はカルテの詳細で確認できます)。
          </p>
        </Modal>
      )}

      {performingRow && (
        <MedicationGuidancePerformModal
          order={performingRow.order}
          patientId={performingRow.patient?.id ?? ""}
          patientName={performingRow.patient ? displayName(performingRow.patient) : undefined}
          defaultDate={date}
          onClose={() => setPerformingId(null)}
        />
      )}

      {finishingRow && (
        <FinishModal
          row={finishingRow}
          defaultEndDate={date}
          pending={updateStatus.isPending}
          onSubmit={(endDate) =>
            updateStatus.mutate(
              { order: finishingRow.order, task: finishingRow.task, status: "completed", endDate },
              { onSuccess: () => setFinishingId(null) },
            )
          }
          onClose={() => setFinishingId(null)}
        />
      )}

      {assigningRow && (
        <AssignModal
          row={assigningRow}
          defaultId={medicationGuidanceAssignee(assigningRow.task)?.id ?? practitionerId ?? ""}
          pending={assign.isPending}
          onSubmit={(pharmacist) =>
            assign.mutate(
              { order: assigningRow.order, task: assigningRow.task, pharmacist },
              { onSuccess: () => setAssigningId(null) },
            )
          }
          onClose={() => setAssigningId(null)}
        />
      )}
    </div>
  );
}

function matchesFilters(row: MedicationGuidanceWorklistRow, filters: Filters, practitionerId: string | null): boolean {
  const summary = summarizeMedicationGuidanceOrder(row.order);
  if (filters.kind && summary.kind !== filters.kind) return false;
  if (
    filters.setting &&
    SETTING_OPTIONS.find((o) => o.code === filters.setting)?.display !== summary.settingDisplay
  ) {
    return false;
  }
  if (filters.wardId && wardOf(row.order).wardId !== filters.wardId) return false;
  if (filters.departmentId && orderRequester(row.order).departmentId !== filters.departmentId) return false;
  const assignee = medicationGuidanceAssignee(row.task);
  if (filters.assignee === "mine" && assignee?.id !== practitionerId) return false;
  if (filters.assignee === "none" && assignee) return false;
  if (filters.status && medicationGuidanceTaskStatus(row.task) !== filters.status) return false;
  return true;
}

function FilterForm({
  date,
  filters,
  wards,
  departments,
  onDateChange,
  onChange,
}: {
  date: string;
  filters: Filters;
  wards: { id: string; name: string }[];
  departments: fhir4.Organization[];
  onDateChange: (value: string) => void;
  onChange: (filters: Filters) => void;
}) {
  // 絞り込みは選んだ瞬間に効かせるので、Enter での送信は何もしない。
  return (
    <form className="patient-search-form" onSubmit={(e: FormEvent) => e.preventDefault()}>
      <label>
        基準日
        <DateStepper value={date} onChange={onDateChange} />
      </label>
      <label>
        指導区分
        <select value={filters.kind} onChange={(e) => onChange({ ...filters, kind: e.target.value })}>
          <option value="">すべて</option>
          {GUIDANCE_KIND_OPTIONS.map((o) => (
            <option key={o.code} value={o.code}>
              {o.display}
            </option>
          ))}
        </select>
      </label>
      <label>
        入外区分
        <select value={filters.setting} onChange={(e) => onChange({ ...filters, setting: e.target.value })}>
          <option value="">すべて</option>
          {SETTING_OPTIONS.map((o) => (
            <option key={o.code} value={o.code}>
              {o.display}
            </option>
          ))}
        </select>
      </label>
      <label>
        病棟
        <select value={filters.wardId} onChange={(e) => onChange({ ...filters, wardId: e.target.value })}>
          <option value="">すべて</option>
          {wards.map((ward) => (
            <option key={ward.id} value={ward.id}>
              {ward.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        診療科
        <select value={filters.departmentId} onChange={(e) => onChange({ ...filters, departmentId: e.target.value })}>
          <option value="">すべて</option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        担当
        <select value={filters.assignee} onChange={(e) => onChange({ ...filters, assignee: e.target.value })}>
          <option value="">すべて</option>
          <option value="mine">自分</option>
          <option value="none">未定</option>
        </select>
      </label>
      <label>
        ステータス
        <select value={filters.status} onChange={(e) => onChange({ ...filters, status: e.target.value })}>
          <option value="">すべて</option>
          {MEDICATION_GUIDANCE_TASK_STATUS_OPTIONS.map((o) => (
            <option key={o.code} value={o.code}>
              {o.display}
            </option>
          ))}
        </select>
      </label>
      <div className="patient-search-form__actions">
        <button type="button" onClick={() => onChange(emptyFilters)}>
          クリア
        </button>
      </div>
    </form>
  );
}

interface RowHandlers {
  pending: boolean;
  onView: () => void;
  onPerform: () => void;
  onAssign: () => void;
  onChangeStatus: (status: MedicationGuidanceTaskStatus) => void;
}

function OrderRow({
  row,
  rowProps,
  ...handlers
}: { row: MedicationGuidanceWorklistRow; rowProps: ComponentProps<"tr"> } & RowHandlers) {
  const returnLinkState = useReturnLinkState();
  const { order, patient } = row;
  const summary = summarizeMedicationGuidanceOrder(order);
  const status = medicationGuidanceTaskStatus(row.task);
  const assignee = medicationGuidanceAssignee(row.task);
  const performed = row.todayPerforms.map((p) => p.sessionTypeShort).filter(Boolean).join("・");

  return (
    <tr {...rowProps}>
      <td className="sticky-table__fix-1">{patient?.identifier?.[0]?.value ?? "-"}</td>
      <td className="sticky-table__fix-2">
        {patient ? (
          <>
            <Link to={`/patients/${patient.id}/karte`} state={returnLinkState}>
              {displayName(patient)}
            </Link>
            <PatientKana patient={patient} />
          </>
        ) : (
          "-"
        )}
      </td>
      <PatientProfileCells patient={patient} />
      <td className="lab-worklist__compact">{summary.kindShort || "-"}</td>
      <td className="lab-worklist__compact">{summary.conditionsLabel || "-"}</td>
      <td className="lab-worklist__compact">{summary.targetDrugs || "-"}</td>
      <td className="lab-worklist__compact">{summary.periodLabel || "-"}</td>
      {/* その日にもう指導したか。期間型なので日ごとに見る。 */}
      <td className="lab-worklist__compact">
        {row.todayPerforms.length > 0 ? performed || "実施" : <span className="order-select__muted">未実施</span>}
      </td>
      <td className="lab-worklist__compact">
        {assignee?.name || <span className="order-select__muted">未定</span>}
      </td>
      <td className="lab-worklist__compact">{summary.settingDisplay || "-"}</td>
      <td className="lab-worklist__compact">{wardOf(order).wardName || "-"}</td>
      <td>{orderContextSummary(orderRequester(order)) || "-"}</td>
      <td className="lab-worklist__compact">
        <span className={`lab-worklist__status lab-worklist__status--${status}`}>
          {medicationGuidanceTaskStatusDisplay(status)}
        </span>
      </td>
      <td className="lab-worklist__actions sticky-table__fix-actions">
        <OrderRowButtons row={row} {...handlers} />
        <RowMenu label="この服薬指導の操作" escapesClipping>
          <OrderMenuItems row={row} {...handlers} />
        </RowMenu>
      </td>
    </tr>
  );
}

/** 行の操作列に直接並べるボタン。ドロワーにも同じものを並べる。 */
function OrderRowButtons({ row, pending, onView, onPerform, onChangeStatus }: { row: MedicationGuidanceWorklistRow } & RowHandlers) {
  const status = medicationGuidanceTaskStatus(row.task);
  return (
    <>
      {medicationGuidanceTaskActions(status)
        .filter((action) => !action.secondary)
        .map((action) => (
          <button key={action.next} type="button" disabled={pending} onClick={() => onChangeStatus(action.next)}>
            {action.label}
          </button>
        ))}
      {/* 実施は受け入れ済のオーダーにだけ出す。押しても行のステータスは実施中のまま。 */}
      {status === "accepted" && (
        <button type="button" onClick={onPerform}>
          実施
        </button>
      )}
      <button type="button" onClick={onView}>
        表示
      </button>
    </>
  );
}

/** 行のケバブの項目(担当・終了・取消・中止)。ドロワーにも同じものを並べる。 */
function OrderMenuItems({ row, pending, onAssign, onChangeStatus }: { row: MedicationGuidanceWorklistRow } & RowHandlers) {
  const status = medicationGuidanceTaskStatus(row.task);
  return (
    <>
      {status !== "cancelled" && (
        <button type="button" className="row-menu__item" onClick={onAssign}>
          担当
        </button>
      )}
      {medicationGuidanceTaskActions(status)
        .filter((action) => action.secondary)
        .map((action) => (
          <button
            key={action.next}
            type="button"
            className={`row-menu__item${action.next === "cancelled" ? " row-menu__item--danger" : ""}`}
            disabled={pending}
            onClick={() => onChangeStatus(action.next)}
          >
            {action.label}
          </button>
        ))}
    </>
  );
}

/** 終了(期間の打ち切り)。オーダーにも終了日を書くので、どの日までだったかを入れさせる。 */
function FinishModal({
  row,
  defaultEndDate,
  pending,
  onSubmit,
  onClose,
}: {
  row: MedicationGuidanceWorklistRow;
  defaultEndDate: string;
  pending: boolean;
  onSubmit: (endDate: string) => void;
  onClose: () => void;
}) {
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [error, setError] = useState("");
  const summary = summarizeMedicationGuidanceOrder(row.order);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!endDate) return setError("終了日を入れてください。");
    if (endDate < summary.startDate) return setError("終了日は開始日と同じか、それより後にしてください。");
    setError("");
    onSubmit(endDate);
  }

  return (
    <Modal title={`服薬指導の終了${row.patient ? ` - ${displayName(row.patient)}` : ""}`} onClose={onClose}>
      <form className="walk-in" onSubmit={handleSubmit}>
        {error && (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">{error}</p>
          </div>
        )}
        <p className="appointment-panel__current">
          {[summary.kindShort, summary.conditionsLabel, summary.periodLabel].filter(Boolean).join(" / ")}
        </p>
        <div className="walk-in__fields">
          <label>
            終了日
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
          </label>
        </div>
        <div className="walk-in__actions">
          <button type="submit" disabled={pending}>
            {pending ? "終了中..." : "終了"}
          </button>
          <button type="button" onClick={onClose} disabled={pending}>
            キャンセル
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** 担当薬剤師の登録。Modal はポータルではないので <form> は書かない。 */
function AssignModal({
  row,
  defaultId,
  pending,
  onSubmit,
  onClose,
}: {
  row: MedicationGuidanceWorklistRow;
  defaultId: string;
  pending: boolean;
  onSubmit: (pharmacist: { id: string; name: string } | null) => void;
  onClose: () => void;
}) {
  const { practitioners, error } = usePractitionerOptions();
  const [selectedId, setSelectedId] = useState(defaultId);
  const current = medicationGuidanceAssignee(row.task);

  function submit() {
    const selected = practitioners.find((p) => p.id === selectedId);
    if (!selected?.id) return;
    onSubmit({ id: selected.id, name: practitionerDisplayName(selected) });
  }

  return (
    <Modal title={`担当薬剤師${row.patient ? ` - ${displayName(row.patient)}` : ""}`} onClose={onClose}>
      <ErrorBanner error={error} />
      <div className="walk-in">
        <div className="walk-in__fields">
          <label>
            担当薬剤師
            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
              <option value="">選択してください</option>
              {practitioners.map((p) => (
                <option key={p.id} value={p.id}>
                  {practitionerDisplayName(p)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="walk-in__actions">
          <button type="button" disabled={!selectedId || pending} onClick={submit}>
            登録
          </button>
          {current && (
            <button type="button" disabled={pending} onClick={() => onSubmit(null)}>
              解除
            </button>
          )}
          <button type="button" onClick={onClose} disabled={pending}>
            キャンセル
          </button>
        </div>
      </div>
    </Modal>
  );
}
