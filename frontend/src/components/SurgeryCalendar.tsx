import { useMemo, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { useKarteLinkState } from "../karteReturn";
import {
  useLocationOptions,
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
// 手術室、週ビューは別セルへ落として日付と手術室を変える。ドロップで即書き込みは
// せず、必ず移動の確認(SurgeryMoveConfirmModal)を挟む。
//
// 右は縦分割のスプリッタで区切った未確定リスト(SurgeryPendingPanel)。格子に
// 置けない手術(日付未定・部屋未定・時間未定)を並べ、そこから格子へドラッグして
// 日程を決める。分割位置は日/週で共有し、localStorage に残す。

/** 1 分あたりの高さ(px)。8:00-18:00 の 10 時間が 600px に収まる。 */
const PX_PER_MINUTE = 1;
/** 時間軸の既定の範囲。予定がはみ出す日はその ぶんだけ広げる。 */
const DEFAULT_START_MINUTE = 8 * 60;
const DEFAULT_END_MINUTE = 18 * 60;

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
  const [performing, setPerforming] = useState<SurgeryWorklistRow | null>(null);

  // 中止は部屋を空けるので出さない(一覧・重なり判定と同じ扱い)。
  const rows = useMemo(() => roomDayRows(worklist.data?.rows ?? [], {}), [worklist.data]);

  // 列 = 登録済みの手術室 ∪ その日に使われている部屋。部屋未定は右の未確定リストへ。
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
                    pending={updateStatus.isPending}
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
    </>
  );
}

interface AxisRange {
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
          return (
            <SurgeryCard
              key={entry.row.order.id}
              row={entry.row}
              summary={entry.summary}
              conflict={conflict}
              movable={movable}
              dragging={isDragging}
              onPointerDown={onCardPointerDown}
              onChangeStatus={onChangeStatus}
              onPerform={onPerform}
              pending={pending}
              style={{
                top: (entry.range.start - axis.start) * PX_PER_MINUTE,
                height: Math.max((entry.range.end - entry.range.start) * PX_PER_MINUTE, 18),
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
  onPointerDown,
  onChangeStatus,
  onPerform,
  pending,
  style,
}: {
  row: SurgeryWorklistRow;
  summary: ReturnType<typeof summarizeSurgeryOrder>;
  conflict: boolean;
  movable: boolean;
  dragging: boolean;
  onPointerDown: (row: SurgeryWorklistRow, event: React.PointerEvent) => void;
  onChangeStatus: (row: SurgeryWorklistRow, status: SurgeryTaskStatus) => void;
  onPerform: (row: SurgeryWorklistRow) => void;
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
      <span className="surgery-calendar__card-time">
        <span className={`surgery-calendar__status is-${status}`}>
          {surgeryTaskStatusDisplay(status)}
        </span>
        {/* 終了予定まで出す。所要時間はカードの高さでも分かるが、
            重なりを詰めるときに読みたいのは数字の方(rangeLabel は一覧・確認モーダルと同じ)。 */}
        {rangeLabel(summary.scheduledTime, summary.durationMinutes)}
        {conflict && <span className="surgery-day-schedule__flag">重なり</span>}

        <SurgeryCardActions
          row={row}
          status={status}
          pending={pending}
          onChangeStatus={onChangeStatus}
          onPerform={onPerform}
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
}: {
  row: SurgeryWorklistRow;
  status: SurgeryTaskStatus;
  pending: boolean;
  onChangeStatus: (row: SurgeryWorklistRow, status: SurgeryTaskStatus) => void;
  onPerform: (row: SurgeryWorklistRow) => void;
}) {
  // カルテの「戻る」でこのカレンダーに戻れるように遷移元を渡す。
  const karteLinkState = useKarteLinkState();
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
        <RowMenu label="この手術の操作" escapesClipping>
          {patient ? (
            <Link
              to={`/patients/${patient.id}/karte`}
              state={karteLinkState}
              className="row-menu__item"
            >
              カルテを表示
            </Link>
          ) : (
            <span className="row-menu__item row-menu__item--disabled">患者を読めていません</span>
          )}
          {showChart && (
            <Link className="row-menu__item" to={`/surgeries/${row.order.id}/anesthesia-chart`}>
              麻酔チャート
            </Link>
          )}
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

  const loading = results.some((result) => result.isLoading);
  const error = results.find((result) => result.error)?.error;
  const truncated = results.some((result) => result.data?.truncated);

  // 列 = 登録済みの手術室 ∪ その週に使われている部屋。
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
          <span className="order-select__muted">-</span>
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
