import { today } from "../lib/dates";
import { useEffect, useMemo, useState, type ComponentProps, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useReturnLinkState } from "../returnTo";
import {
  useAutologousWorklist,
  useSelfDepartments,
  useTransfusionPerformDetail,
  useTransfusionWorklist,
  useUpdateTransfusionTaskStatus,
  type AutologousWorklistRow,
  type TransfusionWorklistRow,
} from "../api/queries";
import { DateStepper } from "../components/DateStepper";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";
import { PatientProfileDrawer, useRowDrawer } from "../components/PatientProfileDrawer";
import { RowMenu } from "../components/RowMenu";
import {
  PatientKana,
  PatientProfileCells,
  PatientProfileHeadCells,
} from "../components/PatientRowCells";
import { RowPictograms } from "../components/PatientListRowParts";
import { TransfusionBloodBadge } from "../components/TransfusionBloodBadge";
import { TransfusionOrderDetailPanel } from "../components/TransfusionOrderDetailPanel";
import { AutologousCollectionModal } from "../components/AutologousCollectionModal";
import { TransfusionDispenseModal } from "../components/TransfusionDispenseModal";
import { useTransfusionProductOptions } from "../api/masterQueries";
import { collectionPlanStatusClass, collectionPlanStatusLabel, plannedVolumeOf } from "../fhir/autologousPlanHelpers";
import { splitPerformBundle } from "../fhir/radResultHelpers";
import { transfusionDispensesByOrderId } from "../fhir/transfusionDispenseHelpers";
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
  type TransfusionTaskAction,
  type TransfusionTaskStatus,
} from "../fhir/transfusionTaskHelpers";
import { displayName } from "../fhir/patientHelpers";
import { orderContextSummary, orderRequester, wardOf } from "../fhir/orderHeader";
import { SETTING_OPTIONS } from "../fhir/prescriptionHelpers";
import {
  useRowPictogramSources,
  type RowPictogramSources,
} from "../hooks/useRowPictogramSources";

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
// (理由は api/queries/rad.ts の「放射線検査一覧」の節)。
//
// 日付の軸は「投与予定日 | 採血予定日」で切り替える。採血予定日は自己血の採血予定(Appointment)を
// 日付で引いた一覧で、1 行 = 予定 1 件。輸血部門(採血室)がその日に採る患者を追う。

type DateAxis = "occurrence" | "collection";

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
  // 出庫入力を開いているオーダー。
  const [dispensingId, setDispensingId] = useState<string | null>(null);
  // 自己血の採血を開いているオーダーと、選んでおく採血予定。
  const [collecting, setCollecting] = useState<{ orderId: string; appointmentId?: string } | null>(null);
  const [axis, setAxis] = useState<DateAxis>("occurrence");
  // 自己血の製剤コード(採血のボタンを出す行の判定)。
  const products = useTransfusionProductOptions();
  const autoCodes = useMemo(
    () => new Set((products.data?.items ?? []).filter((i) => i.category === "auto").map((i) => i.item_code)),
    [products.data],
  );

  // 製剤の列が長くなるので、この画面だけ幅を広げる(病理・検体検査一覧と同じ)。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const worklist = useTransfusionWorklist(date);
  const collections = useAutologousWorklist(date, axis === "collection");
  const departments = useSelfDepartments();
  const updateStatus = useUpdateTransfusionTaskStatus();

  const rows = useMemo(
    () => (worklist.data?.rows ?? []).filter((row) => matchesFilters(row, filters)),
    [worklist.data, filters],
  );
  const total = worklist.data?.rows.length ?? 0;
  const viewingRow =
    worklist.data?.rows.find((row) => row.order.id === viewingId) ??
    collections.data?.rows.find((r) => r.row.order.id === viewingId)?.row;
  const performing = worklist.data?.rows.find((row) => row.order.id === performingId);
  const dispensing = worklist.data?.rows.find((row) => row.order.id === dispensingId);
  // 採血のモーダルは両方の軸から開くので、どちらの行からでも引けるようにする。
  const collectingRow =
    worklist.data?.rows.find((row) => row.order.id === collecting?.orderId) ??
    collections.data?.rows.find((r) => r.row.order.id === collecting?.orderId)?.row;

  const patientIds = useMemo(
    () => rows.flatMap((row) => (row.patient?.id ? [row.patient.id] : [])),
    [rows],
  );
  const pictograms = useRowPictogramSources(patientIds);

  // 行を押すと右に患者プロファイルを出す。行はオーダーごとなのでオーダーで選ぶ
  // (同じ患者が同じ日に複数の輸血を持つこともある)。絞り込みで行が消えたら閉じる。
  const drawer = useRowDrawer();
  const selectedRow = rows.find((row) => row.patient?.id && row.order.id === drawer.selectedKey);
  const selectedMenuActions = selectedRow ? secondaryActionsOf(selectedRow) : [];

  function changeStatus(row: TransfusionWorklistRow, status: TransfusionTaskStatus) {
    updateStatus.mutate({ order: row.order, task: row.task, status });
  }

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
        axis={axis}
        filters={filters}
        wards={wardOptions}
        departments={departments.departments}
        onDateChange={handleDateChange}
        onAxisChange={setAxis}
        onChange={setFilters}
      />

      <ErrorBanner error={worklist.error} />
      <ErrorBanner error={collections.error} />
      <ErrorBanner error={departments.error} />
      <ErrorBanner error={updateStatus.error} />

      {(axis === "occurrence" ? worklist.data?.truncated : collections.data?.truncated) && (
        <p className="error-banner__line error-banner__line--error" role="status">
          この日のオーダーが多いため、一部のみ表示しています。
        </p>
      )}

      {axis === "collection" ? (
        <AutologousWorklistTable
          rows={collections.data?.rows ?? []}
          loading={collections.isLoading}
          onView={(row) => setViewingId(row.order.id ?? null)}
          onCollect={(r) => setCollecting({ orderId: r.row.order.id ?? "", appointmentId: r.appointment.id })}
        />
      ) : worklist.isLoading ? (
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
                    pictograms={pictograms}
                    pending={updateStatus.isPending}
                    onView={() => setViewingId(row.order.id ?? null)}
                    onPerform={() => setPerformingId(row.order.id ?? null)}
                    onDispense={() => setDispensingId(row.order.id ?? null)}
                    onCollect={() => setCollecting({ orderId: row.order.id ?? "" })}
                    canCollect={canCollect(row, autoCodes)}
                    onChangeStatus={(status) => changeStatus(row, status)}
                    rowProps={drawer.rowProps(row.patient?.id && row.order.id, attentionRowClass(row))}
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

      {selectedRow?.patient?.id && (
        <PatientProfileDrawer
          patientId={selectedRow.patient.id}
          patient={selectedRow.patient}
          actions={
            <>
              <WorklistRowButtons
                row={selectedRow}
                pending={updateStatus.isPending}
                onView={() => setViewingId(selectedRow.order.id ?? null)}
                onPerform={() => setPerformingId(selectedRow.order.id ?? null)}
                onDispense={() => setDispensingId(selectedRow.order.id ?? null)}
                onCollect={() => setCollecting({ orderId: selectedRow.order.id ?? "" })}
                canCollect={canCollect(selectedRow, autoCodes)}
                onChangeStatus={(status) => changeStatus(selectedRow, status)}
              />
              <WorklistMenuItems
                actions={selectedMenuActions}
                pending={updateStatus.isPending}
                onChangeStatus={(status) => changeStatus(selectedRow, status)}
              />
            </>
          }
          onClose={drawer.close}
        />
      )}
      {viewingRow && <TransfusionOrderViewModal row={viewingRow} onClose={() => setViewingId(null)} />}
      {performing && (
        <TransfusionPerformModal
          order={performing.order}
          itemRequests={performing.itemRequests}
          task={performing.task}
          patientName={performing.patient ? displayName(performing.patient) : undefined}
          onClose={() => setPerformingId(null)}
        />
      )}
      {dispensing && (
        <TransfusionDispenseModal row={dispensing} onClose={() => setDispensingId(null)} />
      )}
      {collecting && collectingRow && (
        <AutologousCollectionModal
          row={collectingRow}
          appointmentId={collecting.appointmentId}
          onClose={() => setCollecting(null)}
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

  // 病棟はオーダー登録時に焼き付けたもの。病棟を持たないオーダー(外来など)は、
  // 病棟で絞ると消える。
  if (filters.wardId && wardOf(row.order).wardId !== filters.wardId) return false;

  const requester = orderRequester(row.order);
  if (filters.departmentId && requester.departmentId !== filters.departmentId) return false;

  if (filters.status && transfusionTaskStatus(row.task) !== filters.status) return false;

  return true;
}

interface FilterFormProps {
  date: string;
  axis: DateAxis;
  filters: Filters;
  wards: { id: string; name: string }[];
  departments: fhir4.Organization[];
  onDateChange: (value: string) => void;
  onAxisChange: (axis: DateAxis) => void;
  onChange: (filters: Filters) => void;
}

function FilterForm({
  date,
  axis,
  filters,
  wards,
  departments,
  onDateChange,
  onAxisChange,
  onChange,
}: FilterFormProps) {
  // 絞り込みは選んだ瞬間に効かせるので、Enter での送信は何もしない。
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
  }

  return (
    <form className="patient-search-form" onSubmit={handleSubmit}>
      <div className="order-select__tabs transfusion-worklist__axis" role="tablist" aria-label="日付の軸">
        {(
          [
            ["occurrence", "投与予定日"],
            ["collection", "採血予定日"],
          ] as const
        ).map(([code, label]) => (
          <button
            key={code}
            type="button"
            role="tab"
            aria-selected={axis === code}
            className={`order-select__tab${axis === code ? " is-active" : ""}`}
            onClick={() => onAxisChange(code)}
          >
            {label}
          </button>
        ))}
      </div>
      <label>
        {axis === "collection" ? "採血予定日" : "投与予定日"}
        <DateStepper value={date} onChange={onDateChange} />
      </label>
      {axis === "occurrence" && (
        <>
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
        </>
      )}
    </form>
  );
}

/** 投与予定時刻。日付は一覧の絞り込みで決まっているので時刻だけ出す。 */
function scheduledTime(order: fhir4.ServiceRequest): string {
  const occurrence = order.occurrenceDateTime ?? "";
  return occurrence.length > 10 ? occurrence.slice(11, 16) : "";
}

/** 取消・中止。押し間違えると進捗が巻き戻るので、行のケバブに畳む。 */
function secondaryActionsOf(row: TransfusionWorklistRow) {
  return transfusionTaskActions(transfusionTaskStatus(row.task)).filter(
    (action) => action.secondary,
  );
}

/** まだ採血していない採血予定の数。 */
function pendingCollections(row: TransfusionWorklistRow): number {
  return row.appointments.filter((a) => a.status === "booked").length;
}

/** 自己血の製剤を含み、まだ出庫していないオーダー。採血(貯血)の入力を出す。 */
function canCollect(row: TransfusionWorklistRow, autoCodes: Set<string>): boolean {
  const status = transfusionTaskStatus(row.task);
  if (status !== "requested" && status !== "accepted") return false;
  return transfusionOrderProducts(row.itemRequests, row.order).some((p) => autoCodes.has(p.productCode));
}

// 至急と、同意書が未取得のものを目立たせる。中止した行はもう出さないので警告しない。
function attentionRowClass(row: TransfusionWorklistRow): string | undefined {
  const summary = summarizeTransfusionOrder(row.order);
  const needsAttention =
    summary.urgent ||
    (!summary.consentConfirmed && transfusionTaskStatus(row.task) !== "cancelled");
  return needsAttention ? "lab-worklist__row--urgent" : undefined;
}

function WorklistRow({
  row,
  pictograms,
  pending,
  onView,
  onPerform,
  onDispense,
  onCollect,
  canCollect,
  onChangeStatus,
  rowProps,
}: {
  /** 患者氏名の後ろに並べる注意のピクトグラムの材料(一覧の患者ぶんをまとめて引いたもの)。 */
  pictograms: RowPictogramSources;
  row: TransfusionWorklistRow;
  pending: boolean;
  onView: () => void;
  onPerform: () => void;
  onDispense: () => void;
  onCollect: () => void;
  canCollect: boolean;
  onChangeStatus: (status: TransfusionTaskStatus) => void;
  /** 行を押してドロワーを開くための className と onClick。 */
  rowProps: ComponentProps<"tr">;
}) {
  // カルテの「戻る」でこの一覧に戻れるように遷移元を渡す。
  const returnLinkState = useReturnLinkState();
  const { order, patient } = row;
  const summary = summarizeTransfusionOrder(order);
  const products = transfusionOrderProducts(row.itemRequests, order);
  const requester = orderRequester(order);
  const status = transfusionTaskStatus(row.task);
  const secondaryActions = secondaryActionsOf(row);

  return (
    <tr {...rowProps}>
      <td className="sticky-table__fix-1">{patient?.identifier?.[0]?.value ?? "-"}</td>
      <td className="sticky-table__fix-2">
        {patient ? (
          <>
            {/* 製剤を出す前に病歴・検査結果を見に行けるよう、カルテへ直接飛べるようにする。 */}
            <Link to={`/patients/${patient.id}/karte`} state={returnLinkState}>
              {displayName(patient)}
            </Link>
            <PatientKana patient={patient} />
            <RowPictograms patientId={patient.id ?? ""} {...pictograms} />
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
        {summary.urgencyBadge && <span className="dose-conversion__badge">{summary.urgencyBadge}</span>}
        {/* 同意なしで出庫すると事故になるので、行の警告色だけでなく理由も出す。 */}
        {!summary.consentConfirmed && <span className="dose-conversion__badge">同意書未</span>}
        {/* 自己血の採血がまだ残っている(予定どおり採れているかを一覧で追う)。 */}
        {pendingCollections(row) > 0 && (
          <span className="dose-conversion__badge">採血 未{pendingCollections(row)}</span>
        )}
      </td>
      {/* オーダー登録時の入院病棟。病棟を持たないオーダー(外来など)は "-"。 */}
      <td className="lab-worklist__compact">{wardOf(order).wardName || "-"}</td>
      <td>{orderContextSummary(requester) || "-"}</td>
      <td className="lab-worklist__compact">
        <span className={`lab-worklist__status lab-worklist__status--${status}`}>
          {transfusionTaskStatusDisplay(status)}
        </span>
      </td>
      <td className="lab-worklist__actions sticky-table__fix-actions">
        <WorklistRowButtons
          row={row}
          pending={pending}
          onView={onView}
          onPerform={onPerform}
          onDispense={onDispense}
          onCollect={onCollect}
          canCollect={canCollect}
          onChangeStatus={onChangeStatus}
        />
        {/* 取消・中止は押し間違えると進捗が巻き戻るので一段畳む(病理一覧と同じ)。 */}
        {secondaryActions.length > 0 && (
          <RowMenu label="この輸血の操作" escapesClipping>
            <WorklistMenuItems
              actions={secondaryActions}
              pending={pending}
              onChangeStatus={onChangeStatus}
            />
          </RowMenu>
        )}
      </td>
    </tr>
  );
}

/** 行に直接並べるボタン。ドロワーにもケバブの項目より先に同じものを並べる。 */
function WorklistRowButtons({
  row,
  pending,
  onView,
  onPerform,
  onDispense,
  onCollect,
  canCollect,
  onChangeStatus,
}: {
  row: TransfusionWorklistRow;
  pending: boolean;
  onView: () => void;
  onPerform: () => void;
  onDispense: () => void;
  onCollect: () => void;
  canCollect: boolean;
  onChangeStatus: (status: TransfusionTaskStatus) => void;
}) {
  const status = transfusionTaskStatus(row.task);
  return (
    <>
      {/* 自己血の採血(貯血)。出庫の前に採った血を 1 本ずつ記録する。 */}
      {canCollect && (
        <button type="button" onClick={onCollect}>
          採血
        </button>
      )}
      {transfusionTaskActions(status)
        .filter((action) => !action.secondary)
        .map((action) => (
          <button
            key={action.next}
            type="button"
            disabled={pending}
            // 出庫は Task を進めるだけでなく出庫記録(バッグごとの製剤番号・型・期限・交差)を
            // 入れるので、入力モーダルを開く。
            onClick={() => (action.next === "in-progress" ? onDispense() : onChangeStatus(action.next))}
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
    </>
  );
}

/** 行のケバブの項目。ドロワーにも同じものをボタンとして並べる。 */
function WorklistMenuItems({
  actions,
  pending,
  onChangeStatus,
}: {
  actions: TransfusionTaskAction[];
  pending: boolean;
  onChangeStatus: (status: TransfusionTaskStatus) => void;
}) {
  return (
    <>
      {actions.map((action) => (
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
    </>
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
  // 出庫記録(ハブとバッグ)。一覧の行は持っていないので開いたときに引く。
  const perform = useTransfusionPerformDetail(row.order.id);
  const dispenses = useMemo(() => {
    const { procedures, dispenses: bags } = splitPerformBundle(perform.data?.data);
    return transfusionDispensesByOrderId(procedures, bags).get(row.order.id ?? "") ?? [];
  }, [perform.data, row.order.id]);
  return (
    <Modal
      title={`輸血内容 - ${row.patient ? displayName(row.patient) : ""}`}
      onClose={onClose}
      className="modal--wide"
    >
      <ErrorBanner error={perform.error} />
      <TransfusionOrderDetailPanel
        serviceRequest={row.order}
        itemRequests={row.itemRequests}
        dispenses={dispenses}
        appointments={row.appointments}
      />
    </Modal>
  );
}

// 採血予定日の一覧。1 行 = 採血予定 1 件。採血室がその日に採る患者と量を追い、
// 「採血」でその予定を選んだ状態の採血入力を開く。
function AutologousWorklistTable({
  rows,
  loading,
  onView,
  onCollect,
}: {
  rows: AutologousWorklistRow[];
  loading: boolean;
  onView: (row: TransfusionWorklistRow) => void;
  onCollect: (row: AutologousWorklistRow) => void;
}) {
  const returnLinkState = useReturnLinkState();
  if (loading) return <p>読み込み中...</p>;
  return (
    <>
      <div className="lab-worklist-wrap sticky-table-wrap">
        <table className="lab-worklist sticky-table">
          <thead>
            <tr>
              <th className="sticky-table__fix-1">患者番号</th>
              <th className="sticky-table__fix-2">患者氏名</th>
              <PatientProfileHeadCells />
              <th className="lab-worklist__compact">血液型</th>
              <th className="lab-worklist__compact">予定時刻</th>
              <th className="lab-worklist__content">製剤</th>
              <th className="lab-worklist__compact">予定量</th>
              <th className="lab-worklist__compact">累計</th>
              <th className="lab-worklist__compact">使用予定</th>
              <th>依頼科 | 依頼医師</th>
              <th className="lab-worklist__compact">状態</th>
              <th className="lab-worklist__actions sticky-table__fix-actions"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const { order, patient } = r.row;
              const summary = summarizeTransfusionOrder(order);
              const products = transfusionOrderProducts(r.row.itemRequests, order);
              const start = r.appointment.start ?? "";
              const planned = plannedVolumeOf(r.appointment);
              const status = r.appointment.status ?? "booked";
              const taskStatus = transfusionTaskStatus(r.row.task);
              return (
                <tr key={r.appointment.id}>
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
                  <td className="lab-worklist__compact">
                    {summary.bloodTypeDisplay ? (
                      <TransfusionBloodBadge abo={summary.aboBloodType} rhd={summary.rhdBloodType} />
                    ) : (
                      <span className="order-select__muted">未指定</span>
                    )}
                  </td>
                  <td className="lab-worklist__compact">{start.length > 10 ? start.slice(11, 16) : "-"}</td>
                  <td className="lab-worklist__content">
                    {products.length > 0 ? productSummary(products) : <span className="order-select__muted">製剤なし</span>}
                  </td>
                  <td className="lab-worklist__compact">{planned ? `${planned} mL` : "-"}</td>
                  <td className="lab-worklist__compact">{r.collectedVolume} mL</td>
                  <td className="lab-worklist__compact">{(order.occurrenceDateTime ?? "").slice(0, 10) || "-"}</td>
                  <td>{orderContextSummary(orderRequester(order)) || "-"}</td>
                  <td className="lab-worklist__compact">
                    <span className={`lab-worklist__status lab-worklist__status--${collectionPlanStatusClass(status)}`}>
                      {collectionPlanStatusLabel(status)}
                    </span>
                  </td>
                  <td className="lab-worklist__actions sticky-table__fix-actions">
                    {/* 中止・実施済みのオーダーの予定からは採血できない。 */}
                    {status === "booked" && (taskStatus === "requested" || taskStatus === "accepted") && (
                      <button type="button" onClick={() => onCollect(r)}>
                        採血
                      </button>
                    )}
                    <button type="button" onClick={() => onView(r.row)}>
                      表示
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={13} className="master-search__empty">
                  この採血予定日の自己血の採血予定はありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="order-select__muted lab-worklist__count">{rows.length} 件</p>
    </>
  );
}
