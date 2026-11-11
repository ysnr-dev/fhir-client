import { Link } from "react-router-dom";
import { useAuthSession } from "../api/authQueries";
import {
  useAnesthesiaChart,
  useAnesthesiaChartWrite,
  useAnesthesiaPreop,
  usePractitioner,
  useSurgeryOrderDetail,
} from "../api/queries";
import { anesthesiaChartPrintUrl } from "../api/reportsClient";
import { ErrorBanner } from "./ErrorBanner";
import { PatientHeader } from "./PatientHeader";
import {
  ANESTHESIA_CHART_SPEC,
  buildAnesthesiaChartDeleteEntries,
  buildAnesthesiaChartHub,
  type AnesthesiaChartData,
} from "../fhir/anesthesiaChartHelpers";
import { summarizeAnesthesiaPreop } from "../fhir/anesthesiaPreopHelpers";
import { toFhirDateTime } from "../fhir/clinicalNoteHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { serviceRequestsOf } from "../fhir/labOrderHelpers";
import {
  summarizeSurgeryOrder,
  surgeryOrderItemRequests,
  surgeryOrderItems,
} from "../fhir/surgeryOrderHelpers";
import {
  buildChartDrugAdministration,
  buildChartEventObservation,
  buildChartPointObservations,
  finishChartInfusion,
  nowInput,
} from "../fhir/timeSeriesChartHelpers";
import { DrugsSection } from "./timeSeriesChart/DrugsSection";
import { EventsSection } from "./timeSeriesChart/EventsSection";
import { PointsSection } from "./timeSeriesChart/PointsSection";
import { TimeSeriesPlot } from "./timeSeriesChart/TimeSeriesPlot";

// 麻酔チャート(術中リアルタイム記録)の中身。docs/anesthesia-chart-design.md。
//
// 手術中に開きっぱなしにする使い方が主なので本体は専用ページ
// (/surgeries/:orderId/anesthesia-chart)だが、カルテからも同じものを
// モーダルで開けるよう、中身をこのパネルに切り出してある。
// 記録は追加のたびに保存され、確定(ハブ completed)後は閲覧のみになる。
// グラフ・打点・イベント・薬剤は時系列チャートの器(components/timeSeriesChart)で、
// 術前評価の帯・確定が麻酔チャートの固有の部分。

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
  const preop = useAnesthesiaPreop(orderId);
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
        <p className="time-chart__order">
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
      {preop.data && <AnesthesiaPreopBand response={preop.data} />}

      {detail.isLoading || chart.isLoading ? (
        <p>読み込み中...</p>
      ) : !order ? (
        !detail.error && <p className="patient-table__empty">手術オーダーが見つかりません。</p>
      ) : !data ? (
        <div className="time-chart__empty">
          <p>このオーダーの麻酔チャートはまだありません。</p>
          <button type="button" onClick={startChart} disabled={write.isPending}>
            チャート開始
          </button>
        </div>
      ) : (
        <ChartBody
          orderId={orderId ?? ""}
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

// 術前診察から引き継ぐ評価と手術室への指示。困難気道は導入の前に必ず目に入るよう帯の色を変える。
function AnesthesiaPreopBand({ response }: { response: fhir4.QuestionnaireResponse }) {
  const preop = summarizeAnesthesiaPreop(response);

  return (
    <div className={`anes-chart__preop${preop.isDifficultAirway ? " anes-chart__preop--alert" : ""}`}>
      <div className="anes-chart__preop-title">
        術前診察
        {preop.highlights.length > 0 && <span> {preop.highlights.join(" / ")}</span>}
      </div>
      {preop.roomLines.length > 0 && <div className="anes-chart__preop-body">{preop.roomLines.join("\n")}</div>}
    </div>
  );
}

interface ChartBodyProps {
  orderId: string;
  data: AnesthesiaChartData;
  patientId: string;
  write: ReturnType<typeof useAnesthesiaChartWrite>;
  onFinalize: () => void;
  onReopen: () => void;
  onCancel: () => void;
}

function ChartBody({ orderId, data, patientId, write, onFinalize, onReopen, onCancel }: ChartBodyProps) {
  const hubId = data.hub.id ?? "";
  const hubReference = `Procedure/${hubId}`;
  const readOnly = data.readOnly;

  return (
    <>
      <TimeSeriesPlot
        points={data.vitals}
        events={data.events}
        extraTimes={data.drugs.flatMap((d) => [d.time, d.endTime])}
        emptyStart={data.hub.performedPeriod?.start}
        readOnly={readOnly}
        ariaLabel="麻酔チャート(血圧・脈拍)"
      />
      <PointsSection
        spec={ANESTHESIA_CHART_SPEC}
        points={data.vitals}
        readOnly={readOnly}
        legend="バイタル"
        onAdd={(values) => {
          const observations = buildChartPointObservations(ANESTHESIA_CHART_SPEC, values, patientId, hubReference);
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
        spec={ANESTHESIA_CHART_SPEC}
        events={data.events}
        readOnly={readOnly}
        onAdd={(code, occurredAt, note) =>
          write.mutate([
            postEntry(
              buildChartEventObservation(ANESTHESIA_CHART_SPEC, { patientId, hubReference, code, occurredAt, note }),
            ),
          ])
        }
        onDelete={(event) => {
          if (!window.confirm(`イベント「${event.label}」を削除しますか?`)) return;
          write.mutate([{ request: { method: "DELETE", url: `Observation/${event.id}` } }]);
        }}
      />
      <DrugsSection
        spec={ANESTHESIA_CHART_SPEC}
        drugs={data.drugs}
        readOnly={readOnly}
        onAdd={(values) =>
          write.mutate([postEntry(buildChartDrugAdministration(ANESTHESIA_CHART_SPEC, values, patientId, hubReference))])
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

      <div className="time-chart__footer">
        <Link to={anesthesiaChartPrintUrl(orderId)} target="_blank" rel="noopener" className="time-chart__print">
          印刷
        </Link>
        {readOnly ? (
          <button type="button" onClick={onReopen} disabled={write.isPending}>
            再開(確定解除)
          </button>
        ) : (
          <>
            <button type="button" onClick={onFinalize} disabled={write.isPending}>
              確定
            </button>
            <button
              type="button"
              className="time-chart__danger"
              onClick={onCancel}
              disabled={write.isPending}
            >
              チャート取消
            </button>
          </>
        )}
      </div>
    </>
  );
}
