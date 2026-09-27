import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { PatientCaution } from "../api/masterClient";
import { usePatientCautions } from "../api/masterQueries";
import {
  useAllergiesForPatients,
  useEmergencyList,
  useFlagsForPatients,
  useInfectionsForPatients,
  useOutpatientOrders,
  usePractitionerOptions,
  useUpdateEmergencyEncounter,
  type EmergencyRow,
} from "../api/queries";
import { DateStepper } from "../components/DateStepper";
import { EmergencyCheckInModal, useEmergencyBeds } from "../components/EmergencyCheckInModal";
import {
  EmergencyDispositionModal,
  EmergencyEditModal,
  EmergencyIdentifyModal,
  EmergencyTriageModal,
} from "../components/EmergencyRowModals";
import { ErrorBanner } from "../components/ErrorBanner";
import { ORDER_LEGEND, OrderSummaryChips, RowPictograms } from "../components/PatientListRowParts";
import {
  PatientKana,
  PatientProfileCells,
  PatientProfileHeadCells,
} from "../components/PatientRowCells";
import { RowMenu } from "../components/RowMenu";
import { useNow } from "../hooks/useNow";
import { useStoredToggle } from "../hooks/useStoredToggle";
import {
  arrivalModeLabel,
  arrivalModeMark,
  buildEmergencyCancelled,
  buildEmergencyDispositionCancelled,
  buildEmergencyExamStarted,
  dispositionLabel,
  EMERGENCY_STATUS_OPTIONS,
  emergencyArrivalMode,
  emergencyAttendingId,
  emergencyAttendingName,
  emergencyBedId,
  emergencyBedName,
  emergencyComplaint,
  emergencyDisposition,
  emergencyExamStartedAt,
  emergencyPatientId,
  emergencyStatusLabel,
  emergencyTriageLevel,
  isEmergencyActive,
  isProvisionalPatient,
  jtasLabel,
  occupiedEmergencyBedIds,
  withEmergencyStatusReverted,
} from "../fhir/emergencyEncounterHelpers";
import { displayName } from "../fhir/patientHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { today } from "../fhir/scheduleHelpers";
import { dateTimeLabel, nowFhirDateTime } from "../lib/dates";
import { useReturnLinkState } from "../returnTo";

// 救急患者一覧。滞在中の患者は日付をまたいでも常に上にまとめて出し、その下に
// 指定日に来院して転帰が確定した患者を並べる。
//
// 1 行 = 救急の受診(Encounter)1 件。来院で受診を建て、トリアージ → 診察開始 →
// 転帰と、その 1 件の status を進める(fhir/emergencyEncounterHelpers.ts の冒頭)。

interface Filters {
  practitionerId: string;
  bedId: string;
  status: string;
}

const emptyFilters: Filters = { practitionerId: "", bedId: "", status: "" };

const DATE_PARAM = "date";
const FILTER_PARAMS: Record<keyof Filters, string> = {
  practitionerId: "practitioner",
  bedId: "bed",
  status: "status",
};

const POLLING_STORAGE_KEY = "fhir-client.emergency.polling";

export function EmergencyListPage() {
  const navigate = useNavigate();
  const returnLinkState = useReturnLinkState();
  const [searchParams, setSearchParams] = useSearchParams();
  const date = searchParams.get(DATE_PARAM) || today();
  const filters = useMemo<Filters>(
    () => ({
      practitionerId: searchParams.get(FILTER_PARAMS.practitionerId) ?? "",
      bedId: searchParams.get(FILTER_PARAMS.bedId) ?? "",
      status: searchParams.get(FILTER_PARAMS.status) ?? "",
    }),
    [searchParams],
  );
  const [polling, setPolling] = useStoredToggle(POLLING_STORAGE_KEY);
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [triageTarget, setTriageTarget] = useState<EmergencyRow | null>(null);
  const [editTarget, setEditTarget] = useState<EmergencyRow | null>(null);
  const [dispositionTarget, setDispositionTarget] = useState<EmergencyRow | null>(null);
  const [identifyTarget, setIdentifyTarget] = useState<fhir4.Patient | null>(null);

  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const list = useEmergencyList(date, { polling });
  const practitioners = usePractitionerOptions();
  const beds = useEmergencyBeds();
  const update = useUpdateEmergencyEncounter();

  function setParams(next: Record<string, string>) {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    if (!params.get(DATE_PARAM)) params.set(DATE_PARAM, date);
    setSearchParams(params);
  }

  function setFilters(next: Filters) {
    setParams(
      Object.fromEntries(
        (Object.keys(FILTER_PARAMS) as (keyof Filters)[]).map((key) => [FILTER_PARAMS[key], next[key]]),
      ),
    );
  }

  const allRows = useMemo(() => list.data?.rows ?? [], [list.data]);
  const rows = useMemo(() => allRows.filter((row) => matchesFilters(row, filters)), [allRows, filters]);
  const occupiedBedIds = useMemo(
    () => occupiedEmergencyBedIds(allRows.map((row) => row.encounter)),
    [allRows],
  );

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of allRows) {
      if (!matchesFilters(row, { ...filters, status: "" })) continue;
      counts.set(row.encounter.status, (counts.get(row.encounter.status) ?? 0) + 1);
    }
    return EMERGENCY_STATUS_OPTIONS.map((option) => ({
      ...option,
      count: counts.get(option.code) ?? 0,
    }));
  }, [allRows, filters]);

  const patientIds = useMemo(
    () => allRows.map((row) => emergencyPatientId(row.encounter)).filter((id): id is string => Boolean(id)),
    [allRows],
  );
  const cautions = usePatientCautions();
  const cautionsByCode = useMemo(
    () => new Map<string, PatientCaution>((cautions.data?.items ?? []).map((c) => [c.code, c])),
    [cautions.data],
  );
  const flags = useFlagsForPatients(patientIds);
  const allergies = useAllergiesForPatients(patientIds);
  const infections = useInfectionsForPatients(patientIds);
  const orders = useOutpatientOrders(date, patientIds, { polling });

  // 経過時間は滞在中の行だけ数えるので、表示中の日付に関わらず時計を回す。
  const now = useNow(allRows.some((row) => isEmergencyActive(row.encounter)));

  function handleStartExam(row: EmergencyRow) {
    const patientId = emergencyPatientId(row.encounter);
    update.mutate(
      { encounter: buildEmergencyExamStarted(row.encounter, nowFhirDateTime()) },
      {
        onSuccess: () => {
          if (patientId) navigate(`/patients/${patientId}/karte`, { state: returnLinkState });
        },
      },
    );
  }

  function handleCancelExamStart(row: EmergencyRow) {
    if (!window.confirm("診察開始を取り消します。よろしいですか?")) return;
    update.mutate({ encounter: withEmergencyStatusReverted(row.encounter) });
  }

  function handleCancelDisposition(row: EmergencyRow) {
    if (!window.confirm("転帰を取り消して滞在中に戻します。よろしいですか?")) return;
    update.mutate({ encounter: buildEmergencyDispositionCancelled(row.encounter) });
  }

  function handleCancel(row: EmergencyRow) {
    if (!window.confirm("この救急受付を取り消します。よろしいですか?")) return;
    update.mutate({ encounter: buildEmergencyCancelled(row.encounter) });
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>救急患者一覧</h1>
        <div>
          <label className="outpatient__polling" title="一覧を 1 分ごとに読み直します">
            <input
              type="checkbox"
              checked={polling}
              onChange={(event) => setPolling(event.target.checked)}
            />
            自動更新
          </label>
          <button type="button" onClick={() => setCheckInOpen(true)}>
            救急受付
          </button>
        </div>
      </div>

      <FilterForm
        date={date}
        filters={filters}
        practitioners={practitioners.practitioners}
        beds={beds.beds}
        onDateChange={(value) => value && setParams({ [DATE_PARAM]: value })}
        onChange={setFilters}
      />

      <ErrorBanner error={list.error ?? practitioners.error ?? beds.error} />
      <ErrorBanner error={update.error} />

      {list.isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <p className="outpatient__summary">
            {statusCounts.map((status) => (
              <span key={status.code} className="outpatient__summary-item">
                {status.label} <strong>{status.count}</strong>
              </span>
            ))}
          </p>
          <div className="outpatient-wrap sticky-table-wrap">
            <table className="outpatient emergency sticky-table">
              <thead>
                <tr>
                  <th className="emergency__jtas sticky-table__fix-1">JTAS</th>
                  <th className="outpatient__time sticky-table__fix-2">来院</th>
                  <th className="sticky-table__fix-3">患者番号</th>
                  <th className="sticky-table__fix-4">患者氏名</th>
                  <PatientProfileHeadCells />
                  <th>来院方法</th>
                  <th className="emergency__complaint-cell">主訴</th>
                  <th>ベッド</th>
                  <th>担当医</th>
                  <th>状態</th>
                  <th title={ORDER_LEGEND}>当日オーダー</th>
                  <th className="outpatient__actions sticky-table__fix-actions"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const patientId = emergencyPatientId(row.encounter) ?? "";
                  return (
                    <EmergencyTableRow
                      key={row.encounter.id}
                      row={row}
                      now={now}
                      pictograms={
                        <RowPictograms
                          patientId={patientId}
                          flags={flags.byPatient}
                          allergies={allergies.byPatient}
                          infections={infections.byPatient}
                          cautionsByCode={cautionsByCode}
                        />
                      }
                      orders={<OrderSummaryChips orders={orders.byPatient.get(patientId) ?? []} />}
                      pending={update.isPending}
                      onTriage={() => setTriageTarget(row)}
                      onStartExam={() => handleStartExam(row)}
                      onCancelExamStart={() => handleCancelExamStart(row)}
                      onDisposition={() => setDispositionTarget(row)}
                      onCancelDisposition={() => handleCancelDisposition(row)}
                      onEdit={() => setEditTarget(row)}
                      onIdentify={row.patient ? () => setIdentifyTarget(row.patient ?? null) : undefined}
                      onCancel={() => handleCancel(row)}
                    />
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={14} className="master-search__empty">
                      {allRows.length === 0
                        ? "救急の患者はいません"
                        : "絞り込みに該当する患者がいません"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="order-select__muted outpatient__count">{rows.length} 件</p>
        </>
      )}

      {checkInOpen && (
        <EmergencyCheckInModal occupiedBedIds={occupiedBedIds} onClose={() => setCheckInOpen(false)} />
      )}
      {triageTarget && (
        <EmergencyTriageModal row={triageTarget} onClose={() => setTriageTarget(null)} />
      )}
      {editTarget && (
        <EmergencyEditModal
          row={editTarget}
          occupiedBedIds={occupiedBedIds}
          onClose={() => setEditTarget(null)}
        />
      )}
      {dispositionTarget && (
        <EmergencyDispositionModal
          row={dispositionTarget}
          onClose={() => setDispositionTarget(null)}
        />
      )}
      {identifyTarget && (
        <EmergencyIdentifyModal patient={identifyTarget} onClose={() => setIdentifyTarget(null)} />
      )}
    </div>
  );
}

function matchesFilters(row: EmergencyRow, filters: Filters): boolean {
  const { encounter } = row;
  if (filters.practitionerId && emergencyAttendingId(encounter) !== filters.practitionerId) return false;
  if (filters.bedId && emergencyBedId(encounter) !== filters.bedId) return false;
  if (filters.status && encounter.status !== filters.status) return false;
  return true;
}

function FilterForm({
  date,
  filters,
  practitioners,
  beds,
  onDateChange,
  onChange,
}: {
  date: string;
  filters: Filters;
  practitioners: fhir4.Practitioner[];
  beds: fhir4.Location[];
  onDateChange: (value: string) => void;
  onChange: (filters: Filters) => void;
}) {
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
  }

  return (
    <form className="patient-search-form" onSubmit={handleSubmit}>
      <label>
        来院日
        <DateStepper value={date} onChange={onDateChange} />
      </label>
      <label>
        担当医
        <select
          value={filters.practitionerId}
          onChange={(e) => onChange({ ...filters, practitionerId: e.target.value })}
        >
          <option value="">すべて</option>
          {practitioners.map((p) => (
            <option key={p.id} value={p.id}>
              {practitionerDisplayName(p)}
            </option>
          ))}
        </select>
      </label>
      <label>
        ベッド
        <select value={filters.bedId} onChange={(e) => onChange({ ...filters, bedId: e.target.value })}>
          <option value="">すべて</option>
          {beds.map((bed) => (
            <option key={bed.id} value={bed.id}>
              {bed.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        状態
        <select value={filters.status} onChange={(e) => onChange({ ...filters, status: e.target.value })}>
          <option value="">すべて</option>
          {EMERGENCY_STATUS_OPTIONS.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <div className="patient-search-form__actions">
        <button type="button" onClick={() => onChange(emptyFilters)}>
          クリア
        </button>
      </div>
    </form>
  );
}

/** 「1時間5分」のような経過時間。 */
function elapsedLabel(from: string | undefined, to: Date): string {
  if (!from) return "";
  const start = new Date(from).getTime();
  if (Number.isNaN(start)) return "";
  const minutes = Math.max(0, Math.floor((to.getTime() - start) / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}時間${minutes % 60}分` : `${minutes}分`;
}

/** 来院の時刻。今日の来院は時刻だけ、別の日は日付も添える。 */
function arrivalTimeLabel(value: string | undefined): string {
  const label = dateTimeLabel(value);
  return value?.slice(0, 10) === today() ? label.slice(11) : label.slice(5);
}

function EmergencyTableRow({
  row,
  now,
  pictograms,
  orders,
  pending,
  onTriage,
  onStartExam,
  onCancelExamStart,
  onDisposition,
  onCancelDisposition,
  onEdit,
  onIdentify,
  onCancel,
}: {
  row: EmergencyRow;
  now: Date;
  pictograms: ReactNode;
  orders: ReactNode;
  pending: boolean;
  onTriage: () => void;
  onStartExam: () => void;
  onCancelExamStart: () => void;
  onDisposition: () => void;
  onCancelDisposition: () => void;
  onEdit: () => void;
  onIdentify?: () => void;
  onCancel: () => void;
}) {
  const returnLinkState = useReturnLinkState();
  const { encounter, patient } = row;
  const patientId = emergencyPatientId(encounter);
  const patientName = patient ? displayName(patient) : (encounter.subject?.display ?? "");
  const level = emergencyTriageLevel(encounter);
  const active = isEmergencyActive(encounter);
  const status = encounter.status;
  const arrivalMode = emergencyArrivalMode(encounter);
  const provisional = isProvisionalPatient(patient);
  const examStartedAt = emergencyExamStartedAt(encounter);
  // 滞在中は来院からの経過、転帰確定は滞在した長さ。
  const elapsed = active
    ? elapsedLabel(encounter.period?.start, now)
    : encounter.period?.end
      ? elapsedLabel(encounter.period.start, new Date(encounter.period.end))
      : "";

  return (
    <tr className={active ? undefined : "emergency__row--finished"}>
      <td className="emergency__jtas sticky-table__fix-1">
        {level ? (
          <span className={`jtas-badge jtas--${level}`} title={`JTAS ${level} ${jtasLabel(level)}`}>
            {level}
          </span>
        ) : (
          <span className="jtas-badge jtas-badge--none" title="未判定">
            -
          </span>
        )}
      </td>
      <td className="outpatient__time sticky-table__fix-2">
        {arrivalTimeLabel(encounter.period?.start)}
        {elapsed && (
          <span
            className="outpatient__wait"
            title={examStartedAt ? `診察開始 ${dateTimeLabel(examStartedAt)}` : undefined}
          >
            {elapsed}
          </span>
        )}
      </td>
      <td className="sticky-table__fix-3">{patient?.identifier?.[0]?.value ?? "-"}</td>
      <td className="sticky-table__fix-4">
        <span className="outpatient__name-cell">
          {provisional && <span className="emergency__provisional">仮</span>}
          <span className="outpatient__name">
            {patientName || "-"}
            <PatientKana patient={patient} />
          </span>
          {pictograms}
        </span>
      </td>
      <PatientProfileCells patient={patient} />
      <td>
        {arrivalMode ? (
          <span className={`emergency__arrival emergency__arrival--${arrivalMode}`}>
            {arrivalModeMark(arrivalMode) && (
              <span className="emergency__arrival-mark" aria-hidden="true">
                {arrivalModeMark(arrivalMode)}
              </span>
            )}
            {arrivalModeLabel(arrivalMode)}
          </span>
        ) : (
          "-"
        )}
      </td>
      <td className="emergency__complaint-cell" title={emergencyComplaint(encounter)}>
        {emergencyComplaint(encounter) || "-"}
      </td>
      <td>{emergencyBedName(encounter) || "-"}</td>
      <td>{emergencyAttendingName(encounter) || "-"}</td>
      <td>
        <span className={`outpatient__status emergency__status--${status}`}>
          {status === "finished"
            ? dispositionLabel(emergencyDisposition(encounter)) || emergencyStatusLabel(status)
            : emergencyStatusLabel(status)}
        </span>
      </td>
      <td className="outpatient__orders-cell">{orders}</td>
      <td className="outpatient__actions sticky-table__fix-actions">
        {(status === "arrived" || status === "triaged") && (
          <button type="button" disabled={pending} onClick={status === "arrived" ? onTriage : onStartExam}>
            {status === "arrived" ? "トリアージ" : "診察開始"}
          </button>
        )}
        {status === "in-progress" && (
          <button type="button" disabled={pending} onClick={onDisposition}>
            転帰
          </button>
        )}
        {patientId && (
          <Link className="button" to={`/patients/${patientId}/karte`} state={returnLinkState}>
            カルテ
          </Link>
        )}
        <RowMenu label="この受診の操作" escapesClipping>
          {active && (
            <button type="button" className="row-menu__item" disabled={pending} onClick={onTriage}>
              {level ? "再トリアージ" : "トリアージ"}
            </button>
          )}
          {status === "arrived" && (
            <button type="button" className="row-menu__item" disabled={pending} onClick={onStartExam}>
              診察開始
            </button>
          )}
          {(status === "arrived" || status === "triaged") && (
            <button type="button" className="row-menu__item" disabled={pending} onClick={onDisposition}>
              転帰
            </button>
          )}
          <button type="button" className="row-menu__item" disabled={pending} onClick={onEdit}>
            来院情報の編集
          </button>
          {provisional && onIdentify && (
            <button type="button" className="row-menu__item" disabled={pending} onClick={onIdentify}>
              身元判明
            </button>
          )}
          {status === "in-progress" && (
            <button
              type="button"
              className="row-menu__item"
              disabled={pending}
              onClick={onCancelExamStart}
            >
              診察開始を取り消す
            </button>
          )}
          {status === "finished" && (
            <button
              type="button"
              className="row-menu__item"
              disabled={pending}
              onClick={onCancelDisposition}
            >
              転帰を取り消す
            </button>
          )}
          {active && status !== "in-progress" && (
            <button
              type="button"
              className="row-menu__item row-menu__item--danger"
              disabled={pending}
              onClick={onCancel}
            >
              受付を取り消す
            </button>
          )}
        </RowMenu>
      </td>
    </tr>
  );
}
