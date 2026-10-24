import { today } from "../lib/dates";
import {
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type ComponentType,
  type FormEvent,
  type ReactElement,
} from "react";
import { Link } from "react-router-dom";
import { useReturnLinkState } from "../returnTo";
import {
  useSelfDepartments,
  useScheduleExamOrder,
  UNSCHEDULED_WORKLIST_DATE,
  type ExamWorklistResult,
  type ExamWorklistRow,
  type makeUpdateTaskStatusHook,
} from "../api/queries";
import type { ExamItem, ExamTypeOption } from "../api/masterClient";
import { DateStepper } from "../components/DateStepper";
import { ErrorBanner } from "../components/ErrorBanner";
import { ExamBookingModal } from "../components/ExamBookingModal";
import { renderExamTypeOptions } from "../components/examItemOptions";
import { ExamReportEntryModal } from "../components/ExamReportEntryModal";
import { PatientProfileDrawer, useRowDrawer } from "../components/PatientProfileDrawer";
import { RowMenu } from "../components/RowMenu";
import { RowPictograms } from "../components/PatientListRowParts";
import { useRowPictogramSources } from "../hooks/useRowPictogramSources";
import {
  PatientKana,
  PatientProfileCells,
  PatientProfileHeadCells,
} from "../components/PatientRowCells";
import { examReportStatusDisplay, type ExamReportConfig } from "../fhir/examReportHelpers";
import { displayName } from "../fhir/patientHelpers";
import { orderContextSummary, orderRequester, wardOf } from "../fhir/orderHeader";
import { SETTING_OPTIONS } from "../fhir/prescriptionHelpers";
import { EXAM_TASK_STATUS_OPTIONS, examTaskActions, type ExamTaskStatus } from "../fhir/examTaskHelpers";

// 部門ワークリスト(生理検査一覧・内視鏡一覧)。実施日を決めて、その日に行う検査を並べる。
// 部門の違い(文言・マスタと進捗の hook・オーダーの読み方・実施入力モーダル)は
// ExamWorklistConfig で渡す。
//
// 1 行 = オーダー 1 件。CT・MRI のように 1 検査に時間を要する項目は、マスタで
// 「単独」にしておけばオーダー登録の時点で 1 件ずつ別オーダーに分かれるので、
// 行がそのまま検査の単位になる(オーダー項目マスタの「オーダー単位」)。
//
// 実施日だけが上流での絞り込みで、残りは読み込んだ 1 日ぶんから画面側で絞る
// (理由は api/queries/rad.ts の「放射線検査一覧」の節)。

/** オーダーに載っている項目のうち、この画面が見る値。 */
interface WorklistItem {
  code: string;
  examTypeCode: string;
}

export interface ExamWorklistConfig {
  /** 部門名。見出し(「生理検査一覧」)と、オーダーが無いときの文言に使う。 */
  name: string;
  /** 明細の列の見出し。 */
  contentHeader: string;
  /** 明細が無い行の文言。 */
  emptyItemsLabel: string;
  reportConfig: ExamReportConfig;
  useWorklist: (date: string) => { data?: ExamWorklistResult; error: unknown; isLoading: boolean };
  useUpdateTaskStatus: ReturnType<typeof makeUpdateTaskStatusHook<ExamTaskStatus>>;
  useExamTypeOptions: () => { data?: { items: ExamTypeOption[] }; error: unknown };
  useItemsByCodes: (codes: string[]) => { data?: { items: ExamItem[] }; error: unknown; isLoading: boolean };
  PerformModal: ComponentType<{ row: ExamWorklistRow; onClose: () => void }>;
  /** オーダーした項目(単独項目・セット・セットの構成項目をすべて含む平坦な一覧)。 */
  orderItems: (order: fhir4.ServiceRequest, itemRequests: fhir4.ServiceRequest[]) => WorklistItem[];
  /** 明細の列に並べる GP(単独項目・セット)の見出し。 */
  orderEntries: (order: fhir4.ServiceRequest, itemRequests: fhir4.ServiceRequest[]) => { key: string; label: string }[];
  /** 実施時刻(HH:mm)。時刻を指定していないオーダーは空。 */
  orderTime: (order: fhir4.ServiceRequest) => string;
  summarizeOrder: (order: fhir4.ServiceRequest) => { settingCode: string; settingDisplay: string; urgent: boolean };
  taskStatus: (task: fhir4.Task | undefined) => ExamTaskStatus;
  taskStatusDisplay: (status: ExamTaskStatus) => string;
}

/** 日付別と日付未定(実施予定日の無いオーダー)のタブ。手術一覧と同じ分け方。 */
type Tab = "dated" | "undated";

interface Filters {
  examTypeCode: string;
  setting: string;
  wardId: string;
  departmentId: string;
  status: string;
}

const emptyFilters: Filters = {
  examTypeCode: "",
  setting: "",
  wardId: "",
  departmentId: "",
  status: "",
};

export function ExamWorklistPage({ config }: { config: ExamWorklistConfig }) {
  // 実施日は必須。未選択にはできないので当日から始める。
  const [date, setDate] = useState(today);
  // 日付未定タブは実施予定日の無いオーダーを並べる。日付を決めるのは依頼側の編集なので、
  // ここでは実施できない。
  const [tab, setTab] = useState<Tab>("dated");
  const undated = tab === "undated";
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  // 実施入力を開いている行。「実施」だけはステータス変更ではなくモーダルを開く。
  const [performing, setPerforming] = useState<ExamWorklistRow | null>(null);
  // 予約を取っている日付未定の行。
  const [booking, setBooking] = useState<ExamWorklistRow | null>(null);
  // 所見レポートを開いているオーダー。保存後に一覧を読み直すので、行ではなく id で覚える。
  const [reporting, setReporting] = useState<{ orderId: string; patientId: string; title: string } | null>(
    null,
  );

  // 列が多く、既定の幅では患者名や依頼科まで折り返すので、この画面だけ幅を広げる
  // (カルテと同じやり方)。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const datedList = config.useWorklist(date);
  // 日付未定はタブを開いていなくても件数を出すので常に読む(件数は小さい)。
  const undatedList = config.useWorklist(UNSCHEDULED_WORKLIST_DATE);
  const worklist = undated ? undatedList : datedList;
  const undatedCount = undatedList.data?.rows.length ?? 0;
  const examTypes = config.useExamTypeOptions();
  const departments = useSelfDepartments();
  const updateStatus = config.useUpdateTaskStatus();
  const scheduleOrder = useScheduleExamOrder();

  const rows = useMemo(
    () => (worklist.data?.rows ?? []).filter((row) => matchesFilters(config, row, filters)),
    [config, worklist.data, filters],
  );
  const total = worklist.data?.rows.length ?? 0;
  const patientIds = useMemo(
    () => rows.flatMap((row) => (row.patient?.id ? [row.patient.id] : [])),
    [rows],
  );
  const pictograms = useRowPictogramSources(patientIds);

  // 行を押すと右に患者プロファイルを出す。行はオーダーごとなのでオーダーで選ぶ
  // (同じ患者が 1 日に複数のオーダーを持つこともある)。絞り込みで行が消えたら閉じる。
  const drawer = useRowDrawer(tab);
  const selectedRow = rows.find((row) => row.order.id && row.order.id === drawer.selectedKey);

  // 病棟の選択肢は読み込んだ 1 日ぶんのオーダーから拾う。病棟名はオーダー登録時に
  // 焼き付けてあるので病棟マスタを引く必要がなく、その日に無い病棟を並べても仕方が
  // ないのはモダリティの選択肢と同じ考え方。
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

  // 「実施」で実施入力を開くかどうかは項目マスタが決めるので、この日の
  // オーダーに載っている項目をまとめて引いておく。
  const itemCodes = useMemo(
    () =>
      (worklist.data?.rows ?? []).flatMap((row) =>
        config.orderItems(row.order, row.itemRequests).map((item) => item.code),
      ),
    [config, worklist.data],
  );
  const items = config.useItemsByCodes(itemCodes);
  const masterByCode = useMemo(() => {
    const map = new Map<string, ExamItem>();
    for (const item of items.data?.items ?? []) map.set(item.item_code, item);
    return map;
  }, [items.data]);

  // 予約を取っている行の項目のうち、枠表を持つ最初の項目。
  const bookingMaster = booking
    ? config
        .orderItems(booking.order, booking.itemRequests)
        .map((item) => masterByCode.get(item.code))
        .find((master) => master?.appointment_schedule_id)
    : undefined;

  // 実施入力をする項目が 1 つでもあれば実施入力を開く。
  //
  // セットは検査そのものではなく依頼の束ね方なので、判定は構成項目だけで行う
  // (JJ1017 の要素を持たないのと同じ理由)。マスタに無いコード(項目を消した後の
  // オーダーなど)は入力の機会を落とさないよう「あり」に倒す。
  function needsPerformInput(row: ExamWorklistRow): boolean {
    const codes = config
      .orderItems(row.order, row.itemRequests)
      .map((item) => item.code)
      .filter((code) => masterByCode.get(code)?.kind !== "set");
    if (codes.length === 0) return true;

    return codes.some((code) => masterByCode.get(code)?.requires_perform_input ?? true);
  }

  // 実施入力をしない検査は、実施記録を作らずに Task を実施済にするだけ。
  function handlePerform(row: ExamWorklistRow) {
    if (needsPerformInput(row)) setPerforming(row);
    else updateStatus.mutate({ order: row.order, task: row.task, status: "completed" });
  }

  // 行の操作。行のボタン・ケバブと、ドロワーに並べるボタン・ケバブの項目で共有する。
  function actionsFor(row: ExamWorklistRow): WorklistRowActions {
    return {
      // マスタが読めるまでは実施入力の有無が決まらないので押させない。
      pending: updateStatus.isPending || items.isLoading,
      onChangeStatus: (status) =>
        updateStatus.mutate({ order: row.order, task: row.task, status }),
      onPerform: () => handlePerform(row),
      onBook: () => setBooking(row),
      onReport: () =>
        setReporting({
          orderId: row.order.id ?? "",
          patientId: row.patient?.id ?? "",
          title: row.patient ? displayName(row.patient) : "",
        }),
    };
  }

  // ドロワーには行のボタン(カルテを除く)を先に、ケバブの項目を後に並べる。
  // どちらも無い行では操作の欄そのものを出さない。
  function drawerActionsFor(row: ExamWorklistRow) {
    const actions = actionsFor(row);
    const buttons = worklistRowButtons(config, row, actions);
    if (buttons.length === 0 && secondaryActionsOf(config, row).length === 0) return undefined;
    return (
      <>
        {buttons}
        <WorklistMenuItems config={config} row={row} {...actions} />
      </>
    );
  }

  function handleDateChange(value: string) {
    // 日付を空にはさせない(空で検索すると全期間になってしまう)。
    if (value) setDate(value);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>{config.name}一覧</h1>
      </div>

      <div className="order-select__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={!undated}
          className={!undated ? "order-select__tab is-active" : "order-select__tab"}
          onClick={() => setTab("dated")}
        >
          実施日別
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={undated}
          className={undated ? "order-select__tab is-active" : "order-select__tab"}
          onClick={() => setTab("undated")}
        >
          日付未定{undatedCount > 0 && ` (${undatedCount})`}
        </button>
      </div>

      <FilterForm
        date={date}
        // 日付未定タブは日付で絞らないので日付欄を出さない。
        undated={undated}
        filters={filters}
        examTypes={examTypes.data?.items ?? []}
        wards={wardOptions}
        departments={departments.departments}
        onDateChange={handleDateChange}
        onChange={setFilters}
      />

      <ErrorBanner error={worklist.error} />
      <ErrorBanner error={examTypes.error ?? departments.error ?? items.error} />
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
          <div className="rad-worklist-wrap sticky-table-wrap">
            <table className="rad-worklist sticky-table">
              <thead>
                <tr>
                  {/* 横に送っても「いつ・誰の検査か」は残す(左 3 列を固定する)。 */}
                  <th className="rad-worklist__time sticky-table__fix-1">実施時刻</th>
                  <th className="sticky-table__fix-2">患者番号</th>
                  <th className="sticky-table__fix-3">患者氏名</th>
                  <PatientProfileHeadCells />
                  <th className="rad-worklist__content">{config.contentHeader}</th>
                  <th className="rad-worklist__compact">区分</th>
                  <th className="rad-worklist__compact">病棟</th>
                  <th>依頼科 | 依頼医師</th>
                  <th className="rad-worklist__compact">ステータス</th>
                  <th className="rad-worklist__compact">所見</th>
                  <th className="rad-worklist__actions sticky-table__fix-actions"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <WorklistRow
                    key={row.order.id}
                    config={config}
                    row={row}
                    pictograms={pictograms}
                    rowProps={drawer.rowProps(
                      row.patient?.id && row.order.id,
                      config.summarizeOrder(row.order).urgent ? "rad-worklist__row--urgent" : undefined,
                    )}
                    {...actionsFor(row)}
                  />
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={12} className="master-search__empty">
                      {total === 0
                        ? undated
                          ? `日付未定の${config.name}オーダーはありません`
                          : `この実施日の${config.name}オーダーはありません`
                        : "絞り込みに該当する検査がありません"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="order-select__muted rad-worklist__count">{rows.length} 件</p>
        </>
      )}

      {selectedRow?.patient?.id && (
        <PatientProfileDrawer
          patientId={selectedRow.patient.id}
          patient={selectedRow.patient}
          actions={drawerActionsFor(selectedRow)}
          onClose={drawer.close}
        />
      )}
      {booking?.patient && (
        <ExamBookingModal
          title={`検査予約: ${displayName(booking.patient)}`}
          // 枠表と所要時間は項目マスタから(オーダー画面で予約するときと同じ)。
          defaultScheduleId={bookingMaster?.appointment_schedule_id ?? undefined}
          requiredMinutes={bookingMaster?.duration_minutes ?? undefined}
          pending={scheduleOrder.isPending}
          error={scheduleOrder.error}
          onBook={(selection) =>
            scheduleOrder.mutate(
              {
                order: booking.order,
                itemRequests: booking.itemRequests,
                patient: booking.patient!,
                selection,
              },
              { onSuccess: () => setBooking(null) },
            )
          }
          onClose={() => {
            scheduleOrder.reset();
            setBooking(null);
          }}
        />
      )}
      {performing && (
        <config.PerformModal row={performing} onClose={() => setPerforming(null)} />
      )}
      {reporting && (
        <ExamReportEntryModal
          config={config.reportConfig}
          orderId={reporting.orderId}
          patientId={reporting.patientId}
          title={reporting.title}
          onClose={() => setReporting(null)}
        />
      )}
    </div>
  );
}

// 明細に載っている種別(モダリティ)。セットは自身に種別を持たないので構成項目から採る。
function rowExamTypeCodes(config: ExamWorklistConfig, row: ExamWorklistRow): string[] {
  return config
    .orderItems(row.order, row.itemRequests)
    .map((item) => item.examTypeCode)
    .filter(Boolean);
}

function matchesFilters(config: ExamWorklistConfig, row: ExamWorklistRow, filters: Filters): boolean {
  if (filters.examTypeCode && !rowExamTypeCodes(config, row).includes(filters.examTypeCode)) return false;

  const summary = config.summarizeOrder(row.order);
  if (filters.setting && summary.settingCode !== filters.setting) return false;

  // 病棟はオーダー登録時に焼き付けたもの。病棟を持たないオーダー(外来など)は、
  // 病棟で絞ると消える。
  if (filters.wardId && wardOf(row.order).wardId !== filters.wardId) return false;

  const requester = orderRequester(row.order);
  if (filters.departmentId && requester.departmentId !== filters.departmentId) return false;

  if (filters.status && config.taskStatus(row.task) !== filters.status) return false;

  return true;
}

interface FilterFormProps {
  date: string;
  /** 日付未定タブ(日付欄を出さない)。 */
  undated: boolean;
  filters: Filters;
  examTypes: ExamTypeOption[];
  wards: { id: string; name: string }[];
  departments: fhir4.Organization[];
  onDateChange: (value: string) => void;
  onChange: (filters: Filters) => void;
}

function FilterForm({
  date,
  undated,
  filters,
  examTypes,
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
      {!undated && (
        <label>
          実施日
          <DateStepper value={date} onChange={onDateChange} />
        </label>
      )}
      <label>
        検査種別
        <select
          value={filters.examTypeCode}
          onChange={(e) => onChange({ ...filters, examTypeCode: e.target.value })}
        >
          <option value="">すべて</option>
          {renderExamTypeOptions(examTypes)}
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
          {EXAM_TASK_STATUS_OPTIONS.map((option) => (
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

interface WorklistRowActions {
  pending: boolean;
  onChangeStatus: (status: ExamTaskStatus) => void;
  /** 実施入力を開く(実施入力の要らない検査はそのまま実施済にする)。 */
  onPerform: () => void;
  /** 所見レポートの入力を開く。 */
  onReport: () => void;
  /** 日付未定のオーダーに予約を取る。 */
  onBook: () => void;
}

/** ケバブに畳む操作(訂正・取りやめ)。 */
function secondaryActionsOf(config: ExamWorklistConfig, row: ExamWorklistRow) {
  return examTaskActions(config.taskStatus(row.task)).filter((action) => action.secondary);
}

function WorklistRow({
  config,
  row,
  rowProps,
  pictograms,
  ...rowActions
}: {
  config: ExamWorklistConfig;
  row: ExamWorklistRow;
  /** 患者氏名の後ろに並べる注意のピクトグラムの材料(一覧の患者ぶんをまとめて引いたもの)。 */
  pictograms: ReturnType<typeof useRowPictogramSources>;
  /** 行を押してドロワーを開くための className と onClick。 */
  rowProps: ComponentProps<"tr">;
} & WorklistRowActions) {
  // カルテの「戻る」でこの一覧に戻れるように遷移元を渡す。
  const returnLinkState = useReturnLinkState();
  const { order, patient, task } = row;
  const summary = config.summarizeOrder(order);
  const entries = config.orderEntries(order, row.itemRequests);
  const status = config.taskStatus(task);
  const requester = orderRequester(order);

  return (
    <tr {...rowProps}>
      <td className="rad-worklist__time sticky-table__fix-1">{config.orderTime(order) || "-"}</td>
      <td className="sticky-table__fix-2">{patient?.identifier?.[0]?.value ?? "-"}</td>
      <td className="sticky-table__fix-3">
        {patient ? (
          <>
            {/* 実施時に前回結果や病名を見に行けるよう、カルテへ直接飛べるようにする。
                カナは列を分けず、氏名の後ろに小さめの括弧書きで添える。 */}
            <Link to={`/patients/${patient.id}/karte`} state={returnLinkState}>{displayName(patient)}</Link>
            <PatientKana patient={patient} />
            <RowPictograms patientId={patient.id ?? ""} {...pictograms} />
          </>
        ) : (
          "-"
        )}
      </td>
      <PatientProfileCells patient={patient} />
      <td className="rad-worklist__content">
        <ul className="rad-worklist__items">
          {entries.map((entry) => (
            <li key={entry.key}>{entry.label}</li>
          ))}
          {entries.length === 0 && <li className="order-select__muted">{config.emptyItemsLabel}</li>}
        </ul>
      </td>
      <td className="rad-worklist__compact">
        {summary.settingDisplay || "-"}
        {summary.urgent && <span className="dose-conversion__badge">至急</span>}
      </td>
      {/* オーダー登録時の入院病棟。病棟を持たないオーダー(外来など)は "-"。 */}
      <td className="rad-worklist__compact">{wardOf(order).wardName || "-"}</td>
      <td>{orderContextSummary(requester) || "-"}</td>
      <td className="rad-worklist__compact">
        <span className={`rad-worklist__status rad-worklist__status--${status}`}>
          {config.taskStatusDisplay(status)}
        </span>
      </td>
      <td className="rad-worklist__compact">
        {row.reportId ? (
          examReportStatusDisplay(row.reportStatus) || "登録済"
        ) : (
          <span className="order-select__muted">未</span>
        )}
      </td>
      <td className="rad-worklist__actions sticky-table__fix-actions">
        {worklistRowButtons(config, row, rowActions)}
        {/* 訂正・取りやめは押し間違えると進捗が巻き戻るので、一段畳んで置く。
            一覧は横スクロールできるよう overflow を持つため、メニューは
            escapesClipping で領域の外に出す(でないと縁で切れる)。 */}
        {secondaryActionsOf(config, row).length > 0 && (
          <RowMenu label="この検査の操作" escapesClipping>
            <WorklistMenuItems config={config} row={row} {...rowActions} />
          </RowMenu>
        )}
      </td>
    </tr>
  );
}

/**
 * 行の操作セルに直接並べるボタン(カルテへのリンクは除く)。ドロワーにも同じものを並べる。
 */
function worklistRowButtons(
  config: ExamWorklistConfig,
  row: ExamWorklistRow,
  { pending, onChangeStatus, onPerform, onReport, onBook }: WorklistRowActions,
): ReactElement[] {
  const status = config.taskStatus(row.task);
  const buttons = examTaskActions(status)
    .filter((action) => !action.secondary)
    // 日付未定のオーダーは実施日が決まっていないので、実施はできない(受付・中止はできる)。
    .filter((action) => !(action.opensPerformInput && !row.order.occurrenceDateTime))
    .map((action) => (
      <button
        key={action.next}
        type="button"
        disabled={pending}
        onClick={() => (action.opensPerformInput ? onPerform() : onChangeStatus(action.next))}
      >
        {action.label}
      </button>
    ));
  // 所見は検査した後に書く。既に書いてあれば同じボタンから直す
  // (確定済みのレポートを直すと訂正報告になる)。
  // 日付未定のオーダーは予約を取ると日付が決まる(オーダーの日付も同じ transaction で書く)。
  if (!row.order.occurrenceDateTime && status !== "completed" && status !== "cancelled") {
    buttons.push(
      <button key="book" type="button" disabled={pending || !row.patient} onClick={onBook}>
        予約
      </button>,
    );
  }
  if (status === "completed") {
    buttons.push(
      <button key="report" type="button" disabled={!row.patient?.id} onClick={onReport}>
        {row.reportId ? "所見編集" : "所見"}
      </button>,
    );
  }
  return buttons;
}

/** 検査の行のケバブの項目。ドロワーにも同じものをボタンとして並べる。 */
function WorklistMenuItems({
  config,
  row,
  pending,
  onChangeStatus,
}: { config: ExamWorklistConfig; row: ExamWorklistRow } & WorklistRowActions) {
  // 所見レポートがある検査の実施を取り消すと、実施していない検査に所見が残る。
  const lockedByReport = config.taskStatus(row.task) === "completed" && Boolean(row.reportId);

  return (
    <>
      {secondaryActionsOf(config, row).map((action) => (
        <button
          key={action.next}
          type="button"
          // 中止は検査そのものを取りやめる操作なので目立たせる。取消は
          // 1 つ前に戻すだけの訂正なので通常の項目にする。
          className={`row-menu__item${action.next === "cancelled" ? " row-menu__item--danger" : ""}`}
          disabled={pending || lockedByReport}
          title={lockedByReport ? "所見レポートがあるため取り消せません" : undefined}
          onClick={() => onChangeStatus(action.next)}
        >
          {action.label}
        </button>
      ))}
    </>
  );
}
