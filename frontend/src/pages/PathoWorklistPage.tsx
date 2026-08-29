import { today } from "../lib/dates";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useReturnLinkState } from "../returnTo";
import {
  useSelfDepartments,
  usePathoWorklist,
  useUpdatePathoTaskStatus,
  type PathoWorklistRow,
} from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";
import { PathoOrderDetailPanel } from "../components/PathoOrderDetailPanel";
import { PathoResultDetailPanel } from "../components/PathoResultDetailPanel";
import {
  PathoResultCreateForm,
  PathoResultEditForm,
} from "../components/KartePathoResultTab";
import { RowMenu } from "../components/RowMenu";
import {
  PatientKana,
  PatientProfileCells,
  PatientProfileHeadCells,
} from "../components/PatientRowCells";
import {
  EXAM_CATEGORY_OPTIONS,
  pathoOrderSpecimens,
  specimenSummary,
  summarizePathoOrder,
} from "../fhir/pathoOrderHelpers";
import {
  PATHO_TASK_STATUS_OPTIONS,
  pathoTaskActions,
  pathoTaskStatus,
  pathoTaskStatusDisplay,
  type PathoTaskStatus,
} from "../fhir/pathoTaskHelpers";
import { reportStatusDisplay } from "../fhir/pathoResultHelpers";
import { displayName } from "../fhir/patientHelpers";
import {
  SETTING_OPTIONS,
  orderContextSummary,
  prescriptionRequester,
  wardOf,
} from "../fhir/prescriptionHelpers";

// 病理検査一覧(部門ワークリスト)。採取(予定)日を決めて、その日に検体を採る検査を
// 並べる。作りは検体検査一覧(LabWorklistPage)に合わせてある。
//
// 1 行 = オーダー 1 件。1 行を 1 段に収めて件数を目で追えるよう、検査内容の列には
// 臓器の名前だけを並べる。検体タイプ・採取法・臨床経過は「表示」で開くモーダルに送る。
//
// 検体ラベルは今回のスコープ外(docs/patho-order-design.md §8)なので、受付済・検査済へは
// この一覧のボタンで直接進める。レポートは検査済のオーダーから登録し、登録後は同じ
// ボタンから編集できる(確定後の編集は自動的に修正報告になる)。
//
// 採取日だけが上流での絞り込みで、残りは読み込んだ 1 日ぶんから画面側で絞る
// (理由は queries.ts の useLabWorklist を参照)。

interface Filters {
  examCategory: string;
  setting: string;
  wardId: string;
  departmentId: string;
  status: string;
}

const emptyFilters: Filters = {
  examCategory: "",
  setting: "",
  wardId: "",
  departmentId: "",
  status: "",
};

export function PathoWorklistPage() {
  // 採取日は必須。未選択にはできないので当日から始める。
  const [date, setDate] = useState(today);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  // 内容を開いているオーダー。行そのものではなく id で覚えておき、読み直しの
  // たびに引き直す(受付の後に開いたままのモーダルも追い付く)。
  const [viewingId, setViewingId] = useState<string | null>(null);
  // レポートを書いているオーダー。同じ理由で id で覚えておく。
  const [enteringId, setEnteringId] = useState<string | null>(null);

  // 検査内容の列が長くなるので、この画面だけ幅を広げる(検体検査一覧と同じ)。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const worklist = usePathoWorklist(date);
  const departments = useSelfDepartments();
  const updateStatus = useUpdatePathoTaskStatus();

  const rows = useMemo(
    () => (worklist.data?.rows ?? []).filter((row) => matchesFilters(row, filters)),
    [worklist.data, filters],
  );
  const total = worklist.data?.rows.length ?? 0;
  const viewing = worklist.data?.rows.find((row) => row.order.id === viewingId);
  const entering = worklist.data?.rows.find((row) => row.order.id === enteringId);

  // 病棟の選択肢は読み込んだ 1 日ぶんのオーダーから拾う(検体検査一覧と同じ考え方)。
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
        <h1>病理検査一覧</h1>
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
                  {/* 横に送っても「誰の検査か」は残す(左 2 列を固定する)。 */}
                  <th className="sticky-table__fix-1">患者番号</th>
                  <th className="sticky-table__fix-2">患者氏名</th>
                  <PatientProfileHeadCells />
                  <th className="lab-worklist__compact">区分</th>
                  <th className="lab-worklist__content">検体</th>
                  <th className="lab-worklist__compact">入外</th>
                  <th className="lab-worklist__compact">病棟</th>
                  <th>依頼科 | 依頼医師</th>
                  <th className="lab-worklist__compact">ステータス</th>
                  <th className="lab-worklist__compact">レポート</th>
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
                    onEnterReport={() => setEnteringId(row.order.id ?? null)}
                    onChangeStatus={(status) =>
                      updateStatus.mutate({ order: row.order, task: row.task, status })
                    }
                  />
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={12} className="master-search__empty">
                      {total === 0
                        ? "この採取日の病理検査オーダーはありません"
                        : "絞り込みに該当する検査がありません"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="order-select__muted lab-worklist__count">{rows.length} 件</p>
        </>
      )}

      {viewing && <PathoOrderViewModal row={viewing} onClose={() => setViewingId(null)} />}
      {entering && (
        <PathoReportEntryModal row={entering} onClose={() => setEnteringId(null)} />
      )}
    </div>
  );
}

function matchesFilters(row: PathoWorklistRow, filters: Filters): boolean {
  const summary = summarizePathoOrder(row.order);
  if (filters.examCategory && summary.examCategory !== filters.examCategory) return false;

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

  if (filters.status && pathoTaskStatus(row.task) !== filters.status) return false;

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
        採取日
        <input type="date" value={date} required onChange={(e) => onDateChange(e.target.value)} />
      </label>
      <label>
        検査区分
        <select
          value={filters.examCategory}
          onChange={(e) => onChange({ ...filters, examCategory: e.target.value })}
        >
          <option value="">すべて</option>
          {EXAM_CATEGORY_OPTIONS.map((option) => (
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
          {PATHO_TASK_STATUS_OPTIONS.map((option) => (
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

function WorklistRow({
  row,
  pending,
  onView,
  onEnterReport,
  onChangeStatus,
}: {
  row: PathoWorklistRow;
  pending: boolean;
  onView: () => void;
  onEnterReport: () => void;
  onChangeStatus: (status: PathoTaskStatus) => void;
}) {
  // カルテの「戻る」でこの一覧に戻れるように遷移元を渡す。
  const returnLinkState = useReturnLinkState();
  const { order, patient } = row;
  const summary = summarizePathoOrder(order);
  const specimens = pathoOrderSpecimens(row.itemRequests);
  const requester = prescriptionRequester(order);
  const status = pathoTaskStatus(row.task);
  const actions = pathoTaskActions(status);
  const secondaryActions = actions.filter((action) => action.secondary);

  return (
    <tr className={summary.urgent ? "lab-worklist__row--urgent" : undefined}>
      <td className="sticky-table__fix-1">{patient?.identifier?.[0]?.value ?? "-"}</td>
      <td className="sticky-table__fix-2">
        {patient ? (
          <>
            {/* 検体を受け取る前に病名や経過を見に行けるよう、カルテへ直接飛べるようにする。 */}
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
      <td className="lab-worklist__compact">{summary.examCategoryDisplay || "-"}</td>
      <td className="lab-worklist__content">
        {specimens.length > 0 ? (
          specimenSummary(specimens)
        ) : (
          <span className="order-select__muted">検体なし</span>
        )}
      </td>
      <td className="lab-worklist__compact">
        {summary.settingDisplay || "-"}
        {summary.urgent && <span className="dose-conversion__badge">至急</span>}
      </td>
      {/* オーダー登録時の入院病棟。外来オーダーと、焼き付ける前のオーダーは "-"。 */}
      <td className="lab-worklist__compact">{wardOf(order).wardName || "-"}</td>
      <td>{orderContextSummary(requester) || "-"}</td>
      <td className="lab-worklist__compact">
        <span className={`lab-worklist__status lab-worklist__status--${status}`}>
          {pathoTaskStatusDisplay(status)}
        </span>
      </td>
      <td className="lab-worklist__compact">
        {row.reportId ? (
          reportStatusDisplay(row.reportStatus) || "登録済"
        ) : (
          <span className="order-select__muted">未</span>
        )}
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
        {/* レポートは検体が届いてから書く。既に書いてあれば同じボタンから直す
            (確定済みのレポートを直すと修正報告になる)。 */}
        {(status === "accepted" || status === "completed") && (
          <button type="button" disabled={!patient?.id} onClick={onEnterReport}>
            {row.reportId ? "レポート編集" : "レポート登録"}
          </button>
        )}
        {/* 一覧には臓器しか出さないので、検体タイプ・採取法・臨床経過はここから開く。
            行によって数が変わる進捗のボタンより右に置いて、どの行でも同じ位置で押せるようにする。 */}
        <button type="button" onClick={onView}>
          表示
        </button>
        {/* 取消・中止は押し間違えると進捗が巻き戻るので一段畳む(検体検査一覧と同じ)。 */}
        {secondaryActions.length > 0 && (
          <RowMenu label="この検査の操作" escapesClipping>
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

// 「表示」で開くオーダー内容。カルテの詳細モーダルと同じパネルを使い、レポートが
// 既にあればその内容も続けて見せる(部門では依頼とレポートを並べて読むため)。
function PathoOrderViewModal({
  row,
  onClose,
}: {
  row: PathoWorklistRow;
  onClose: () => void;
}) {
  return (
    <Modal
      title={`病理検査内容 - ${row.patient ? displayName(row.patient) : ""}`}
      onClose={onClose}
      className="modal--wide"
    >
      <PathoOrderDetailPanel serviceRequest={row.order} itemRequests={row.itemRequests} />
      {row.reportId && (
        <>
          <h3 className="karte-tabpanel__header">病理診断レポート</h3>
          <PathoResultDetailPanel reportId={row.reportId} />
        </>
      )}
    </Modal>
  );
}

// 「レポート登録 / レポート編集」で開く入力。入力欄はカルテの病理タブと同じ
// PathoResultForm で、違いは紐付け先のオーダーが行から決まっていること。
function PathoReportEntryModal({
  row,
  onClose,
}: {
  row: PathoWorklistRow;
  onClose: () => void;
}) {
  const patientId = row.patient?.id ?? "";
  const orderId = row.order.id ?? "";

  return (
    <Modal
      title={`${row.reportId ? "病理レポート編集" : "病理レポート登録"} - ${
        row.patient ? displayName(row.patient) : ""
      }`}
      onClose={onClose}
      className="modal--wide"
    >
      {row.reportId ? (
        <PathoResultEditForm patientId={patientId} reportId={row.reportId} onSaved={onClose} />
      ) : (
        <PathoResultCreateForm
          patientId={patientId}
          fixedOrderId={orderId}
          onSaved={onClose}
        />
      )}
    </Modal>
  );
}
