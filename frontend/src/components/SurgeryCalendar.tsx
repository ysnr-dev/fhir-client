import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { useReturnLinkState } from "../returnTo";
import {
  useLocationOptions,
  useMoveSurgerySchedule,
  useSurgeryWorklist,
  useSurgeryWorklistWeek,
  useUpdateSurgeryTaskStatus,
  type SurgeryWorklistRow,
} from "../api/queries";
import { useSurgeryRoomBlocks } from "../api/masterQueries";
import type { SurgeryRoomBlock } from "../api/masterClient";
import { locationDisplayName, locationTypeCode } from "../fhir/locationHelpers";
import { addDays, formatDateLabel, today, weekDates, weekStart } from "../fhir/scheduleHelpers";
import { summarizeSurgeryOrder, surgeryOrderItems } from "../fhir/surgeryOrderHelpers";
import {
  surgeryTaskActions,
  surgeryTaskStatus,
  surgeryTaskStatusDisplay,
  type SurgeryTaskStatus,
} from "../fhir/surgeryTaskHelpers";
import {
  blockLabel,
  blockRange,
  blocksOfRoomDay,
  conflictingRows,
  isSurgeryMovable,
  minutesToTime,
  rangeLabel,
  roomDayRows,
  rowIdSet,
  snapMinutes,
  DRAG_SNAP_MINUTES,
  timeRange,
  weekdayOf,
  type MinuteRange,
} from "../fhir/surgeryConflictHelpers";
import { useCardDrag, type DragState } from "../hooks/useCardDrag";
import { clampGridRatio, readGridRatio, storeGridRatio } from "../surgeryCalendarLayout";
import { ageWithMonthsLabel, displayKana, displayName, genderLabel } from "../fhir/patientHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { KarteSplitter } from "./KarteSplitter";
import { PatientKana } from "./PatientRowCells";
import { RowMenu } from "./RowMenu";
import { SurgeryPendingPanel } from "./SurgeryPendingPanel";
import { SurgeryMoveConfirmModal, type SurgeryMoveTarget } from "./SurgeryMoveConfirmModal";
import { SurgeryOrderCreateModal, SurgeryOrderEditModal } from "./SurgeryOrderModals";
import type { SurgeryDefaultSchedule } from "./SurgeryOrderPanels";
import { SurgeryPerformModal } from "./SurgeryPerformModal";

// 手術室カレンダー。手術一覧の 3 つ目のタブ。
//
// 手術は予約枠(Slot)を持たないので、描く材料は手術オーダーそのもの
// (occurrenceDateTime + 所要時間)。読むクエリは一覧と同じ useSurgeryWorklist で、
// タブを切り替えても読み直しは起きない(docs/surgery-calendar-design.md)。
//
// 2 モードある。
//   日ビュー … 横 = 手術室、縦 = 時刻。当日の運用把握と、部屋の重なりの視認。
//   週ビュー … 横 = 曜日、縦 = 手術室。日程を組むときの空き探し。
//
// 背景の帯はブロックスケジュール(曜日ごとの科割り当て)。割当は警告にしか
// 使わないので、カレンダーでも「そこに入れられない」表現にはしない。
//
// カード/チップは掴んで動かせる(申込済・受付済のみ)。日ビューは縦で時刻・横で
// 手術室、週ビューは別セルへ落として日付と手術室を変える。日ビューのカードは
// **上下の縁を掴んで伸縮**もでき、上端で入室時刻、下端で所要時間を変えられる。
// ドロップで即書き込みはせず、必ず変更の確認(SurgeryMoveConfirmModal)を挟む。
//
// 空いているところは掴んで縦に引くと、その範囲(日・入室時刻・所要時間・手術室)を
// 初期値にして手術オーダーを登録できる。押しただけなら所要時間は空(術式の既定に
// 任せる)。カードのケバブからは修正。どちらもカルテ右ペインと同じフォーム
// (SurgeryOrderModals)をモーダルで開くだけで、申込の中身は二重に持たない。
//
// 右は縦分割のスプリッタで区切った未確定リスト(SurgeryPendingPanel)。格子に
// 置けない手術(日付未定・部屋未定・時間未定)を並べ、そこから格子へドラッグして
// 日程を決める。分割位置は日/週で共有し、localStorage に残す。

/** 1 分あたりの高さ(px)。8:00-18:00 の 10 時間が 600px に収まる。 */
const PX_PER_MINUTE = 1;
/** 時間軸の既定の範囲。予定がはみ出す日はその ぶんだけ広げる。 */
const DEFAULT_START_MINUTE = 8 * 60;
const DEFAULT_END_MINUTE = 18 * 60;
/**
 * 空き枠を選ぶときの刻み(分)。カードの移動(5 分)より粗くする —— 枠を選ぶ操作では
 * 位置ちょうどより「9:23 を押したら 9:15 から」の方が近く、時刻はフォームで直せる。
 * 始まりは切り捨て、終わりは切り上げて、掴んだ範囲を必ず含む。
 */
const SLOT_SNAP_MINUTES = 15;

export type CalendarMode = "day" | "week";

interface Props {
  /** 見ている日(YYYY-MM-DD)。週ビューではこの日を含む週を出す。 */
  date: string;
  onDateChange: (next: string) => void;
  mode: CalendarMode;
  onModeChange: (next: CalendarMode) => void;
}

export function SurgeryCalendar({ date, onDateChange, mode, onModeChange }: Props) {
  // 格子側が占める幅の比率。日ビュー・週ビューで同じ値を使う(モードを切り替える
  // たびに幅が戻ると、未確定リストを広げて日程を組んでいる最中に邪魔になる)。
  const [gridRatio, setGridRatio] = useState(readGridRatio);
  const splitProps = {
    gridRatio,
    onGridRatioChange: (ratio: number) => setGridRatio(clampGridRatio(ratio)),
    onGridRatioChangeEnd: storeGridRatio,
  };

  return (
    <div className="surgery-calendar">
      <div className="surgery-calendar__toolbar">
        <div className="order-select__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "day"}
            className={mode === "day" ? "order-select__tab is-active" : "order-select__tab"}
            onClick={() => onModeChange("day")}
          >
            日
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "week"}
            className={mode === "week" ? "order-select__tab is-active" : "order-select__tab"}
            onClick={() => onModeChange("week")}
          >
            週
          </button>
        </div>

        {/* 日送り・週送り。入院一覧の DateStepper と同じ形だが、あちらは
            .patient-search-form の中にあって入力の見た目を親から受けている。
            ここはフォームの外なので自前のクラスで与える(枠カレンダーと同じ扱い)。 */}
        <div className="surgery-calendar__date">
          <button
            type="button"
            onClick={() => onDateChange(addDays(date, mode === "day" ? -1 : -7))}
            aria-label={mode === "day" ? "前の日" : "前の週"}
          >
            &lt;
          </button>
          <input
            type="date"
            value={date}
            onChange={(e) => onDateChange(e.target.value || today())}
          />
          <button
            type="button"
            onClick={() => onDateChange(addDays(date, mode === "day" ? 1 : 7))}
            aria-label={mode === "day" ? "次の日" : "次の週"}
          >
            &gt;
          </button>
          <button type="button" onClick={() => onDateChange(today())} disabled={date === today()}>
            今日
          </button>
        </div>
      </div>

      {mode === "day" ? (
        <DayView date={date} {...splitProps} />
      ) : (
        <WeekView
          date={date}
          onPickDate={onDateChange}
          onModeChange={onModeChange}
          {...splitProps}
        />
      )}
    </div>
  );
}

/** 格子と未確定リストの分割。日ビュー・週ビューで同じものを受ける。 */
interface SplitProps {
  gridRatio: number;
  onGridRatioChange: (ratio: number) => void;
  onGridRatioChangeEnd: (ratio: number) => void;
}

/**
 * 格子(左) / スプリッタ / 未確定リスト(右)の 3 列。
 *
 * 比率はカスタムプロパティで渡す。狭い画面では CSS 側で縦積みに切り替えるため、
 * grid-template-columns 自体はインラインで上書きしない(カルテの karte-layout と同じ)。
 */
function CalendarSplit({
  gridRatio,
  onGridRatioChange,
  onGridRatioChangeEnd,
  grid,
  panel,
}: SplitProps & { grid: React.ReactNode; panel: React.ReactNode }) {
  const splitRef = useRef<HTMLDivElement>(null);

  return (
    <div
      className="surgery-calendar__split"
      ref={splitRef}
      style={{ "--surgery-calendar-grid-ratio": gridRatio } as CSSProperties}
    >
      <div className="surgery-calendar__grid-pane">{grid}</div>
      <KarteSplitter
        containerRef={splitRef}
        orientation="vertical"
        ratio={gridRatio}
        label="カレンダーと未確定リストの幅"
        onChange={onGridRatioChange}
        onChangeEnd={onGridRatioChangeEnd}
      />
      {panel}
    </div>
  );
}

// ---- 日ビュー ----

function DayView({ date, ...split }: { date: string } & SplitProps) {
  const worklist = useSurgeryWorklist(date);
  const blocks = useSurgeryRoomBlocks(date || undefined);
  const rooms = useSurgeryRooms();

  // 掴んだカードを落とす先を決めるために、列の本体の位置を測る。
  // 測定は同期で行う(自動化タブでは rAF / ResizeObserver が発火しない)。
  const bodyRefs = useRef(new Map<string, HTMLDivElement>());
  // 未確定リストから掴んだか。掴みしろ(resolveTarget 参照)は時間軸に載っている
  // カードでしか意味を持たないので、右ペインから掴んだときは 0 にする —— 部屋未定の
  // 手術は入室時刻を持つので、そのままだと掴んだ位置と落ちる位置がずれる。
  const fromPanel = useRef(false);
  const [moving, setMoving] = useState<{ row: SurgeryWorklistRow; target: SurgeryMoveTarget } | null>(
    null,
  );
  // 進捗の操作は一覧タブと同じものを使う(押せる操作・遷移先は surgeryTaskActions が持つ)。
  const updateStatus = useUpdateSurgeryTaskStatus();
  // 格子から未確定リストへ戻す(日付未定・部屋未定)。日程を書くだけなので
  // ドラッグでの移動と同じ mutation を使う(進捗は申込済のまま動かさない)。
  const unschedule = useMoveSurgerySchedule();
  const [performing, setPerforming] = useState<SurgeryWorklistRow | null>(null);
  // 空き枠から登録する手術の枠。掴んだ列と範囲から決めて、そのまま登録フォームの
  // 初期値になる。
  const [creating, setCreating] = useState<SurgeryDefaultSchedule | null>(null);
  // 申込内容を直す手術(カルテと同じ編集フォームを開く)。
  const [editing, setEditing] = useState<SurgeryWorklistRow | null>(null);

  /**
   * 決めた日程を外して未確定リストへ戻す。外すのは指定された片方だけで、
   * もう片方と所要時間は据え置く —— 組み直すときの手掛かりを消さない。
   */
  function handleUnschedule(row: SurgeryWorklistRow, clear: "date" | "room") {
    const summary = summarizeSurgeryOrder(row.order);
    unschedule.mutate({
      order: row.order,
      values: {
        scheduledDate: clear === "date" ? "" : summary.scheduledDate,
        scheduledTime: clear === "date" ? "" : summary.scheduledTime,
        durationMinutes: summary.durationMinutes != null ? String(summary.durationMinutes) : "",
        roomId: clear === "room" ? "" : (summary.roomId ?? ""),
        roomName: clear === "room" ? "" : (summary.roomName ?? ""),
      },
    });
  }

  // 中止は部屋を空けるので出さない(一覧・重なり判定と同じ扱い)。
  const rows = useMemo(() => roomDayRows(worklist.data?.rows ?? [], {}), [worklist.data]);

  // 列 = 登録済みの手術室 ∪ その日に使われている部屋。部屋未定は右の未確定リストへ。
  //
  // 並びは「場所」マスタの表示順(useLocationOptions が並べ済み。Map は挿入順を
  // 保つのでここで並べ直さない)。マスタに無い部屋は後ろに付く —— 順番を決めよう
  // にも設定する場所が無く、登録済みの並びを崩さない方が読み手の期待に合う。
  const columns = useMemo(() => {
    const byId = new Map<string, string>();
    for (const room of rooms) byId.set(room.id ?? "", locationDisplayName(room));
    for (const row of rows) {
      const summary = summarizeSurgeryOrder(row.order);
      if (summary.roomId && !byId.has(summary.roomId)) {
        byId.set(summary.roomId, summary.roomName || summary.roomId);
      }
    }
    byId.delete("");
    return Array.from(byId, ([id, name]) => ({ id, name }));
  }, [rooms, rows]);

  // 時間軸。既定は 8:00-18:00 で、はみ出す予定があればその ぶん広げる。
  const axis = useMemo(() => axisRange(rows), [rows]);
  const hours = useMemo(() => hourMarks(axis), [axis]);

  const roomNames = useRef(new Map<string, string>());
  for (const room of columns) roomNames.current.set(room.id, room.name);

  /**
   * ポインタ位置 → 落とす先(手術室と入室時刻)。列の外に出ていれば null。
   *
   * 掴んだ場所とカードの頭のずれ(掴みしろ)を保つ。カードの真ん中を持ったのに
   * 頭がポインタへ飛ぶと、掴んだ瞬間に予定が動いたように見えるため。
   */
  function resolveTarget(state: DragState<SurgeryWorklistRow>): SurgeryMoveTarget | null {
    const summary = summarizeSurgeryOrder(state.item.order);
    const duration =
      summary.durationMinutes != null && summary.durationMinutes > 0 ? summary.durationMinutes : 1;

    for (const [roomId, body] of bodyRefs.current) {
      const rect = body.getBoundingClientRect();
      if (state.x < rect.left || state.x > rect.right) continue;

      // 列の本体はどれも同じ高さ・同じ上端なので、掴みしろはこの列の rect で測れる。
      const grabbed = fromPanel.current ? null : timeRange(summary.scheduledTime, null);
      const pointerAtStart = axis.start + (state.startY - rect.top) / PX_PER_MINUTE;
      const grabOffset = grabbed ? pointerAtStart - grabbed.start : 0;

      const raw = axis.start + (state.y - rect.top) / PX_PER_MINUTE - grabOffset;
      // 5 分刻みに丸め、0:00〜24:00 に収まる範囲へ寄せる(日をまたぐ予定は作らない)。
      const start = Math.min(Math.max(snapMinutes(raw), 0), 24 * 60 - duration);
      return {
        date,
        time: minutesToTime(start),
        roomId,
        roomName: roomNames.current.get(roomId) ?? "",
      };
    }
    return null;
  }

  const dragging = useCardDrag<SurgeryWorklistRow>({
    onDrop: (state) => {
      const target = resolveTarget(state);
      if (!target) return;
      const summary = summarizeSurgeryOrder(state.item.order);
      // 位置が変わっていなければ何もしない(掴んで置き直しただけ)。
      if (target.roomId === summary.roomId && target.time === summary.scheduledTime) return;
      setMoving({ row: state.item, target });
    },
  });

  const preview = dragging.drag ? resolveTarget(dragging.drag) : null;

  return (
    <>
      <ErrorBanner error={worklist.error} />
      <ErrorBanner error={blocks.error} />
      <ErrorBanner error={updateStatus.error} />
      <ErrorBanner error={unschedule.error} />
      {worklist.data?.truncated && (
        <p className="surgery-day-schedule__warn" role="status">
          オーダーが多いため一部しか読めていません。重なりの有無はこの表では確かめきれません。
        </p>
      )}

      <CalendarSplit
        {...split}
        panel={
          <SurgeryPendingPanel
            mode="day"
            rangeRows={rows}
            onCardPointerDown={(row, event) => {
              fromPanel.current = true;
              dragging.start(row, event);
            }}
            onEdit={setEditing}
            draggingOrderId={dragging.drag?.item.order.id}
          />
        }
        grid={
          worklist.isLoading ? (
            <p>読み込み中...</p>
          ) : columns.length === 0 ? (
            <p className="patient-table__empty">
              手術室が登録されていません。「場所」から種別 手術室 の部屋を登録してください。
            </p>
          ) : (
            <div className="surgery-calendar__day-wrap">
              <div className="surgery-calendar__day">
                {/* 時刻の目盛り。 */}
                <div className="surgery-calendar__axis">
                  <div className="surgery-calendar__col-head">時刻</div>
                  <div
                    className="surgery-calendar__axis-body"
                    style={{ height: (axis.end - axis.start) * PX_PER_MINUTE }}
                  >
                    {hours.map((minute) => (
                      <div
                        key={minute}
                        className="surgery-calendar__hour"
                        style={{ top: (minute - axis.start) * PX_PER_MINUTE }}
                      >
                        <span>{minutesToTime(minute)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {columns.map((room) => (
                  <RoomColumn
                    key={room.id}
                    room={room}
                    date={date}
                    rows={rows}
                    blocks={blocks.data ?? []}
                    axis={axis}
                    hours={hours}
                    bodyRef={(el) => {
                      if (el) bodyRefs.current.set(room.id, el);
                      else bodyRefs.current.delete(room.id);
                    }}
                    onCardPointerDown={(row, event) => {
                      fromPanel.current = false;
                      dragging.start(row, event);
                    }}
                    onChangeStatus={(target, status) =>
                      updateStatus.mutate({ order: target.order, task: target.task, status })
                    }
                    onPerform={setPerforming}
                    onEdit={setEditing}
                    onUnschedule={handleUnschedule}
                    onResize={(row, start, end) =>
                      // 伸縮も移動と同じ確認を通す。日・部屋は変えず、
                      // 入室時刻と所要時間だけを変更後として渡す。
                      setMoving({
                        row,
                        target: {
                          date,
                          time: minutesToTime(start),
                          roomId: room.id,
                          roomName: room.name,
                          durationMinutes: end - start,
                        },
                      })
                    }
                    onEmptySlot={(start, end) =>
                      setCreating({
                        scheduledDate: date,
                        scheduledTime: minutesToTime(start),
                        durationMinutes: end != null ? String(end - start) : "",
                        roomId: room.id,
                        roomName: room.name,
                      })
                    }
                    pending={updateStatus.isPending || unschedule.isPending}
                    draggingOrderId={dragging.drag?.item.order.id}
                    preview={preview?.roomId === room.id ? preview : null}
                    previewDuration={
                      dragging.drag
                        ? summarizeSurgeryOrder(dragging.drag.item.order).durationMinutes
                        : null
                    }
                  />
                ))}
              </div>
            </div>
          )
        }
      />

      {moving && (
        <SurgeryMoveConfirmModal
          row={moving.row}
          target={moving.target}
          onClose={() => setMoving(null)}
        />
      )}

      {/* 「実施」はステータスを進めるだけでなく実施記録を書く操作なので、
          一覧タブと同じ実施入力モーダルを開く。 */}
      {performing && (
        <SurgeryPerformModal row={performing} onClose={() => setPerforming(null)} />
      )}

      {/* 空き枠から新規登録。掴んだ範囲をフォームの日程・所要時間・手術室にする。 */}
      {creating && (
        <SurgeryOrderCreateModal defaultSchedule={creating} onClose={() => setCreating(null)} />
      )}

      {editing && <SurgeryOrderEditModal row={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

interface AxisRange {
  start: number;
  end: number;
}

/** 掴んでいる縁。上端は入室時刻、下端は所要時間を変える。 */
type ResizeEdge = "top" | "bottom";

interface ResizeState {
  row: SurgeryWorklistRow;
  edge: ResizeEdge;
  start: number;
  end: number;
}

function RoomColumn({
  room,
  date,
  rows,
  blocks,
  axis,
  hours,
  bodyRef,
  onCardPointerDown,
  onChangeStatus,
  onPerform,
  onEdit,
  onUnschedule,
  onEmptySlot,
  onResize,
  pending,
  draggingOrderId,
  preview,
  previewDuration,
}: {
  room: { id: string; name: string };
  date: string;
  rows: SurgeryWorklistRow[];
  blocks: SurgeryRoomBlock[];
  axis: AxisRange;
  hours: number[];
  /** 落とす先を測るために本体の要素を親へ渡す。 */
  bodyRef: (el: HTMLDivElement | null) => void;
  onCardPointerDown: (row: SurgeryWorklistRow, event: React.PointerEvent) => void;
  onChangeStatus: (row: SurgeryWorklistRow, status: SurgeryTaskStatus) => void;
  onPerform: (row: SurgeryWorklistRow) => void;
  onEdit: (row: SurgeryWorklistRow) => void;
  /** 決めた日程の片方を外して未確定リストへ戻す。 */
  onUnschedule: (row: SurgeryWorklistRow, clear: "date" | "room") => void;
  /**
   * 予定の入っていないところで枠を選んだ。`end` は縦に引いて終わりまで決めたとき
   * だけ入る(押しただけなら null = 所要時間はフォームに任せる)。
   */
  onEmptySlot: (start: number, end: number | null) => void;
  /** カードの縁を掴んで伸縮させた。入室〜退室の分で返す。 */
  onResize: (row: SurgeryWorklistRow, start: number, end: number) => void;
  /** 進捗の書き込み中。二重に押せないようにする。 */
  pending: boolean;
  /** 掴んでいるカード。元の位置は薄く出す。 */
  draggingOrderId?: string;
  /** この列に落ちる予定なら、その位置。 */
  preview: SurgeryMoveTarget | null;
  previewDuration: number | null;
}) {
  const roomRows = roomDayRows(rows, { roomId: room.id });
  const placed = roomRows
    .map((row) => {
      const summary = summarizeSurgeryOrder(row.order);
      return { row, summary, range: timeRange(summary.scheduledTime, summary.durationMinutes) };
    })
    .filter((entry): entry is typeof entry & { range: MinuteRange } => entry.range != null)
    .sort((a, b) => a.range.start - b.range.start);

  // 重なっている手術。列の中で横に分けて、どちらも読めるようにする。
  const conflictIds = rowIdSet(
    placed.flatMap((entry) =>
      conflictingRows(
        roomDayRows(roomRows, { roomId: room.id, excludeOrderId: entry.row.order.id }),
        entry.range,
      ),
    ),
  );
  const lanes = assignLanes(placed.map((entry) => entry.range));

  const dayBlocks = blocksOfRoomDay(blocks, room.id, date);

  const previewRange = preview ? timeRange(preview.time, previewDuration) : null;

  // 空き枠の下見(マウスの下の 1 枠)と、掴んで引いている最中の範囲。どちらも列の
  // 中だけの話なので列で持つ。カードを掴んでいる間は出さない(落とし先の枠と紛れる)。
  const [hoverStart, setHoverStart] = useState<number | null>(null);
  const [selection, setSelection] = useState<{ from: number; to: number } | null>(null);
  // 縁を掴んで伸縮させている最中のカードと、その入室〜退室。
  const [resize, setResize] = useState<ResizeState | null>(null);
  const resizeRef = useRef<ResizeState | null>(null);
  // 掴んでいる範囲は ref にも持つ。押してすぐ離すと pointerdown の setState が
  // 反映される前に pointerup が走るので、state だけだと「押しただけ」を取り落とす。
  const selectionRef = useRef<{ from: number; to: number } | null>(null);

  function updateSelection(next: { from: number; to: number } | null) {
    selectionRef.current = next;
    setSelection(next);
  }

  function updateResize(next: ResizeState | null) {
    resizeRef.current = next;
    setResize(next);
  }

  /**
   * 縁を掴んだ。掴んだ側の端だけを動かし、反対の端は据え置く —— 上端なら入室時刻
   * (退室はそのまま)、下端なら所要時間が変わる。
   *
   * ポインタは**掴んだ縁で捕まえる**。カードの外・列の外まで引いても追い続ける。
   */
  function startResize(row: SurgeryWorklistRow, edge: ResizeEdge, event: React.PointerEvent) {
    const summary = summarizeSurgeryOrder(row.order);
    const range = timeRange(summary.scheduledTime, summary.durationMinutes);
    if (!range) return;
    updateResize({ row, edge, start: range.start, end: range.end });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  /** 引いている先の分 → 伸縮後の入室〜退室。最短は 1 目盛り(DRAG_SNAP_MINUTES)。 */
  function resizedTo(current: ResizeState, minute: number): ResizeState {
    const snapped = snapMinutes(minute);
    return current.edge === "bottom"
      ? { ...current, end: Math.min(Math.max(snapped, current.start + DRAG_SNAP_MINUTES), 24 * 60) }
      : { ...current, start: Math.max(Math.min(snapped, current.end - DRAG_SNAP_MINUTES), 0) };
  }

  // 引いている途中の Escape でやめられるようにする(カードの移動と同じ)。
  useEffect(() => {
    if (!selection) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") updateSelection(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // updateSelection は ref と setState だけなので、張り直す必要はない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  // 伸縮の途中も同じく Escape でやめられる。
  useEffect(() => {
    if (!resize) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") updateResize(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resize]);

  /** ポインタの縦位置 → 時間軸の分。 */
  function minuteAt(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return axis.start + (event.clientY - rect.top) / PX_PER_MINUTE;
  }

  /** 枠の頭。切り捨てて 0:00〜24:00 に収める。 */
  function slotStart(minute: number) {
    const start = Math.floor(minute / SLOT_SNAP_MINUTES) * SLOT_SNAP_MINUTES;
    return Math.min(Math.max(start, 0), 24 * 60 - SLOT_SNAP_MINUTES);
  }

  /** カードとその上のボタン・ケバブの上か。RowMenu は非ポータルなのでこれで見分く。 */
  function onCard(event: React.PointerEvent) {
    return Boolean((event.target as HTMLElement).closest(".surgery-calendar__card"));
  }

  /**
   * 引いている範囲を枠に丸める。始まりは切り捨て、終わりは切り上げて、上へ引いても
   * 下へ引いても掴んだぶんを含む 1 枠以上にする。
   */
  function snapRange(range: { from: number; to: number }) {
    const start = slotStart(Math.min(range.from, range.to));
    const end = Math.max(
      Math.ceil(Math.max(range.from, range.to) / SLOT_SNAP_MINUTES) * SLOT_SNAP_MINUTES,
      start + SLOT_SNAP_MINUTES,
    );
    return { start, end: Math.min(end, 24 * 60) };
  }

  const selected = selection ? snapRange(selection) : null;

  return (
    <div
      className={
        preview ? "surgery-calendar__col surgery-calendar__col--drop-target" : "surgery-calendar__col"
      }
    >
      <div className="surgery-calendar__col-head">{room.name}</div>
      <div
        ref={bodyRef}
        className="surgery-calendar__col-body"
        style={{ height: (axis.end - axis.start) * PX_PER_MINUTE }}
        // 空いているところを掴んで縦に引くと、その範囲で手術を登録する。カード(と
        // カードの上のボタン・ケバブ)の上は除く。割当科の帯は背景でしかないので、
        // その上も空き枠として扱う。
        //
        // click ではなく pointerup で開く。カードを掴んで同じ列に落とすと click は
        // ここまで上がってくるので、click で開くと移動確認と登録が同時に出てしまう。
        onPointerDown={(e) => {
          if (e.button !== 0 || onCard(e)) return;
          const minute = minuteAt(e);
          updateSelection({ from: minute, to: minute });
          // 列から出ても引き続けられるようにする(下へ引くと軸の外へ出やすい)。
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          // 伸縮が先。縁を掴んだ pointerdown はカードの上で止めてあるので、
          // 空き枠の選択とは同時に起きない。
          const sizing = resizeRef.current;
          if (sizing) {
            updateResize(resizedTo(sizing, minuteAt(e)));
            return;
          }
          const current = selectionRef.current;
          if (current) {
            updateSelection({ ...current, to: minuteAt(e) });
            return;
          }
          // カードを掴んでいる間は出さない(落とし先の枠と紛れる)。
          setHoverStart(onCard(e) || draggingOrderId ? null : slotStart(minuteAt(e)));
        }}
        onPointerUp={(e) => {
          const sizing = resizeRef.current;
          if (sizing) {
            updateResize(null);
            const summary = summarizeSurgeryOrder(sizing.row.order);
            const before = timeRange(summary.scheduledTime, summary.durationMinutes);
            // 掴んで戻しただけなら何もしない(移動と同じ)。
            if (before && before.start === sizing.start && before.end === sizing.end) return;
            onResize(sizing.row, sizing.start, sizing.end);
            return;
          }
          const current = selectionRef.current;
          if (!current) return;
          updateSelection(null);
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
          const range = snapRange(current);
          // 引かずに押しただけなら所要時間は決めていない(術式の既定に任せる)。
          const dragged = Math.abs(current.to - current.from) >= SLOT_SNAP_MINUTES / 2;
          onEmptySlot(range.start, dragged ? range.end : null);
        }}
        onPointerCancel={() => {
          updateSelection(null);
          updateResize(null);
        }}
        onPointerLeave={() => setHoverStart(null)}
      >
        {/* 割当科の帯。背景なので操作はしない。 */}
        {dayBlocks.map((block) => {
          const range = blockRange(block);
          if (!range) return null;
          return (
            <div
              key={block.id}
              className="surgery-calendar__block"
              style={{
                top: (range.start - axis.start) * PX_PER_MINUTE,
                height: (range.end - range.start) * PX_PER_MINUTE,
              }}
              title={blockLabel(block)}
            >
              <span>{block.department_name || block.department_code}</span>
            </div>
          );
        })}

        {/* 1 時間ごとの罫線。 */}
        {hours.map((minute) => (
          <div
            key={minute}
            className="surgery-calendar__gridline"
            style={{ top: (minute - axis.start) * PX_PER_MINUTE }}
          />
        ))}

        {/* 空き枠の下見。マウスの下の 1 枠を薄く塗って、どこに入るのかを出す。
            掴んで引いている間と、カードを掴んでいる間は出さない。 */}
        {hoverStart != null && !selected && !preview && (
          <div
            className="surgery-calendar__slot-hover"
            style={{
              top: (hoverStart - axis.start) * PX_PER_MINUTE,
              height: SLOT_SNAP_MINUTES * PX_PER_MINUTE,
            }}
          >
            <span>{minutesToTime(hoverStart)}</span>
          </div>
        )}

        {/* 引いている最中の範囲。入室〜退室と所要時間をその場で出す
            (登録フォームに入るのと同じ値)。 */}
        {selected && (
          <div
            className="surgery-calendar__slot-select"
            style={{
              top: (selected.start - axis.start) * PX_PER_MINUTE,
              height: Math.max((selected.end - selected.start) * PX_PER_MINUTE, 18),
            }}
          >
            <span>
              {minutesToTime(selected.start)}〜{minutesToTime(selected.end)}
            </span>
            <span className="surgery-calendar__slot-duration">
              {selected.end - selected.start} 分
            </span>
          </div>
        )}

        {/* 落とす先。掴んでいる間だけ出す点線の枠。 */}
        {preview && previewRange && (
          <div
            className="surgery-calendar__drop-preview"
            style={{
              top: (previewRange.start - axis.start) * PX_PER_MINUTE,
              height: Math.max((previewRange.end - previewRange.start) * PX_PER_MINUTE, 18),
            }}
          >
            <span>{rangeLabel(preview.time, previewDuration)}</span>
          </div>
        )}

        {placed.map((entry, index) => {
          const lane = lanes[index];
          const conflict = entry.row.order.id != null && conflictIds.has(entry.row.order.id);
          const movable = isSurgeryMovable(entry.row.task);
          const isDragging = entry.row.order.id != null && entry.row.order.id === draggingOrderId;
          // 伸縮中はその場で背を伸ばす。書き込む前の見た目が結果と同じになるので、
          // 確認モーダルを開く前に「これでいいか」をカードのまま決められる。
          const sizing = resize?.row.order.id === entry.row.order.id ? resize : null;
          const range = sizing ?? entry.range;
          return (
            <SurgeryCard
              key={entry.row.order.id}
              row={entry.row}
              summary={entry.summary}
              conflict={conflict}
              movable={movable}
              dragging={isDragging}
              resizing={sizing ? { start: sizing.start, end: sizing.end } : null}
              onPointerDown={onCardPointerDown}
              onResizeStart={startResize}
              onChangeStatus={onChangeStatus}
              onPerform={onPerform}
              onEdit={onEdit}
              onUnschedule={onUnschedule}
              pending={pending}
              style={{
                top: (range.start - axis.start) * PX_PER_MINUTE,
                height: Math.max((range.end - range.start) * PX_PER_MINUTE, 18),
                left: `${(lane.index / lane.total) * 100}%`,
                width: `${100 / lane.total}%`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

// 日ビューのカード 1 枚。
//
// 高さは所要時間で決まるので、短い手術では下の行が隠れる(overflow: hidden)。
// **上から順に、隠れて困る度合いが低いものを置く**: 時刻・ステータス → 患者 →
// 術式 → 執刀医。全文は title(ツールチップ)に入れてあるので、隠れても読めなくは
// ならない。
//
// ケバブメニューはカードの右上に絶対配置する。行に混ぜると短いカードで真っ先に
// 隠れてしまうのと、掴む場所(カード本体)と押す場所を見た目で分けるため。
function SurgeryCard({
  row,
  summary,
  conflict,
  movable,
  dragging,
  resizing,
  onPointerDown,
  onResizeStart,
  onChangeStatus,
  onPerform,
  onEdit,
  onUnschedule,
  pending,
  style,
}: {
  row: SurgeryWorklistRow;
  summary: ReturnType<typeof summarizeSurgeryOrder>;
  conflict: boolean;
  movable: boolean;
  dragging: boolean;
  /** 縁を掴んで伸縮させている最中の入室〜退室。時刻の行をこの値で置き換える。 */
  resizing: { start: number; end: number } | null;
  onPointerDown: (row: SurgeryWorklistRow, event: React.PointerEvent) => void;
  onResizeStart: (row: SurgeryWorklistRow, edge: ResizeEdge, event: React.PointerEvent) => void;
  onChangeStatus: (row: SurgeryWorklistRow, status: SurgeryTaskStatus) => void;
  onPerform: (row: SurgeryWorklistRow) => void;
  onEdit: (row: SurgeryWorklistRow) => void;
  onUnschedule: (row: SurgeryWorklistRow, clear: "date" | "room") => void;
  pending: boolean;
  style: React.CSSProperties;
}) {
  const items = surgeryOrderItems(row.order, row.itemRequests);
  const surgeon = summary.staff.find((line) => line.role === "surgeon");
  const status = surgeryTaskStatus(row.task);
  const patient = row.patient;

  return (
    <div
      className={[
        "surgery-calendar__card",
        conflict ? "surgery-calendar__card--conflict" : "",
        movable ? "surgery-calendar__card--movable" : "",
        dragging ? "surgery-calendar__card--dragging" : "",
        resizing ? "surgery-calendar__card--resizing" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onPointerDown={movable ? (e) => onPointerDown(row, e) : undefined}
      style={style}
      title={[
        rangeLabel(summary.scheduledTime, summary.durationMinutes),
        surgeryTaskStatusDisplay(status),
        patient ? patientLine(patient) : "",
        items.map((item) => item.name).join(" / "),
        surgeon ? `執刀: ${surgeon.practitionerName}` : "",
      ]
        .filter(Boolean)
        .join("\n")}
    >
      {/* 上下の縁。掴んだ側の端だけを動かす。押した指がそのままカードの移動を
          始めないよう、pointerdown はここで止める(ケバブ・進捗ボタンと同じ)。
          title は付けない —— カード全体の title(時刻・患者・術式)を縁に重ねて
          潰してしまううえ、掴めることはカーソルと縁の色で足りる。 */}
      {movable && (
        <>
          <span
            className="surgery-calendar__card-resize surgery-calendar__card-resize--top"
            onPointerDown={(e) => {
              e.stopPropagation();
              onResizeStart(row, "top", e);
            }}
          />
          <span
            className="surgery-calendar__card-resize surgery-calendar__card-resize--bottom"
            onPointerDown={(e) => {
              e.stopPropagation();
              onResizeStart(row, "bottom", e);
            }}
          />
        </>
      )}

      <span className="surgery-calendar__card-time">
        <span className={`surgery-calendar__status is-${status}`}>
          {surgeryTaskStatusDisplay(status)}
        </span>
        {/* 終了予定まで出す。所要時間はカードの高さでも分かるが、
            重なりを詰めるときに読みたいのは数字の方(rangeLabel は一覧・確認モーダルと同じ)。
            伸縮中は**引いている今の値**に差し替え、所要時間も添える(高さだけでは
            何分になったのか読めないため)。 */}
        {resizing ? (
          <>
            {minutesToTime(resizing.start)}〜{minutesToTime(resizing.end)}
            <span className="surgery-calendar__card-duration">
              {resizing.end - resizing.start} 分
            </span>
          </>
        ) : (
          rangeLabel(summary.scheduledTime, summary.durationMinutes)
        )}
        {conflict && <span className="surgery-day-schedule__flag">重なり</span>}

        <SurgeryCardActions
          row={row}
          status={status}
          pending={pending}
          onChangeStatus={onChangeStatus}
          onPerform={onPerform}
          onEdit={onEdit}
          onUnschedule={onUnschedule}
        />
      </span>

      <span className="surgery-calendar__card-patient">
        {patient ? (
          <>
            <span className="surgery-calendar__card-mrn">
              {patient.identifier?.[0]?.value ?? "-"}
            </span>
            <span className="surgery-calendar__card-patient-name">{displayName(patient)}</span>
            <PatientKana patient={patient} />
            <span className="surgery-calendar__card-profile">
              {ageWithMonthsLabel(patient.birthDate ?? "") || "-"} {genderLabel(patient.gender)}
            </span>
          </>
        ) : (
          "-"
        )}
      </span>

      <span className="surgery-calendar__card-name">{items[0]?.name ?? "術式なし"}</span>
      {surgeon && (
        <span className="surgery-calendar__card-staff">執刀: {surgeon.practitionerName}</span>
      )}
    </div>
  );
}

/**
 * カード見出し行の右端に置く操作。一覧タブ(予定日別)と同じ組み方で、
 * 普段押す操作をボタンに、押し間違えると進捗が巻き戻る操作をケバブに畳む。
 *
 * ［実装］この塊の pointerdown は止める。止めないとボタンを押した指がそのまま
 * カードのドラッグを始め、押す前にカードが動いてしまう。
 * カレンダーは overflow の中にあるので RowMenu は escapesClipping で外へ出す。
 */
function SurgeryCardActions({
  row,
  status,
  pending,
  onChangeStatus,
  onPerform,
  onEdit,
  onUnschedule,
}: {
  row: SurgeryWorklistRow;
  status: SurgeryTaskStatus;
  pending: boolean;
  onChangeStatus: (row: SurgeryWorklistRow, status: SurgeryTaskStatus) => void;
  onPerform: (row: SurgeryWorklistRow) => void;
  onEdit: (row: SurgeryWorklistRow) => void;
  onUnschedule: (row: SurgeryWorklistRow, clear: "date" | "room") => void;
}) {
  // カルテの「戻る」でこのカレンダーに戻れるように遷移元を渡す。
  const returnLinkState = useReturnLinkState();
  const patient = row.patient;
  const actions = surgeryTaskActions(status);
  const primary = actions.filter((action) => !action.secondary);
  const secondary = actions.filter((action) => action.secondary);
  // 麻酔チャートを開けるのは入室後(書き始める)と実施済(振り返りに読む)だけ。
  const showChart = status === "in-progress" || status === "completed";

  return (
    <span className="surgery-calendar__card-actions" onPointerDown={(e) => e.stopPropagation()}>
      {primary.map((action) => (
        <button
          key={action.next}
          type="button"
          disabled={pending}
          onClick={() =>
            action.opensPerformInput ? onPerform(row) : onChangeStatus(row, action.next)
          }
        >
          {action.label}
        </button>
      ))}

      <span className="surgery-calendar__card-menu">
        {/* 並びは「別の画面へ行く → この申込を直す → 進捗を戻す」。
            カルテ表示は**どの進捗でも先頭**に置く —— 一番よく押すうえ、進捗によって
            出たり消えたりする項目の下に置くと、カードごとに位置が変わって探す羽目になる。
            進捗を戻す操作(取消・中止)は押し間違えると困るので、いちばん下にまとめる。 */}
        <RowMenu label="この手術の操作" escapesClipping>
          {patient ? (
            <Link
              to={`/patients/${patient.id}/karte`}
              state={returnLinkState}
              className="row-menu__item"
            >
              カルテ表示
            </Link>
          ) : (
            <span className="row-menu__item row-menu__item--disabled">患者を読めていません</span>
          )}
          {showChart && (
            <Link
              className="row-menu__item"
              to={`/surgeries/${row.order.id}/anesthesia-chart`}
              state={returnLinkState}
            >
              麻酔チャート
            </Link>
          )}
          {/* 決めた日程を外して未確定リスト(右ペイン)へ戻す。
              ［導出］**申込済のときだけ**出す。受付済から先は手術部が日程を確定した
              後で、外すと病棟・麻酔科が見ている予定が黙って消える。戻すなら受付を
              取り消してからにする(その導線は同じメニューの「受付取消」)。
              ［実装］外すのは押した片方だけ。もう片方と所要時間は残して、組み直す
              ときの手掛かりにする。 */}
          {status === "requested" && (
            <>
              <button
                type="button"
                className="row-menu__item"
                disabled={pending}
                onClick={() => onUnschedule(row, "date")}
              >
                日付未定に変更
              </button>
              <button
                type="button"
                className="row-menu__item"
                disabled={pending}
                onClick={() => onUnschedule(row, "room")}
              >
                部屋未定に変更
              </button>
            </>
          )}

          {/* 申込内容の修正。カルテへ行かなくても直せるように、カレンダーからも
              同じ編集フォームを開く(可否もカルテと同じで進捗では絞らない)。 */}
          <button type="button" className="row-menu__item" onClick={() => onEdit(row)}>
            編集
          </button>

          {secondary.map((action) => (
            <button
              key={action.next}
              type="button"
              // 中止は手術そのものを取りやめる操作なので目立たせる(一覧と同じ)。
              className={`row-menu__item${
                action.next === "cancelled" ? " row-menu__item--danger" : ""
              }`}
              disabled={pending}
              onClick={() => onChangeStatus(row, action.next)}
            >
              {action.label}
            </button>
          ))}
        </RowMenu>
      </span>
    </span>
  );
}

/** ツールチップ用の患者 1 行。 */
function patientLine(patient: fhir4.Patient): string {
  const kana = displayKana(patient);
  return [
    patient.identifier?.[0]?.value,
    displayName(patient),
    kana ? `(${kana})` : "",
    ageWithMonthsLabel(patient.birthDate ?? ""),
    genderLabel(patient.gender),
  ]
    .filter(Boolean)
    .join(" ");
}

// ---- 週ビュー ----

function WeekView({
  date,
  onPickDate,
  onModeChange,
  ...split
}: {
  date: string;
  onPickDate: (next: string) => void;
  onModeChange: (next: CalendarMode) => void;
} & SplitProps) {
  const dates = weekDates(weekStart(date));
  const results = useSurgeryWorklistWeek(dates);
  const blocks = useSurgeryRoomBlocks(date || undefined);
  const rooms = useSurgeryRooms();

  // セル(部屋 × 日)の位置。落とす先のヒットテストに使う。
  const cellRefs = useRef(new Map<string, HTMLTableCellElement>());
  const [moving, setMoving] = useState<{ row: SurgeryWorklistRow; target: SurgeryMoveTarget } | null>(
    null,
  );
  // 申込内容を直す手術。週ビューは時刻を持てないので、新規登録は日ビューだけに置く。
  const [editing, setEditing] = useState<SurgeryWorklistRow | null>(null);

  const loading = results.some((result) => result.isLoading);
  const error = results.find((result) => result.error)?.error;
  const truncated = results.some((result) => result.data?.truncated);

  // 列 = 登録済みの手術室 ∪ その週に使われている部屋。並びは日ビューと同じく
  // 「場所」マスタの表示順(useLocationOptions が並べ済み)。
  // useQueries の戻りは毎レンダー新しい配列になるので memo 化しない
  // (7 日ぶんの Map 詰めなので、そのまま数えても安い)。
  const columns = (() => {
    const byId = new Map<string, string>();
    for (const room of rooms) byId.set(room.id ?? "", locationDisplayName(room));
    for (const result of results) {
      for (const row of result.data?.rows ?? []) {
        const summary = summarizeSurgeryOrder(row.order);
        if (summary.roomId && !byId.has(summary.roomId)) {
          byId.set(summary.roomId, summary.roomName || summary.roomId);
        }
      }
    }
    byId.delete("");
    return Array.from(byId, ([id, name]) => ({ id, name }));
  })();

  // 未確定リストに渡す 7 日ぶんの行。セルは部屋で絞るので、部屋未定の手術は
  // 週の格子のどこにも出ない —— 右ペインが唯一の置き場になる。
  const weekRows = results.flatMap((result) => result.data?.rows ?? []);

  function openDay(target: string) {
    onPickDate(target);
    onModeChange("day");
  }

  const dragging = useCardDrag<SurgeryWorklistRow>({
    onDrop: (state) => {
      const target = resolveCell(state.item, state.x, state.y);
      if (!target) return;
      const summary = summarizeSurgeryOrder(state.item.order);
      // 同じセルに戻しただけなら何もしない。
      if (target.date === summary.scheduledDate && target.roomId === summary.roomId) return;
      setMoving({ row: state.item, target });
    },
  });

  /** ポインタ位置のセル。週ビューは日と部屋だけを変え、**時刻は動かさない**。 */
  function resolveCell(row: SurgeryWorklistRow, x: number, y: number): SurgeryMoveTarget | null {
    for (const [key, cell] of cellRefs.current) {
      const rect = cell.getBoundingClientRect();
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
      const [cellDate, roomId] = key.split("|");
      const summary = summarizeSurgeryOrder(row.order);
      return {
        date: cellDate,
        time: summary.scheduledTime,
        roomId,
        roomName: columns.find((c) => c.id === roomId)?.name ?? "",
      };
    }
    return null;
  }

  const previewKey = dragging.drag
    ? (() => {
        const target = resolveCell(dragging.drag.item, dragging.drag.x, dragging.drag.y);
        return target ? `${target.date}|${target.roomId}` : null;
      })()
    : null;

  return (
    <>
      <ErrorBanner error={error} />
      <ErrorBanner error={blocks.error} />
      {truncated && (
        <p className="surgery-day-schedule__warn" role="status">
          オーダーが多いため一部しか読めていません。件数は実際より少なく出ています。
        </p>
      )}

      <CalendarSplit
        {...split}
        panel={
          <SurgeryPendingPanel
            mode="week"
            rangeRows={weekRows}
            onCardPointerDown={dragging.start}
            onEdit={setEditing}
            draggingOrderId={dragging.drag?.item.order.id}
          />
        }
        grid={
          loading ? (
            <p>読み込み中...</p>
          ) : columns.length === 0 ? (
            <p className="patient-table__empty">
              手術室が登録されていません。「場所」から種別 手術室 の部屋を登録してください。
            </p>
          ) : (
            <div className="slot-calendar__wrap">
              <table className="slot-calendar surgery-calendar__week">
                <thead>
                  <tr>
                    <th className="slot-calendar__time-col">手術室</th>
                    {dates.map((d) => (
                      <th key={d} className={weekendClass(d)}>
                        <button
                          type="button"
                          className="surgery-calendar__day-link"
                          onClick={() => openDay(d)}
                        >
                          {formatDateLabel(d)}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {columns.map((room) => (
                    <tr key={room.id}>
                      <th className="slot-calendar__time-col">{room.name}</th>
                      {dates.map((d, index) => (
                        <WeekCell
                          key={d}
                          date={d}
                          room={room}
                          rows={results[index]?.data?.rows ?? []}
                          blocks={blocks.data ?? []}
                          onOpen={() => {
                            // 掴んで離した直後の click は飲む(日ビューへ落ちてしまうため)。
                            if (dragging.consumeClick()) return;
                            openDay(d);
                          }}
                          cellRef={(el) => {
                            const key = `${d}|${room.id}`;
                            if (el) cellRefs.current.set(key, el);
                            else cellRefs.current.delete(key);
                          }}
                          onChipPointerDown={dragging.start}
                          draggingOrderId={dragging.drag?.item.order.id}
                          dropTarget={previewKey === `${d}|${room.id}`}
                        />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      />

      {moving && (
        <SurgeryMoveConfirmModal
          row={moving.row}
          target={moving.target}
          onClose={() => setMoving(null)}
        />
      )}

      {editing && <SurgeryOrderEditModal row={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function WeekCell({
  date,
  room,
  rows,
  blocks,
  onOpen,
  cellRef,
  onChipPointerDown,
  draggingOrderId,
  dropTarget,
}: {
  date: string;
  room: { id: string; name: string };
  rows: SurgeryWorklistRow[];
  blocks: SurgeryRoomBlock[];
  onOpen: () => void;
  cellRef: (el: HTMLTableCellElement | null) => void;
  onChipPointerDown: (row: SurgeryWorklistRow, event: React.PointerEvent) => void;
  draggingOrderId?: string;
  /** ここに落ちる予定。 */
  dropTarget: boolean;
}) {
  const roomRows = roomDayRows(rows, { roomId: room.id });
  const entries = roomRows
    .map((row) => {
      const summary = summarizeSurgeryOrder(row.order);
      return { row, summary, range: timeRange(summary.scheduledTime, summary.durationMinutes) };
    })
    .sort((a, b) => (a.range?.start ?? 0) - (b.range?.start ?? 0));

  const hasConflict = entries.some(
    (entry) =>
      entry.range != null &&
      conflictingRows(
        roomDayRows(roomRows, { roomId: room.id, excludeOrderId: entry.row.order.id }),
        entry.range,
      ).length > 0,
  );

  const dayBlocks = blocksOfRoomDay(blocks, room.id, date);

  return (
    <td
      ref={cellRef}
      className={[weekendClass(date) ?? "", dropTarget ? "surgery-calendar__cell--drop-target" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        type="button"
        className={
          hasConflict
            ? "surgery-calendar__cell surgery-calendar__cell--conflict"
            : "surgery-calendar__cell"
        }
        onClick={onOpen}
        title={`${room.name} ${date} の日ビューを開く`}
      >
        {dayBlocks.length > 0 && (
          <span className="surgery-calendar__cell-blocks">
            {dayBlocks.map((block) => (
              <span key={block.id} className="surgery-calendar__cell-block">
                {block.department_name || block.department_code}
              </span>
            ))}
          </span>
        )}
        {entries.length === 0 ? (
          <span className="order-select__muted surgery-calendar__cell-empty">-</span>
        ) : (
          <>
            <span className="surgery-calendar__cell-count">
              {entries.length} 件{hasConflict && " ・重なり"}
            </span>
            {entries.map((entry) => {
              const items = surgeryOrderItems(entry.row.order, entry.row.itemRequests);
              const movable = isSurgeryMovable(entry.row.task);
              const isDragging =
                entry.row.order.id != null && entry.row.order.id === draggingOrderId;
              return (
                <span
                  key={entry.row.order.id}
                  className={[
                    "surgery-calendar__chip",
                    movable ? "surgery-calendar__chip--movable" : "",
                    isDragging ? "surgery-calendar__chip--dragging" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onPointerDown={movable ? (e) => onChipPointerDown(entry.row, e) : undefined}
                >
                  {entry.summary.scheduledTime || "時刻未定"} {items[0]?.name ?? "術式なし"}
                </span>
              );
            })}
          </>
        )}
      </button>
    </td>
  );
}

// ---- 補助 ----

/** 手術室(Location 種別 SU)。 */
function useSurgeryRooms() {
  const locations = useLocationOptions();
  return locations.locations.filter((location) => locationTypeCode(location) === "SU");
}

/** 予定がはみ出す日は時間軸を広げる(夜間の緊急手術で格子の外に出ないように)。 */
function axisRange(rows: SurgeryWorklistRow[]): AxisRange {
  let start = DEFAULT_START_MINUTE;
  let end = DEFAULT_END_MINUTE;
  for (const row of rows) {
    const summary = summarizeSurgeryOrder(row.order);
    const range = timeRange(summary.scheduledTime, summary.durationMinutes);
    if (!range) continue;
    start = Math.min(start, Math.floor(range.start / 60) * 60);
    end = Math.max(end, Math.ceil(range.end / 60) * 60);
  }
  // 日をまたぐ手術(23:00 開始で 4 時間 など)は翌日ぶんを描かず 24:00 で切る。
  // カレンダーは 1 日の格子で、またぎを正しく描くには翌日の列が要るため。
  return { start: Math.max(start, 0), end: Math.min(end, 24 * 60) };
}

function hourMarks({ start, end }: AxisRange): number[] {
  const marks: number[] = [];
  for (let minute = Math.ceil(start / 60) * 60; minute <= end; minute += 60) marks.push(minute);
  return marks;
}

/**
 * 重なっている予定を列の中で横に分ける。重なりの塊(連続して重なるグループ)ごとに
 * 必要なレーン数を数え、その塊の全員を同じ分割数で描く(幅が揃って読みやすい)。
 */
function assignLanes(ranges: MinuteRange[]): { index: number; total: number }[] {
  const result: { index: number; total: number }[] = ranges.map(() => ({ index: 0, total: 1 }));
  let groupEnd = -1;
  let group: number[] = [];

  const flush = () => {
    if (group.length === 0) return;
    // 塊の中で、先に置いた予定と重ならない一番左のレーンへ入れる。
    const laneEnds: number[] = [];
    for (const i of group) {
      let lane = laneEnds.findIndex((end) => end <= ranges[i].start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(0);
      }
      laneEnds[lane] = ranges[i].end;
      result[i].index = lane;
    }
    for (const i of group) result[i].total = laneEnds.length;
    group = [];
  };

  // ranges は開始時刻の昇順。塊の終端より後から始まる予定が来たら塊が切れる。
  ranges.forEach((range, i) => {
    if (group.length > 0 && range.start >= groupEnd) flush();
    group.push(i);
    groupEnd = Math.max(groupEnd, range.end);
  });
  flush();

  return result;
}

function weekendClass(dateISO: string): string | undefined {
  const weekday = weekdayOf(dateISO);
  if (weekday === 6) return "slot-calendar__col--saturday";
  if (weekday === 0) return "slot-calendar__col--sunday";
  return undefined;
}
