import { useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useAuthSession } from "../api/authQueries";
import {
  useAnesthesiaChart,
  useAnesthesiaChartWrite,
  usePractitioner,
  useSurgeryOrderDetail,
} from "../api/queries";
import type { Medicine } from "../api/masterClient";
import { ErrorBanner } from "./ErrorBanner";
import { MedicineSearchModal } from "./MedicineSearchModal";
import { PatientHeader } from "./PatientHeader";
import {
  CHART_EVENT_OPTIONS,
  CHART_MEASURES,
  SURGERY_ROUTE_OPTIONS,
  buildAnesthesiaChartDeleteEntries,
  buildAnesthesiaChartHub,
  buildChartDrugAdministration,
  buildChartEventObservation,
  buildChartVitalObservations,
  finishChartInfusion,
  type AnesthesiaChartData,
  type ChartDrugFormValues,
  type ChartMeasureKey,
  type ChartVitalPoint,
} from "../fhir/anesthesiaChartHelpers";
import { toDateTimeInput, toFhirDateTime } from "../fhir/clinicalNoteHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { serviceRequestsOf } from "../fhir/labOrderHelpers";
import {
  summarizeSurgeryOrder,
  surgeryOrderItemRequests,
  surgeryOrderItems,
} from "../fhir/surgeryOrderHelpers";

// 麻酔チャート(術中リアルタイム記録)の中身。docs/anesthesia-chart-design.md。
//
// 手術中に開きっぱなしにする使い方が主なので本体は専用ページ
// (/surgeries/:orderId/anesthesia-chart)だが、カルテからも同じものを
// モーダルで開けるよう、中身をこのパネルに切り出してある。
// 記録は追加のたびに保存され、確定(ハブ completed)後は閲覧のみになる。

/** datetime-local に入れる現在時刻。 */
function nowInput(): string {
  return toDateTimeInput(new Date());
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L12 4M6.5 6.5v5M9.5 6.5v5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 行を消すボタン。イベント・薬剤で同じ見た目・同じ意味なのでまとめる。 */
function RemoveRowButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      className="rp-card__icon-button"
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      <TrashIcon />
    </button>
  );
}

/**
 * 時刻の入力欄。記録は「今」を打つことがほとんどなので、開いている間に古く
 * なった既定値を押し直せるボタンを添える。
 */
function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {label}
      <span className="anes-chart__time-field">
        <input
          type="datetime-local"
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="anes-chart__now"
          title="現在時刻を入れる"
          onClick={() => onChange(nowInput())}
        >
          現在
        </button>
      </span>
    </label>
  );
}

function postEntry(resource: fhir4.Resource): fhir4.BundleEntry {
  return { resource, request: { method: "POST", url: resource.resourceType } };
}

function putEntry<T extends fhir4.Resource & { id?: string }>(resource: T): fhir4.BundleEntry {
  return {
    resource,
    request: { method: "PUT", url: `${resource.resourceType}/${resource.id}` },
  };
}

interface AnesthesiaChartPanelProps {
  orderId: string | undefined;
  /** 患者ヘッダ(氏名・ID)を出すか。カルテから開くときは要らない。 */
  showPatientHeader?: boolean;
}

export function AnesthesiaChartPanel({ orderId, showPatientHeader }: AnesthesiaChartPanelProps) {
  const detail = useSurgeryOrderDetail(orderId);
  const chart = useAnesthesiaChart(orderId);
  const write = useAnesthesiaChartWrite(orderId);

  const requests = serviceRequestsOf(detail.data?.data);
  const order = requests.find((request) => request.id === orderId);
  const items = order
    ? surgeryOrderItems(order, surgeryOrderItemRequests(requests, orderId ?? ""))
    : [];
  const patientId = order?.subject?.reference?.match(/^Patient\/(.+)$/)?.[1];

  // チャート開始時の麻酔担当 = ログイン中の医療従事者。
  const session = useAuthSession();
  const loginPractitionerId = session.data?.user?.practitioner_id ?? undefined;
  const loginPractitioner = usePractitioner(loginPractitionerId);

  const data = chart.data ?? null;
  const summary = order ? summarizeSurgeryOrder(order) : null;

  function startChart() {
    if (!patientId || !orderId) return;
    const practitioner = loginPractitioner.data?.data;
    write.mutate([
      postEntry(
        buildAnesthesiaChartHub({
          patientId,
          orderId,
          practitionerId: loginPractitionerId,
          practitionerName: practitioner ? practitionerDisplayName(practitioner) : undefined,
        }),
      ),
    ]);
  }

  function finalizeChart() {
    if (!data) return;
    write.mutate([
      putEntry({
        ...data.hub,
        status: "completed",
        performedPeriod: { ...data.hub.performedPeriod, end: toFhirDateTime(nowInput()) },
      }),
    ]);
  }

  function reopenChart() {
    if (!data) return;
    const period = { ...data.hub.performedPeriod };
    delete period.end;
    write.mutate([putEntry({ ...data.hub, status: "in-progress", performedPeriod: period })]);
  }

  function cancelChart() {
    if (!data) return;
    if (!window.confirm("麻酔チャートを取り消します。記録した打点・イベント・薬剤もすべて削除されます。よろしいですか?")) {
      return;
    }
    write.mutate(buildAnesthesiaChartDeleteEntries(data));
  }

  return (
    <>
      {showPatientHeader && <PatientHeader patientId={patientId} />}
      <ErrorBanner error={detail.error} />
      <ErrorBanner error={chart.error} />
      <ErrorBanner error={write.error} />

      {summary && (
        <p className="anes-chart__order">
          {items[0] ? `${items[0].name}` : "術式未登録"}
          {summary.roomName ? ` | ${summary.roomName}` : ""}
          {summary.scheduledDate
            ? ` | 予定 ${summary.scheduledDate} ${summary.scheduledTime}`
            : " | 日程未定"}
          {data?.performerName ? ` | 麻酔担当: ${data.performerName}` : ""}
          {data && (
            <span
              className={`rad-worklist__status rad-worklist__status--${data.readOnly ? "completed" : "in-progress"}`}
            >
              {data.readOnly ? "確定済" : "記録中"}
            </span>
          )}
        </p>
      )}

      {detail.isLoading || chart.isLoading ? (
        <p>読み込み中...</p>
      ) : !order ? (
        !detail.error && <p className="patient-table__empty">手術オーダーが見つかりません。</p>
      ) : !data ? (
        <div className="anes-chart__empty">
          <p>このオーダーの麻酔チャートはまだありません。</p>
          <button type="button" onClick={startChart} disabled={write.isPending}>
            チャート開始
          </button>
        </div>
      ) : (
        <ChartBody
          data={data}
          patientId={patientId ?? ""}
          write={write}
          onFinalize={finalizeChart}
          onReopen={reopenChart}
          onCancel={cancelChart}
        />
      )}
    </>
  );
}

interface ChartBodyProps {
  data: AnesthesiaChartData;
  patientId: string;
  write: ReturnType<typeof useAnesthesiaChartWrite>;
  onFinalize: () => void;
  onReopen: () => void;
  onCancel: () => void;
}

function ChartBody({ data, patientId, write, onFinalize, onReopen, onCancel }: ChartBodyProps) {
  const hubId = data.hub.id ?? "";
  const readOnly = data.readOnly;

  return (
    <>
      <ChartPlot data={data} />
      <VitalsSection
        data={data}
        readOnly={readOnly}
        onAdd={(values) => {
          const observations = buildChartVitalObservations(values, patientId, hubId);
          if (observations.length) write.mutate(observations.map(postEntry));
        }}
        onDeletePoint={(point) => {
          if (!window.confirm(`${point.time.slice(11, 16)} の打点を削除しますか?`)) return;
          write.mutate(
            point.observationIds.map((id) => ({
              request: { method: "DELETE" as const, url: `Observation/${id}` },
            })),
          );
        }}
      />
      <EventsSection
        data={data}
        readOnly={readOnly}
        onAdd={(code, occurredAt, note) =>
          write.mutate([
            postEntry(buildChartEventObservation({ patientId, hubId, code, occurredAt, note })),
          ])
        }
        onDelete={(id, label) => {
          if (!window.confirm(`イベント「${label}」を削除しますか?`)) return;
          write.mutate([{ request: { method: "DELETE", url: `Observation/${id}` } }]);
        }}
      />
      <DrugsSection
        data={data}
        readOnly={readOnly}
        onAdd={(values) =>
          write.mutate([postEntry(buildChartDrugAdministration(values, patientId, hubId))])
        }
        onFinish={(line) =>
          write.mutate([putEntry(finishChartInfusion(line.administration, nowInput()))])
        }
        onDelete={(line) => {
          if (!window.confirm(`薬剤「${line.name}」の記録を削除しますか?`)) return;
          write.mutate([
            { request: { method: "DELETE", url: `MedicationAdministration/${line.id}` } },
          ]);
        }}
      />

      <div className="anes-chart__footer">
        {readOnly ? (
          <button type="button" onClick={onReopen} disabled={write.isPending}>
            再開(確定を解除)
          </button>
        ) : (
          <>
            <button type="button" onClick={onFinalize} disabled={write.isPending}>
              確定
            </button>
            <button
              type="button"
              className="anes-chart__danger"
              onClick={onCancel}
              disabled={write.isPending}
            >
              チャートを取消
            </button>
          </>
        )}
      </div>
    </>
  );
}

// ---- グラフ ----

const PLOT = {
  height: 292,
  top: 46, // イベント帯(ラベルを 2 段に振るぶんの高さを見ている)
  bottom: 22, // 時刻ラベル
  left: 34,
  right: 16,
  yMax: 220,
};

/**
 * 横軸の目盛り。手術は 30 分で終わるものから 8 時間を超えるものまであり、
 * 1 分あたりの幅を固定すると短い手術は左端に潰れ、長い手術は延々と横に伸びる。
 * 記録しながら切り替えられるよう選択式にした(既定は 5 分グリッドが読める広さ)。
 *
 * "fit" は 1 分あたりの幅を決めず、記録の全体が画面幅にちょうど収まるよう
 * その場で計算する(pxPerMin: null)。短い手術で枠が左に縮むのも、長い手術で
 * 横スクロールが要るのも避けられる。
 */
const PLOT_SCALES = [
  { key: "wide", label: "広く", pxPerMin: 1.5 },
  { key: "normal", label: "標準", pxPerMin: 4 },
  { key: "zoom", label: "拡大", pxPerMin: 10 },
  { key: "fit", label: "全画面", pxPerMin: null },
] as const;

type PlotScaleKey = (typeof PLOT_SCALES)[number]["key"];

/**
 * グリッドと時刻ラベルの間隔。1 分あたりの幅から決めるので、"全画面" で
 * 幅が変わっても目盛りが詰まりすぎない。
 */
function gridSpec(pxPerMin: number): { gridMinutes: number; labelMinutes: number } {
  if (pxPerMin >= 8) return { gridMinutes: 5, labelMinutes: 15 };
  if (pxPerMin >= 3) return { gridMinutes: 5, labelMinutes: 30 };
  return { gridMinutes: 15, labelMinutes: 60 };
}

/** "YYYY-MM-DDTHH:mm" → 分(ローカル)。 */
function minutesOf(time: string): number {
  return new Date(time).getTime() / 60000;
}

/**
 * 記号の凡例。グラフと同じクラスで同じ形・同じ色を描くので、色や記号を
 * 変えたときに凡例だけ取り残されることがない。
 */
function PlotLegend() {
  return (
    <span className="anes-chart__legend">
      <span className="anes-chart__legend-item">
        <svg width="16" height="12" aria-hidden="true" focusable="false">
          <path d="M3 4 L8 9 L13 4" className="anes-plot__bp" />
        </svg>
        収縮期
      </span>
      <span className="anes-chart__legend-item">
        <svg width="16" height="12" aria-hidden="true" focusable="false">
          <path d="M3 8 L8 3 L13 8" className="anes-plot__bp" />
        </svg>
        拡張期
      </span>
      <span className="anes-chart__legend-item">
        <svg width="16" height="12" aria-hidden="true" focusable="false">
          <line x1="1" y1="6" x2="15" y2="6" className="anes-plot__pulse-line" />
          <circle cx="8" cy="6" r="3" className="anes-plot__pulse" />
        </svg>
        脈拍
      </span>
      <span className="anes-chart__legend-item">
        <svg width="16" height="12" aria-hidden="true" focusable="false">
          <line x1="8" y1="2" x2="8" y2="11" className="anes-plot__event-line" />
          <text x="8" y="7" textAnchor="middle" className="anes-plot__event">
            ▼
          </text>
        </svg>
        イベント
      </span>
    </span>
  );
}

function ChartPlot({ data }: { data: AnesthesiaChartData }) {
  const [scaleKey, setScaleKey] = useState<PlotScaleKey>("normal");
  const scale = PLOT_SCALES.find((s) => s.key === scaleKey) ?? PLOT_SCALES[1];
  const fit = scale.pxPerMin === null;

  // "全画面" は置ける幅から 1 分あたりの幅を逆算するので、実際の幅を測る。
  // 初回は同期で測る(ResizeObserver の初回配信を待つと、標準の幅で 1 度描いて
  // から飛ぶ)。以後の追従は observer に任せる。fit の切り替えでコンテナの
  // 幅指定自体が変わるので、そのたびに測り直す。
  const wrapRef = useRef<HTMLDivElement>(null);
  const [wrapWidth, setWrapWidth] = useState(0);
  useLayoutEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    setWrapWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => setWrapWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [fit]);

  const model = useMemo(() => {
    // 軸は「記録がある範囲」で決める。ハブの開始や「今」まで伸ばすと、
    // 記録を止めている間や退室後に開いたときに余白ばかりの軸になる。
    const times = [
      ...data.vitals.map((p) => p.time),
      ...data.events.map((e) => e.time),
      ...data.drugs.map((d) => d.time),
      ...data.drugs.map((d) => d.endTime),
    ]
      .map((t) => t.slice(0, 16))
      .filter(Boolean)
      .map(minutesOf)
      .filter(Number.isFinite);
    // 記録が 1 件も無いうちは、開始時刻から先の 30 分ぶんを枠として見せる。
    if (!times.length) {
      const start = minutesOf(toDateTimeInput(data.hub.performedPeriod?.start).slice(0, 16));
      if (!Number.isFinite(start)) return null;
      const min = Math.floor(start / 5) * 5;
      return { min, max: min + 30 };
    }

    const min = Math.floor(Math.min(...times) / 5) * 5;
    // 記録中は右に少し余白を足す(次の打点を置く先が見えるように)。
    const pad = data.readOnly ? 5 : 15;
    const max = Math.max(Math.ceil((Math.max(...times) + pad) / 5) * 5, min + 30);
    return { min, max };
  }, [data]);

  if (!model) return null;

  const span = model.max - model.min;
  // 全画面のときだけ、置ける幅に収まる 1 分あたりの幅にする(幅を測る前の
  // 初回描画では標準の幅で描いておき、測れ次第 1 度だけ描き直す)。
  const pxPerMin =
    scale.pxPerMin ??
    (wrapWidth > 0 ? Math.max(0.3, (wrapWidth - PLOT.left - PLOT.right) / span) : 4);
  const { gridMinutes, labelMinutes } = gridSpec(pxPerMin);
  const width = PLOT.left + PLOT.right + span * pxPerMin;
  const plotH = PLOT.height - PLOT.top - PLOT.bottom;
  const x = (time: string) => PLOT.left + (minutesOf(time) - model.min) * pxPerMin;
  const y = (value: number) =>
    PLOT.top + plotH - (Math.min(value, PLOT.yMax) / PLOT.yMax) * plotH;

  const gridX: { minute: number; major: boolean }[] = [];
  for (let m = model.min; m <= model.max; m += gridMinutes) {
    gridX.push({ minute: m, major: m % labelMinutes === 0 });
  }
  const gridY: number[] = [];
  for (let v = 0; v <= PLOT.yMax; v += 20) gridY.push(v);

  const minuteX = (minute: number) => PLOT.left + (minute - model.min) * pxPerMin;
  const timeLabel = (minute: number) => {
    const date = new Date(minute * 60000);
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  };

  const pulseLine = data.vitals
    .filter((p) => p.values.pulse != null)
    .map((p) => `${x(p.time)},${y(p.values.pulse ?? 0)}`)
    .join(" ");

  return (
    <>
      <div className="anes-chart__plot-bar">
        <span>横軸</span>
        {PLOT_SCALES.map((option) => (
          <button
            key={option.key}
            type="button"
            className={
              option.key === scaleKey
                ? "anes-chart__scale anes-chart__scale--active"
                : "anes-chart__scale"
            }
            onClick={() => setScaleKey(option.key)}
          >
            {option.label}
          </button>
        ))}
        <PlotLegend />
      </div>
      <div
        ref={wrapRef}
        className={
          fit ? "anes-chart__plot-scroll anes-chart__plot-scroll--fit" : "anes-chart__plot-scroll"
        }
      >
      <svg
        className="anes-chart__plot"
        width={width}
        height={PLOT.height}
        viewBox={`0 0 ${width} ${PLOT.height}`}
        role="img"
        aria-label="麻酔チャート(血圧・脈拍)"
      >
        {/* 目盛り */}
        {gridY.map((v) => (
          <g key={v}>
            <line
              x1={PLOT.left}
              y1={y(v)}
              x2={width - PLOT.right}
              y2={y(v)}
              className={v % 40 === 0 ? "anes-plot__grid--major" : "anes-plot__grid"}
            />
            {v % 40 === 0 && (
              <text x={PLOT.left - 6} y={y(v) + 3} className="anes-plot__ylabel">
                {v}
              </text>
            )}
          </g>
        ))}
        {gridX.map(({ minute, major }) => (
          <g key={minute}>
            <line
              x1={minuteX(minute)}
              y1={PLOT.top}
              x2={minuteX(minute)}
              y2={PLOT.height - PLOT.bottom}
              className={major ? "anes-plot__grid--major" : "anes-plot__grid"}
            />
            {major && (
              <text
                x={minuteX(minute)}
                y={PLOT.height - 8}
                textAnchor="middle"
                className="anes-plot__xlabel"
              >
                {timeLabel(minute)}
              </text>
            )}
          </g>
        ))}

        {/* イベント(上端の帯)。麻酔開始と挿管のように数分差で続くことがあり、
            ラベルを同じ高さに置くと重なって読めない。前のラベルと近ければ
            1 段下げる(2 段で足りない密度は「拡大」で開いてもらう)。 */}
        {(() => {
          // ラベルは中央揃えなので、隣り合う 2 つが触れるかは「前の半分 + 自分の
          // 半分」で決まる。文字幅はフォントサイズ(10px)を全角 1 文字として見る。
          const halfWidthOf = (text: string) => (text.length * 10) / 2;
          let previousX = -Infinity;
          let previousHalf = 0;
          let previousRow = 1;
          return data.events.map((event) => {
            const eventX = x(event.time);
            const text = event.code === "other" && event.note ? event.note : event.label;
            const half = halfWidthOf(text);
            const row = eventX - previousX < previousHalf + half + 4 ? 1 - previousRow : 0;
            previousX = eventX;
            previousHalf = half;
            previousRow = row;
            return (
              <g key={event.id}>
                <line
                  x1={eventX}
                  y1={PLOT.top}
                  x2={eventX}
                  y2={PLOT.height - PLOT.bottom}
                  className="anes-plot__event-line"
                />
                <text x={eventX} y={12} textAnchor="middle" className="anes-plot__event">
                  ▼
                </text>
                <text
                  x={eventX}
                  y={26 + row * 13}
                  textAnchor="middle"
                  className="anes-plot__event-label"
                >
                  {text}
                </text>
              </g>
            );
          });
        })()}

        {/* 脈拍(折れ線 + ●) */}
        {pulseLine && <polyline points={pulseLine} className="anes-plot__pulse-line" />}
        {data.vitals.map((point) =>
          point.values.pulse != null ? (
            <circle
              key={`hr-${point.time}`}
              cx={x(point.time)}
              cy={y(point.values.pulse)}
              r={3}
              className="anes-plot__pulse"
            />
          ) : null,
        )}

        {/* 血圧(∨ = 収縮期 / ∧ = 拡張期。紙の麻酔チャートと同じ記号) */}
        {data.vitals.map((point) => (
          <g key={`bp-${point.time}`}>
            {point.systolic != null && (
              <path
                d={`M ${x(point.time) - 5} ${y(point.systolic) - 5} L ${x(point.time)} ${y(point.systolic)} L ${x(point.time) + 5} ${y(point.systolic) - 5}`}
                className="anes-plot__bp"
              />
            )}
            {point.diastolic != null && (
              <path
                d={`M ${x(point.time) - 5} ${y(point.diastolic) + 5} L ${x(point.time)} ${y(point.diastolic)} L ${x(point.time) + 5} ${y(point.diastolic) + 5}`}
                className="anes-plot__bp"
              />
            )}
          </g>
        ))}
      </svg>
      </div>
    </>
  );
}

// ---- バイタル表 ----

interface VitalsSectionProps {
  data: AnesthesiaChartData;
  readOnly: boolean;
  onAdd: (values: {
    measuredAt: string;
    systolic: string;
    diastolic: string;
    values: Partial<Record<ChartMeasureKey, string>>;
  }) => void;
  onDeletePoint: (point: ChartVitalPoint) => void;
}

function VitalsSection({ data, readOnly, onAdd, onDeletePoint }: VitalsSectionProps) {
  const [measuredAt, setMeasuredAt] = useState(nowInput);
  const [systolic, setSystolic] = useState("");
  const [diastolic, setDiastolic] = useState("");
  const [values, setValues] = useState<Partial<Record<ChartMeasureKey, string>>>({});

  function submit(event: FormEvent) {
    event.preventDefault();
    onAdd({ measuredAt, systolic, diastolic, values });
    setSystolic("");
    setDiastolic("");
    setValues({});
    setMeasuredAt(nowInput());
  }

  return (
    <fieldset className="anes-chart__section">
      <legend>バイタル</legend>
      {data.vitals.length === 0 ? (
        <p className="patient-table__empty">打点はまだありません。</p>
      ) : (
        <div className="anes-chart__table-scroll">
          <table className="anes-chart__table">
            <thead>
              <tr>
                <th></th>
                {data.vitals.map((point) => (
                  <th key={point.time}>
                    {point.time.slice(11, 16)}
                    {!readOnly && (
                      <button
                        type="button"
                        className="anes-chart__cell-delete"
                        title="この時点の打点を削除"
                        onClick={() => onDeletePoint(point)}
                      >
                        ×
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>血圧</th>
                {data.vitals.map((point) => (
                  <td key={point.time}>
                    {point.systolic != null && point.diastolic != null
                      ? `${point.systolic}/${point.diastolic}`
                      : ""}
                  </td>
                ))}
              </tr>
              {CHART_MEASURES.map((measure) => (
                <tr key={measure.key}>
                  <th>{measure.label}</th>
                  {data.vitals.map((point) => (
                    <td key={point.time}>{point.values[measure.key] ?? ""}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!readOnly && (
        <form className="anes-chart__entry" onSubmit={submit}>
          <TimeField label="時刻" value={measuredAt} onChange={setMeasuredAt} />
          <label>
            血圧
            <span className="anes-chart__bp-pair">
              <input
                type="number"
                step="1"
                placeholder="収縮"
                value={systolic}
                onChange={(e) => setSystolic(e.target.value)}
              />
              /
              <input
                type="number"
                step="1"
                placeholder="拡張"
                value={diastolic}
                onChange={(e) => setDiastolic(e.target.value)}
              />
            </span>
          </label>
          {CHART_MEASURES.map((measure) => (
            <label key={measure.key}>
              {measure.label}
              <input
                type="number"
                step={measure.step}
                value={values[measure.key] ?? ""}
                onChange={(e) =>
                  setValues((current) => ({ ...current, [measure.key]: e.target.value }))
                }
              />
            </label>
          ))}
          <button type="submit">追加</button>
        </form>
      )}
    </fieldset>
  );
}

// ---- イベント ----

interface EventsSectionProps {
  data: AnesthesiaChartData;
  readOnly: boolean;
  onAdd: (code: string, occurredAt: string, note: string) => void;
  onDelete: (id: string, label: string) => void;
}

function EventsSection({ data, readOnly, onAdd, onDelete }: EventsSectionProps) {
  const [code, setCode] = useState<string>(CHART_EVENT_OPTIONS[0].code);
  const [occurredAt, setOccurredAt] = useState(nowInput);
  const [note, setNote] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    onAdd(code, occurredAt, note);
    setNote("");
    setOccurredAt(nowInput());
  }

  return (
    <fieldset className="anes-chart__section">
      <legend>イベント</legend>
      {data.events.length === 0 ? (
        <p className="patient-table__empty">イベントはまだありません。</p>
      ) : (
        <ul className="anes-chart__list">
          {data.events.map((event) => (
            <li key={event.id}>
              <span className="anes-chart__list-time">{event.time.slice(11, 16)}</span>
              <span>{event.label}</span>
              {event.note && <span className="anes-chart__list-note">{event.note}</span>}
              {!readOnly && (
                <RemoveRowButton title="削除" onClick={() => onDelete(event.id, event.label)} />
              )}
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <form className="anes-chart__entry" onSubmit={submit}>
          <TimeField label="時刻" value={occurredAt} onChange={setOccurredAt} />
          <label>
            種別
            <select value={code} onChange={(e) => setCode(e.target.value)}>
              {CHART_EVENT_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.display}
                </option>
              ))}
            </select>
          </label>
          <label>
            メモ
            <input
              type="text"
              value={note}
              required={code === "other"}
              placeholder={code === "other" ? "内容(必須)" : "任意"}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button type="submit">追加</button>
        </form>
      )}
    </fieldset>
  );
}

// ---- 薬剤 ----

interface DrugsSectionProps {
  data: AnesthesiaChartData;
  readOnly: boolean;
  onAdd: (values: ChartDrugFormValues) => void;
  onFinish: (line: AnesthesiaChartData["drugs"][number]) => void;
  onDelete: (line: AnesthesiaChartData["drugs"][number]) => void;
}

function DrugsSection({ data, readOnly, onAdd, onFinish, onDelete }: DrugsSectionProps) {
  const [searching, setSearching] = useState(false);
  const [draft, setDraft] = useState<ChartDrugFormValues | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    onAdd(draft);
    setDraft(null);
  }

  return (
    <fieldset className="anes-chart__section">
      <legend>薬剤</legend>
      {data.drugs.length === 0 ? (
        <p className="patient-table__empty">薬剤はまだありません。</p>
      ) : (
        <ul className="anes-chart__list">
          {data.drugs.map((line) => (
            <li key={line.id}>
              <span className="anes-chart__list-time">
                {line.time.slice(11, 16)}
                {line.mode === "infusion" &&
                  ` 〜 ${line.running ? "投与中" : line.endTime.slice(11, 16)}`}
              </span>
              <span>{line.name}</span>
              <span className="anes-chart__list-note">
                {line.mode === "bolus" ? "単回" : "持続"}
                {line.doseLabel ? ` ${line.doseLabel}` : ""}
              </span>
              {!readOnly && line.running && (
                <button type="button" onClick={() => onFinish(line)}>
                  終了
                </button>
              )}
              {!readOnly && <RemoveRowButton title="削除" onClick={() => onDelete(line)} />}
            </li>
          ))}
        </ul>
      )}

      {!readOnly && !draft && (
        <button type="button" onClick={() => setSearching(true)}>
          薬剤を追加
        </button>
      )}

      {draft && (
        <form className="anes-chart__entry" onSubmit={submit}>
          <span className="anes-chart__drug-name">{draft.name}</span>
          <label>
            投与
            <select
              value={draft.mode}
              onChange={(e) =>
                setDraft({ ...draft, mode: e.target.value as ChartDrugFormValues["mode"] })
              }
            >
              <option value="bolus">単回</option>
              <option value="infusion">持続</option>
            </select>
          </label>
          {draft.mode === "bolus" ? (
            <label>
              量
              <span className="anes-chart__bp-pair">
                <input
                  type="number"
                  step="0.01"
                  value={draft.dose}
                  onChange={(e) => setDraft({ ...draft, dose: e.target.value })}
                />
                {draft.unitName}
              </span>
            </label>
          ) : (
            <label>
              速度
              <span className="anes-chart__bp-pair">
                <input
                  type="number"
                  step="0.1"
                  value={draft.rate}
                  onChange={(e) => setDraft({ ...draft, rate: e.target.value })}
                />
                <input
                  type="text"
                  className="anes-chart__unit-input"
                  placeholder="mL/h"
                  value={draft.rateUnit}
                  onChange={(e) => setDraft({ ...draft, rateUnit: e.target.value })}
                />
              </span>
            </label>
          )}
          <label>
            経路
            <select
              value={draft.routeCode}
              onChange={(e) => setDraft({ ...draft, routeCode: e.target.value })}
            >
              <option value="">未指定</option>
              {SURGERY_ROUTE_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.display}
                </option>
              ))}
            </select>
          </label>
          <TimeField
            label={draft.mode === "bolus" ? "時刻" : "開始"}
            value={draft.givenAt}
            onChange={(givenAt) => setDraft({ ...draft, givenAt })}
          />
          <button type="submit">追加</button>
          <button type="button" onClick={() => setDraft(null)}>
            やめる
          </button>
        </form>
      )}

      {searching && (
        <MedicineSearchModal
          title="薬剤を選択"
          onSelect={(medicine: Medicine) => {
            setSearching(false);
            setDraft({
              medicineCode: medicine.medicine_code,
              name: medicine.name,
              yjCode: medicine.yj_code ?? "",
              mode: "bolus",
              dose: "",
              unitName: medicine.unit_name ?? "",
              rate: "",
              rateUnit: "mL/h",
              routeCode: "IV",
              givenAt: nowInput(),
            });
          }}
          onClose={() => setSearching(false)}
        />
      )}
    </fieldset>
  );
}
