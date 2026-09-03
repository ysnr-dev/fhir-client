import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  usePatientEncounterEvents,
  usePatientExamOrders,
  usePatientInjectionOrders,
  usePatientSurgeryPerforms,
  useVitalFlowsheet,
  useVitalThresholds,
} from "../api/queries";
import { buildInjectionRows } from "../fhir/flowsheetInjectionHelpers";
import {
  buildExamRows,
  buildFlowsheetEvents,
  flowsheetEventAtLabel,
  flowsheetEventRangeLabel,
  groupFlowsheetEventsByDay,
  hospitalDayLabel,
  hospitalDayOf,
  localDateOf,
  markKey,
  markModalEvents,
  postOpDayLabel,
  postOpDayOf,
  type FlowsheetEvent,
  type FlowsheetEventGroup,
  type FlowsheetMark,
  type FlowsheetMarkRow,
} from "../fhir/flowsheetEventHelpers";
import { interpretationClass } from "../fhir/labResultHelpers";
import type { KarteDetailTarget } from "../karteUrl";
import { addDays, today } from "../lib/dates";
import { FlowsheetEventModal } from "./FlowsheetEventModal";
import {
  BLOOD_PRESSURE_SERIES,
  bloodPressureNumbers,
  buildVitalFlowsheet,
  flowsheetColumnLabel,
  flowsheetDayLabel,
  vitalInterpretationOf,
  type VitalFlowsheetRow,
  type VitalInterpretation,
  type VitalThresholdSettings,
} from "../fhir/vitalHelpers";
import { ErrorBanner } from "./ErrorBanner";

// バイタルの経過表(POMR のフローシート)。読み取り専用で、編集はカルテの
// バイタルカードから行う(編集の導線を 2 つ持つと同期の負債になるため)。
//
// 横軸は**基準日から 1 週間**(左が古く、右端が基準日)。1 日の中は測定ごとに列が
// 分かれ、測定の無い日も 1 列は置く(紙の温度板と同じで、空いている日が見える)。
// 列の幅はパネルの幅を列数で割って使い切る(列が多い週だけ横に送る)。
//
// 上から順に、イベントの帯(手術・入退院・転棟・外出泊)、温度板グラフ、測定項目、
// 注射(薬剤の組ごと)、検査(種別ごと)。帯・注射・検査の印は**その日の列の中央**に
// 置く(1 日の中の位置は測定の並びで決まり時間に比例しないため。時刻は title と
// 一覧モーダルで見せる)。

/** 表に出す日数。基準日を含む。 */
const WEEK_DAYS = 7;
/** 列幅の下限(px)。これより狭くなる週は横に送る。 */
const MIN_COLUMN_WIDTH = 64;
/** 項目列 + 単位列の幅(px)。CSS の --vital-flowsheet-item-w / -unit-w と一致させること。 */
const LABEL_COLUMNS_WIDTH = 180;

/** 表の 1 列。測定があればその日時、無い日は日付だけの空き列。 */
interface DayColumn {
  key: string;
  day: string;
  at?: string;
}

/** 同じ日の列のまとまり。 */
interface DayGroup {
  day: string;
  /** columns の中での先頭の位置。 */
  start: number;
  count: number;
}

export function VitalFlowsheetPanel({
  patientId,
  onOpenDetail,
}: {
  patientId: string;
  /** イベント一覧からカルテのオーダー詳細モーダルを開く。 */
  onOpenDetail?: (target: KarteDetailTarget) => void;
}) {
  const [baseDate, setBaseDate] = useState(today());
  const [fullscreen, setFullscreen] = useState(false);
  // 帯で選んだ日。選ぶとその日のイベント一覧をモーダルで出す。
  const [selectedEventDay, setSelectedEventDay] = useState<string | null>(null);
  // 注射・検査の行で選んだ印。一覧は同じまとまり(その日のオーダー)ぶんを出し、
  // 押した 1 件は markKey で突き止めて色を付ける。
  const [selectedMark, setSelectedMark] = useState<{
    rows: "injection" | "exam";
    groupId: string;
    key: string;
  } | null>(null);
  // 全画面はビューポート全体ではなく「患者情報の下」から始める。開始位置は
  // カルテのレイアウト(左右ペインの上端)を実測して決める。
  const panelRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [fullscreenTop, setFullscreenTop] = useState(0);
  const [wrapWidth, setWrapWidth] = useState(0);

  const rangeStart = addDays(baseDate, -(WEEK_DAYS - 1));
  const rangeEnd = baseDate;
  const days = useMemo(
    () => Array.from({ length: WEEK_DAYS }, (_, i) => addDays(rangeStart, i)),
    [rangeStart],
  );

  const { data: observations, isLoading, error } = useVitalFlowsheet(patientId, rangeStart, rangeEnd);
  // 異常値(H/L)の色付けは施設設定のしきい値で表示時に判定する。
  const thresholds = useVitalThresholds();
  const flowsheet = useMemo(
    () => buildVitalFlowsheet(observations ?? [], thresholds),
    [observations, thresholds],
  );

  // 日ごとの列。測定があればその日時ごと、無ければ空き列を 1 つ。
  const { columns, dayGroups } = useMemo(() => {
    const columns: DayColumn[] = [];
    const dayGroups: DayGroup[] = [];
    for (const day of days) {
      const instants = flowsheet.columns.filter((at) => localDateOf(at) === day);
      const start = columns.length;
      if (instants.length === 0) columns.push({ key: `day:${day}`, day });
      else for (const at of instants) columns.push({ key: at, day, at });
      dayGroups.push({ day, start, count: Math.max(1, instants.length) });
    }
    return { columns, dayGroups };
  }, [days, flowsheet.columns]);

  const encounters = usePatientEncounterEvents(patientId, rangeStart, rangeEnd);
  const surgeries = usePatientSurgeryPerforms(patientId);
  const examOrders = usePatientExamOrders(patientId, rangeStart, rangeEnd);
  const injections = usePatientInjectionOrders(patientId, rangeStart, rangeEnd);

  const injectionRows = useMemo(
    () => (injections.data ? buildInjectionRows(injections.data) : []),
    [injections.data],
  );
  const examRows = useMemo(
    () => (examOrders.data ? buildExamRows(examOrders.data) : []),
    [examOrders.data],
  );
  const markModal = useMemo(() => {
    if (!selectedMark) return null;
    const rows = selectedMark.rows === "injection" ? injectionRows : examRows;
    const { events, highlightIndex, selected } = markModalEvents(
      rows,
      selectedMark.groupId,
      selectedMark.key,
    );
    if (events.length === 0) return null;
    const heading = selectedMark.rows === "injection" ? "注射" : "検査";
    // 見出しは押した 1 件の日時。どれを押したかが一覧を見る前に分かる。
    const when = selected ? flowsheetEventAtLabel(selected.at) : flowsheetEventRangeLabel(events);
    return { events, highlightIndex, title: `${heading}（${when}）` };
  }, [selectedMark, injectionRows, examRows]);

  const events = useMemo(
    () => buildFlowsheetEvents(encounters.data?.events ?? [], surgeries.data ?? []),
    [encounters.data, surgeries.data],
  );
  const eventGroups = useMemo(() => groupFlowsheetEventsByDay(events), [events]);
  const selectedEventGroup = eventGroups.find((group) => group.day === selectedEventDay);

  const stays = encounters.data?.stays ?? [];
  // 手術日(YYYY-MM-DD)。術後日数の行を出すかの判定にも使う。
  const surgeryDates = useMemo(
    () =>
      (surgeries.data ?? [])
        .map((procedure) => procedure.performedPeriod?.start ?? procedure.performedDateTime ?? "")
        .filter(Boolean)
        .map(localDateOf)
        .filter(Boolean),
    [surgeries.data],
  );
  const hospitalDays = days.map((day) => hospitalDayOf(day, stays));
  const postOpDays = days.map((day) => postOpDayOf(day, surgeryDates));
  const showHospitalDays = hospitalDays.some((day) => day !== undefined);
  const showPostOpDays = postOpDays.some((day) => day !== undefined);
  // 見出しは 年 / 日付 / 時刻 の 3 段。病日・術後日数を出すぶんだけ rowSpan を伸ばす。
  const headerRowSpan = 3 + (showHospitalDays ? 1 : 0) + (showPostOpDays ? 1 : 0);

  // 全画面は Escape でも抜けられるようにする(モーダルと同じ作法)。
  useEffect(() => {
    if (!fullscreen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setFullscreen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fullscreen]);

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

  // 列幅はパネルの幅から決める。ペインの分割やウィンドウの幅で変わるので、
  // 描画のたびに同期で測り、以後は ResizeObserver で追う。
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    function measure() {
      if (wrapRef.current) setWrapWidth(wrapRef.current.clientWidth);
    }
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(wrap);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [fullscreen, isLoading]);

  const columnWidth = Math.max(
    MIN_COLUMN_WIDTH,
    Math.floor((wrapWidth - LABEL_COLUMNS_WIDTH) / Math.max(1, columns.length)),
  );

  const chartSeries = useMemo(
    () => buildChartSeries(flowsheet.rows, observations ?? [], thresholds),
    [flowsheet, observations, thresholds],
  );

  // 年の見出し。連続する同じ年の日をまとめる。
  const yearGroups = useMemo(() => {
    const groups: { year: string; count: number }[] = [];
    for (const group of dayGroups) {
      const { year } = flowsheetDayLabel(group.day);
      const last = groups[groups.length - 1];
      if (last && last.year === year) last.count += group.count;
      else groups.push({ year, count: group.count });
    }
    return groups;
  }, [dayGroups]);

  /**
   * 日の区切り x(px)。注射・検査の行は 1 セルを SVG で描くので表の縦罫線が入らない。
   * 日ごとに読めるよう、同じ位置に自前で線を引く(末尾はセルの外枠と重なるので除く)。
   */
  const dayLineXs = useMemo(
    () => dayGroups.slice(0, -1).map((group) => (group.start + group.count) * columnWidth),
    [dayGroups, columnWidth],
  );

  /** 日の列のまとまりの幅(px)。同じ日に重なる印をどこまで広げてよいかに使う。 */
  const dayWidth = (day: string): number => {
    const group = dayGroups.find((candidate) => candidate.day === day);
    return (group?.count ?? 1) * columnWidth;
  };

  /** 日の列のまとまりの中央 x(px)。範囲外の日は端に寄せる。 */
  const dayCenterX = (day: string): number => {
    if (day < rangeStart) return 0;
    if (day > rangeEnd) return columns.length * columnWidth;
    const group = dayGroups.find((candidate) => candidate.day === day);
    return group ? (group.start + group.count / 2) * columnWidth : 0;
  };

  function shiftWeek(delta: number) {
    setBaseDate((prev) => addDays(prev, delta * WEEK_DAYS));
  }

  return (
    // 表の地色・見出し行・1 行おきの濃淡は他のタブ(検査結果の時系列表示)と同じ
    // .karte-tabpanel 配下の指定に任せる。全画面は同じ中身を左右ペインの領域に
    // 重ねるだけ(患者情報の帯までは残り、右ペインなどは覆われて見えなくなる)。
    <div
      ref={panelRef}
      className={`karte-tabpanel vital-flowsheet${fullscreen ? " vital-flowsheet--fullscreen" : ""}`}
      style={{
        ...(fullscreen ? { top: fullscreenTop } : {}),
        ["--vital-flowsheet-col-w" as string]: `${columnWidth}px`,
      }}
    >
      <ErrorBanner
        error={error ?? encounters.error ?? surgeries.error ?? examOrders.error ?? injections.error}
      />

      <div className="lab-timeline__controls">
        <label className="lab-timeline__count">
          基準日
          <input
            type="date"
            value={baseDate}
            onChange={(e) => {
              if (e.target.value) setBaseDate(e.target.value);
            }}
          />
        </label>
        <button
          type="button"
          className="vital-flowsheet__week-button"
          onClick={() => shiftWeek(-1)}
          title="前の週"
          aria-label="前の週"
        >
          ◀
        </button>
        <button
          type="button"
          className="vital-flowsheet__week-button"
          onClick={() => shiftWeek(1)}
          title="次の週"
          aria-label="次の週"
        >
          ▶
        </button>
        <button type="button" onClick={() => setBaseDate(today())}>
          今日
        </button>
        <span className="lab-timeline__hint" />
        <button type="button" onClick={() => setFullscreen((prev) => !prev)}>
          {fullscreen ? "全画面を終了" : "全画面"}
        </button>
      </div>

      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <div ref={wrapRef} className="lab-timeline__table-wrap">
            <table className="lab-timeline__table vital-flowsheet__table">
              <thead>
                {/* 1 日 = 列のまとまり。測定ごとに列が分かれるので、日付の下に時刻を出す。
                    末尾の空列は列幅の端数を吸収する。 */}
                <tr>
                  <th className="lab-timeline__item-col" rowSpan={3}>
                    測定項目
                  </th>
                  <th className="lab-timeline__unit-col" rowSpan={3}>
                    単位
                  </th>
                  {yearGroups.map((group, index) => (
                    <th key={index} className="lab-timeline__year-col" colSpan={group.count}>
                      {group.year}年
                    </th>
                  ))}
                  <th className="vital-flowsheet__filler" rowSpan={headerRowSpan} />
                </tr>
                <tr>
                  {dayGroups.map((group) => {
                    const { label, weekday } = flowsheetDayLabel(group.day);
                    const weekendClass =
                      weekday === 0
                        ? " vital-flowsheet__date-col--sunday"
                        : weekday === 6
                          ? " vital-flowsheet__date-col--saturday"
                          : "";
                    return (
                      <th
                        key={group.day}
                        className={`lab-timeline__date-col vital-flowsheet__date-col${weekendClass}${
                          group.day === baseDate ? " vital-flowsheet__date-col--base" : ""
                        }`}
                        colSpan={group.count}
                        title={group.day}
                      >
                        {label}
                      </th>
                    );
                  })}
                </tr>
                <tr>
                  {columns.map((column) => (
                    <th key={column.key} className="vital-flowsheet__time-col" title={column.at}>
                      {column.at ? flowsheetColumnLabel(column.at).time : ""}
                    </th>
                  ))}
                </tr>
                {/* 病日・術後日数。入院・手術があるときだけ行を出す。日の単位なので
                    日のまとまりごとに 1 セル。見出しの中にあるので縦に送っても残る。 */}
                {showHospitalDays && (
                  <tr>
                    <th className="lab-timeline__item-col vital-flowsheet__day-head">病日</th>
                    <th className="lab-timeline__unit-col" />
                    {dayGroups.map((group, index) => (
                      <th
                        key={group.day}
                        className="vital-flowsheet__day-col"
                        colSpan={group.count}
                        title="入院からの日数"
                      >
                        {hospitalDayLabel(hospitalDays[index])}
                      </th>
                    ))}
                  </tr>
                )}
                {showPostOpDays && (
                  <tr>
                    <th className="lab-timeline__item-col vital-flowsheet__day-head">術後</th>
                    <th className="lab-timeline__unit-col" />
                    {dayGroups.map((group, index) => (
                      <th
                        key={group.day}
                        className="vital-flowsheet__day-col"
                        colSpan={group.count}
                        title="手術からの日数"
                      >
                        {postOpDayLabel(postOpDays[index])}
                      </th>
                    ))}
                  </tr>
                )}
              </thead>

              {/* イベントの帯とグラフは測定の行と性質が違うので tbody を分ける。
                  1 行おきの濃淡(tbody tr:nth-child(even))が測定の行だけに当たり、
                  帯の有無で縞の向きが入れ替わらない。 */}
              <tbody className="vital-flowsheet__chart-body">
                {eventGroups.some((group) => group.day >= rangeStart && group.day <= rangeEnd) && (
                  <tr className="vital-flowsheet__event-row">
                    <th className="lab-timeline__item-col vital-flowsheet__event-head" colSpan={2}>
                      イベント
                    </th>
                    <td className="vital-flowsheet__event-cell" colSpan={columns.length}>
                      <FlowsheetEventBand
                        width={columns.length * columnWidth}
                        groups={eventGroups.filter(
                          (group) => group.day >= rangeStart && group.day <= rangeEnd,
                        )}
                        xOf={dayCenterX}
                        selectedDay={selectedEventDay}
                        onSelect={setSelectedEventDay}
                      />
                    </td>
                    <td className="vital-flowsheet__filler" />
                  </tr>
                )}
                <tr className="vital-flowsheet__chart-row">
                  <th className="lab-timeline__item-col vital-flowsheet__axis-cell" colSpan={2}>
                    <FlowsheetAxis series={chartSeries} />
                  </th>
                  <td className="vital-flowsheet__chart-cell" colSpan={columns.length}>
                    <FlowsheetChart
                      columns={columns}
                      columnWidth={columnWidth}
                      series={chartSeries}
                      eventXs={eventGroups
                        .filter((group) => group.day >= rangeStart && group.day <= rangeEnd)
                        .map((group) => dayCenterX(group.day))}
                    />
                  </td>
                  <td className="vital-flowsheet__filler" />
                </tr>
              </tbody>

              <tbody>
                {flowsheet.rows.length === 0 && (
                  <tr>
                    <td className="lab-timeline__item-col vital-flowsheet__empty" colSpan={2}>
                      バイタルの記録がありません
                    </td>
                    <td colSpan={columns.length} />
                    <td className="vital-flowsheet__filler" />
                  </tr>
                )}
                {flowsheet.rows.map((row) => (
                  <tr key={row.key}>
                    {/* 項目列・単位列は幅固定で左に貼り付く(CSS)。長い項目名は省略されるので title で。 */}
                    <td className="lab-timeline__item-col" title={row.name}>
                      <span className="lab-timeline__item-label">{row.name}</span>
                    </td>
                    <td className="lab-timeline__unit-col">{row.unit}</td>
                    {columns.map((column) => (
                      // 列幅は固定なので、長い文字値(観察結果)は省略される。全文は title で。
                      // 異常値は検査結果の時系列表示と同じ修飾子(--high / --low)で色付けする。
                      <td
                        key={column.key}
                        className={interpretationClass(
                          (column.at && row.interpretations.get(column.at)) || "",
                          "lab-timeline__value",
                        )}
                        title={column.at ? row.values.get(column.at) : undefined}
                      >
                        {column.at ? (row.values.get(column.at) ?? "") : ""}
                      </td>
                    ))}
                    <td className="vital-flowsheet__filler" />
                  </tr>
                ))}
              </tbody>

              {/* 注射・検査。薬剤の組・検査の種別ごとに 1 行で、印はその日の列の中央。
                  測定の行とは読むものが違うので下にまとめ、tbody を分けて縞を掛けない。
                  オーダーが無ければ区切りごと出さない。 */}
              <FlowsheetMarkSection
                heading="注射"
                rows={injectionRows}
                columnCount={columns.length}
                width={columns.length * columnWidth}
                dayLineXs={dayLineXs}
                xOf={dayCenterX}
                dayWidthOf={dayWidth}
                selectedKey={selectedMark?.rows === "injection" ? selectedMark.key : null}
                onSelect={(mark) =>
                  setSelectedMark({ rows: "injection", groupId: mark.groupId, key: markKey(mark) })
                }
              />
              <FlowsheetMarkSection
                heading="検査"
                rows={examRows}
                columnCount={columns.length}
                width={columns.length * columnWidth}
                dayLineXs={dayLineXs}
                xOf={dayCenterX}
                dayWidthOf={dayWidth}
                selectedKey={selectedMark?.rows === "exam" ? selectedMark.key : null}
                onSelect={(mark) =>
                  setSelectedMark({ rows: "exam", groupId: mark.groupId, key: markKey(mark) })
                }
              />
            </table>
          </div>

          {selectedEventGroup && (
            <FlowsheetEventModal
              events={selectedEventGroup.events}
              onOpenDetail={onOpenDetail}
              onClose={() => setSelectedEventDay(null)}
            />
          )}

          {markModal && (
            <FlowsheetEventModal
              events={markModal.events}
              title={markModal.title}
              highlightIndex={markModal.highlightIndex}
              onOpenDetail={onOpenDetail}
              onClose={() => setSelectedMark(null)}
            />
          )}
        </>
      )}
    </div>
  );
}

// ---- イベントの帯 ----

/** 1 つの日に積むラベルの上限。これを超えたら最後の行を「他N件」にする。 */
const EVENT_LABEL_ROWS = 3;
const EVENT_ROW_HEIGHT = 13;
/** ▼ とラベルの間。 */
const EVENT_MARK_HEIGHT = 12;
/** ラベルの文字数の上限。列幅に収まる長さで丸め、全文は title に出す。 */
const EVENT_LABEL_CHARS = 5;

function truncateLabel(label: string): string {
  return label.length > EVENT_LABEL_CHARS ? `${label.slice(0, EVENT_LABEL_CHARS)}…` : label;
}

function eventTitle(event: FlowsheetEvent): string {
  const when = flowsheetEventAtLabel(event.at);
  return [event.name, event.detail].filter(Boolean).join(" ") + (when ? ` (${when})` : "");
}

/**
 * イベントの帯。印はその日の列のまとまりの中央に置き、同じ日のイベントは縦に積む。
 */
function FlowsheetEventBand({
  width,
  groups,
  xOf,
  selectedDay,
  onSelect,
}: {
  width: number;
  groups: FlowsheetEventGroup[];
  xOf: (day: string) => number;
  selectedDay: string | null;
  onSelect: (day: string) => void;
}) {
  const rows = Math.min(EVENT_LABEL_ROWS, Math.max(1, ...groups.map((group) => group.labels.length)));
  const height = EVENT_MARK_HEIGHT + rows * EVENT_ROW_HEIGHT;

  return (
    <svg
      className="vital-flowsheet__event-band"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="入退院・手術のイベント"
    >
      {groups.map((group) => {
        const x = xOf(group.day);
        // 4 件以上あるときは 2 行だけ出し、残りを最後の行にまとめる。
        const overflow = group.labels.length > EVENT_LABEL_ROWS;
        const shown = overflow ? group.labels.slice(0, EVENT_LABEL_ROWS - 1) : group.labels;
        const selected = group.day === selectedDay;
        return (
          <g
            key={group.day}
            className={`vital-flowsheet__event vital-flowsheet__event--${group.labels[0].kind}${
              selected ? " vital-flowsheet__event--selected" : ""
            }`}
            role="button"
            tabIndex={0}
            aria-label={`${group.labels.map((l) => l.text).join("・")} の一覧を開く`}
            onClick={() => onSelect(group.day)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(group.day);
              }
            }}
          >
            <title>{group.events.map(eventTitle).join("\n")}</title>
            {/* クリックできる範囲。▼ とラベルだけだと当たり判定が細すぎる。 */}
            <rect
              className="vital-flowsheet__event-hit"
              x={x - MIN_COLUMN_WIDTH / 2}
              y={0}
              width={MIN_COLUMN_WIDTH}
              height={height}
            />
            <path className="vital-flowsheet__event-mark" d={`M${x - 4},2 L${x + 4},2 L${x},9 Z`} />
            {shown.map((label, index) => (
              <text
                key={`${label.text}/${index}`}
                className={`vital-flowsheet__event-label vital-flowsheet__event-label--${label.kind}`}
                x={x}
                y={EVENT_MARK_HEIGHT + (index + 1) * EVENT_ROW_HEIGHT - 3}
                textAnchor="middle"
              >
                {truncateLabel(label.text)}
              </text>
            ))}
            {overflow && (
              <text
                className="vital-flowsheet__event-label vital-flowsheet__event-label--more"
                x={x}
                y={EVENT_MARK_HEIGHT + EVENT_LABEL_ROWS * EVENT_ROW_HEIGHT - 3}
                textAnchor="middle"
              >
                他{group.labels.length - shown.length}件
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ---- 印の行(注射・検査) ----

const MARK_ROW_HEIGHT = 18;
/** 印の半径。 */
const MARK_R = 4;
/** 開始と終了が同じ位置に来たときのバーの最小幅。 */
const MARK_BAR_MIN_WIDTH = 12;
/** 同じ位置に重なった点をずらす間隔。印の直径 + 隙間。 */
const MARK_GAP = 13;
/** その日に印が多いときの間隔の下限。これ以下には詰めない(重なって読めなくなる)。 */
const MARK_MIN_GAP = 7;
/** 当たり判定の最小幅。 */
const MARK_HIT_WIDTH = 13;

/** 区切り行 + 行の並び。行が無ければ何も出さない。 */
function FlowsheetMarkSection({
  heading,
  rows,
  columnCount,
  width,
  dayLineXs,
  xOf,
  dayWidthOf,
  selectedKey,
  onSelect,
}: {
  heading: string;
  rows: FlowsheetMarkRow[];
  columnCount: number;
  width: number;
  /** 日の区切りに引く縦線の x。 */
  dayLineXs: number[];
  xOf: (day: string) => number;
  dayWidthOf: (day: string) => number;
  /** 押した印。色を付ける 1 件を選ぶ。 */
  selectedKey: string | null;
  onSelect: (mark: FlowsheetMark) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <tbody className="vital-flowsheet__injection-body">
      <tr className="vital-flowsheet__section-row">
        <th className="lab-timeline__item-col vital-flowsheet__section-head" colSpan={2}>
          {heading}
        </th>
        <td colSpan={columnCount} />
        <td className="vital-flowsheet__filler" />
      </tr>
      {rows.map((row) => (
        <tr key={row.key} className="vital-flowsheet__injection-row">
          <th
            className="lab-timeline__item-col vital-flowsheet__injection-head"
            colSpan={2}
            title={row.title}
          >
            {row.label}
          </th>
          <td className="vital-flowsheet__injection-cell" colSpan={columnCount}>
            <FlowsheetMarkRowSvg
              width={width}
              marks={row.marks}
              dayLineXs={dayLineXs}
              xOf={xOf}
              dayWidthOf={dayWidthOf}
              selectedKey={selectedKey}
              onSelect={onSelect}
            />
          </td>
          <td className="vital-flowsheet__filler" />
        </tr>
      ))}
    </tbody>
  );
}

/**
 * 印の x を決める。印はその日の列のまとまりの中央。同じ日に 2 回投与する予定や、
 * 予定とその実施は同じ位置に落ちて重なるので、左右に均等にずらして数が見えるようにする。
 * ずらす間隔はその日の幅に収める(はみ出すと隣の日の印に見える)。
 */
function placeMarks(
  marks: FlowsheetMark[],
  xOf: (day: string) => number,
  dayWidthOf: (day: string) => number,
): { mark: FlowsheetMark; x: number; endX?: number }[] {
  // バーを描くのは**日をまたぐ**ときだけ。横軸は 1 日単位なので、同じ日に収まる
  // 点滴の長さは描き分けられず、短いバーを出すと隣の印に重なって鎖のように見える
  // (同じ日の開始〜終了は title と一覧モーダルで読む)。
  const placed = marks.map((mark) => {
    const day = localDateOf(mark.at);
    const endDay = mark.end ? localDateOf(mark.end) : "";
    return {
      mark,
      x: xOf(day),
      endX: endDay && endDay !== day ? xOf(endDay) : undefined,
    };
  });

  const byX = new Map<number, typeof placed>();
  for (const item of placed) {
    const list = byX.get(item.x);
    if (list) list.push(item);
    else byX.set(item.x, [item]);
  }
  for (const list of byX.values()) {
    if (list.length < 2) continue;
    // 時刻順に並べて左から置く(左が古い)。
    list.sort((a, b) => a.mark.at.localeCompare(b.mark.at));
    const dayWidth = dayWidthOf(localDateOf(list[0].mark.at));
    const gap = Math.max(MARK_MIN_GAP, Math.min(MARK_GAP, dayWidth / list.length));
    list.forEach((item, index) => {
      const shift = (index - (list.length - 1) / 2) * gap;
      item.x += shift;
      if (item.endX !== undefined) item.endX += shift;
    });
  }
  return placed;
}

/** 印 1 行(薬剤の組 1 つ、検査の種別 1 つ)。終了があればバー、無ければ点。 */
function FlowsheetMarkRowSvg({
  width,
  marks,
  dayLineXs,
  xOf,
  dayWidthOf,
  selectedKey,
  onSelect,
}: {
  width: number;
  marks: FlowsheetMark[];
  dayLineXs: number[];
  xOf: (day: string) => number;
  dayWidthOf: (day: string) => number;
  selectedKey: string | null;
  onSelect: (mark: FlowsheetMark) => void;
}) {
  const y = MARK_ROW_HEIGHT / 2;
  const placed = placeMarks(marks, xOf, dayWidthOf);

  return (
    <svg
      className="vital-flowsheet__injection-band"
      width={width}
      height={MARK_ROW_HEIGHT}
      viewBox={`0 0 ${width} ${MARK_ROW_HEIGHT}`}
      role="img"
      aria-label="予定と実施"
    >
      {/* 日の区切り。印より先に描いて背面に置く。 */}
      {dayLineXs.map((x) => (
        <line
          key={x}
          className="vital-flowsheet__grid vital-flowsheet__grid--column"
          x1={x}
          x2={x}
          y1={0}
          y2={MARK_ROW_HEIGHT}
        />
      ))}
      {placed.map(({ mark, x: rawX, endX: rawEndX }, index) => {
        // 端に来た印が半分切れないよう、半径ぶんだけ内側に寄せる。
        const x = Math.min(Math.max(rawX, MARK_R), width - MARK_R);
        const endX =
          rawEndX === undefined ? undefined : Math.min(Math.max(rawEndX, MARK_R), width - MARK_R);
        const selected = markKey(mark) === selectedKey;
        // 左が古いので、バーは開始(x)から終了(endX)へ右に伸びる。
        const barWidth = endX === undefined ? 0 : Math.max(MARK_BAR_MIN_WIDTH, endX - x);
        return (
          <g
            key={`${mark.groupId}/${mark.at}/${mark.kind}/${index}`}
            className={`vital-flowsheet__injection vital-flowsheet__injection--${mark.kind}${
              selected ? " vital-flowsheet__injection--selected" : ""
            }`}
            role="button"
            tabIndex={0}
            aria-label={`${mark.title} の一覧を開く`}
            onClick={() => onSelect(mark)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(mark);
              }
            }}
          >
            <title>{mark.title}</title>
            <rect
              className="vital-flowsheet__injection-hit"
              x={x - MARK_HIT_WIDTH / 2}
              y={0}
              width={barWidth + MARK_HIT_WIDTH}
              height={MARK_ROW_HEIGHT}
            />
            {endX !== undefined && (
              <rect
                className="vital-flowsheet__injection-bar"
                x={x}
                y={y - 4}
                width={Math.min(barWidth, width - x)}
                height={8}
                rx={4}
              />
            )}
            <circle className="vital-flowsheet__injection-mark" cx={x} cy={y} r={MARK_R} />
            {(mark.kind === "not-done" || mark.kind === "cancelled") && (
              <path
                className="vital-flowsheet__injection-cross"
                d={`M${x - 3},${y - 3} L${x + 3},${y + 3} M${x + 3},${y - 3} L${x - 3},${y + 3}`}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ---- グラフ(温度板) ----

const CHART_HEIGHT = 190;
const CHART_PAD = { top: 22, bottom: 12 };
const PLOT_H = CHART_HEIGHT - CHART_PAD.top - CHART_PAD.bottom;
/** 目盛りの区間数。全系列で共通(同じ横罫線に各系列の目盛りを揃える)。 */
const TICK_INTERVALS = 6;
/** 基準線(下から数えた目盛りの位置)。BP 120 / R 30 / P 75 / T 37 の横罫線。 */
const BASELINE_TICK = 3;

type ChartMarker = "square" | "circle" | "triangle-up" | "triangle-down";

interface ChartSpec {
  key: string;
  /** 略称(T/BP/P/R)。 */
  name: string;
  unit: string;
  /** CSS 側で色を当てる修飾子。 */
  className: string;
  marker: ChartMarker;
  /** 最下段の目盛りと 1 区間の幅。目盛りは TICK_INTERVALS 区間で固定。 */
  min: number;
  step: number;
  /** 軸の列に出す系列。血圧の拡張期は収縮期と同じ列を使う。 */
  axis: boolean;
}

interface ChartSeries extends ChartSpec {
  max: number;
  numbers: Map<string, number>;
  /** 測定日時 → 異常値の判定。点の色を変える。 */
  interpretations: Map<string, VitalInterpretation>;
}

// 温度板の慣例的な目盛り(BP 0–240 / R 0–60 / P 0–150 / T 34–40)。系列ごとにスケールが
// 違うので 1 つの軸に重ねず、同じ横罫線に各系列の目盛りを割り当てる。
const CHART_SPECS: ChartSpec[] = [
  { key: "8480-6", name: "BP", unit: "mmHg", className: "bp", marker: "triangle-down", min: 0, step: 40, axis: true },
  { key: "8462-4", name: "BP", unit: "mmHg", className: "bp", marker: "triangle-up", min: 0, step: 40, axis: false },
  { key: "9279-1", name: "R", unit: "/分", className: "r", marker: "square", min: 0, step: 10, axis: true },
  { key: "8867-4", name: "P", unit: "/分", className: "p", marker: "circle", min: 0, step: 25, axis: true },
  { key: "8310-5", name: "T", unit: "℃", className: "t", marker: "circle", min: 34, step: 1, axis: true },
];

function buildChartSeries(
  rows: VitalFlowsheetRow[],
  observations: fhir4.Observation[],
  thresholds: VitalThresholdSettings,
): ChartSeries[] {
  const bpKeys = BLOOD_PRESSURE_SERIES.map((series) => series.key as string);
  return CHART_SPECS.map((spec) => {
    const numbers = bpKeys.includes(spec.key)
      ? bloodPressureNumbers(observations, spec.key)
      : (rows.find((row) => row.key === spec.key)?.numbers ?? new Map<string, number>());
    // 表の血圧行は収縮期・拡張期をまとめて判定しているので、グラフは系列ごとに判定し直す。
    const interpretations = new Map<string, VitalInterpretation>();
    for (const [at, value] of numbers) {
      const mark = vitalInterpretationOf(spec.key, value, thresholds);
      if (mark) interpretations.set(at, mark);
    }
    // 目盛りの区間数は固定なので、範囲外の測定があれば目盛りごと平行移動して収める
    // (上側を優先。上下両方にはみ出す極端な場合は下側が切れる)。
    let { min } = spec;
    const span = spec.step * TICK_INTERVALS;
    const values = [...numbers.values()];
    if (values.length > 0) {
      const low = Math.min(...values);
      const high = Math.max(...values);
      while (min > low) min -= spec.step;
      while (min + span < high) min += spec.step;
    }
    return { ...spec, min, max: min + span, numbers, interpretations };
  });
}

const tickY = (index: number) => CHART_PAD.top + PLOT_H - (PLOT_H * index) / TICK_INTERVALS;

/** 左端の軸。系列ごとの目盛りを列にして、グラフと同じ高さの横罫線に揃える。 */
function FlowsheetAxis({ series }: { series: ChartSeries[] }) {
  const columns = series.filter((s) => s.axis);
  const colWidth = 36;
  const width = columns.length * colWidth;
  return (
    <svg
      className="vital-flowsheet__axis"
      width={width}
      height={CHART_HEIGHT}
      viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
      aria-hidden="true"
    >
      {columns.map((s, col) => {
        const x = width - (columns.length - col - 0.5) * colWidth;
        return (
          <g key={s.key} className={`vital-flowsheet__series vital-flowsheet__series--${s.className}`}>
            <text className="vital-flowsheet__axis-name" x={x} y={12} textAnchor="middle">
              {s.name}
            </text>
            {Array.from({ length: TICK_INTERVALS + 1 }, (_, i) => (
              <text
                key={i}
                className={`vital-flowsheet__axis-tick${i === BASELINE_TICK ? " vital-flowsheet__axis-tick--base" : ""}`}
                x={x}
                y={tickY(i) + 3.5}
                textAnchor="middle"
              >
                {s.min + s.step * i}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

function markerShape(marker: ChartMarker, x: number, y: number) {
  const r = 3.5;
  switch (marker) {
    case "square":
      return <rect x={x - r} y={y - r} width={r * 2} height={r * 2} />;
    // 血圧は温度板の慣例で収縮期を ▼、拡張期を ▲ にする。
    case "triangle-down":
      return <path d={`M${x},${y + r + 0.5} L${x + r + 0.5},${y - r} L${x - r - 0.5},${y - r} Z`} />;
    case "triangle-up":
      return <path d={`M${x},${y - r - 0.5} L${x + r + 0.5},${y + r} L${x - r - 0.5},${y + r} Z`} />;
    default:
      return <circle cx={x} cy={y} r={r} />;
  }
}

function FlowsheetChart({
  columns,
  columnWidth,
  series,
  eventXs,
}: {
  columns: DayColumn[];
  columnWidth: number;
  series: ChartSeries[];
  /** イベントの帯の ▼ と同じ位置に落とす縦線(その日の中央)。 */
  eventXs: number[];
}) {
  const width = columns.length * columnWidth;
  const xOf = (index: number) => (index + 0.5) * columnWidth;
  const yOf = (s: ChartSeries, value: number) =>
    CHART_PAD.top + PLOT_H - ((value - s.min) / (s.max - s.min)) * PLOT_H;

  // 目盛りの横罫線(主)と、区間を 2 等分する補助線。
  const majorLines = Array.from({ length: TICK_INTERVALS + 1 }, (_, i) => tickY(i));
  const minorLines = Array.from({ length: TICK_INTERVALS }, (_, i) => tickY(i + 0.5));

  return (
    <svg
      className="vital-flowsheet__chart"
      width={width}
      height={CHART_HEIGHT}
      viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
      role="img"
      aria-label="バイタルの推移グラフ"
    >
      {minorLines.map((y) => (
        <line key={y} className="vital-flowsheet__grid vital-flowsheet__grid--minor" x1={0} x2={width} y1={y} y2={y} />
      ))}
      {majorLines.map((y, i) => (
        <line
          key={y}
          className={`vital-flowsheet__grid${i === BASELINE_TICK ? " vital-flowsheet__grid--base" : ""}`}
          x1={0}
          x2={width}
          y1={y}
          y2={y}
        />
      ))}
      {/* 列の区切り線。表のセルの縦罫線と同じ位置に引いて、グラフの点がどの列の
          測定かを目で追えるようにする(点は列の中央に載る)。 */}
      {columns.map((column, index) => (
        <line
          key={column.key}
          className="vital-flowsheet__grid vital-flowsheet__grid--column"
          x1={(index + 1) * columnWidth}
          x2={(index + 1) * columnWidth}
          y1={0}
          y2={CHART_HEIGHT}
        />
      ))}
      {/* イベントの縦線。帯の ▼ から折れ線まで目で追えるよう、破線で通す。 */}
      {eventXs.map((x, index) => (
        <line
          key={`event-${index}`}
          className="vital-flowsheet__grid vital-flowsheet__grid--event"
          x1={x}
          x2={x}
          y1={0}
          y2={CHART_HEIGHT}
        />
      ))}
      {series.map((s) => {
        const points = columns.flatMap((column, index) => {
          const value = column.at ? s.numbers.get(column.at) : undefined;
          return value == null || !column.at
            ? []
            : [{ at: column.at, value, x: xOf(index), y: yOf(s, value) }];
        });
        if (points.length === 0) return null;
        const path = points
          .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
          .join(" ");
        return (
          <g key={s.key} className={`vital-flowsheet__series vital-flowsheet__series--${s.className}`}>
            <path className="vital-flowsheet__line" d={path} />
            {points.map((p) => (
              <g
                key={p.at}
                className={interpretationClass(
                  s.interpretations.get(p.at) ?? "",
                  "vital-flowsheet__marker",
                )}
              >
                <title>
                  {s.name} {p.value}
                  {s.unit} ({flowsheetColumnLabel(p.at).date} {flowsheetColumnLabel(p.at).time})
                </title>
                {markerShape(s.marker, p.x, p.y)}
              </g>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
