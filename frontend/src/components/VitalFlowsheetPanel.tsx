import { useEffect, useMemo, useRef, useState } from "react";
import {
  usePatientEncounterEvents,
  usePatientExamOrders,
  usePatientSurgeryPerforms,
  useVitalFlowsheet,
  useVitalThresholds,
} from "../api/queries";
import {
  buildFlowsheetEvents,
  groupFlowsheetEvents,
  hospitalDayLabel,
  hospitalDayOf,
  localDateOf,
  postOpDayLabel,
  postOpDayOf,
  type FlowsheetEvent,
  type FlowsheetEventGroup,
} from "../fhir/flowsheetEventHelpers";
import { interpretationClass } from "../fhir/labResultHelpers";
import { today } from "../lib/dates";
import {
  BLOOD_PRESSURE_SERIES,
  bloodPressureNumbers,
  buildVitalFlowsheet,
  flowsheetColumnLabel,
  groupFlowsheetColumns,
  vitalInterpretationOf,
  type VitalFlowsheetRow,
  type VitalInterpretation,
  type VitalThresholdSettings,
} from "../fhir/vitalHelpers";
import { ErrorBanner } from "./ErrorBanner";

// バイタルの経過表(POMR のフローシート)。読み取り専用で、編集はカルテの
// バイタルカードから行う(編集の導線を 2 つ持つと同期の負債になるため)。
//
// 表の操作系は検査結果の時系列表示(LabResultTimelinePanel)に合わせるが、
// グラフは温度板にならって表の最上段に常設し、体温・血圧・脈拍・呼吸数を
// 表の列位置に揃えて描く(項目を選んでモーダルで開く方式は採らない)。
//
// グラフの上にはイベントの帯(入退院・転棟・外出泊・手術・放射線/内視鏡/生理検査)、
// 日付の見出しの下には病日・術後日数を出す(fhir/flowsheetEventHelpers.ts)。

const DEFAULT_COLUMN_COUNT = 10;
const MAX_COLUMN_COUNT = 100;

export function VitalFlowsheetPanel({ patientId }: { patientId: string }) {
  const [columnCount, setColumnCount] = useState(DEFAULT_COLUMN_COUNT);
  const [fullscreen, setFullscreen] = useState(false);
  // 全画面はビューポート全体ではなく「患者情報の下」から始める。開始位置は
  // カルテのレイアウト(左右ペインの上端)を実測して決める。全画面のときこの
  // 要素自体は fixed で流れから外れるが、レイアウトの上端は上の行(アプリ
  // ヘッダー + 患者情報)で決まるので測り直しても動かない。
  const panelRef = useRef<HTMLDivElement>(null);
  const [fullscreenTop, setFullscreenTop] = useState(0);

  const { data: observations, isLoading, error } = useVitalFlowsheet(patientId, columnCount);
  // 異常値(H/L)の色付けは施設設定のしきい値で表示時に判定する。
  const thresholds = useVitalThresholds();
  const flowsheet = useMemo(
    () => buildVitalFlowsheet(observations ?? [], columnCount, thresholds),
    [observations, columnCount, thresholds],
  );
  const { columns } = flowsheet;

  // イベントと病日は「表に出ている期間」だけ引く(いちばん古い列 〜 今日)。
  // 列が無ければ引かない。入院期間は範囲より前に始まっていても返る(病日を数えるため)。
  const rangeStart = columns.length > 0 ? localDateOf(columns[columns.length - 1]) : "";
  const rangeEnd = today();
  const encounters = usePatientEncounterEvents(patientId, rangeStart, rangeEnd);
  const surgeries = usePatientSurgeryPerforms(patientId);
  const examOrders = usePatientExamOrders(patientId, rangeStart, rangeEnd);

  const events = useMemo(
    () =>
      buildFlowsheetEvents(
        encounters.data?.events ?? [],
        surgeries.data ?? [],
        examOrders.data ?? [],
      ),
    [encounters.data, surgeries.data, examOrders.data],
  );
  const eventGroups = useMemo(
    () => groupFlowsheetEvents(columns, events),
    [columns, events],
  );

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
  // 列ごとの端末ローカル日付。病日・術後日数はこれで数える。
  const columnDates = useMemo(() => columns.map(localDateOf), [columns]);
  const hospitalDays = columnDates.map((date) => hospitalDayOf(date, stays));
  const postOpDays = columnDates.map((date) => postOpDayOf(date, surgeryDates));
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

  function handleColumnCountChange(raw: number) {
    if (!Number.isFinite(raw)) return;
    setColumnCount(Math.min(MAX_COLUMN_COUNT, Math.max(1, Math.round(raw))));
  }

  const chartSeries = useMemo(
    () => buildChartSeries(flowsheet.rows, observations ?? [], thresholds),
    [flowsheet, observations, thresholds],
  );

  const yearGroups = groupFlowsheetColumns(columns, (at) => flowsheetColumnLabel(at).year);
  // 同じ日の朝夕は列を分けたまま、日付の見出しだけ 1 つにまとめる。
  const dateGroups = groupFlowsheetColumns(
    columns,
    (at) => `${flowsheetColumnLabel(at).year}/${flowsheetColumnLabel(at).date}`,
  );

  return (
    // 表の地色・見出し行・1 行おきの濃淡は他のタブ(検査結果の時系列表示)と同じ
    // .karte-tabpanel 配下の指定に任せる。全画面は同じ中身を左右ペインの領域に
    // 重ねるだけ(患者情報の帯までは残り、右ペインなどは覆われて見えなくなる)。
    <div
      ref={panelRef}
      className={`karte-tabpanel vital-flowsheet${fullscreen ? " vital-flowsheet--fullscreen" : ""}`}
      style={fullscreen ? { top: fullscreenTop } : undefined}
    >
      <ErrorBanner
        error={error ?? encounters.error ?? surgeries.error ?? examOrders.error}
      />

      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <div className="lab-timeline__controls">
            <label className="lab-timeline__count">
              履歴の表示数
              <input
                type="number"
                min={1}
                max={MAX_COLUMN_COUNT}
                value={columnCount}
                onChange={(e) => handleColumnCountChange(e.target.valueAsNumber)}
              />
            </label>
            <span className="lab-timeline__hint" />
            <button type="button" onClick={() => setFullscreen((prev) => !prev)}>
              {fullscreen ? "全画面を終了" : "全画面"}
            </button>
          </div>

          {flowsheet.rows.length === 0 ? (
            <p className="patient-table__empty">バイタルの記録がありません</p>
          ) : (
            <div className="lab-timeline__table-wrap">
              <table className="lab-timeline__table vital-flowsheet__table">
                <thead>
                  {/* 列は測定 1 回。同じ日の朝夕を潰さないよう、日付の下に時刻を出す。
                      末尾の空列は余白を吸収する(測定列の幅を固定してグラフと揃えるため)。 */}
                  <tr>
                    <th className="lab-timeline__item-col" rowSpan={3}>
                      測定項目
                    </th>
                    <th className="lab-timeline__unit-col" rowSpan={3}>
                      単位
                    </th>
                    {yearGroups.map((group) => (
                      <th
                        key={group.columns[0]}
                        className="lab-timeline__year-col"
                        colSpan={group.columns.length}
                      >
                        {group.label}年
                      </th>
                    ))}
                    <th className="vital-flowsheet__filler" rowSpan={headerRowSpan} />
                  </tr>
                  <tr>
                    {dateGroups.map((group) => (
                      <th
                        key={group.columns[0]}
                        className="lab-timeline__date-col vital-flowsheet__date-col"
                        colSpan={group.columns.length}
                        title={group.columns.join("\n")}
                      >
                        {flowsheetColumnLabel(group.columns[0]).date}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {columns.map((at) => (
                      <th key={at} className="vital-flowsheet__time-col" title={at}>
                        {flowsheetColumnLabel(at).time}
                      </th>
                    ))}
                  </tr>
                  {/* 病日・術後日数。入院・手術があるときだけ行を出す。見出しの中に
                      置いてあるので、縦に送っても列の日付と一緒に残る。 */}
                  {showHospitalDays && (
                    <tr>
                      <th className="lab-timeline__item-col vital-flowsheet__day-head">病日</th>
                      <th className="lab-timeline__unit-col" />
                      {columns.map((at, index) => (
                        <th key={at} className="vital-flowsheet__day-col" title="入院からの日数">
                          {hospitalDayLabel(hospitalDays[index])}
                        </th>
                      ))}
                    </tr>
                  )}
                  {showPostOpDays && (
                    <tr>
                      <th className="lab-timeline__item-col vital-flowsheet__day-head">術後</th>
                      <th className="lab-timeline__unit-col" />
                      {columns.map((at, index) => (
                        <th key={at} className="vital-flowsheet__day-col" title="手術からの日数">
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
                  {/* イベントの帯。グラフの真上に置き、同じ x にグラフの縦線を落とす。
                      イベントが 1 件も無ければ行ごと出さない。 */}
                  {eventGroups.length > 0 && (
                    <tr className="vital-flowsheet__event-row">
                      <th
                        className="lab-timeline__item-col vital-flowsheet__event-head"
                        colSpan={2}
                      >
                        イベント
                      </th>
                      <td className="vital-flowsheet__event-cell" colSpan={columns.length}>
                        <FlowsheetEventBand columns={columns} groups={eventGroups} />
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
                        series={chartSeries}
                        eventSlots={eventGroups.map((group) => group.slot)}
                      />
                    </td>
                    <td className="vital-flowsheet__filler" />
                  </tr>
                </tbody>
                <tbody>
                  {flowsheet.rows.map((row) => (
                    <tr key={row.key}>
                      {/* 項目列・単位列は幅固定で左に貼り付く(CSS)。長い項目名は省略されるので title で。 */}
                      <td className="lab-timeline__item-col" title={row.name}>
                        <span className="lab-timeline__item-label">{row.name}</span>
                      </td>
                      <td className="lab-timeline__unit-col">{row.unit}</td>
                      {columns.map((at) => (
                        // 列幅は固定なので、長い文字値(観察結果)は省略される。全文は title で。
                        // 異常値は検査結果の時系列表示と同じ修飾子(--high / --low)で色付けする。
                        <td
                          key={at}
                          className={interpretationClass(
                            row.interpretations.get(at) ?? "",
                            "lab-timeline__value",
                          )}
                          title={row.values.get(at)}
                        >
                          {row.values.get(at) ?? ""}
                        </td>
                      ))}
                      <td className="vital-flowsheet__filler" />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---- イベントの帯 ----

/** 1 つの境目に積むラベルの上限。これを超えたら最後の行を「他N件」にする。 */
const EVENT_LABEL_ROWS = 3;
const EVENT_ROW_HEIGHT = 13;
/** ▼ とラベルの間。 */
const EVENT_MARK_HEIGHT = 12;
/** ラベルの文字数の上限。列幅(64px)に収まる長さで丸め、全文は title に出す。 */
const EVENT_LABEL_CHARS = 5;

function truncateLabel(label: string): string {
  return label.length > EVENT_LABEL_CHARS ? `${label.slice(0, EVENT_LABEL_CHARS)}…` : label;
}

function eventTitle(event: FlowsheetEvent): string {
  // 日付だけで登録されたイベント(検査オーダー・入院日など)には時刻を出さない。
  // 日付は localDateOf で出す(flowsheetColumnLabel は日付だけの値を UTC 0 時と
  // 読むので、時差によっては前日にずれる)。
  const hasTime = !/^\d{4}-\d{2}-\d{2}$/.test(event.at);
  const date = localDateOf(event.at).slice(5).replace("-", "/");
  const when = [date, hasTime ? flowsheetColumnLabel(event.at).time : ""]
    .filter(Boolean)
    .join(" ");
  const name = event.count > 1 ? `${event.label}×${event.count}` : event.label;
  return [name, event.detail].filter(Boolean).join(" ") + (when ? ` (${when})` : "");
}

/**
 * イベントの帯。列は等間隔で時間に比例しないので、イベントは列の**境目**に置く
 * (列の中央に置くと、その測定のときに起きたように見えてしまう)。
 * 同じ境目に集まったイベントはラベルを縦に積む。
 */
function FlowsheetEventBand({
  columns,
  groups,
}: {
  columns: string[];
  groups: FlowsheetEventGroup[];
}) {
  const width = columns.length * FLOWSHEET_COLUMN_WIDTH;
  const rows = Math.min(
    EVENT_LABEL_ROWS,
    Math.max(1, ...groups.map((group) => group.labels.length)),
  );
  const height = EVENT_MARK_HEIGHT + rows * EVENT_ROW_HEIGHT;

  return (
    <svg
      className="vital-flowsheet__event-band"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="入退院・手術・検査のイベント"
    >
      {groups.map((group) => {
        const x = group.slot * FLOWSHEET_COLUMN_WIDTH;
        // 4 種類以上あるときは 2 行だけ出し、残りを最後の行にまとめる。
        const overflow = group.labels.length > EVENT_LABEL_ROWS;
        const shown = overflow ? group.labels.slice(0, EVENT_LABEL_ROWS - 1) : group.labels;
        // 端の境目はラベルが SVG からはみ出すので、寄せ方を変える。
        const anchor = x <= 0 ? "start" : x >= width ? "end" : "middle";
        return (
          <g
            key={group.slot}
            className={`vital-flowsheet__event vital-flowsheet__event--${group.labels[0].kind}`}
          >
            <title>{group.events.map(eventTitle).join("\n")}</title>
            <path
              className="vital-flowsheet__event-mark"
              d={`M${x - 4},2 L${x + 4},2 L${x},9 Z`}
            />
            {shown.map((label, index) => (
              <text
                key={label.text}
                className={`vital-flowsheet__event-label vital-flowsheet__event-label--${label.kind}`}
                x={x}
                y={EVENT_MARK_HEIGHT + (index + 1) * EVENT_ROW_HEIGHT - 3}
                textAnchor={anchor}
              >
                {truncateLabel(label.text)}
              </text>
            ))}
            {overflow && (
              <text
                className="vital-flowsheet__event-label vital-flowsheet__event-label--more"
                x={x}
                y={EVENT_MARK_HEIGHT + EVENT_LABEL_ROWS * EVENT_ROW_HEIGHT - 3}
                textAnchor={anchor}
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

// ---- グラフ(温度板) ----

/** 測定列 1 つの幅(px)。表のセル幅(CSS の .vital-flowsheet__table)と一致させること。 */
export const FLOWSHEET_COLUMN_WIDTH = 64;
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
  series,
  eventSlots,
}: {
  columns: string[];
  series: ChartSeries[];
  /** イベントの帯の ▼ と同じ位置に落とす縦線(列の境目)。 */
  eventSlots: number[];
}) {
  const width = columns.length * FLOWSHEET_COLUMN_WIDTH;
  const xOf = (index: number) => (index + 0.5) * FLOWSHEET_COLUMN_WIDTH;
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
      {columns.map((at, index) => (
        <line
          key={at}
          className="vital-flowsheet__grid vital-flowsheet__grid--column"
          x1={(index + 1) * FLOWSHEET_COLUMN_WIDTH}
          x2={(index + 1) * FLOWSHEET_COLUMN_WIDTH}
          y1={0}
          y2={CHART_HEIGHT}
        />
      ))}
      {/* イベントの縦線。帯の ▼ から折れ線まで目で追えるよう、破線で通す。 */}
      {eventSlots.map((slot) => (
        <line
          key={`event-${slot}`}
          className="vital-flowsheet__grid vital-flowsheet__grid--event"
          x1={slot * FLOWSHEET_COLUMN_WIDTH}
          x2={slot * FLOWSHEET_COLUMN_WIDTH}
          y1={0}
          y2={CHART_HEIGHT}
        />
      ))}
      {series.map((s) => {
        const points = columns.flatMap((at, index) => {
          const value = s.numbers.get(at);
          return value == null ? [] : [{ at, value, x: xOf(index), y: yOf(s, value) }];
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
