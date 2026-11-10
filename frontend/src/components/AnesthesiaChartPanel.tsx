import { useState, type FormEvent } from "react";
import { useAuthSession } from "../api/authQueries";
import {
  useAnesthesiaChart,
  useAnesthesiaChartWrite,
  useAnesthesiaPreop,
  usePractitioner,
  useSurgeryOrderDetail,
} from "../api/queries";
import type { Medicine } from "../api/masterClient";
import { ErrorBanner } from "./ErrorBanner";
import { MedicineSearchModal } from "./MedicineSearchModal";
import { PatientHeader } from "./PatientHeader";
import {
  ANESTHESIA_CHART_SPEC,
  SURGERY_ROUTE_OPTIONS,
  buildAnesthesiaChartDeleteEntries,
  buildAnesthesiaChartHub,
  buildChartDrugAdministration,
  finishChartInfusion,
  type AnesthesiaChartData,
  type ChartDrugFormValues,
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
import { buildChartEventObservation, buildChartPointObservations, nowInput } from "../fhir/timeSeriesChartHelpers";
import { RemoveRowButton } from "./RemoveRowButton";
import { EventsSection } from "./timeSeriesChart/EventsSection";
import { PointsSection } from "./timeSeriesChart/PointsSection";
import { TimeField } from "./timeSeriesChart/TimeField";
import { TimeSeriesPlot } from "./timeSeriesChart/TimeSeriesPlot";

// 麻酔チャート(術中リアルタイム記録)の中身。docs/anesthesia-chart-design.md。
//
// 手術中に開きっぱなしにする使い方が主なので本体は専用ページ
// (/surgeries/:orderId/anesthesia-chart)だが、カルテからも同じものを
// モーダルで開けるよう、中身をこのパネルに切り出してある。
// 記録は追加のたびに保存され、確定(ハブ completed)後は閲覧のみになる。
// グラフ・打点・イベントは時系列チャートの器(components/timeSeriesChart)で、
// 薬剤・術前評価の帯・確定が麻酔チャートの固有の部分。

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
  data: AnesthesiaChartData;
  patientId: string;
  write: ReturnType<typeof useAnesthesiaChartWrite>;
  onFinalize: () => void;
  onReopen: () => void;
  onCancel: () => void;
}

function ChartBody({ data, patientId, write, onFinalize, onReopen, onCancel }: ChartBodyProps) {
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

      <div className="time-chart__footer">
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
    <fieldset className="time-chart__section">
      <legend>薬剤</legend>
      {data.drugs.length === 0 ? (
        <p className="patient-table__empty">薬剤はまだありません。</p>
      ) : (
        <ul className="time-chart__list">
          {data.drugs.map((line) => (
            <li key={line.id}>
              <span className="time-chart__list-time">
                {line.time.slice(11, 16)}
                {line.mode === "infusion" &&
                  ` 〜 ${line.running ? "投与中" : line.endTime.slice(11, 16)}`}
              </span>
              <span>{line.name}</span>
              <span className="time-chart__list-note">
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
          薬剤追加
        </button>
      )}

      {draft && (
        <form className="time-chart__entry" onSubmit={submit}>
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
              <span className="time-chart__bp-pair">
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
              <span className="time-chart__bp-pair">
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
