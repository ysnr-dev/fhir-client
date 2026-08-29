import { today } from "../lib/dates";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useReturnLinkState } from "../returnTo";
import {
  useSelfDepartments,
  useTransfusionWorklist,
  useUpdateTransfusionTaskStatus,
  type TransfusionWorklistRow,
} from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";
import { RowMenu } from "../components/RowMenu";
import {
  PatientKana,
  PatientProfileCells,
  PatientProfileHeadCells,
} from "../components/PatientRowCells";
import { TransfusionBloodBadge } from "../components/TransfusionBloodBadge";
import { TransfusionOrderDetailPanel } from "../components/TransfusionOrderDetailPanel";
import { TransfusionPerformModal } from "../components/TransfusionPerformModal";
import {
  TEST_TYPE_OPTIONS,
  productSummary,
  summarizeTransfusionOrder,
  transfusionOrderProducts,
} from "../fhir/transfusionOrderHelpers";
import {
  TRANSFUSION_TASK_STATUS_OPTIONS,
  transfusionTaskActions,
  transfusionTaskStatus,
  transfusionTaskStatusDisplay,
  type TransfusionTaskStatus,
} from "../fhir/transfusionTaskHelpers";
import { displayName } from "../fhir/patientHelpers";
import {
  SETTING_OPTIONS,
  orderContextSummary,
  prescriptionRequester,
  wardOf,
} from "../fhir/prescriptionHelpers";

// 輸血一覧(部門ワークリスト)。投与予定日を決めて、その日に出す輸血を並べる。
// 作りは病理検査一覧(PathoWorklistPage)に合わせてある。
//
// 1 行 = オーダー 1 件。1 行を 1 段に収めて件数を目で追えるよう、製剤の列には
// 略称と単位数だけを並べる。備考・同意書の有無は「表示」で開くモーダルに送る。
//
// 病理と違うところ:
// - **血液型を独立した列にする**。輸血部門が製剤を選ぶときに最初に確かめるのが型で、
//   他の情報と同じ扱いで文字の列に混ぜると読み飛ばされる。オーダー画面と同じ
//   日赤の区分色を付けて、横に流し読みしても型が拾えるようにする。
// - **同意書が未取得の行を警告色で出す**。同意なしで出庫すると事故になるため、
//   至急と同じ強さで行そのものを目立たせる。
// - レポートの列は無い(輸血に結果レポートは無く、記録は実施記録側)。
//
// 出庫済の行の「実施」は、Task を進めるだけでなく実施入力(製剤番号・開始/終了時刻・
// 副作用)を開く。輸血は投与するのが病棟なので、この一覧のほかカルテのカードからも
// 同じ入力を開ける(docs/transfusion-order-design.md §5.1)。
//
// 投与予定日だけが上流での絞り込みで、残りは読み込んだ 1 日ぶんから画面側で絞る
// (理由は queries.ts の useLabWorklist を参照)。

interface Filters {
  testType: string;
  setting: string;
  wardId: string;
  departmentId: string;
  status: string;
}

const emptyFilters: Filters = {
  testType: "",
  setting: "",
  wardId: "",
  departmentId: "",
  status: "",
};

export function TransfusionWorklistPage() {
  // 投与予定日は必須。未選択にはできないので当日から始める。
  const [date, setDate] = useState(today);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  // 内容を開いているオーダー。行そのものではなく id で覚えておき、読み直しの
  // たびに引き直す(受付の後に開いたままのモーダルも追い付く)。
  const [viewingId, setViewingId] = useState<string | null>(null);
  // 実施入力を開いているオーダー。同じ理由で id で覚えておく。
  const [performingId, setPerformingId] = useState<string | null>(null);

  // 製剤の列が長くなるので、この画面だけ幅を広げる(病理・検体検査一覧と同じ)。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const worklist = useTransfusionWorklist(date);
  const departments = useSelfDepartments();
  const updateStatus = useUpdateTransfusionTaskStatus();

  const rows = useMemo(
    () => (worklist.data?.rows ?? []).filter((row) => matchesFilters(row, filters)),
    [worklist.data, filters],
  );
  const total = worklist.data?.rows.length ?? 0;
  const viewing = worklist.data?.rows.find((row) => row.order.id === viewingId);
  const performing = worklist.data?.rows.find((row) => row.order.id === performingId);

  // 病棟の選択肢は読み込んだ 1 日ぶんのオーダーから拾う(病理一覧と同じ考え方)。
  const wardOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const row of worklist.data?.rows ?? []) {
      const ward = wardOf(row.order);
      if (ward.wardId && !byId.has(ward.wardId)) {
        byId.set(ward.wardId, ward.wardName || ward.wardId);
      }
    }
    return Array.from(byId, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [worklist.data]);

  function handleDateChange(value: string) {
    // 日付を空にはさせない(空で検索すると全期間になってしまう)。
    if (value) setDate(value);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>輸血一覧</h1>
      </div>

      <FilterForm
        date={date}
        filters={filters}
        wards={wardOptions}
        departments={departments.departments}
        onDateChange={handleDateChange}
        onChange={setFilters}
      />

      <ErrorBanner error={worklist.error} />
      <ErrorBanner error={departments.error} />
      <ErrorBanner error={updateStatus.error} />

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
                  {/* 横に送っても「誰の輸血か」は残す(左 2 列を固定する)。 */}
                  <th className="sticky-table__fix-1">患者番号</th>
                  <th className="sticky-table__fix-2">患者氏名</th>
                  <PatientProfileHeadCells />
                  <th className="lab-worklist__compact">血液型</th>
                  <th className="lab-worklist__compact">検査区分</th>
                  <th className="lab-worklist__content">製剤</th>
                  <th className="lab-worklist__compact">投与予定</th>
                  <th className="lab-worklist__compact">入外</th>
                  <th className="lab-worklist__compact">病棟</th>
                  <th>依頼科 | 依頼医師</th>
                  <th className="lab-worklist__compact">ステータス</th>
                  <th className="lab-worklist__actions sticky-table__fix-actions"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <WorklistRow
                    key={row.order.id}
                    row={row}
                    pending={updateStatus.isPending}
                    onView={() => setViewingId(row.order.id ?? null)}
                    onPerform={() => setPerformingId(row.order.id ?? null)}
                    onChangeStatus={(status) =>
                      updateStatus.mutate({ order: row.order, task: row.task, status })
                    }
                  />
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={13} className="master-search__empty">
                      {total === 0
                        ? "この投与予定日の輸血オーダーはありません"
                        : "絞り込みに該当する輸血がありません"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="order-select__muted lab-worklist__count">{rows.length} 件</p>
        </>
      )}

      {viewing && <TransfusionOrderViewModal row={viewing} onClose={() => setViewingId(null)} />}
      {performing && (
        <TransfusionPerformModal
          order={performing.order}
          itemRequests={performing.itemRequests}
          task={performing.task}
          patientName={performing.patient ? displayName(performing.patient) : undefined}
          onClose={() => setPerformingId(null)}
        />
      )}
    </div>
  );
}

function matchesFilters(row: TransfusionWorklistRow, filters: Filters): boolean {
  const summary = summarizeTransfusionOrder(row.order);
  if (filters.testType && summary.testType !== filters.testType) return false;

  // 入外区分は表示名ではなくコードで持っているので、選択肢のコードと突き合わせる。
  if (
    filters.setting &&
    SETTING_OPTIONS.find((o) => o.code === filters.setting)?.display !== summary.settingDisplay
  ) {
    return false;
  }

  // 病棟はオーダー登録時に焼き付けたもの。外来オーダーと、焼き付ける前に出した
  // オーダーは病棟を持たないので、病棟で絞ると消える。
  if (filters.wardId && wardOf(row.order).wardId !== filters.wardId) return false;

  const requester = prescriptionRequester(row.order);
  if (filters.departmentId && requester.departmentId !== filters.departmentId) return false;

  if (filters.status && transfusionTaskStatus(row.task) !== filters.status) return false;

  return true;
}

interface FilterFormProps {
  date: string;
  filters: Filters;
  wards: { id: string; name: string }[];
  departments: fhir4.Organization[];
  onDateChange: (value: string) => void;
  onChange: (filters: Filters) => void;
}

function FilterForm({
  date,
  filters,
  wards,
  departments,
  onDateChange,
  onChange,
}: FilterFormProps) {
  // 絞り込みは選んだ瞬間に効かせるので、Enter での送信は何もしない。
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
  }

  return (
    <form className="patient-search-form" onSubmit={handleSubmit}>
      <label>
        投与予定日
        <input type="date" value={date} required onChange={(e) => onDateChange(e.target.value)} />
      </label>
      <label>
        輸血検査区分
        <select
          value={filters.testType}
          onChange={(e) => onChange({ ...filters, testType: e.target.value })}
        >
          <option value="">すべて</option>
          {TEST_TYPE_OPTIONS.map((option) => (
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
        診療科
        <select
          value={filters.departmentId}
          onChange={(e) => onChange({ ...filters, departmentId: e.target.value })}
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
          {TRANSFUSION_TASK_STATUS_OPTIONS.map((option) => (
            <option key={option.code} value={option.code}>
              {option.display}
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

/** 投与予定時刻。日付は一覧の絞り込みで決まっているので時刻だけ出す。 */
function scheduledTime(order: fhir4.ServiceRequest): string {
  const occurrence = order.occurrenceDateTime ?? "";
  return occurrence.length > 10 ? occurrence.slice(11, 16) : "";
}

function WorklistRow({
  row,
  pending,
  onView,
  onPerform,
  onChangeStatus,
}: {
  row: TransfusionWorklistRow;
  pending: boolean;
  onView: () => void;
  onPerform: () => void;
  onChangeStatus: (status: TransfusionTaskStatus) => void;
}) {
  // カルテの「戻る」でこの一覧に戻れるように遷移元を渡す。
  const returnLinkState = useReturnLinkState();
  const { order, patient } = row;
  const summary = summarizeTransfusionOrder(order);
  const products = transfusionOrderProducts(row.itemRequests);
  const requester = prescriptionRequester(order);
  const status = transfusionTaskStatus(row.task);
  const actions = transfusionTaskActions(status);
  const secondaryActions = actions.filter((action) => action.secondary);

  // 至急と、同意書が未取得のものを目立たせる。中止した行はもう出さないので警告しない。
  const needsAttention =
    summary.urgent || (!summary.consentConfirmed && status !== "cancelled");

  return (
    <tr className={needsAttention ? "lab-worklist__row--urgent" : undefined}>
      <td className="sticky-table__fix-1">{patient?.identifier?.[0]?.value ?? "-"}</td>
      <td className="sticky-table__fix-2">
        {patient ? (
          <>
            {/* 製剤を出す前に病歴・検査結果を見に行けるよう、カルテへ直接飛べるようにする。 */}
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
      {/* 製剤を選ぶときに最初に確かめる情報。オーダー画面と同じ区分色で出す。 */}
      <td className="lab-worklist__compact">
        {summary.bloodTypeDisplay ? (
          <TransfusionBloodBadge abo={summary.aboBloodType} rhd={summary.rhdBloodType} />
        ) : (
          <span className="order-select__muted">未指定</span>
        )}
      </td>
      <td className="lab-worklist__compact">{summary.testTypeDisplay || "-"}</td>
      <td className="lab-worklist__content">
        {products.length > 0 ? (
          productSummary(products)
        ) : (
          <span className="order-select__muted">製剤なし</span>
        )}
      </td>
      <td className="lab-worklist__compact">{scheduledTime(order) || "-"}</td>
      <td className="lab-worklist__compact">
        {summary.settingDisplay || "-"}
        {summary.urgent && <span className="dose-conversion__badge">至急</span>}
        {/* 同意なしで出庫すると事故になるので、行の警告色だけでなく理由も出す。 */}
        {!summary.consentConfirmed && <span className="dose-conversion__badge">同意書未</span>}
      </td>
      {/* オーダー登録時の入院病棟。外来オーダーと、焼き付ける前のオーダーは "-"。 */}
      <td className="lab-worklist__compact">{wardOf(order).wardName || "-"}</td>
      <td>{orderContextSummary(requester) || "-"}</td>
      <td className="lab-worklist__compact">
        <span className={`lab-worklist__status lab-worklist__status--${status}`}>
          {transfusionTaskStatusDisplay(status)}
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
        {/* 実施は Task を進めるだけでなく実施記録を入れるので、他の進捗ボタンとは
            別に置く。出庫していない製剤は輸血できないので出庫済のときだけ出す。 */}
        {status === "in-progress" && (
          <button type="button" onClick={onPerform}>
            実施
          </button>
        )}
        {/* 一覧には製剤の略称しか出さないので、備考・同意書・依頼コメントはここから開く。
            行によって数が変わる進捗のボタンより右に置いて、どの行でも同じ位置で押せるようにする。 */}
        <button type="button" onClick={onView}>
          表示
        </button>
        {/* 取消・中止は押し間違えると進捗が巻き戻るので一段畳む(病理一覧と同じ)。 */}
        {secondaryActions.length > 0 && (
          <RowMenu label="この輸血の操作" escapesClipping>
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

// 「表示」で開くオーダー内容。カルテの詳細モーダルと同じパネルを使う。
function TransfusionOrderViewModal({
  row,
  onClose,
}: {
  row: TransfusionWorklistRow;
  onClose: () => void;
}) {
  return (
    <Modal
      title={`輸血内容 - ${row.patient ? displayName(row.patient) : ""}`}
      onClose={onClose}
      className="modal--wide"
    >
      <TransfusionOrderDetailPanel serviceRequest={row.order} itemRequests={row.itemRequests} />
    </Modal>
  );
}
