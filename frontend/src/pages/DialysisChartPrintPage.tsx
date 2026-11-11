import { useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import {
  useDialysisChart,
  useDialysisSessionDetail,
  useLatestDryWeight,
  usePatient,
  useSelfOrganization,
} from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { TimeSeriesPlot } from "../components/timeSeriesChart/TimeSeriesPlot";
import {
  DIALYSIS_CHART_SPEC,
  dialysisChartMarkers,
  dialysisChartSecondaryAxis,
  dialysisChartTarget,
} from "../fhir/dialysisChartHelpers";
import { summarizeDialysisOrder } from "../fhir/dialysisOrderHelpers";
import { dialysisSessionDisplay } from "../fhir/dialysisResultHelpers";
import { displayName, patientNumberOf } from "../fhir/patientHelpers";
import type { ChartPoint } from "../fhir/timeSeriesChartHelpers";
import { dateTimeLabel, nowFhirDateTime, shortDate } from "../lib/dates";
import { applyTheme, resolveTheme } from "../theme";

// 透析経過表を紙に出す別タブ。ThinReports ではグラフを描けないので、画面と同じ SVG を
// A4 横の幅に収めてブラウザの印刷に渡す。打点の表は時点の列が多いと紙に収まらないので、
// 列数で区切って段にする。設計は docs/dialysis-chart-design.md §3.5。

/** A4 横(297mm)から左右の余白を引いた紙面の幅。 */
const PAGE_MARGIN_MM = 10;
const SHEET_MM = 297 - PAGE_MARGIN_MM * 2;
/** mm → CSS px(96dpi)。 */
const SHEET_PX = Math.floor((SHEET_MM / 25.4) * 96);
/** 打点の表を区切る列数(行見出し + 時点の列が紙面の幅に入る数)。 */
const COLUMNS_PER_TABLE = 12;
/** グラフの高さ。4 時間の回がグラフ・表・できごとまで A4 横 1 枚に入る大きさ。 */
const PLOT_HEIGHT = 210;

export function DialysisChartPrintPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const detail = useDialysisSessionDetail(sessionId);
  const chart = useDialysisChart(sessionId);
  const patientId = detail.data?.order.subject?.reference?.split("/").pop();
  const patient = usePatient(patientId);
  const dryWeight = useLatestDryWeight(patientId);
  const { organization } = useSelfOrganization();
  // 印刷日時は開いた時点で固定する。
  const printedAt = useMemo(() => dateTimeLabel(nowFhirDateTime()), []);

  // 紙面は白地に印字するので、ダークテーマでもこのタブだけライトで描く。
  useEffect(() => {
    applyTheme("light");
    return () => applyTheme(resolveTheme());
  }, []);

  const session = detail.data?.session;
  const order = detail.data?.order;
  const data = chart.data ?? null;
  const ready = Boolean(session && order && data);

  return (
    <div className="dialysis-chart-print time-chart">
      <style>{`@page { size: A4 landscape; margin: ${PAGE_MARGIN_MM}mm; }`}</style>
      <div className="karte-print__toolbar">
        <button type="button" disabled={!ready} onClick={() => window.print()}>
          印刷
        </button>
        {(detail.isLoading || chart.isLoading) && <span>読み込み中...</span>}
      </div>
      <ErrorBanner error={detail.error} />
      <ErrorBanner error={chart.error} />
      {detail.data === null && <p>透析の実施記録が見つかりません。</p>}
      {session && order && chart.data === null && <p>この回の経過表はありません。</p>}
      {session && order && data && (
        <section className="dialysis-chart-print__page" style={{ width: `${SHEET_MM}mm` }}>
          <div className="dialysis-chart-print__title">
            <span>透析経過表</span>
            <span className="dialysis-chart-print__organization">{organization?.name ?? ""}</span>
          </div>
          <dl className="dialysis-chart-print__info">
            {(() => {
              const summary = summarizeDialysisOrder(order);
              const display = dialysisSessionDisplay(session);
              const target = dialysisChartTarget(session, dryWeight.data ?? null);
              const patientResource = patient.data?.data;
              const items: [string, string][] = [
                ["患者", patientResource ? displayName(patientResource) : ""],
                ["患者番号", patientResource ? (patientNumberOf(patientResource) ?? "") : ""],
                ["実施日", [display.date ? shortDate(display.date) : "", display.timeLabel].filter(Boolean).join(" ")],
                ["浄化方法", summary.modalityDisplay],
                ["条件", summary.conditionLabel],
                ["透析前体重", display.preWeight != null ? `${display.preWeight} kg` : ""],
                ["ドライウェイト", dryWeight.data ? `${dryWeight.data.value} kg` : ""],
                ["目標除水", target != null ? `${target} L` : ""],
                ["記録", data.hub.performer?.[0]?.actor?.display ?? ""],
                ["印刷日時", printedAt],
              ];
              return items
                .filter(([, value]) => value)
                .map(([label, value]) => (
                  <div key={label} className="dialysis-chart-print__item">
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ));
            })()}
          </dl>

          <div style={{ width: SHEET_PX }}>
            <TimeSeriesPlot
              points={data.points}
              events={data.events}
              extraTimes={data.drugs.flatMap((d) => [d.time, d.endTime])}
              markers={dialysisChartMarkers(session)}
              emptyStart={session.hub.performedPeriod?.start}
              readOnly
              secondary={dialysisChartSecondaryAxis(data.points, dialysisChartTarget(session, dryWeight.data ?? null))}
              fixedWidth={SHEET_PX}
              height={PLOT_HEIGHT}
              ariaLabel="透析経過表(血圧・脈拍・累積除水)"
            />
          </div>

          {chunk(data.points, COLUMNS_PER_TABLE).map((points, index) => (
            <table key={index} className="time-chart__table dialysis-chart-print__table">
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
                  <th>血圧</th>
                  {points.map((point) => (
                    <td key={point.time}>
                      {point.systolic != null && point.diastolic != null ? `${point.systolic}/${point.diastolic}` : ""}
                    </td>
                  ))}
                </tr>
                {DIALYSIS_CHART_SPEC.measures.map((measure) => (
                  <tr key={measure.key}>
                    <th>
                      {measure.label}
                      <span className="dialysis-chart-print__unit">{measure.unit}</span>
                    </th>
                    {points.map((point) => (
                      <td key={point.time}>{point.values[measure.key] ?? ""}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ))}

          <div className="dialysis-chart-print__lists">
            <div>
              <h2>できごと</h2>
              {data.events.length === 0 ? (
                <p>なし</p>
              ) : (
                <ul className="time-chart__list">
                  {data.events.map((event) => (
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
              {data.drugs.length === 0 ? (
                <p>なし</p>
              ) : (
                <ul className="time-chart__list">
                  {data.drugs.map((line) => (
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
      )}
    </div>
  );
}

function chunk(points: readonly ChartPoint[], size: number): ChartPoint[][] {
  const chunks: ChartPoint[][] = [];
  for (let i = 0; i < points.length; i += size) chunks.push(points.slice(i, i + size));
  return chunks;
}
