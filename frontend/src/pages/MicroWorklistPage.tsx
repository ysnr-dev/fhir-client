import { useEffect, useMemo, useState, type ComponentProps, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useReturnLinkState } from "../returnTo";
import { separateContainerCodes, useMicroOrderItems } from "../api/masterQueries";
import {
  useSelfDepartments,
  useMicroWorklist,
  useUpdateMicroTaskStatus,
  type MicroWorklistRow,
} from "../api/queries";
import { microLabelPdfUrl } from "../api/reportsClient";
import { DateStepper } from "../components/DateStepper";
import { ErrorBanner } from "../components/ErrorBanner";
import { TubeBadge } from "../components/LabOrderViewModal";
import { Modal } from "../components/Modal";
import { MicroOrderDetailPanel } from "../components/MicroOrderDetailPanel";
import { MicroResultDetailPanel } from "../components/MicroResultDetailPanel";
import { MicroResultCreateForm, MicroResultEditForm } from "../components/KarteMicroResultTab";
import { PatientProfileDrawer, useRowDrawer } from "../components/PatientProfileDrawer";
import { RowMenu } from "../components/RowMenu";
import { PatientKana, PatientProfileCells, PatientProfileHeadCells } from "../components/PatientRowCells";
import { RowPictograms } from "../components/PatientListRowParts";
import { labelNumberOf } from "../fhir/labSpecimenHelpers";
import { microContainers } from "../fhir/microContainerHelpers";
import { microOrderContents, specimenLabel, summarizeMicroOrder } from "../fhir/microOrderHelpers";
import { reportStatusDisplay } from "../fhir/microResultHelpers";
import {
  canEnterMicroResult,
  MICRO_TASK_STATUS_OPTIONS,
  microTaskActions,
  microOrderStatus,
  microTaskStatusDisplay,
  type MicroTaskAction,
  type MicroTaskStatus,
} from "../fhir/microTaskHelpers";
import { displayName } from "../fhir/patientHelpers";
import { orderContextSummary, orderRequester, wardOf } from "../fhir/orderHeader";
import { SETTING_OPTIONS } from "../fhir/prescriptionHelpers";
import { useRowPictogramSources, type RowPictogramSources } from "../hooks/useRowPictogramSources";
import { addDays, diffDays, localDay, today } from "../lib/dates";

// 細菌検査一覧(部門ワークリスト)。検査日を決めて、その日に検体が出る検査を並べる。
// 作りは病理検査一覧(PathoWorklistPage)に合わせてある。
//
// 1 行 = オーダー 1 件(1 検体)。検体ラベル(容器ごと)は病棟が採取のときにカルテから刷り、
// 検体到着確認で全容器を読むと受付済になる。ラベルの無い検体(持ち込みなど)は、ここで
// 刷るか「受付」で直接進める。結果は受付済のオーダーから書き、最終報告で報告済になる
// (fhir/microTaskHelpers.ts)。
//
// 培養は結果まで数日かかるので、「未完了」にすると選んだ日までの数日ぶんを読み、
// 依頼済・受付済(中間報告を含む)の検査だけを古い順に並べる。

/** 「未完了」で遡る日数(選んだ日を含む)。 */
const PENDING_DAYS = 14;

interface Filters {
  setting: string;
  wardId: string;
  departmentId: string;
  status: string;
}

const emptyFilters: Filters = {
  setting: "",
  wardId: "",
  departmentId: "",
  status: "",
};

export function MicroWorklistPage() {
  // 検査日は必須。未選択にはできないので当日から始める。
  const [date, setDate] = useState(today);
  const [pendingOnly, setPendingOnly] = useState(false);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  // 内容を開いているオーダー・結果を書いているオーダー。行そのものではなく id で覚えておき、
  // 読み直しのたびに引き直す(受付の後に開いたままのモーダルも追い付く)。
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [enteringId, setEnteringId] = useState<string | null>(null);

  // 検査内容の列が長くなるので、この画面だけ幅を広げる(検体検査一覧と同じ)。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const range = useMemo(
    () => ({ from: pendingOnly ? addDays(date, -(PENDING_DAYS - 1)) : date, to: date }),
    [date, pendingOnly],
  );
  const worklist = useMicroWorklist(range);
  const departments = useSelfDepartments();
  const updateStatus = useUpdateMicroTaskStatus();

  const loaded = useMemo(
    () =>
      (worklist.data?.rows ?? []).filter(
        (row) => !pendingOnly || isPending(rowStatus(row)),
      ),
    [worklist.data, pendingOnly],
  );
  const rows = useMemo(() => loaded.filter((row) => matchesFilters(row, filters)), [loaded, filters]);
  const viewing = worklist.data?.rows.find((row) => row.order.id === viewingId);
  const entering = worklist.data?.rows.find((row) => row.order.id === enteringId);

  const patientIds = useMemo(
    () => rows.flatMap((row) => (row.patient?.id ? [row.patient.id] : [])),
    [rows],
  );
  const pictograms = useRowPictogramSources(patientIds);

  // 行を押すと右に患者プロファイルを出す。行はオーダーごとなのでオーダーで選ぶ
  // (同じ患者が同じ日に複数の検体を出すこともある)。絞り込みで行が消えたら閉じる。
  const drawer = useRowDrawer();
  const selectedRow = rows.find((row) => row.patient?.id && row.order.id === drawer.selectedKey);

  function changeStatus(row: MicroWorklistRow, status: MicroTaskStatus) {
    updateStatus.mutate({ order: row.order, task: row.task, status });
  }

  // 病棟の選択肢は読み込んだぶんのオーダーから拾う(検体検査一覧と同じ考え方)。
  const wardOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const row of worklist.data?.rows ?? []) {
      const ward = wardOf(row.order);
      if (ward.wardId && !byId.has(ward.wardId)) byId.set(ward.wardId, ward.wardName || ward.wardId);
    }
    return Array.from(byId, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [worklist.data]);

  function handleDateChange(value: string) {
    // 日付を空にはさせない(空で検索すると全期間になってしまう)。
    if (value) setDate(value);
  }

  const handlers = (row: MicroWorklistRow) => ({
    onView: () => setViewingId(row.order.id ?? null),
    onEnterResult: () => setEnteringId(row.order.id ?? null),
    onChangeStatus: (status: MicroTaskStatus) => changeStatus(row, status),
  });

  return (
    <div className="page">
      <div className="page__header">
        <h1>細菌検査一覧</h1>
      </div>

      <FilterForm
        date={date}
        pendingOnly={pendingOnly}
        filters={filters}
        wards={wardOptions}
        departments={departments.departments}
        onDateChange={handleDateChange}
        onPendingOnlyChange={setPendingOnly}
        onChange={setFilters}
      />

      <ErrorBanner error={worklist.error} />
      <ErrorBanner error={departments.error} />
      <ErrorBanner error={updateStatus.error} />

      {worklist.data?.truncated && (
        <p className="error-banner__line error-banner__line--error" role="status">
          この期間のオーダーが多いため、一部のみ表示しています。
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
                  <th className="lab-worklist__compact">検査日</th>
                  <th className="lab-worklist__compact">日数</th>
                  <th className="lab-worklist__content">検体・検査項目</th>
                  <th className="lab-worklist__compact">入外</th>
                  <th className="lab-worklist__compact">病棟</th>
                  <th>依頼科 | 依頼医師</th>
                  <th className="lab-worklist__compact">ステータス</th>
                  <th className="lab-worklist__compact">結果</th>
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
                    {...handlers(row)}
                    rowProps={drawer.rowProps(row.patient?.id && row.order.id, urgentRowClass(row))}
                  />
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={13} className="master-search__empty">
                      {loaded.length === 0
                        ? pendingOnly
                          ? "未完了の細菌検査オーダーはありません"
                          : "この検査日の細菌検査オーダーはありません"
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

      {selectedRow?.patient?.id && (
        <PatientProfileDrawer
          patientId={selectedRow.patient.id}
          patient={selectedRow.patient}
          actions={
            <>
              <WorklistRowButtons row={selectedRow} pending={updateStatus.isPending} {...handlers(selectedRow)} />
              <WorklistMenuItems
                row={selectedRow}
                actions={secondaryActionsOf(selectedRow)}
                pending={updateStatus.isPending}
                onChangeStatus={handlers(selectedRow).onChangeStatus}
              />
            </>
          }
          onClose={drawer.close}
        />
      )}
      {viewing && <MicroOrderViewModal row={viewing} onClose={() => setViewingId(null)} />}
      {entering && <MicroResultEntryModal row={entering} onClose={() => setEnteringId(null)} />}
    </div>
  );
}

function rowStatus(row: MicroWorklistRow): MicroTaskStatus {
  return microOrderStatus(row.task, row.reportStatus);
}

/** 部門の手がまだ離れていない(未完了)。 */
function isPending(status: MicroTaskStatus): boolean {
  return status === "requested" || status === "accepted";
}

function matchesFilters(row: MicroWorklistRow, filters: Filters): boolean {
  // 入外区分は表示名ではなくコードで持っているので、選択肢のコードと突き合わせる。
  if (
    filters.setting &&
    SETTING_OPTIONS.find((o) => o.code === filters.setting)?.display !==
      summarizeMicroOrder(row.order).settingDisplay
  ) {
    return false;
  }

  // 病棟はオーダー登録時に焼き付けたもの。病棟を持たないオーダー(外来など)は、
  // 病棟で絞ると消える。
  if (filters.wardId && wardOf(row.order).wardId !== filters.wardId) return false;

  if (filters.departmentId && orderRequester(row.order).departmentId !== filters.departmentId) return false;

  if (filters.status && rowStatus(row) !== filters.status) return false;

  return true;
}

interface FilterFormProps {
  date: string;
  pendingOnly: boolean;
  filters: Filters;
  wards: { id: string; name: string }[];
  departments: fhir4.Organization[];
  onDateChange: (value: string) => void;
  onPendingOnlyChange: (value: boolean) => void;
  onChange: (filters: Filters) => void;
}

function FilterForm({
  date,
  pendingOnly,
  filters,
  wards,
  departments,
  onDateChange,
  onPendingOnlyChange,
  onChange,
}: FilterFormProps) {
  // 絞り込みは選んだ瞬間に効かせるので、Enter での送信は何もしない。
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
  }

  return (
    <form className="patient-search-form" onSubmit={handleSubmit}>
      <label>
        検査日
        <DateStepper value={date} onChange={onDateChange} />
      </label>
      <label className="patient-search-form__check">
        <input
          type="checkbox"
          checked={pendingOnly}
          onChange={(e) => onPendingOnlyChange(e.target.checked)}
        />
        {`未完了(${PENDING_DAYS}日)`}
      </label>
      <label>
        入外区分
        <select value={filters.setting} onChange={(e) => onChange({ ...filters, setting: e.target.value })}>
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
        <select value={filters.status} onChange={(e) => onChange({ ...filters, status: e.target.value })}>
          <option value="">すべて</option>
          {MICRO_TASK_STATUS_OPTIONS.map((option) => (
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

/** 取消・中止。押し間違えると進捗が巻き戻るので、行のケバブに畳む。 */
function secondaryActionsOf(row: MicroWorklistRow) {
  return microTaskActions(rowStatus(row)).filter((action) => action.secondary);
}

/**
 * ラベルの刷り方。依頼済は行のボタン(ラベルの無い検体が持ち込まれたときに刷る)、受付済・報告済は
 * 刷り直しなのでケバブ。中止には出さない。同じ容器には同じ番号が刷られる。
 */
function labelPlacement(row: MicroWorklistRow): "button" | "menu" | null {
  const status = rowStatus(row);
  if (status === "cancelled") return null;
  return status === "requested" ? "button" : "menu";
}

function urgentRowClass(row: MicroWorklistRow): string | undefined {
  return summarizeMicroOrder(row.order).urgent ? "lab-worklist__row--urgent" : undefined;
}

interface RowHandlers {
  onView: () => void;
  onEnterResult: () => void;
  onChangeStatus: (status: MicroTaskStatus) => void;
}

function WorklistRow({
  row,
  pictograms,
  pending,
  rowProps,
  ...handlers
}: RowHandlers & {
  row: MicroWorklistRow;
  /** 患者氏名の後ろに並べる注意のピクトグラムの材料(一覧の患者ぶんをまとめて引いたもの)。 */
  pictograms: RowPictogramSources;
  pending: boolean;
  /** 行を押してドロワーを開くための className と onClick。 */
  rowProps: ComponentProps<"tr">;
}) {
  // カルテの「戻る」でこの一覧に戻れるように遷移元を渡す。
  const returnLinkState = useReturnLinkState();
  const { order, patient } = row;
  const summary = summarizeMicroOrder(order);
  const { specimen, items } = microOrderContents(row.itemRequests);
  const requester = orderRequester(order);
  const status = rowStatus(row);
  const secondaryActions = secondaryActionsOf(row);
  const day = localDay(order.occurrenceDateTime);
  // 結果待ちの検体が何日目か(検査日を 1 日目と数える)。
  const elapsed = day && isPending(status) ? diffDays(day, today()) + 1 : 0;

  return (
    <tr {...rowProps}>
      <td className="sticky-table__fix-1">{patient?.identifier?.[0]?.value ?? "-"}</td>
      <td className="sticky-table__fix-2">
        {patient ? (
          <>
            {/* 検体を受け取る前に病名や経過を見に行けるよう、カルテへ直接飛べるようにする。 */}
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
      <td className="lab-worklist__compact">{day || "-"}</td>
      <td className="lab-worklist__compact">{elapsed > 0 ? `${elapsed} 日目` : "-"}</td>
      <td className="lab-worklist__content">
        {specimenLabel(specimen) || <span className="order-select__muted">検体なし</span>}
        {items.length > 0 && (
          <span className="order-select__muted">{` ${items.map((item) => item.name).join("/")}`}</span>
        )}
      </td>
      <td className="lab-worklist__compact">
        {summary.settingDisplay || "-"}
        {summary.urgent && <span className="dose-conversion__badge">至急</span>}
      </td>
      {/* オーダー登録時の入院病棟。病棟を持たないオーダー(外来など)は "-"。 */}
      <td className="lab-worklist__compact">{wardOf(order).wardName || "-"}</td>
      <td>{orderContextSummary(requester) || "-"}</td>
      <td className="lab-worklist__compact">
        <span className={`lab-worklist__status lab-worklist__status--${status}`}>
          {microTaskStatusDisplay(status)}
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
        <WorklistRowButtons row={row} pending={pending} {...handlers} />
        {/* 取消・中止は押し間違えると進捗が巻き戻るので一段畳む(検体検査一覧と同じ)。 */}
        {(secondaryActions.length > 0 || labelPlacement(row) === "menu") && (
          <RowMenu label="この検査の操作" escapesClipping>
            <WorklistMenuItems
              row={row}
              actions={secondaryActions}
              pending={pending}
              onChangeStatus={handlers.onChangeStatus}
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
  onEnterResult,
  onChangeStatus,
}: RowHandlers & { row: MicroWorklistRow; pending: boolean }) {
  const status = rowStatus(row);
  return (
    <>
      {microTaskActions(status)
        .filter((action) => !action.secondary)
        .map((action) => (
          <button key={action.next} type="button" disabled={pending} onClick={() => onChangeStatus(action.next)}>
            {action.label}
          </button>
        ))}
      {labelPlacement(row) === "button" && (
        <a className="button" href={microLabelPdfUrl(row.order.id ?? "")} target="_blank" rel="noopener">
          ラベル発行
        </a>
      )}
      {/* 結果は検体が届いてから書く。既に書いてあれば同じボタンから直す
          (中間報告を最終報告に切り替えるのもここ)。 */}
      {canEnterMicroResult(status) && (
        <button type="button" disabled={!row.patient?.id} onClick={onEnterResult}>
          {row.reportId ? "結果編集" : "結果登録"}
        </button>
      )}
      {/* 一覧には検体と項目しか出さないので、目的菌・臨床情報はここから開く。
          行によって数が変わる進捗のボタンより右に置いて、どの行でも同じ位置で押せるようにする。 */}
      <button type="button" onClick={onView}>
        表示
      </button>
    </>
  );
}

/** 行のケバブの項目。ドロワーにも同じものをボタンとして並べる。 */
function WorklistMenuItems({
  row,
  actions,
  pending,
  onChangeStatus,
}: {
  row: MicroWorklistRow;
  actions: MicroTaskAction[];
  pending: boolean;
  onChangeStatus: (status: MicroTaskStatus) => void;
}) {
  return (
    <>
      {labelPlacement(row) === "menu" && (
        <a className="row-menu__item" href={microLabelPdfUrl(row.order.id ?? "")} target="_blank" rel="noopener">
          ラベル発行
        </a>
      )}
      {actions.map((action) => (
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

// 「表示」で開くオーダー内容。カルテの詳細モーダルと同じパネルを使い、結果が既にあれば
// その内容も続けて見せる(部門では依頼と結果を並べて読むため)。部門の画面なので、
// 容器ごとの発行・到着とラベルの番号も添える(到着が記録されない容器の問い合わせはこの番号で行う)。
function MicroOrderViewModal({ row, onClose }: { row: MicroWorklistRow; onClose: () => void }) {
  const masterItems = useMicroOrderItems();
  const containers = microContainers(
    row.itemRequests,
    separateContainerCodes(masterItems.data?.items),
    row.containers,
  );
  return (
    <Modal
      title={`細菌検査内容 - ${row.patient ? displayName(row.patient) : ""}`}
      onClose={onClose}
      className="modal--wide"
    >
      <MicroOrderDetailPanel serviceRequest={row.order} itemRequests={row.itemRequests} />
      {masterItems.data && containers.length > 0 && (
        <>
          <h3 className="karte-tabpanel__header">容器</h3>
          <div className="lab-order-view">
            {containers.map((container, index) => {
              const number = container.specimen ? labelNumberOf(container.specimen) : "";
              return (
                <div className="karte-rp" key={container.key}>
                  <div className="karte-rp__head">
                    <span className="karte-rp__number">{`容器${index + 1}`}</span>
                    <TubeBadge specimen={container.specimen} />
                    <span className="karte-order__group-name">{container.label}</span>
                    {number && <span className="lab-order-view__number">{`採取番号 ${number}`}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      {row.reportId && (
        <>
          <h3 className="karte-tabpanel__header">細菌検査結果</h3>
          <MicroResultDetailPanel reportId={row.reportId} />
        </>
      )}
    </Modal>
  );
}

// 「結果登録 / 結果編集」で開く入力。入力欄はカルテの細菌検査タブと同じ MicroResultForm で、
// 違いは紐付け先のオーダーが行から決まっていること。
function MicroResultEntryModal({ row, onClose }: { row: MicroWorklistRow; onClose: () => void }) {
  const patientId = row.patient?.id ?? "";
  return (
    <Modal
      title={`${row.reportId ? "細菌検査結果編集" : "細菌検査結果登録"} - ${
        row.patient ? displayName(row.patient) : ""
      }`}
      onClose={onClose}
      className="modal--wide"
    >
      {row.reportId ? (
        <MicroResultEditForm
          patientId={patientId}
          reportId={row.reportId}
          fixedOrderId={row.order.id}
          onSaved={onClose}
        />
      ) : (
        <MicroResultCreateForm patientId={patientId} fixedOrder={row.order} onSaved={onClose} />
      )}
    </Modal>
  );
}
