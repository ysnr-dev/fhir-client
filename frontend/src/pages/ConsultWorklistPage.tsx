import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useReturnLinkState } from "../returnTo";
import {
  useConsultWorklist,
  useSelfDepartments,
  useUpdateConsultTaskStatus,
  type ConsultWorklistRow,
  type ConsultWorklistView,
} from "../api/queries";
import { ConsultOrderDetailPanel } from "../components/ConsultOrderDetailPanel";
import { ConsultReplyModal } from "../components/ConsultReplyModal";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";
import {
  PatientKana,
  PatientProfileCells,
  PatientProfileHeadCells,
} from "../components/PatientRowCells";
import { RowMenu } from "../components/RowMenu";
import {
  REQUEST_TYPE_OPTIONS,
  summarizeConsultOrder,
} from "../fhir/consultOrderHelpers";
import {
  CONSULT_TASK_STATUS_OPTIONS,
  consultTaskActions,
  consultTaskStatus,
  consultTaskStatusDisplay,
  type ConsultTaskStatus,
} from "../fhir/consultTaskHelpers";
import { displayName } from "../fhir/patientHelpers";
import {
  SETTING_OPTIONS,
  orderContextSummary,
  prescriptionRequester,
  wardOf,
} from "../fhir/prescriptionHelpers";
import { useOrderContext } from "../hooks/useOrderContext";

// 他科依頼一覧(部門ワークリスト)。
//
// **他部門の一覧と軸が違う。** 検査・処置は「その日に実施予定のオーダー」を日付で
// 並べるが、他科依頼は日付軸を持たない(希望日は任意入力)。代わりに
// ServiceRequest.status で切る(docs/consult-order-design.md §4.1)。
//
// - 未回答 … status=active / revoked。いま溜まっている仕事なので件数は有限。
// - 回答済 … status=completed の直近ぶん(依頼日の降順)。振り返り用。
//
// 依頼先科の絞り込みだけは上流が performer を索引していないためクライアント側で行う
// (§2.1)。既定はヘッダーで選択中の診療科 = 「自分の科あての依頼」。
//
// 「回答」は状態を選ぶ操作ではなく診療記録を書く操作なので、進捗ボタンではなく
// 専用のモーダル(ConsultReplyModal)を開く。保存で回答済になる。

interface Filters {
  /** 依頼先の診療科。既定はヘッダーで選択中の科。 */
  targetDepartmentId: string;
  requestType: string;
  setting: string;
  wardId: string;
  /** 依頼元の診療科。 */
  requesterDepartmentId: string;
  status: string;
  /** 至急の依頼だけに絞る。 */
  urgentOnly: boolean;
}

function emptyFilters(targetDepartmentId: string): Filters {
  return {
    targetDepartmentId,
    requestType: "",
    setting: "",
    wardId: "",
    requesterDepartmentId: "",
    status: "",
    urgentOnly: false,
  };
}

export function ConsultWorklistPage() {
  const [view, setView] = useState<ConsultWorklistView>("open");
  // 既定の依頼先科はヘッダーで選択中の科(= 自分の科あての依頼)。ヘッダーを
  // 選び直したときに絞り込みが勝手に動くと混乱するので、初期値としてだけ使う。
  const orderContext = useOrderContext();
  const [filters, setFilters] = useState<Filters | null>(null);
  const effectiveFilters = filters ?? emptyFilters(orderContext.departmentId);

  // 開いている対象は行そのものではなく id で覚えておき、読み直しのたびに引き直す。
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [replyingId, setReplyingId] = useState<string | null>(null);

  // 列が多いのでこの画面だけ幅を広げる(リハビリ・輸血一覧と同じ)。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const worklist = useConsultWorklist(view);
  const departments = useSelfDepartments();
  const updateStatus = useUpdateConsultTaskStatus();

  const allRows = useMemo(() => worklist.data?.rows ?? [], [worklist.data]);
  const rows = useMemo(
    () => allRows.filter((row) => matchesFilters(row, effectiveFilters)),
    [allRows, effectiveFilters],
  );

  const viewing = allRows.find((row) => row.order.id === viewingId);
  const replying = allRows.find((row) => row.order.id === replyingId);

  // 病棟の選択肢は読み込んだぶんのオーダーから拾う(リハビリ一覧と同じ考え方)。
  const wardOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const row of allRows) {
      const ward = wardOf(row.order);
      if (ward.wardId && !byId.has(ward.wardId)) {
        byId.set(ward.wardId, ward.wardName || ward.wardId);
      }
    }
    return Array.from(byId, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [allRows]);

  function handleChangeStatus(row: ConsultWorklistRow, status: ConsultTaskStatus) {
    updateStatus.mutate({ order: row.order, task: row.task, status });
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>他科依頼一覧</h1>
      </div>

      {/* 未回答と回答済は絞り込みではなく見る軸そのものの切り替え(サーバーへの
          問い合わせも別)なので、絞り込み欄ではなくタブに出す。 */}
      <div className="order-select__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={view === "open"}
          className={view === "open" ? "order-select__tab is-active" : "order-select__tab"}
          onClick={() => setView("open")}
        >
          未回答
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "answered"}
          className={view === "answered" ? "order-select__tab is-active" : "order-select__tab"}
          onClick={() => setView("answered")}
        >
          回答済
        </button>
      </div>

      <FilterForm
        filters={effectiveFilters}
        wards={wardOptions}
        departments={departments.departments}
        onChange={setFilters}
        onClear={() => setFilters(emptyFilters(orderContext.departmentId))}
      />

      <ErrorBanner error={worklist.error} />
      <ErrorBanner error={departments.error} />
      <ErrorBanner error={updateStatus.error} />

      {worklist.data?.truncated && (
        <p className="error-banner__line error-banner__line--error" role="status">
          他科依頼が多いため、一部のみ表示しています。
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
                  {/* 横に送っても「誰の依頼か」は残す(左 2 列を固定する)。 */}
                  <th className="sticky-table__fix-1">患者番号</th>
                  <th className="sticky-table__fix-2">患者氏名</th>
                  <PatientProfileHeadCells />
                  <th className="lab-worklist__compact">依頼日</th>
                  <th className="lab-worklist__compact">希望日</th>
                  <th className="lab-worklist__compact">種別</th>
                  <th>依頼先</th>
                  <th>依頼目的</th>
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
                    pending={updateStatus.isPending}
                    onView={() => setViewingId(row.order.id ?? null)}
                    onReply={() => setReplyingId(row.order.id ?? null)}
                    onChangeStatus={(status) => handleChangeStatus(row, status)}
                  />
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={15} className="master-search__empty">
                      {allRows.length === 0
                        ? view === "open"
                          ? "未回答の他科依頼はありません"
                          : "回答済の他科依頼はありません"
                        : "絞り込みに該当する他科依頼がありません"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="order-select__muted lab-worklist__count">{rows.length} 件</p>
        </>
      )}

      {viewing && (
        <Modal
          title={`他科依頼内容 - ${viewing.patient ? displayName(viewing.patient) : ""}`}
          onClose={() => setViewingId(null)}
          className="modal--wide"
        >
          <ConsultOrderDetailPanel serviceRequest={viewing.order} />
        </Modal>
      )}

      {replying && (
        <ConsultReplyModal
          order={replying.order}
          task={replying.task}
          patientId={replying.order.subject?.reference?.split("/").pop() ?? ""}
          patientName={replying.patient ? displayName(replying.patient) : undefined}
          onClose={() => setReplyingId(null)}
        />
      )}
    </div>
  );
}

function matchesFilters(row: ConsultWorklistRow, filters: Filters): boolean {
  const summary = summarizeConsultOrder(row.order);

  // 依頼先科。上流が performer を索引していないのでここで絞る(§2.1)。
  if (filters.targetDepartmentId && summary.targetDepartmentId !== filters.targetDepartmentId) {
    return false;
  }
  if (filters.requestType && summary.requestType !== filters.requestType) return false;
  if (filters.urgentOnly && !summary.urgent) return false;

  if (
    filters.setting &&
    SETTING_OPTIONS.find((o) => o.code === filters.setting)?.display !== summary.settingDisplay
  ) {
    return false;
  }

  // 病棟はオーダー登録時に焼き付けたもの。外来オーダーは病棟を持たない。
  if (filters.wardId && wardOf(row.order).wardId !== filters.wardId) return false;

  const requester = prescriptionRequester(row.order);
  if (filters.requesterDepartmentId && requester.departmentId !== filters.requesterDepartmentId) {
    return false;
  }

  if (filters.status && consultTaskStatus(row.task) !== filters.status) return false;

  return true;
}

interface FilterFormProps {
  filters: Filters;
  wards: { id: string; name: string }[];
  departments: fhir4.Organization[];
  onChange: (filters: Filters) => void;
  onClear: () => void;
}

function FilterForm({ filters, wards, departments, onChange, onClear }: FilterFormProps) {
  // 絞り込みは選んだ瞬間に効かせるので、Enter での送信は何もしない。
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
  }

  return (
    <form className="patient-search-form" onSubmit={handleSubmit}>
      <label>
        依頼先の診療科
        <select
          value={filters.targetDepartmentId}
          onChange={(e) => onChange({ ...filters, targetDepartmentId: e.target.value })}
        >
          <option value="">すべて</option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        依頼種別
        <select
          value={filters.requestType}
          onChange={(e) => onChange({ ...filters, requestType: e.target.value })}
        >
          <option value="">すべて</option>
          {REQUEST_TYPE_OPTIONS.map((option) => (
            <option key={option.code} value={option.code}>
              {option.display}
            </option>
          ))}
        </select>
      </label>
      <label>
        入外区分
        <select
          value={filters.setting}
          onChange={(e) => onChange({ ...filters, setting: e.target.value })}
        >
          <option value="">すべて</option>
          {SETTING_OPTIONS.map((option) => (
            <option key={option.code} value={option.code}>
              {option.display}
            </option>
          ))}
        </select>
      </label>
      <label>
        病棟
        <select
          value={filters.wardId}
          onChange={(e) => onChange({ ...filters, wardId: e.target.value })}
        >
          <option value="">すべて</option>
          {wards.map((ward) => (
            <option key={ward.id} value={ward.id}>
              {ward.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        依頼元の診療科
        <select
          value={filters.requesterDepartmentId}
          onChange={(e) => onChange({ ...filters, requesterDepartmentId: e.target.value })}
        >
          <option value="">すべて</option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        ステータス
        <select
          value={filters.status}
          onChange={(e) => onChange({ ...filters, status: e.target.value })}
        >
          <option value="">すべて</option>
          {CONSULT_TASK_STATUS_OPTIONS.map((option) => (
            <option key={option.code} value={option.code}>
              {option.display}
            </option>
          ))}
        </select>
      </label>
      <label className="patient-search-form__check">
        <input
          type="checkbox"
          checked={filters.urgentOnly}
          onChange={(e) => onChange({ ...filters, urgentOnly: e.target.checked })}
        />
        至急のみ
      </label>
      <div className="patient-search-form__actions">
        <button type="button" onClick={onClear}>
          クリア
        </button>
      </div>
    </form>
  );
}

function OrderRow({
  row,
  pending,
  onView,
  onReply,
  onChangeStatus,
}: {
  row: ConsultWorklistRow;
  pending: boolean;
  onView: () => void;
  onReply: () => void;
  onChangeStatus: (status: ConsultTaskStatus) => void;
}) {
  // カルテの「戻る」でこの一覧に戻れるように遷移元を渡す。
  const returnLinkState = useReturnLinkState();
  const { order, patient } = row;
  const summary = summarizeConsultOrder(order);
  const requester = prescriptionRequester(order);
  const status = consultTaskStatus(row.task);
  const actions = consultTaskActions(status);
  const secondaryActions = actions.filter((action) => action.secondary);

  return (
    <tr>
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
      <td className="lab-worklist__compact">{order.authoredOn?.slice(0, 10) ?? "-"}</td>
      <td className="lab-worklist__compact">
        {summary.desiredDate || <span className="order-select__muted">指定なし</span>}
      </td>
      <td className="lab-worklist__compact">
        {summary.requestTypeDisplay || "-"}
        {/* 至急は行の中で最も見落としてはいけない情報なので、種別の隣に出す。 */}
        {summary.urgent && <span className="micro-result__badge">至急</span>}
      </td>
      <td>{summary.targetLabel || "-"}</td>
      {/* 依頼目的は長いので 1 行に丸め、全文は「表示」で見る。 */}
      <td className="consult-worklist__purpose" title={summary.purpose}>
        {summary.purpose || "-"}
      </td>
      <td className="lab-worklist__compact">{summary.settingDisplay || "-"}</td>
      <td className="lab-worklist__compact">{wardOf(order).wardName || "-"}</td>
      <td>{orderContextSummary(requester) || "-"}</td>
      <td className="lab-worklist__compact">
        <span className={`lab-worklist__status lab-worklist__status--${status}`}>
          {consultTaskStatusDisplay(status)}
        </span>
      </td>
      <td className="lab-worklist__actions sticky-table__fix-actions">
        {actions
          .filter((action) => !action.secondary)
          .map((action) => (
            <button
              key={action.next}
              type="button"
              disabled={pending}
              onClick={() => onChangeStatus(action.next)}
            >
              {action.label}
            </button>
          ))}
        {/* 回答は状態を選ぶ操作ではなく診療記録を書く操作なので、進捗ボタンとは別に出す。
            受付を経ずに直接回答することもできる(短い相談で受付だけ残るのを防ぐ)。 */}
        {(status === "requested" || status === "accepted") && (
          <button type="button" onClick={onReply}>
            回答
          </button>
        )}
        <button type="button" onClick={onView}>
          表示
        </button>
        {/* 取消・回答取消は押し間違えると進捗が動くので一段畳む。 */}
        {secondaryActions.length > 0 && (
          <RowMenu label="この他科依頼の操作" escapesClipping>
            {secondaryActions.map((action) => (
              <button
                key={action.next}
                type="button"
                className={`row-menu__item${
                  action.next === "cancelled" ? " row-menu__item--danger" : ""
                }`}
                disabled={pending}
                onClick={() => onChangeStatus(action.next)}
              >
                {action.label}
              </button>
            ))}
          </RowMenu>
        )}
      </td>
    </tr>
  );
}
