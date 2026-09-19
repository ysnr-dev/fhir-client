import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  useNursingPerformsOf,
  useNursingPerformsOn,
  PATHWAY_TREE_KEY_PREFIX,
  usePathwayApplicationTree,
  usePathwayApplications,
  usePathwayObservations,
} from "../api/queries";
import { useKarteConditions } from "../api/queries";
import { orderKindOf } from "../fhir/karteTimeline";
import { buildEvaluationState } from "../fhir/pathwayEvaluationHelpers";
import {
  buildPathwaySheet,
  filterSheetRows,
  nursingPerformDates,
  defaultDayEventId,
  pathwayTaskPerformedOn,
  sheetProgress,
  type SheetIssue,
  pathwayStatusLabel,
  todayEventOf,
  type PathwaySheet,
  type SheetAssessmentCell,
  type SheetRow,
  type SheetTaskCell,
  type SheetUnitCell,
} from "../fhir/pathwaySheetHelpers";
import { pathStepLabel } from "../fhir/pathwayHelpers";
import { orderStartDate } from "../fhir/pathwayScheduleHelpers";
import { formatPathwaySheetView, parsePathwaySheetView, type PathwaySheetView } from "../karteUrl";
import { today } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { NursingPerformModal } from "./NursingPerformModal";
import { usePathway } from "../api/masterQueries";
import { currentPhaseKeyOf, nextPhasesOf } from "../fhir/pathwayApplyHelpers";
import { PathwayCancelPanel } from "./PathwayCancelPanel";
import { PathwayNextPhaseModal } from "./PathwayNextPhaseModal";
import { PathwayClosePanel } from "./PathwayClosePanel";
import { PathwayDayView } from "./PathwayDayView";
import { PathwayEvaluatePanel } from "./PathwayEvaluatePanel";
import { PathwayOrderModal } from "./PathwayOrderModal";
import { PathwaySchedulePanel } from "./PathwaySchedulePanel";
import { PathwayTaskPanel } from "./PathwayTaskPanel";
import { PathwayUnplannedPanel } from "./PathwayUnplannedPanel";
import { RowMenu } from "./RowMenu";

// カルテ画面の「パス」タブ。適用したクリニカルパスを、紙のパスシートと同じ
// 病日 × OAT ユニットのシートで見る。列は病日(今日の列を強調)、行は OAT ユニットを
// 見出しに観察項目とタスクを並べる。適用が複数ある入院ではタブで切り替える(化学療法と同じ)。
//
// 全画面は経過表と同じ作法: 患者情報の下からビューポートの下端まで広げ、view の末尾の
// 「!」で URL に残す。Escape で戻る。
//
// セルを押したときに開くものは行の種類で決まる。アウトカムのセルは評価、タスクのセルは
// そのタスクに結んだオーダー(看護指示なら実施入力、他はオーダーの詳細)、オーダーを
// 持たないタスクは実施 / 未実施の記録。観察項目の実績値は評価の中で入れる。
//
// ［決定］どれもモーダルで開く(右ペインは使わない)。このタブは全画面を持ち、全画面では
// 右ペインが後ろに隠れるので、右ペインと使い分けると同じ操作で開く場所が変わってしまう。
// オーダーの編集だけは右ペインのフォームしか無いので、詳細モーダルの「編集」から右ペインへ渡す。

/** タスクに結んだオーダーの種別のうち、右ペインの「〜編集」で開けるもの。 */
export type PathwayOrderKind = Exclude<ReturnType<typeof orderKindOf>, null | "nursing-order" | "chemo-regimen">;

interface KartePathwayTabProps {
  patientId: string;
  /** URL の view。「適用の id[!]」。 */
  view: string;
  onViewChange: (view: string | null) => void;
  /**
   * セルを押したとき、その病日 × OAT ユニットの評価入力を右ペインで開く。
   * 全画面のときは右ペインが隠れるので、代わりにこのタブがモーダルで開く。
   */
  /** オーダー詳細の「編集」。そのオーダーの編集フォームを右ペインで開く。 */
  onOpenOrder: (kind: PathwayOrderKind, srId: string) => void;
  /** 次のフェーズの適用(右ペインで開く)。 */
  onApplyPhase: (applyId: string, phaseKey: string) => void;
}

/** 病日の列幅の下限と上限。表の幅に収まるだけ広げ、収まらなければ下限のまま表の中だけ横に送る。 */
const SHEET_COLUMN_MIN = 96;
const SHEET_COLUMN_MAX = 180;
/** 行の見出し列の幅(App.css の .pathway-sheet__label-col と揃える)。 */
const SHEET_LABEL_WIDTH = 220;
const SHEET_LABEL_WIDTH_FULLSCREEN = 320;
/** 病日のセルの左右の余白の合計(App.css の .pathway-sheet__table td の padding)。 */
const SHEET_CELL_PADDING = 16;

const ISSUE_LABELS: Record<SheetIssue, string> = { pending: "未評価", variance: "バリアンス", undone: "未実施" };

/** セルが属する OAT ユニット(CarePlan)の id。観察項目・タスクの行は、同じ組の見出し行(unit)から引く。 */
function sheetUnitIdOf(
  row: SheetRow,
  cell: SheetUnitCell | SheetAssessmentCell | SheetTaskCell,
  sheet: PathwaySheet,
  eventId: string,
): string | null {
  if (row.kind === "unit") return (cell as SheetUnitCell).unitId;
  const unitKey = row.key.split("/")[0];
  const unitRow = sheet.rows.find((r) => r.kind === "unit" && r.key === unitKey);
  return (unitRow?.cells.get(eventId) as SheetUnitCell | undefined)?.unitId ?? null;
}

export function KartePathwayTab({ patientId, view, onViewChange, onOpenOrder, onApplyPhase }: KartePathwayTabProps) {
  const current = parsePathwaySheetView(view);
  const applications = usePathwayApplications(patientId);
  const list = applications.data?.applications ?? [];
  // 既定は最初の適用(開始日の新しい順)。URL に無い id を指していれば最初のものに戻す。
  const selected = list.find((a) => a.id === current.applyId) ?? list[0] ?? null;
  const fullscreen = Boolean(current.fullscreen);
  // 全画面では右ペインが隠れるので、評価入力はモーダルで開く(開いている OAT ユニット)。
  const [modalUnitId, setModalUnitId] = useState<string | null>(null);
  const [modalTaskId, setModalTaskId] = useState<string | null>(null);
  // オーダーを結んだタスクの詳細。看護指示だけは詳細ではなく実施入力を開く(指示簿と同じ画面)。
  const [modalOrder, setModalOrder] = useState<{
    order: fhir4.ServiceRequest;
    kind: PathwayOrderKind;
    date: string;
  } | null>(null);
  // パスの終了・中止と、予定外アウトカムの追加。どちらも見出しの帯から開く。
  const [closeOpen, setCloseOpen] = useState(false);
  const [unplannedOpen, setUnplannedOpen] = useState(false);
  // 日程の変更と、誤って適用したパスの取り消し。見出しの帯のメニューから開く。
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [nextPhaseOpen, setNextPhaseOpen] = useState(false);
  const [phaseCancelOpen, setPhaseCancelOpen] = useState(false);
  const [nursingPerform, setNursingPerform] = useState<{ orders: fhir4.ServiceRequest[]; date: string } | null>(null);
  const nursingPerformsOfDay = useNursingPerformsOn(nursingPerform?.date ?? "", nursingPerform ? [patientId] : []);
  // 詳細に出す対象プロブレムの名前。カルテのカードから開く詳細と同じものを渡す。
  const { conditions } = useKarteConditions(patientId);
  const problemsById = useMemo(
    () => new Map(conditions.filter((c) => c.id).map((c) => [c.id as string, c])),
    [conditions],
  );

  function updateView(next: PathwaySheetView) {
    onViewChange(
      formatPathwaySheetView({ applyId: selected?.id, mode: current.mode, eventId: current.eventId, fullscreen, ...next }),
    );
  }
  // 表示の既定はオーバービュー(日めくりは切り替えるか、病日を指して開いたときだけ)。
  const mode = current.mode ?? "sheet";
  // 見出し帯の集計(未評価・バリアンス・未実施)でオーバービューの行を絞っているとき。
  const [issue, setIssue] = useState<SheetIssue | null>(null);

  const tree = usePathwayApplicationTree(selected?.id);
  const orderProgress = tree.data?.orderProgress;
  // オーダーの詳細(注射・輸血の実施入力を含む)と看護指示の実施入力は、それぞれの種別の一覧だけを読み直し、
  // 適用の木(オーダーの進み具合の Task を含む)は読み直さない。閉じたときにここで読み直させる。
  const queryClient = useQueryClient();
  const orderModalOpen = Boolean(modalOrder || nursingPerform);
  const orderModalWasOpen = useRef(false);
  useEffect(() => {
    if (orderModalWasOpen.current && !orderModalOpen) {
      queryClient.invalidateQueries({ queryKey: PATHWAY_TREE_KEY_PREFIX });
    }
    orderModalWasOpen.current = orderModalOpen;
  }, [orderModalOpen, queryClient]);
  const observations = usePathwayObservations(patientId);
  const application = tree.data?.application ?? null;
  // 次のフェーズの候補は、適用済みの病日の印とパス定義の分岐から逆算する。
  const pathwayMaster = usePathway(application?.pathwayCode || null);
  const nextPhases = application && pathwayMaster.data ? nextPhasesOf(application, pathwayMaster.data) : null;
  const currentPhaseKey = application ? currentPhaseKeyOf(application) : "";
  // 取り消せるのは最後に適用した 2 つ目以降のフェーズ(最初のフェーズは適用の取り消しで戻す)。
  const phaseCancellable =
    application?.status === "active" &&
    currentPhaseKey !== "" &&
    application.events.some((e) => e.phaseKey !== currentPhaseKey);
  const orders = tree.data?.orders;
  const evaluation =
    tree.data && observations.data
      ? buildEvaluationState(observations.data, tree.data.goals, [...tree.data.carePlans.values()])
      : null;
  const sheet = application ? buildPathwaySheet(application, evaluation) : null;
  const todayDate = today();
  // 看護指示を結んだタスクは、その日の実施記録で実施を出す(pathwayTaskPerformedOn)。
  const nursingPerforms = useNursingPerformsOf(patientId);
  const performDates = useMemo(() => nursingPerformDates(nursingPerforms.data), [nursingPerforms.data]);

  // アウトカム(OAT ユニット)ごとの開閉。評価の済んだアウトカムは既定で畳み、
  // 手で開け閉めしたらそのまま残す(適用を切り替えたら既定に戻す)。
  const [collapsedUnits, setCollapsedUnits] = useState<Set<string>>(new Set());
  const defaultsFor = useRef<string | null>(null);
  useEffect(() => {
    // 評価が揃う前に決めると全部開いたままになるので、両方届いてから初期値を入れる。
    if (!sheet || !selected || !evaluation) return;
    if (defaultsFor.current === selected.id) return;
    defaultsFor.current = selected.id;
    setCollapsedUnits(new Set(sheet.rows.filter((row) => row.kind === "unit" && row.evaluated).map((row) => row.key)));
  }, [sheet, selected, evaluation]);

  function toggleUnit(unitKey: string) {
    setCollapsedUnits((current) => {
      const next = new Set(current);
      if (next.has(unitKey)) next.delete(unitKey);
      else next.add(unitKey);
      return next;
    });
  }

  // 雛形から出したオーダーが最初に載る病日の日付(オーダーの開始日と食い違えば「日付違い」を出す)。
  const firstDateByOrder = useMemo(() => {
    const map = new Map<string, string>();
    if (!sheet) return map;
    for (const day of sheet.days) {
      for (const row of sheet.rows) {
        if (row.kind !== "task") continue;
        const cell = row.cells.get(day.eventId) as SheetTaskCell | undefined;
        for (const id of cell?.orderIds ?? []) if (!map.has(id)) map.set(id, day.date);
      }
    }
    return map;
  }, [sheet]);

  function dayClasses(date: string): string {
    return `${date === todayDate ? " pathway-sheet__day--today" : ""}${date < todayDate ? " pathway-sheet__day--past" : ""}`;
  }

  const progress = sheet ? sheetProgress(sheet, todayDate, orders, performDates, orderProgress) : null;
  const visibleRows =
    sheet && progress && issue
      ? filterSheetRows(sheet.rows, issue, progress)
      : (sheet?.rows.filter((row) => row.kind === "unit" || !collapsedUnits.has(row.unitKey)) ?? []);
  const todayEvent = application ? todayEventOf(application.events, todayDate) : null;
  const dayEventId =
    application && current.eventId && application.events.some((e) => e.id === current.eventId)
      ? current.eventId
      : application
        ? defaultDayEventId(application.events, todayDate)
        : "";

  // タスクのセル・日めくりのタスクから、結んだオーダーの画面(看護指示は実施入力)を開く。
  // オーダーを持たないタスクは、そのタスクの実施 / 未実施の記録を開く。
  function openTask(orderIds: string[], procedureId: string, date: string) {
    const linked = orderIds
      .map((id) => orders?.get(id))
      .filter((sr): sr is fhir4.ServiceRequest => Boolean(sr));
    const nursing = linked.filter((sr) => orderKindOf(sr) === "nursing-order");
    if (nursing.length > 0) {
      setNursingPerform({ orders: nursing, date });
      return;
    }
    const kind = linked[0] ? orderKindOf(linked[0]) : null;
    if (linked[0] && kind && kind !== "nursing-order" && kind !== "chemo-regimen") {
      setModalOrder({ order: linked[0], kind, date });
      return;
    }
    setModalTaskId(procedureId);
  }

  // 病日の列幅。表の幅(見出し列を除く)を列の数で割り、下限と上限の間に収める。
  // 自動化のタブでは ResizeObserver が発火しないことがあるので、描画のたびと画面の大きさが変わったときに同期で測る。
  const wrapRef = useRef<HTMLDivElement>(null);
  const [columnWidth, setColumnWidth] = useState(SHEET_COLUMN_MIN);
  const columnCount = sheet?.days.length ?? 0;
  useLayoutEffect(() => {
    function measure() {
      const wrap = wrapRef.current;
      if (!wrap || columnCount === 0) return;
      const label = fullscreen ? SHEET_LABEL_WIDTH_FULLSCREEN : SHEET_LABEL_WIDTH;
      // 右端の詰め物の列にも余白があるので、その分も引く。
      const available = wrap.clientWidth - label - SHEET_CELL_PADDING - 1;
      // 列幅(--pathway-sheet-col-w)はセルの中身の幅で、左右の余白(8px ずつ)はその外に足される。
      const width = Math.max(
        SHEET_COLUMN_MIN,
        Math.min(SHEET_COLUMN_MAX, Math.floor(available / columnCount) - SHEET_CELL_PADDING),
      );
      setColumnWidth((prev) => (prev === width ? prev : width));
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  });

  // オーバービューを開いたとき(適用・表示を切り替えたとき)に、今日の列と、今日まだ評価していない最初のアウトカムへ寄せる。
  const scrolledFor = useRef<string | null>(null);
  useLayoutEffect(() => {
    const key = `${selected?.id ?? ""}:${mode}:${issue ?? ""}`;
    const wrap = wrapRef.current;
    if (mode !== "sheet" || !wrap || !sheet || !evaluation || scrolledFor.current === key) return;
    scrolledFor.current = key;
    const label = fullscreen ? SHEET_LABEL_WIDTH_FULLSCREEN : SHEET_LABEL_WIDTH;
    const todayHeader = wrap.querySelector<HTMLElement>("thead .pathway-sheet__day--today");
    wrap.scrollLeft = todayHeader ? Math.max(0, todayHeader.offsetLeft - label) : 0;
    const head = wrap.querySelector<HTMLElement>("thead");
    const pendingRow = wrap.querySelector<HTMLElement>("tr.pathway-sheet__row--unit[data-pending-today]");
    wrap.scrollTop = pendingRow ? Math.max(0, pendingRow.offsetTop - (head?.offsetHeight ?? 0)) : 0;
  });

  // 全画面はビューポート全体ではなく「患者情報の下」から始める(経過表と同じ)。
  const panelRef = useRef<HTMLDivElement>(null);
  const [fullscreenTop, setFullscreenTop] = useState(0);
  useEffect(() => {
    if (!fullscreen) return;
    function measure() {
      const layout = panelRef.current?.closest(".karte-layout");
      setFullscreenTop(layout ? Math.max(0, layout.getBoundingClientRect().top) : 0);
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [fullscreen]);

  // Escape は重なりの外側から閉じる(モーダル → 全画面)。Modal は自分では Escape を
  // 見ないので、モーダルを開いている間は全画面でなくてもここで拾う。
  useEffect(() => {
    if (
      !fullscreen &&
      !nursingPerform &&
      !modalOrder &&
      !modalUnitId &&
      !modalTaskId &&
      !closeOpen &&
      !unplannedOpen &&
      !scheduleOpen &&
      !cancelOpen &&
      !nextPhaseOpen &&
      !phaseCancelOpen
    ) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (closeOpen) {
        setCloseOpen(false);
        return;
      }
      if (scheduleOpen) {
        setScheduleOpen(false);
        return;
      }
      if (cancelOpen) {
        setCancelOpen(false);
        return;
      }
      if (nextPhaseOpen) {
        setNextPhaseOpen(false);
        return;
      }
      if (phaseCancelOpen) {
        setPhaseCancelOpen(false);
        return;
      }
      if (unplannedOpen) {
        // オーダーのフォームがテンプレート記入などのモーダルを重ねている間は、
        // そちらを閉じる操作なので予定外の入力は閉じない(入力中の値を失わせない)。
        if (document.querySelectorAll(".modal-overlay").length > 1) return;
        setUnplannedOpen(false);
        return;
      }
      // オーダー詳細を開いている間は、その中の実施入力から順に閉じたいので
      // PathwayOrderModal 側に任せる(こちらは何もしない)。
      if (modalOrder) return;
      if (nursingPerform) setNursingPerform(null);
      else if (modalUnitId) setModalUnitId(null);
      else if (modalTaskId) setModalTaskId(null);
      else if (fullscreen) updateView({ fullscreen: false });
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // updateView は毎描画で作り直されるが、押した時点の選択で戻せればよい。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreen, modalUnitId, modalTaskId, modalOrder, nursingPerform, closeOpen, unplannedOpen, scheduleOpen, cancelOpen, nextPhaseOpen, phaseCancelOpen]);

  return (
    <div
      ref={panelRef}
      className={`karte-tabpanel pathway-sheet${fullscreen ? " pathway-sheet--fullscreen" : ""}`}
      style={{
        ...(fullscreen ? { top: fullscreenTop } : {}),
        ["--pathway-sheet-col-w" as string]: `${columnWidth}px`,
      }}
    >
      <div className="karte-tabpanel__header">
        <div className="karte-tabpanel__title">
          <h3>クリニカルパス</h3>
        </div>
        {list.length > 0 && (
          <div className="pathway-sheet__modes" role="group" aria-label="表示">
            {(["day", "sheet"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                className={`pathway-sheet__mode${mode === m ? " pathway-sheet__mode--active" : ""}`}
                onClick={() => {
                  setIssue(null);
                  updateView({ mode: m });
                }}
              >
                {m === "day" ? "日めくり" : "オーバービュー"}
              </button>
            ))}
          </div>
        )}
        {list.length > 0 && (
          <button type="button" onClick={() => updateView({ fullscreen: !fullscreen })}>
            {fullscreen ? "全画面を終了" : "全画面"}
          </button>
        )}
      </div>

      <ErrorBanner error={applications.error ?? tree.error ?? observations.error} />

      {list.length > 1 && (
        <div className="chemo-calendar__regimens" role="tablist" aria-label="適用したパス">
          {list.map((a) => (
            <button
              key={a.id}
              type="button"
              role="tab"
              aria-selected={a.id === selected?.id}
              className={`chemo-calendar__regimen${a.id === selected?.id ? " chemo-calendar__regimen--active" : ""}${
                a.status !== "active" ? " chemo-calendar__regimen--inactive" : ""
              }`}
              onClick={() => {
                setIssue(null);
                updateView({ applyId: a.id, mode: undefined, eventId: undefined });
              }}
            >
              {a.title}
              {a.status !== "active" && (
                <span className="chemo-calendar__regimen-status">{pathwayStatusLabel(a.status)}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {applications.isPending ? (
        <p>読み込み中...</p>
      ) : list.length === 0 ? (
        <p className="order-set__empty">クリニカルパスは適用されていません。</p>
      ) : !application || !sheet ? (
        tree.isPending ? <p>読み込み中...</p> : null
      ) : (
        <>
          <div className="chemo-calendar__summary pathway-sheet__summary">
            <span className="pathway-sheet__name">{application.title}</span>
            <span>入院 {application.periodStart}</span>
            <span>
              {todayEvent
                ? `病日 ${todayEvent.elapsedDays} / ${application.scheduledDays ?? sheet.dayGroups.length}`
                : `病日 ${sheet.dayGroups.length} 日分`}
            </span>
            <span className={`regimen-status regimen-status--${application.status === "active" ? "approved" : "retired"}`}>
              {pathwayStatusLabel(application.status)}
              {application.periodEnd && ` ${application.periodEnd}`}
            </span>
            {/* 件数はオーバービューの行を絞るためのもので、日めくりでは出さない。 */}
            {mode === "sheet" &&
              progress &&
              (["pending", "variance", "undone"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={issue === key}
                  className={`pathway-sheet__issue pathway-sheet__issue--${key}${issue === key ? " pathway-sheet__issue--active" : ""}`}
                  disabled={progress.counts[key] === 0 && issue !== key}
                  title={issue === key ? "絞り込みを解除" : undefined}
                  onClick={() => setIssue(issue === key ? null : key)}
                >
                  {`${ISSUE_LABELS[key]} ${progress.counts[key]}`}
                  {issue === key && (
                    <span className="pathway-sheet__issue-clear" aria-hidden="true">
                      ×
                    </span>
                  )}
                </button>
              ))}
            {/* 操作は帯の行を増やさないよう、右端の小さなケバブにまとめる。 */}
            <span className="pathway-sheet__menu">
              <RowMenu label="パスの操作" escapesClipping>
                {nextPhases && nextPhases.candidates.length > 0 && (
                  <button type="button" className="row-menu__item" onClick={() => setNextPhaseOpen(true)}>
                    次のフェーズを適用
                  </button>
                )}
                {application.status === "active" && (
                  <>
                    <button type="button" className="row-menu__item" onClick={() => setUnplannedOpen(true)}>
                      予定外を追加
                    </button>
                    <button type="button" className="row-menu__item" onClick={() => setScheduleOpen(true)}>
                      日程の変更
                    </button>
                  </>
                )}
                <button type="button" className="row-menu__item" onClick={() => setCloseOpen(true)}>
                  {application.status === "active" ? "終了・中止" : "終了の記録"}
                </button>
                {application.status === "active" && (
                  <button
                    type="button"
                    className="row-menu__item row-menu__item--danger"
                    onClick={() => setCancelOpen(true)}
                  >
                    適用の取り消し
                  </button>
                )}
                {phaseCancellable && (
                  <button
                    type="button"
                    className="row-menu__item row-menu__item--danger"
                    onClick={() => setPhaseCancelOpen(true)}
                  >
                    フェーズの取り消し
                  </button>
                )}
              </RowMenu>
            </span>
          </div>

          {mode === "day" && (
            <PathwayDayView
              patientId={patientId}
              application={application}
              carePlans={tree.data?.carePlans ?? new Map()}
              procedures={tree.data?.procedures ?? new Map()}
              orders={orders ?? new Map()}
              orderProgress={orderProgress ?? new Map()}
              evaluation={evaluation}
              performDates={performDates}
              eventId={dayEventId}
              today={todayDate}
              onEventChange={(eventId) => updateView({ mode: "day", eventId })}
              onOpenEvaluation={(unitId) => setModalUnitId(unitId)}
              onOpenTask={(task, date) => openTask(task.orderIds, task.id, date)}
            />
          )}
          {mode === "sheet" && (
          <div className="lab-timeline__table-wrap pathway-sheet__wrap" ref={wrapRef}>
            <table className="lab-timeline__table pathway-sheet__table">
              <thead>
                {/* フェーズを分けたパスだけ、フェーズの段を出す(分岐を選んだときの記録は title で読める)。 */}
                {sheet.phased && (
                  <tr>
                    <th className="pathway-sheet__label-col" />
                    {sheet.phaseGroups.map((group) => (
                      <th
                        key={group.phaseKey}
                        colSpan={group.span}
                        className="pathway-sheet__day pathway-sheet__phase"
                        title={group.note || undefined}
                      >
                        {group.name}
                        {group.note && <span className="pathway-sheet__phase-note">{group.note}</span>}
                      </th>
                    ))}
                    <th className="pathway-sheet__filler" />
                  </tr>
                )}
                <tr>
                  <th className="pathway-sheet__label-col" rowSpan={sheet.split ? 3 : 2} />
                  {sheet.dayGroups.map((group) => (
                    <th
                      key={group.days[0].eventId}
                      colSpan={group.days.length}
                      className={`pathway-sheet__day${dayClasses(group.date)}`}
                    >
                      <span className="pathway-sheet__day-no">{group.elapsedDays}</span>
                      <span className="pathway-sheet__day-title">{group.title}</span>
                    </th>
                  ))}
                  <th className="pathway-sheet__filler" rowSpan={sheet.split ? 3 : 2} />
                </tr>
                <tr>
                  {sheet.dayGroups.map((group) => (
                    <th
                      key={group.days[0].eventId}
                      colSpan={group.days.length}
                      className={`pathway-sheet__day pathway-sheet__day-date${dayClasses(group.date)}`}
                    >
                      {group.date.slice(5).replace("-", "/")}
                    </th>
                  ))}
                </tr>
                {/* 同じ病日を術前・術後などに分けたパスだけ、ステップの段を出す。 */}
                {sheet.split && (
                  <tr>
                    {sheet.days.map((day) => {
                      const group = sheet.dayGroups.find((g) => g.days.includes(day));
                      return (
                        <th
                          key={day.eventId}
                          className={`pathway-sheet__day pathway-sheet__day-step${dayClasses(day.date)}`}
                        >
                          {group && group.days.length > 1 ? pathStepLabel(day.pathStep, day.pathStepName) : ""}
                        </th>
                      );
                    })}
                  </tr>
                )}
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const collapsed = collapsedUnits.has(row.key);
                  return (
                  <tr
                    key={row.key}
                    className={`pathway-sheet__row pathway-sheet__row--${row.kind}`}
                    data-pending-today={
                      row.kind === "unit" &&
                      sheet.days.some((day) => {
                        const cell = row.cells.get(day.eventId) as SheetUnitCell | undefined;
                        return day.date === todayDate && cell && (!cell.achievement || cell.achievement === "3");
                      })
                        ? ""
                        : undefined
                    }
                  >
                    <th scope="row" className="pathway-sheet__label-col">
                      {row.kind === "unit" && (
                        <button
                          type="button"
                          className="pathway-sheet__toggle"
                          onClick={() => toggleUnit(row.key)}
                          aria-expanded={!collapsed}
                          disabled={row.childCount === 0}
                          title={collapsed ? "観察項目とタスクを開く" : "観察項目とタスクを畳む"}
                        >
                          {row.childCount === 0 ? "" : collapsed ? "▸" : "▾"}
                        </button>
                      )}
                      {row.kind === "unit" && row.critical && (
                        <span className="pathway-sheet__critical" title="重要アウトカム">
                          ★
                        </span>
                      )}
                      {row.kind === "task" && (
                        <span className="pathway-task__template-label">{row.categoryLabel}</span>
                      )}
                      <span
                        className="pathway-sheet__label"
                        title={row.properValue ? `${row.label}（適正値: ${row.properValue}）` : row.label}
                      >
                        {row.label}
                      </span>
                      {row.properValue && <span className="pathway-sheet__proper">{row.properValue}</span>}
                    </th>
                    {sheet.days.map((day, dayIndex) => {
                      const cell = row.cells.get(day.eventId);
                      // 隣の列(病日・ステップ)にも同じ行のセルがあれば、続いていることを線と矢印で示す。
                      const fromPrev = dayIndex > 0 && row.cells.has(sheet.days[dayIndex - 1].eventId);
                      const toNext = dayIndex < sheet.days.length - 1 && row.cells.has(sheet.days[dayIndex + 1].eventId);
                      const classes = `pathway-sheet__cell${dayClasses(day.date)}`;
                      if (!cell) return <td key={day.eventId} className={classes} />;
                      // アウトカムのセルは、その病日 × OAT ユニットの評価入力を開く。
                      const unitId = sheetUnitIdOf(row, cell, sheet, day.eventId);
                      const openUnit = () => {
                        if (!application || !unitId) return;
                        setModalUnitId(unitId);
                      };
                      const openCellTask = (task: SheetTaskCell) => openTask(task.orderIds, task.procedureId, day.date);
                      if (row.kind === "unit") {
                        const unit = cell as SheetUnitCell;
                        return (
                          <td key={day.eventId} className={`${classes} pathway-sheet__cell--unit`}>
                            <button type="button" className="pathway-sheet__cell-button" onClick={openUnit}>
                              <SeriesLink fromPrev={fromPrev} toNext={toNext}>
                                <span
                                  className={`pathway-sheet__outcome${
                                    unit.achievement ? ` pathway-sheet__outcome--${unit.achievement}` : " pathway-sheet__outcome--pending"
                                  }`}
                                >
                                  {unit.achievementLabel || "未評価"}
                                </span>
                                {unit.unplanned && <span className="pathway-sheet__unplanned">予定外</span>}
                              </SeriesLink>
                            </button>
                          </td>
                        );
                      }
                      if (row.kind === "assessment") {
                        const assessment = cell as SheetAssessmentCell;
                        return (
                          <td
                            key={day.eventId}
                            className={classes}
                            data-assessment-id={assessment.assessmentId}
                            title={assessment.properValue ? `適正値: ${assessment.properValue}` : undefined}
                          >
                            <span className="pathway-sheet__cell-static">
                              <SeriesLink fromPrev={fromPrev} toNext={toNext}>
                                {assessment.value ? (
                                  <span className="pathway-sheet__value">{assessment.value}</span>
                                ) : (
                                  <span className="pathway-sheet__planned">○</span>
                                )}
                              </SeriesLink>
                            </span>
                          </td>
                        );
                      }
                      const task = cell as SheetTaskCell;
                      const order = task.orderIds.map((id) => orders?.get(id)).find(Boolean);
                      const done = pathwayTaskPerformedOn(task, day.date, orders, performDates, orderProgress);
                      const orderState = order?.id ? orderProgress?.get(order.id) : undefined;
                      return (
                        <td key={day.eventId} className={classes} data-procedure-id={task.procedureId}>
                          <button type="button" className="pathway-sheet__cell-button" onClick={() => openCellTask(task)}>
                            <SeriesLink fromPrev={fromPrev} toNext={toNext}>
                              <span className={`pathway-sheet__task${done ? " pathway-sheet__task--done" : ""}`}>
                                {done ? "☑" : "☐"}
                              </span>
                              {orderState && <span className="pathway-sheet__order">{orderState.label}</span>}
                              {order &&
                                order.id &&
                                !orderState?.completed &&
                                !["completed", "revoked", "entered-in-error"].includes(order.status) &&
                                orderStartDate(order) &&
                                orderStartDate(order) !== firstDateByOrder.get(order.id) && (
                                  <span
                                    className="pathway-sheet__order pathway-sheet__order--mismatch"
                                    title={`オーダーの開始日 ${orderStartDate(order)}`}
                                  >
                                    日付違い
                                  </span>
                                )}
                            </SeriesLink>
                          </button>
                        </td>
                      );
                    })}
                    <td className="pathway-sheet__filler" />
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}
        </>
      )}

      {/* 評価入力。シートに重ねて開く(全画面でも通常でも同じ)。 */}
      {modalUnitId && application && (
        <Modal
          title="クリニカルパス(評価)"
          className="modal--wide pathway-evaluate-modal"
          onClose={() => setModalUnitId(null)}
        >
          <PathwayEvaluatePanel
            patientId={patientId}
            applyId={application.id}
            unitId={modalUnitId}
            onSaved={() => setModalUnitId(null)}
          />
        </Modal>
      )}

      {/* オーダーを持たないタスクの実施入力。 */}
      {modalTaskId && application && (
        <Modal
          title="クリニカルパス(タスク)"
          className="modal--wide pathway-evaluate-modal"
          onClose={() => setModalTaskId(null)}
        >
          <PathwayTaskPanel
            patientId={patientId}
            applyId={application.id}
            procedureId={modalTaskId}
            onSaved={() => setModalTaskId(null)}
          />
        </Modal>
      )}

      {/* パスの終了・中止。 */}
      {closeOpen && application && (
        <Modal
          title="クリニカルパス(終了・中止)"
          className="modal--wide pathway-evaluate-modal"
          onClose={() => setCloseOpen(false)}
        >
          <PathwayClosePanel patientId={patientId} applyId={application.id} onSaved={() => setCloseOpen(false)} />
        </Modal>
      )}

      {/* 日程の変更。 */}
      {scheduleOpen && application && (
        <Modal
          title="クリニカルパス(日程の変更)"
          className="modal--wide pathway-evaluate-modal"
          onClose={() => setScheduleOpen(false)}
        >
          <PathwaySchedulePanel patientId={patientId} applyId={application.id} onSaved={() => setScheduleOpen(false)} />
        </Modal>
      )}

      {/* 誤って適用したパスの取り消し。消えた適用は選べないので、URL の view を外す。 */}
      {cancelOpen && application && (
        <Modal
          title="クリニカルパス(適用の取り消し)"
          className="modal--wide pathway-evaluate-modal"
          onClose={() => setCancelOpen(false)}
        >
          <PathwayCancelPanel
            patientId={patientId}
            applyId={application.id}
            onCancelled={() => {
              setCancelOpen(false);
              onViewChange(null);
            }}
          />
        </Modal>
      )}

      {/* フェーズの終わりで次を選ぶ。適用は右ペインなので、全画面は解いてから開く。 */}
      {nextPhaseOpen && application && pathwayMaster.data && nextPhases && (
        <PathwayNextPhaseModal
          pathway={pathwayMaster.data}
          currentName={nextPhases.current?.name ?? ""}
          candidates={nextPhases.candidates}
          onSelectPhase={(phaseKey) => {
            setNextPhaseOpen(false);
            if (fullscreen) updateView({ fullscreen: false });
            onApplyPhase(application.id, phaseKey);
          }}
          onSelectClose={() => {
            setNextPhaseOpen(false);
            setCloseOpen(true);
          }}
          onClose={() => setNextPhaseOpen(false)}
        />
      )}

      {/* 選び間違えた分岐を戻す(最後に適用したフェーズだけ)。 */}
      {phaseCancelOpen && application && (
        <Modal
          title="クリニカルパス(フェーズの取り消し)"
          className="modal--wide pathway-evaluate-modal"
          onClose={() => setPhaseCancelOpen(false)}
        >
          <PathwayCancelPanel
            patientId={patientId}
            applyId={application.id}
            phaseKey={currentPhaseKey}
            onCancelled={() => setPhaseCancelOpen(false)}
          />
        </Modal>
      )}

      {/* 予定外のアウトカムの追加。 */}
      {unplannedOpen && application && (
        <Modal
          title="クリニカルパス(予定外の追加)"
          className="modal--wide pathway-evaluate-modal"
          onClose={() => setUnplannedOpen(false)}
        >
          <PathwayUnplannedPanel
            patientId={patientId}
            applyId={application.id}
            defaultEventId={todayEvent?.id}
            onSaved={() => setUnplannedOpen(false)}
          />
        </Modal>
      )}

      {/* オーダーを結んだタスクの詳細。「編集」は右ペインのフォームへ渡す(全画面なら抜ける)。 */}
      {modalOrder && (
        <PathwayOrderModal
          patientId={patientId}
          order={modalOrder.order}
          kind={modalOrder.kind}
          date={modalOrder.date}
          progress={orderProgress?.get(modalOrder.order.id ?? "")}
          problemsById={problemsById}
          onEdit={() => {
            const { order, kind } = modalOrder;
            setModalOrder(null);
            if (fullscreen) updateView({ fullscreen: false });
            if (order.id) onOpenOrder(kind, order.id);
          }}
          onClose={() => setModalOrder(null)}
        />
      )}

      {/* 看護指示を結んだタスクの実施入力(指示簿の「実施入力」と同じ画面)。過去の病日から
          開いたときは、その日の時刻で記録を始める。 */}
      {nursingPerform && (
        <NursingPerformModal
          orders={nursingPerform.orders}
          defaultAt={
            nursingPerform.date === todayDate ? undefined : `${nursingPerform.date}T${new Date().toTimeString().slice(0, 5)}`
          }
          performsByOrderId={nursingPerformsOfDay.data}
          onClose={() => setNursingPerform(null)}
        />
      )}
    </div>
  );
}

/**
 * 複数の病日に続く行(日をまたぐアウトカム・続く観察項目やタスク)のセルの中身。前の列から続いていれば左に、
 * 次の列へ続いていれば右に線を引き、続きの最後のセルは矢印で終える(紙のパスシートで日をまたいで引く矢印)。
 * 線はセルの余白まで伸ばして隣のセルとつなげる。続いていないセルは中身だけ。
 */
function SeriesLink({ fromPrev, toNext, children }: { fromPrev: boolean; toNext: boolean; children: ReactNode }) {
  if (!fromPrev && !toNext) return <>{children}</>;
  return (
    <span className="pathway-sheet__series">
      <span
        className={
          fromPrev
            ? `pathway-sheet__link pathway-sheet__link--in${toNext ? "" : " pathway-sheet__link--end"}`
            : "pathway-sheet__link-spacer"
        }
        aria-hidden="true"
      />
      <span className="pathway-sheet__series-content">{children}</span>
      <span className={toNext ? "pathway-sheet__link pathway-sheet__link--out" : "pathway-sheet__link-spacer"} aria-hidden="true" />
    </span>
  );
}
