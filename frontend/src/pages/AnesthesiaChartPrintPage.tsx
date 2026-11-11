import { useParams } from "react-router-dom";
import { useAnesthesiaChart, useAnesthesiaPreop, usePatient, useSurgeryOrderDetail } from "../api/queries";
import { ChartPrintPage, type ChartPrintSheet } from "../components/timeSeriesChart/ChartPrintPage";
import { ANESTHESIA_CHART_SPEC } from "../fhir/anesthesiaChartHelpers";
import { summarizeAnesthesiaPreop } from "../fhir/anesthesiaPreopHelpers";
import { serviceRequestsOf } from "../fhir/labOrderHelpers";
import { displayName, patientNumberOf } from "../fhir/patientHelpers";
import { summarizeSurgeryOrder, surgeryOrderItemRequests, surgeryOrderItems } from "../fhir/surgeryOrderHelpers";
import { clockTime, dateTimeLabel, localDay } from "../lib/dates";

// 麻酔チャートを紙に出す別タブ(紙カルテ運用・他院提供)。紙面の組み立ては時系列チャートの器
// (ChartPrintPage)で、ここは見出しに並べる手術と麻酔の情報、術前診察の要点を集める。
// 設計は docs/anesthesia-chart-design.md §7-4。

export function AnesthesiaChartPrintPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const detail = useSurgeryOrderDetail(orderId);
  const chart = useAnesthesiaChart(orderId);
  const preop = useAnesthesiaPreop(orderId);

  const requests = serviceRequestsOf(detail.data?.data);
  const order = requests.find((request) => request.id === orderId);
  const patientId = order?.subject?.reference?.match(/^Patient\/(.+)$/)?.[1];
  const patient = usePatient(patientId);
  const data = chart.data ?? null;

  let sheet: ChartPrintSheet | null = null;
  if (order && data) {
    const summary = summarizeSurgeryOrder(order);
    const items = surgeryOrderItems(order, surgeryOrderItemRequests(requests, orderId ?? ""));
    const period = data.hub.performedPeriod;
    // 日をまたいだ記録は終了にも日付を付ける(時刻だけでは開始と同じ日に読める)。
    const end = period?.end
      ? localDay(period.end) === localDay(period.start) ? clockTime(period.end) : dateTimeLabel(period.end)
      : "";
    const patientResource = patient.data?.data;
    const preopSummary = preop.data ? summarizeAnesthesiaPreop(preop.data) : null;
    sheet = {
      title: "麻酔チャート",
      info: [
        ["患者", patientResource ? displayName(patientResource) : ""],
        ["患者番号", patientResource ? (patientNumberOf(patientResource) ?? "") : ""],
        ["術式", items.map((item) => item.name).join("、")],
        ["手術室", summary.roomName],
        ["記録", period?.start ? `${dateTimeLabel(period.start)}〜${end}` : ""],
        ["麻酔担当", data.performerName],
        ["状態", data.readOnly ? "確定済" : "記録中"],
      ],
      note:
        preopSummary && (preopSummary.highlights.length > 0 || preopSummary.roomLines.length > 0) ? (
          <div className="time-chart-print__note">
            <span className="time-chart-print__note-title">術前診察</span>
            {[preopSummary.highlights.join(" / "), ...preopSummary.roomLines].filter(Boolean).join("　")}
          </div>
        ) : undefined,
      spec: ANESTHESIA_CHART_SPEC,
      points: data.vitals,
      events: data.events,
      drugs: data.drugs,
      emptyStart: period?.start,
      ariaLabel: "麻酔チャート(血圧・脈拍)",
    };
  }

  return (
    <ChartPrintPage
      loading={detail.isLoading || chart.isLoading}
      errors={[detail.error, chart.error, preop.error]}
      emptyMessage={
        !detail.isLoading && !order ? "手術オーダーが見つかりません。" : chart.data === null ? "このオーダーの麻酔チャートはありません。" : undefined
      }
      sheet={sheet}
    />
  );
}
