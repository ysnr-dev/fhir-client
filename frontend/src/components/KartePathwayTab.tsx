import { useEffect, useMemo, useRef, useState } from "react";
import {
  useNursingPerformsOn,
  usePathwayApplicationTree,
  usePathwayApplications,
  usePathwayObservations,
} from "../api/queries";
import { useKarteConditions } from "../api/queries";
import { orderKindOf } from "../fhir/karteTimeline";
import { buildEvaluationState } from "../fhir/pathwayEvaluationHelpers";
import {
  buildPathwaySheet,
  orderStatusLabel,
  pathwayStatusLabel,
  todayEventOf,
  type PathwaySheet,
  type SheetAssessmentCell,
  type SheetRow,
  type SheetTaskCell,
  type SheetUnitCell,
} from "../fhir/pathwaySheetHelpers";
import { formatPathwaySheetView, parsePathwaySheetView } from "../karteUrl";
import { today } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { NursingPerformModal } from "./NursingPerformModal";
import { PathwayClosePanel } from "./PathwayClosePanel";
import { PathwayEvaluatePanel } from "./PathwayEvaluatePanel";
import { PathwayOrderModal } from "./PathwayOrderModal";
import { PathwayTaskPanel } from "./PathwayTaskPanel";
import { PathwayUnplannedPanel } from "./PathwayUnplannedPanel";

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
}

/** 左ペインの幅で読める病日の列数。これを超える分は表の中だけ横に送る。 */
const SHEET_COLUMN_WIDTH = 96;

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

export function KartePathwayTab({ patientId, view, onViewChange, onOpenOrder }: KartePathwayTabProps) {
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
  const [modalOrder, setModalOrder] = useState<{ order: fhir4.ServiceRequest; kind: PathwayOrderKind } | null>(null);
  // パスの終了・中止と、予定外アウトカムの追加。どちらも見出しの帯から開く。
  const [closeOpen, setCloseOpen] = useState(false);
  const [unplannedOpen, setUnplannedOpen] = useState(false);
  const [nursingPerform, setNursingPerform] = useState<{ orders: fhir4.ServiceRequest[]; date: string } | null>(null);
  const nursingPerforms = useNursingPerformsOn(nursingPerform?.date ?? "", nursingPerform ? [patientId] : []);
  // 詳細に出す対象プロブレムの名前。カルテのカードから開く詳細と同じものを渡す。
  const { conditions } = useKarteConditions(patientId);
  const problemsById = useMemo(
    () => new Map(conditions.filter((c) => c.id).map((c) => [c.id as string, c])),
    [conditions],
  );

  function updateView(next: { applyId?: string; fullscreen?: boolean }) {
    onViewChange(formatPathwaySheetView({ applyId: selected?.id, fullscreen, ...next }));
  }

  const tree = usePathwayApplicationTree(selected?.id);
  const observations = usePathwayObservations(patientId);
  const application = tree.data?.application ?? null;
  const orders = tree.data?.orders;
  const evaluation =
    tree.data && observations.data
      ? buildEvaluationState(observations.data, tree.data.goals, [...tree.data.carePlans.values()])
      : null;
  const sheet = application ? buildPathwaySheet(application, evaluation) : null;
  const todayDate = today();

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

  const visibleRows = sheet?.rows.filter((row) => row.kind === "unit" || !collapsedUnits.has(row.unitKey)) ?? [];
  const todayEvent = application ? todayEventOf(application.events, todayDate) : null;

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
      !unplannedOpen
    ) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (closeOpen) {
        setCloseOpen(false);
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
  }, [fullscreen, modalUnitId, modalTaskId, modalOrder, nursingPerform, closeOpen, unplannedOpen]);

  return (
    <div
      ref={panelRef}
      className={`karte-tabpanel pathway-sheet${fullscreen ? " pathway-sheet--fullscreen" : ""}`}
      style={{
        ...(fullscreen ? { top: fullscreenTop } : {}),
        ["--pathway-sheet-col-w" as string]: `${SHEET_COLUMN_WIDTH}px`,
      }}
    >
      <div className="karte-tabpanel__header">
        <div className="karte-tabpanel__title">
          <h3>クリニカルパス</h3>
        </div>
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
              onClick={() => updateView({ applyId: a.id })}
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
                ? `病日 ${todayEvent.elapsedDays} / ${application.scheduledDays ?? sheet.days.length}`
                : `病日 ${sheet.days.length} 日分`}
            </span>
            <span className={`regimen-status regimen-status--${application.status === "active" ? "approved" : "retired"}`}>
              {pathwayStatusLabel(application.status)}
              {application.periodEnd && ` ${application.periodEnd}`}
            </span>
            {application.status === "active" && (
              <button
                type="button"
                className="pathway-sheet__close-button"
                onClick={() => setUnplannedOpen(true)}
              >
                予定外を追加
              </button>
            )}
            <button type="button" className="pathway-sheet__close-button" onClick={() => setCloseOpen(true)}>
              {application.status === "active" ? "終了・中止" : "終了の記録"}
            </button>
          </div>

          <div className="lab-timeline__table-wrap pathway-sheet__wrap">
            <table className="lab-timeline__table pathway-sheet__table">
              <thead>
                <tr>
                  <th className="pathway-sheet__label-col" rowSpan={2} />
                  {sheet.days.map((day) => (
                    <th
                      key={day.eventId}
                      className={`pathway-sheet__day${day.date === todayDate ? " pathway-sheet__day--today" : ""}${
                        day.date < todayDate ? " pathway-sheet__day--past" : ""
                      }`}
                    >
                      <span className="pathway-sheet__day-no">{day.elapsedDays}</span>
                      <span className="pathway-sheet__day-title">{day.title}</span>
                    </th>
                  ))}
                  <th className="pathway-sheet__filler" rowSpan={2} />
                </tr>
                <tr>
                  {sheet.days.map((day) => (
                    <th
                      key={day.eventId}
                      className={`pathway-sheet__day pathway-sheet__day-date${
                        day.date === todayDate ? " pathway-sheet__day--today" : ""
                      }${day.date < todayDate ? " pathway-sheet__day--past" : ""}`}
                    >
                      {day.date.slice(5).replace("-", "/")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const collapsed = collapsedUnits.has(row.key);
                  return (
                  <tr key={row.key} className={`pathway-sheet__row pathway-sheet__row--${row.kind}`}>
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
                      <span className="pathway-sheet__label" title={row.label}>
                        {row.label}
                      </span>
                    </th>
                    {sheet.days.map((day) => {
                      const cell = row.cells.get(day.eventId);
                      const classes = `pathway-sheet__cell${day.date === todayDate ? " pathway-sheet__day--today" : ""}${
                        day.date < todayDate ? " pathway-sheet__day--past" : ""
                      }`;
                      if (!cell) return <td key={day.eventId} className={classes} />;
                      // アウトカムのセルは、その病日 × OAT ユニットの評価入力を開く。
                      const unitId = sheetUnitIdOf(row, cell, sheet, day.eventId);
                      const openUnit = () => {
                        if (!application || !unitId) return;
                        setModalUnitId(unitId);
                      };
                      // タスクのセルは、結んだオーダーの画面(看護指示は実施入力)を開く。
                      // オーダーを持たないタスクは、そのタスクの実施 / 未実施の記録を開く。
                      const openTask = (task: SheetTaskCell) => {
                        if (!application) return;
                        const linked = task.orderIds
                          .map((id) => orders?.get(id))
                          .filter((sr): sr is fhir4.ServiceRequest => Boolean(sr));
                        const nursing = linked.filter((sr) => orderKindOf(sr) === "nursing-order");
                        if (nursing.length > 0) {
                          setNursingPerform({ orders: nursing, date: day.date });
                          return;
                        }
                        const kind = linked[0] ? orderKindOf(linked[0]) : null;
                        if (linked[0] && kind && kind !== "nursing-order" && kind !== "chemo-regimen") {
                          setModalOrder({ order: linked[0], kind });
                          return;
                        }
                        setModalTaskId(task.procedureId);
                      };
                      if (row.kind === "unit") {
                        const unit = cell as SheetUnitCell;
                        return (
                          <td key={day.eventId} className={`${classes} pathway-sheet__cell--unit`}>
                            <button type="button" className="pathway-sheet__cell-button" onClick={openUnit}>
                              <span
                                className={`pathway-sheet__outcome${
                                  unit.achievement ? ` pathway-sheet__outcome--${unit.achievement}` : " pathway-sheet__outcome--pending"
                                }`}
                              >
                                {unit.achievementLabel || "未評価"}
                              </span>
                              {unit.unplanned && <span className="pathway-sheet__unplanned">予定外</span>}
                            </button>
                          </td>
                        );
                      }
                      if (row.kind === "assessment") {
                        const assessment = cell as SheetAssessmentCell;
                        return (
                          <td key={day.eventId} className={classes} data-assessment-id={assessment.assessmentId}>
                            <span className="pathway-sheet__cell-static">
                              {assessment.value ? (
                                <span className="pathway-sheet__value">{assessment.value}</span>
                              ) : (
                                <span className="pathway-sheet__planned">○</span>
                              )}
                            </span>
                          </td>
                        );
                      }
                      const task = cell as SheetTaskCell;
                      const order = task.orderIds.map((id) => orders?.get(id)).find(Boolean);
                      return (
                        <td key={day.eventId} className={classes} data-procedure-id={task.procedureId}>
                          <button type="button" className="pathway-sheet__cell-button" onClick={() => openTask(task)}>
                            <span className={`pathway-sheet__task${task.done ? " pathway-sheet__task--done" : ""}`}>
                              {task.done ? "☑" : "☐"}
                            </span>
                            {order && (
                              <span className="pathway-sheet__order">{orderStatusLabel(order.status)}</span>
                            )}
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
          performsByOrderId={nursingPerforms.data}
          onClose={() => setNursingPerform(null)}
        />
      )}
    </div>
  );
}
