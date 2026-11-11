import { useEffect, useMemo, type ReactNode } from "react";
import { useSelfOrganization } from "../../api/queries";
import type {
  ChartDrugLine,
  ChartEventLine,
  ChartMarker,
  ChartPoint,
  ChartSecondaryAxis,
  ChartSpec,
} from "../../fhir/timeSeriesChartHelpers";
import { dateTimeLabel, nowFhirDateTime } from "../../lib/dates";
import { applyTheme, resolveTheme } from "../../theme";
import { ErrorBanner } from "../ErrorBanner";
import { TimeSeriesPlot } from "./TimeSeriesPlot";

// 時系列チャート(麻酔チャート・透析経過表)を紙に出す別タブの器。ThinReports ではグラフを
// 描けないので、画面と同じ SVG を A4 横の幅に収めてブラウザの印刷に渡す。打点の表は時点の列が
// 多いと紙に収まらないので、列数で区切って段にする。設計は docs/dialysis-chart-design.md §3.5。
// 何を見出しに並べるかとデータの読み込みは部門のページが持つ。

/** A4 横(297mm)から左右の余白を引いた紙面の幅。 */
const PAGE_MARGIN_MM = 10;
const SHEET_MM = 297 - PAGE_MARGIN_MM * 2;
/** mm → CSS px(96dpi)。 */
const SHEET_PX = Math.floor((SHEET_MM / 25.4) * 96);
/** 打点の表 1 段に置ける時点の列の数(行見出しと合わせて紙面の幅に入る数)。 */
const MAX_COLUMNS_PER_TABLE = 18;
/** グラフの高さ。4 時間ぶんがグラフ・表・一覧まで A4 横 1 枚に入る大きさ。 */
const PLOT_HEIGHT = 210;

export interface ChartPrintSheet {
  title: string;
  /** 見出しの項目。値が空の項目は出さない。印刷日時はこちらで足す。 */
  info: [label: string, value: string][];
  /** 見出しの下に置く帯(麻酔の術前診察など)。 */
  note?: ReactNode;
  spec: ChartSpec;
  points: readonly ChartPoint[];
  events: readonly ChartEventLine[];
  drugs: readonly ChartDrugLine[];
  markers?: readonly ChartMarker[];
  emptyStart?: string;
  secondary?: ChartSecondaryAxis;
  ariaLabel: string;
}

interface ChartPrintPageProps {
  loading: boolean;
  errors: unknown[];
  /** 読み込めたが印刷するものが無いときの文言。 */
  emptyMessage?: string;
  sheet: ChartPrintSheet | null;
}

export function ChartPrintPage({ loading, errors, emptyMessage, sheet }: ChartPrintPageProps) {
  const { organization } = useSelfOrganization();
  // 印刷日時は開いた時点で固定する。
  const printedAt = useMemo(() => dateTimeLabel(nowFhirDateTime()), []);

  // 紙面は白地に印字するので、ダークテーマでもこのタブだけライトで描く。
  useEffect(() => {
    applyTheme("light");
    return () => applyTheme(resolveTheme());
  }, []);

  return (
    <div className="time-chart-print time-chart">
      <style>{`@page { size: A4 landscape; margin: ${PAGE_MARGIN_MM}mm; }`}</style>
      <div className="karte-print__toolbar">
        <button type="button" disabled={!sheet} onClick={() => window.print()}>
          印刷
        </button>
        {loading && <span>読み込み中...</span>}
      </div>
      {errors.map((error, index) => (
        <ErrorBanner key={index} error={error} />
      ))}
      {!loading && !sheet && emptyMessage && <p>{emptyMessage}</p>}
      {sheet && <Sheet sheet={sheet} organizationName={organization?.name ?? ""} printedAt={printedAt} />}
    </div>
  );
}

function Sheet({
  sheet,
  organizationName,
  printedAt,
}: {
  sheet: ChartPrintSheet;
  organizationName: string;
  printedAt: string;
}) {
  const info = [...sheet.info, ["印刷日時", printedAt] as [string, string]].filter(([, value]) => value);
  return (
    <section className="time-chart-print__page" style={{ width: `${SHEET_MM}mm` }}>
      <div className="time-chart-print__title">
        <span>{sheet.title}</span>
        <span className="time-chart-print__organization">{organizationName}</span>
      </div>
      <dl className="time-chart-print__info">
        {info.map(([label, value]) => (
          <div key={label} className="time-chart-print__item">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {sheet.note}

      <div style={{ width: SHEET_PX }}>
        <TimeSeriesPlot
          points={sheet.points}
          events={sheet.events}
          extraTimes={sheet.drugs.flatMap((d) => [d.time, d.endTime])}
          markers={sheet.markers}
          emptyStart={sheet.emptyStart}
          readOnly
          secondary={sheet.secondary}
          fixedWidth={SHEET_PX}
          height={PLOT_HEIGHT}
          ariaLabel={sheet.ariaLabel}
        />
      </div>

      {chunk(sheet.points, MAX_COLUMNS_PER_TABLE).map((points, index) => (
        <table key={index} className="time-chart__table time-chart-print__table">
          <thead>
            <tr>
              <th></th>
              {points.map((point) => (
                <th key={point.time}>{point.time.slice(11, 16)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>
                血圧
                <span className="time-chart-print__unit">mmHg</span>
              </th>
              {points.map((point) => (
                <td key={point.time}>
                  {point.systolic != null && point.diastolic != null ? `${point.systolic}/${point.diastolic}` : ""}
                </td>
              ))}
            </tr>
            {sheet.spec.measures.map((measure) => (
              <tr key={measure.key}>
                <th>
                  {measure.label}
                  <span className="time-chart-print__unit">{measure.unit}</span>
                </th>
                {points.map((point) => (
                  <td key={point.time}>{point.values[measure.key] ?? ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ))}

      <div className="time-chart-print__lists">
        <div>
          <h2>できごと</h2>
          {sheet.events.length === 0 ? (
            <p>なし</p>
          ) : (
            <ul className="time-chart__list">
              {sheet.events.map((event) => (
                <li key={event.id}>
                  <span className="time-chart__list-time">{event.time.slice(11, 16)}</span>
                  <span>{event.label}</span>
                  {event.note && <span className="time-chart__list-note">{event.note}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h2>薬剤</h2>
          {sheet.drugs.length === 0 ? (
            <p>なし</p>
          ) : (
            <ul className="time-chart__list">
              {sheet.drugs.map((line) => (
                <li key={line.id}>
                  <span className="time-chart__list-time">
                    {line.time.slice(11, 16)}
                    {line.mode === "infusion" && ` 〜 ${line.running ? "投与中" : line.endTime.slice(11, 16)}`}
                  </span>
                  <span>{line.name}</span>
                  <span className="time-chart__list-note">
                    {line.mode === "bolus" ? "単回" : "持続"}
                    {line.doseLabel ? ` ${line.doseLabel}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

/** 段に分ける。段数を最小にし、列の数を段のあいだで揃える(最後の段が 1 列だけ、にしない)。 */
function chunk(points: readonly ChartPoint[], maxSize: number): ChartPoint[][] {
  const count = Math.ceil(points.length / maxSize);
  const size = Math.ceil(points.length / Math.max(1, count));
  const chunks: ChartPoint[][] = [];
  for (let i = 0; i < points.length; i += size) chunks.push(points.slice(i, i + size));
  return chunks;
}
