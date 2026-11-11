import { Link } from "react-router-dom";
import { useCurrentPractitioner } from "../api/authQueries";
import {
  useDialysisChart,
  useDialysisChartWrite,
  useDialysisSessionDetail,
  useLatestDryWeight,
  type DialysisSessionDetail,
} from "../api/queries";
import { dialysisChartPrintUrl } from "../api/reportsClient";
import {
  buildDialysisChartDeleteEntries,
  buildDialysisChartHub,
  DIALYSIS_CHART_SPEC,
  dialysisChartMarkers,
  dialysisChartSecondaryAxis,
  dialysisChartTarget,
  type DialysisChartData,
} from "../fhir/dialysisChartHelpers";
import { summarizeDialysisOrder } from "../fhir/dialysisOrderHelpers";
import { dialysisSessionDisplay, type DryWeight } from "../fhir/dialysisResultHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import {
  buildChartDrugAdministration,
  buildChartEventObservation,
  buildChartPointObservations,
  finishChartInfusion,
  nowInput,
} from "../fhir/timeSeriesChartHelpers";
import { shortDate, toDateTimeInputValue, toFhirDateTime } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { PatientHeader } from "./PatientHeader";
import { DrugsSection } from "./timeSeriesChart/DrugsSection";
import { EventsSection } from "./timeSeriesChart/EventsSection";
import { PointsSection } from "./timeSeriesChart/PointsSection";
import { TimeSeriesPlot } from "./timeSeriesChart/TimeSeriesPlot";

// 透析経過表(透析中の時系列記録)の中身。docs/dialysis-chart-design.md §3。
//
// 透析中に開きっぱなしにする使い方が主なので本体は専用ページ
// (/dialysis-sessions/:sessionId/chart)だが、カルテの実施履歴からも同じものを
// モーダルで開けるよう、中身をこのパネルに切り出してある。
// 経過表のハブは最初の打点と同じ transaction で作り、「確定」は置かない
// (回の終了がその役。終了後も書き忘れた血圧を足せる)。

function postEntry(resource: fhir4.Resource): fhir4.BundleEntry {
  return { resource, request: { method: "POST", url: resource.resourceType } };
}

function putEntry<T extends fhir4.Resource & { id?: string }>(resource: T): fhir4.BundleEntry {
  return { resource, request: { method: "PUT", url: `${resource.resourceType}/${resource.id}` } };
}

interface DialysisChartPanelProps {
  sessionId: string | undefined;
  /** 患者ヘッダ(氏名・ID)を出すか。カルテから開くときは要らない。 */
  showPatientHeader?: boolean;
}

export function DialysisChartPanel({ sessionId, showPatientHeader }: DialysisChartPanelProps) {
  const detail = useDialysisSessionDetail(sessionId);
  const chart = useDialysisChart(sessionId);
  const patientId = detail.data?.order.subject?.reference?.split("/").pop();
  const dryWeight = useLatestDryWeight(patientId);

  return (
    <>
      {showPatientHeader && <PatientHeader patientId={patientId} />}
      <ErrorBanner error={detail.error} />
      <ErrorBanner error={chart.error} />
      <ErrorBanner error={dryWeight.error} />
      {detail.isLoading || chart.isLoading ? (
        <p>読み込み中...</p>
      ) : !detail.data ? (
        !detail.error && <p className="patient-table__empty">透析の実施記録が見つかりません。</p>
      ) : detail.data.session.hub.status === "preparation" ? (
        <p className="patient-table__empty">開始前の回には経過表を書けません。</p>
      ) : (
        <ChartBody
          sessionId={sessionId ?? ""}
          detail={detail.data}
          data={chart.data ?? null}
          dryWeight={dryWeight.data ?? null}
        />
      )}
    </>
  );
}

interface ChartBodyProps {
  sessionId: string;
  detail: DialysisSessionDetail;
  data: DialysisChartData | null;
  dryWeight: DryWeight | null;
}

function ChartBody({ sessionId, detail, data, dryWeight }: ChartBodyProps) {
  const { session, order } = detail;
  const write = useDialysisChartWrite(sessionId);
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const patientId = order.subject?.reference?.split("/").pop() ?? "";
  const summary = summarizeDialysisOrder(order);
  const display = dialysisSessionDisplay(session);
  const target = dialysisChartTarget(session, dryWeight);
  const markers = dialysisChartMarkers(session);
  // 終わった回を後から書くときは、時刻の初期値を回の開始にする(「今」では別の日になる)。
  const completed = session.hub.status === "completed";
  const defaultTime = completed ? toDateTimeInputValue(session.hub.performedPeriod?.start).slice(0, 16) : undefined;
  // 終わった回の持続投与を閉じる時刻も、「今」ではなく回の終了にする。
  const infusionEnd = completed ? toDateTimeInputValue(session.hub.performedPeriod?.end).slice(0, 16) || nowInput() : nowInput();

  /**
   * ハブがまだ無ければ、最初の記録と同じ transaction で作る(urn:uuid で結ぶ)。
   * 記録の組み立てはハブの参照を受け取る形にしてある。
   */
  function withHub(at: string, build: (hubReference: string) => fhir4.Resource[]) {
    if (data?.hub.id) {
      const resources = build(`Procedure/${data.hub.id}`);
      if (resources.length) write.mutate(resources.map(postEntry));
      return;
    }
    const reference = `urn:uuid:${crypto.randomUUID()}`;
    const resources = build(reference);
    if (!resources.length) return;
    const performer = practitionerId
      ? { id: practitionerId, name: practitioner ? practitionerDisplayName(practitioner) : "" }
      : null;
    write.mutate([
      {
        fullUrl: reference,
        resource: buildDialysisChartHub(session, performer, toFhirDateTime(at)),
        request: { method: "POST", url: "Procedure" },
      },
      ...resources.map(postEntry),
    ]);
  }

  function cancelChart() {
    if (!data) return;
    if (!window.confirm("この回の経過表を取り消します。記録した打点・イベントもすべて削除されます。よろしいですか?")) {
      return;
    }
    write.mutate(buildDialysisChartDeleteEntries(data));
  }

  return (
    <>
      <ErrorBanner error={write.error} />
      <p className="time-chart__order">
        {[
          summary.modalityDisplay,
          [display.date ? shortDate(display.date) : "", display.timeLabel, display.statusLabel].filter(Boolean).join(" "),
          summary.conditionLabel,
          target != null ? `目標除水 ${target}L` : "",
          data?.hub.performer?.[0]?.actor?.display ? `記録: ${data.hub.performer[0].actor.display}` : "",
        ]
          .filter(Boolean)
          .join(" | ")}
      </p>

      <TimeSeriesPlot
        points={data?.points ?? []}
        events={data?.events ?? []}
        extraTimes={data?.drugs.flatMap((d) => [d.time, d.endTime]) ?? []}
        markers={markers}
        emptyStart={session.hub.performedPeriod?.start}
        readOnly={completed}
        secondary={dialysisChartSecondaryAxis(data?.points ?? [], target)}
        ariaLabel="透析経過表(血圧・脈拍・累積除水)"
      />
      <PointsSection
        spec={DIALYSIS_CHART_SPEC}
        points={data?.points ?? []}
        readOnly={false}
        legend="打点"
        defaultTime={defaultTime}
        onAdd={(values) =>
          withHub(values.measuredAt, (hubReference) =>
            buildChartPointObservations(DIALYSIS_CHART_SPEC, values, patientId, hubReference),
          )
        }
        onDeletePoint={(point) => {
          if (!window.confirm(`${point.time.slice(11, 16)} の打点を削除しますか?`)) return;
          write.mutate(
            point.observationIds.map((id) => ({ request: { method: "DELETE" as const, url: `Observation/${id}` } })),
          );
        }}
      />
      <EventsSection
        spec={DIALYSIS_CHART_SPEC}
        events={data?.events ?? []}
        readOnly={false}
        defaultTime={defaultTime}
        onAdd={(code, occurredAt, note) =>
          withHub(occurredAt, (hubReference) => [
            buildChartEventObservation(DIALYSIS_CHART_SPEC, { patientId, hubReference, code, occurredAt, note }),
          ])
        }
        onDelete={(event) => {
          if (!window.confirm(`イベント「${event.label}」を削除しますか?`)) return;
          write.mutate([{ request: { method: "DELETE", url: `Observation/${event.id}` } }]);
        }}
      />
      <DrugsSection
        spec={DIALYSIS_CHART_SPEC}
        drugs={data?.drugs ?? []}
        readOnly={false}
        defaultTime={defaultTime}
        onAdd={(values) =>
          withHub(values.givenAt, (hubReference) => [
            buildChartDrugAdministration(DIALYSIS_CHART_SPEC, values, patientId, hubReference),
          ])
        }
        onFinish={(line) => write.mutate([putEntry(finishChartInfusion(line.administration, infusionEnd))])}
        onDelete={(line) => {
          if (!window.confirm(`薬剤「${line.name}」の記録を削除しますか?`)) return;
          write.mutate([{ request: { method: "DELETE", url: `MedicationAdministration/${line.id}` } }]);
        }}
      />

      {data && (
        <div className="time-chart__footer">
          <Link to={dialysisChartPrintUrl(sessionId)} target="_blank" rel="noopener" className="time-chart__print">
            印刷
          </Link>
          <button type="button" className="time-chart__danger" onClick={cancelChart} disabled={write.isPending}>
            経過表取消
          </button>
        </div>
      )}
    </>
  );
}
