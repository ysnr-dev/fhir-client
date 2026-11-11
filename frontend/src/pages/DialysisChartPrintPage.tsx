import { useParams } from "react-router-dom";
import { useDialysisChart, useDialysisSessionDetail, useLatestDryWeight, usePatient } from "../api/queries";
import { ChartPrintPage, type ChartPrintSheet } from "../components/timeSeriesChart/ChartPrintPage";
import {
  DIALYSIS_CHART_SPEC,
  dialysisChartMarkers,
  dialysisChartSecondaryAxis,
  dialysisChartTarget,
} from "../fhir/dialysisChartHelpers";
import { summarizeDialysisOrder } from "../fhir/dialysisOrderHelpers";
import { dialysisSessionDisplay } from "../fhir/dialysisResultHelpers";
import { displayName, patientNumberOf } from "../fhir/patientHelpers";
import { shortDate } from "../lib/dates";

// 透析経過表を紙に出す別タブ。紙面の組み立ては時系列チャートの器(ChartPrintPage)で、
// ここは見出しに並べる回の情報を集める。設計は docs/dialysis-chart-design.md §3.5。

export function DialysisChartPrintPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const detail = useDialysisSessionDetail(sessionId);
  const chart = useDialysisChart(sessionId);
  const patientId = detail.data?.order.subject?.reference?.split("/").pop();
  const patient = usePatient(patientId);
  const dryWeight = useLatestDryWeight(patientId);

  const session = detail.data?.session;
  const order = detail.data?.order;
  const data = chart.data ?? null;

  let sheet: ChartPrintSheet | null = null;
  if (session && order && data) {
    const summary = summarizeDialysisOrder(order);
    const display = dialysisSessionDisplay(session);
    const target = dialysisChartTarget(session, dryWeight.data ?? null);
    const patientResource = patient.data?.data;
    sheet = {
      title: "透析経過表",
      info: [
        ["患者", patientResource ? displayName(patientResource) : ""],
        ["患者番号", patientResource ? (patientNumberOf(patientResource) ?? "") : ""],
        ["実施日", [display.date ? shortDate(display.date) : "", display.timeLabel].filter(Boolean).join(" ")],
        ["浄化方法", summary.modalityDisplay],
        ["条件", summary.conditionLabel],
        ["透析前体重", display.preWeight != null ? `${display.preWeight} kg` : ""],
        ["ドライウェイト", dryWeight.data ? `${dryWeight.data.value} kg` : ""],
        ["目標除水", target != null ? `${target} L` : ""],
        ["記録", data.hub.performer?.[0]?.actor?.display ?? ""],
      ],
      spec: DIALYSIS_CHART_SPEC,
      points: data.points,
      events: data.events,
      drugs: data.drugs,
      markers: dialysisChartMarkers(session),
      emptyStart: session.hub.performedPeriod?.start,
      secondary: dialysisChartSecondaryAxis(data.points, target),
      ariaLabel: "透析経過表(血圧・脈拍・累積除水)",
    };
  }

  return (
    <ChartPrintPage
      loading={detail.isLoading || chart.isLoading}
      errors={[detail.error, chart.error]}
      emptyMessage={
        detail.data === null ? "透析の実施記録が見つかりません。" : chart.data === null ? "この回の経過表はありません。" : undefined
      }
      sheet={sheet}
    />
  );
}
