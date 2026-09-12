import { useEffect, useRef, useState } from "react";
import { usePathwayApplicationTree, usePathwayApplications, usePathwayObservations } from "../api/queries";
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
import { PathwayEvaluatePanel } from "./PathwayEvaluatePanel";

// カルテ画面の「パス」タブ。適用したクリニカルパスを、紙のパスシートと同じ
// 病日 × OAT ユニットのシートで見る。列は病日(今日の列を強調)、行は OAT ユニットを
// 見出しに観察項目とタスクを並べる。適用が複数ある入院ではタブで切り替える(化学療法と同じ)。
//
// 全画面は経過表と同じ作法: 患者情報の下からビューポートの下端まで広げ、view の末尾の
// 「!」で URL に残す。Escape で戻る。評価の入力は右ペインの担当(第 2 段階のタスク 7)。

interface KartePathwayTabProps {
  patientId: string;
  /** URL の view。「適用の id[!]」。 */
  view: string;
  onViewChange: (view: string | null) => void;
  /**
   * セルを押したとき、その病日 × OAT ユニットの評価入力を右ペインで開く。
   * 全画面のときは右ペインが隠れるので、代わりにこのタブがモーダルで開く。
   */
  onOpenUnit: (applyId: string, unitId: string) => void;
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

export function KartePathwayTab({ patientId, view, onViewChange, onOpenUnit }: KartePathwayTabProps) {
  const current = parsePathwaySheetView(view);
  const applications = usePathwayApplications(patientId);
  const list = applications.data?.applications ?? [];
  // 既定は最初の適用(開始日の新しい順)。URL に無い id を指していれば最初のものに戻す。
  const selected = list.find((a) => a.id === current.applyId) ?? list[0] ?? null;
  const fullscreen = Boolean(current.fullscreen);
  // 全画面では右ペインが隠れるので、評価入力はモーダルで開く(開いている OAT ユニット)。
  const [modalUnitId, setModalUnitId] = useState<string | null>(null);
  useEffect(() => {
    if (!fullscreen) setModalUnitId(null);
  }, [fullscreen]);

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

  // 全画面は Escape でも抜けられるようにする(モーダルと同じ作法)。評価のモーダルを
  // 開いているときは、そちらを先に閉じる(重なりの外側から閉じる)。
  useEffect(() => {
    if (!fullscreen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (modalUnitId) setModalUnitId(null);
      else updateView({ fullscreen: false });
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // updateView は毎描画で作り直されるが、押した時点の選択で戻せればよい。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreen, modalUnitId]);

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
            </span>
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
                {sheet.rows.map((row) => (
                  <tr key={row.key} className={`pathway-sheet__row pathway-sheet__row--${row.kind}`}>
                    <th scope="row" className="pathway-sheet__label-col">
                      {row.kind === "unit" && row.critical && (
                        <span className="pathway-sheet__critical" title="重要アウトカム">
                          ★
                        </span>
                      )}
                      {row.kind === "task" && (
                        <span className="pathway-task__template-label">{row.categoryLabel}</span>
                      )}
                      <span className="pathway-sheet__label">{row.label}</span>
                    </th>
                    {sheet.days.map((day) => {
                      const cell = row.cells.get(day.eventId);
                      const classes = `pathway-sheet__cell${day.date === todayDate ? " pathway-sheet__day--today" : ""}${
                        day.date < todayDate ? " pathway-sheet__day--past" : ""
                      }`;
                      if (!cell) return <td key={day.eventId} className={classes} />;
                      // どの行のセルを押しても、その病日 × OAT ユニットの評価入力を開く。
                      const unitId = sheetUnitIdOf(row, cell, sheet, day.eventId);
                      const open = () => {
                        if (!application || !unitId) return;
                        if (fullscreen) setModalUnitId(unitId);
                        else onOpenUnit(application.id, unitId);
                      };
                      if (row.kind === "unit") {
                        const unit = cell as SheetUnitCell;
                        return (
                          <td key={day.eventId} className={`${classes} pathway-sheet__cell--unit`}>
                            <button type="button" className="pathway-sheet__cell-button" onClick={open}>
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
                            <button type="button" className="pathway-sheet__cell-button" onClick={open}>
                              {assessment.value ? (
                                <span className="pathway-sheet__value">{assessment.value}</span>
                              ) : (
                                <span className="pathway-sheet__planned">○</span>
                              )}
                            </button>
                          </td>
                        );
                      }
                      const task = cell as SheetTaskCell;
                      const order = task.orderIds.map((id) => orders?.get(id)).find(Boolean);
                      return (
                        <td key={day.eventId} className={classes} data-procedure-id={task.procedureId}>
                          <button type="button" className="pathway-sheet__cell-button" onClick={open}>
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
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* 全画面のときの評価入力。右ペインと同じ中身を、シートに重ねて開く。 */}
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
    </div>
  );
}
