import { useEffect, useMemo, useState, type ComponentProps } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useRxVerificationQueue, type RxVerificationQueue } from "../api/queries";
import { DateStepper } from "../components/DateStepper";
import { ErrorBanner } from "../components/ErrorBanner";
import { PatientProfileDrawer, useRowDrawer } from "../components/PatientProfileDrawer";
import { RowPictograms } from "../components/PatientListRowParts";
import { PatientKana, PatientProfileCells, PatientProfileHeadCells } from "../components/PatientRowCells";
import { RxInquiryModal } from "../components/RxInquiryModal";
import { RxVerificationModal } from "../components/RxVerificationModal";
import { TruncatedNotice } from "../components/TruncatedNotice";
import { INJECTION_TASK_CODE, injectionTaskStatus, injectionTaskStatusDisplay } from "../fhir/injectionTaskHelpers";
import { hasTaskCode, taskPatientId } from "../fhir/notificationHelpers";
import { wardOf } from "../fhir/orderHeader";
import { displayName } from "../fhir/patientHelpers";
import { rxHoldReasonLabel, rxHoldReasonOf } from "../fhir/rxInquiryHelpers";
import { RX_TASK_CODE, rxTaskStatus, rxTaskStatusDisplay } from "../fhir/rxTaskHelpers";
import {
  interventionOutcomeDisplay,
  rxVerificationOrderId,
  rxVerificationResultLabel,
  rxVerificationResultOf,
  rxVerificationSummaryOf,
  type RxVerificationOrderKind,
} from "../fhir/rxVerificationHelpers";
import { priorityDisplay } from "../fhir/shared";
import { useRowPictogramSources, type RowPictogramSources } from "../hooks/useRowPictogramSources";
import { dateTimeLabel, today } from "../lib/dates";
import { useReturnLinkState } from "../returnTo";

// 処方監査(docs/rx-verification-design.md §3.1)。院内の処方・注射の監査 Task を、未監査は日付を問わず
// 古い順に、監査済は監査日の期間で並べる。行の「監査」で内容・患者の状態・警告を見て監査済にする。

type Tab = "pending" | "verified";

const TABS: { key: Tab; label: string }[] = [
  { key: "pending", label: "未監査" },
  { key: "verified", label: "監査済" },
];

interface Filters {
  kind: "" | RxVerificationOrderKind;
  setting: string;
  urgentOnly: boolean;
}

const emptyFilters: Filters = { kind: "", setting: "", urgentOnly: false };

interface QueueRow {
  task: fhir4.Task;
  patient?: fhir4.Patient;
  order?: fhir4.ServiceRequest;
  /** 起点のオーダーの進捗(調剤・注射)。まだ無ければ依頼済。 */
  progress?: fhir4.Task;
}

function rowsOf(queue: RxVerificationQueue | undefined): QueueRow[] {
  if (!queue) return [];
  return queue.tasks.map((task) => {
    const orderId = rxVerificationOrderId(task) ?? "";
    const orderTasks = queue.orderTasks.get(orderId) ?? [];
    return {
      task,
      patient: queue.patients.get(taskPatientId(task)),
      order: queue.orders.get(orderId),
      progress: orderTasks.find(
        (t) => hasTaskCode(t, RX_TASK_CODE.code) || hasTaskCode(t, INJECTION_TASK_CODE.code),
      ),
    };
  });
}

function isUrgent(task: fhir4.Task): boolean {
  return Boolean(task.priority && task.priority !== "routine");
}

function matchesFilters(row: QueueRow, filters: Filters): boolean {
  const summary = rxVerificationSummaryOf(row.task);
  if (filters.kind && summary.kind !== filters.kind) return false;
  if (filters.setting && summary.setting !== filters.setting) return false;
  if (filters.urgentOnly && !isUrgent(row.task)) return false;
  return true;
}

function progressLabel(row: QueueRow): string {
  const hold = rxHoldReasonOf(row.progress);
  if (hold) return rxHoldReasonLabel(hold);
  return rxVerificationSummaryOf(row.task).kind === "injection"
    ? injectionTaskStatusDisplay(injectionTaskStatus(row.progress))
    : rxTaskStatusDisplay(rxTaskStatus(row.progress));
}

export function RxVerificationPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab = searchParams.get("tab") === "verified" ? "verified" : "pending";
  const [date, setDate] = useState(today);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  // 開いている監査・疑義照会は Task の id で覚え、読み直しのたびに引き直す。
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [inquiringId, setInquiringId] = useState<string | null>(null);

  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const queue = useRxVerificationQueue(tab, { from: date, to: date });
  const allRows = useMemo(() => rowsOf(queue.data), [queue.data]);
  const rows = useMemo(() => {
    const filtered = allRows.filter((row) => matchesFilters(row, filters));
    // 未監査は至急を先に、同じ区分の中は届いた順(上流の並び)のまま。
    return tab === "pending" ? [...filtered].sort((a, b) => Number(isUrgent(b.task)) - Number(isUrgent(a.task))) : filtered;
  }, [allRows, filters, tab]);
  const settingOptions = useMemo(
    () => [...new Set(allRows.map((row) => rxVerificationSummaryOf(row.task).setting).filter(Boolean))],
    [allRows],
  );
  const verifying = allRows.find((row) => row.task.id === verifyingId);
  const inquiring = allRows.find((row) => row.task.id === inquiringId);

  const patientIds = useMemo(() => rows.flatMap((row) => (row.patient?.id ? [row.patient.id] : [])), [rows]);
  const pictograms = useRowPictogramSources(patientIds);
  const drawer = useRowDrawer();
  const selectedRow = rows.find((row) => row.patient?.id && row.task.id === drawer.selectedKey);

  return (
    <div className="page">
      <div className="page__header">
        <h1>処方監査</h1>
      </div>

      <div className="order-select__tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={tab === t.key ? "order-select__tab is-active" : "order-select__tab"}
            onClick={() => setSearchParams(t.key === "pending" ? {} : { tab: t.key })}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="patient-search-form">
        {tab === "verified" && (
          <label>
            監査日
            <DateStepper value={date} onChange={(value) => value && setDate(value)} />
          </label>
        )}
        <label>
          種別
          <select
            value={filters.kind}
            onChange={(e) => setFilters({ ...filters, kind: e.target.value as Filters["kind"] })}
          >
            <option value="">すべて</option>
            <option value="prescription">処方</option>
            <option value="injection">注射</option>
          </select>
        </label>
        <label>
          入外区分
          <select value={filters.setting} onChange={(e) => setFilters({ ...filters, setting: e.target.value })}>
            <option value="">すべて</option>
            {settingOptions.map((setting) => (
              <option key={setting} value={setting}>
                {setting}
              </option>
            ))}
          </select>
        </label>
        <label className="dose-conversion__checkbox rx-verification__urgent-only">
          <input
            type="checkbox"
            checked={filters.urgentOnly}
            onChange={(e) => setFilters({ ...filters, urgentOnly: e.target.checked })}
          />
          至急のみ
        </label>
      </div>

      <ErrorBanner error={queue.error} />
      <TruncatedNotice show={queue.data?.truncated} />

      {queue.isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <div className="lab-worklist-wrap sticky-table-wrap">
            <table className="lab-worklist sticky-table">
              <thead>
                <tr>
                  <th className="sticky-table__fix-1">患者番号</th>
                  <th className="sticky-table__fix-2">患者氏名</th>
                  <PatientProfileHeadCells />
                  <th className="lab-worklist__compact">処方日</th>
                  <th className="lab-worklist__compact">種別</th>
                  <th className="rx-worklist__content">内容</th>
                  <th className="lab-worklist__compact">病棟</th>
                  <th>依頼科 | 依頼医師</th>
                  {tab === "pending" ? (
                    <th className="lab-worklist__compact">進捗</th>
                  ) : (
                    <>
                      <th>監査結果</th>
                      <th className="lab-worklist__compact">監査</th>
                    </>
                  )}
                  <th className="lab-worklist__actions sticky-table__fix-actions"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <QueueTableRow
                    key={row.task.id}
                    row={row}
                    tab={tab}
                    pictograms={pictograms}
                    rowProps={drawer.rowProps(row.patient?.id && row.task.id)}
                    onVerify={() => setVerifyingId(row.task.id ?? null)}
                    onInquire={() => setInquiringId(row.task.id ?? null)}
                  />
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={12} className="master-search__empty">
                      {allRows.length > 0
                        ? "絞り込みに該当するものがありません"
                        : tab === "pending"
                          ? "未監査の処方・注射はありません"
                          : "この日に監査したものはありません"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="order-select__muted lab-worklist__count">{rows.length} 件</p>
        </>
      )}

      {selectedRow?.patient?.id && (
        <PatientProfileDrawer
          patientId={selectedRow.patient.id}
          patient={selectedRow.patient}
          actions={
            <RowButtons
              row={selectedRow}
              tab={tab}
              onVerify={() => setVerifyingId(selectedRow.task.id ?? null)}
              onInquire={() => setInquiringId(selectedRow.task.id ?? null)}
            />
          }
          onClose={drawer.close}
        />
      )}
      {verifying && (
        <RxVerificationModal
          task={verifying.task}
          patient={verifying.patient}
          onInquire={
            verifying.order
              ? () => {
                  setVerifyingId(null);
                  setInquiringId(verifying.task.id ?? null);
                }
              : undefined
          }
          onClose={() => setVerifyingId(null)}
        />
      )}
      {inquiring?.order && (
        <RxInquiryModal
          kind={rxVerificationSummaryOf(inquiring.task).kind}
          order={inquiring.order}
          orderLabel={inquiring.task.description ?? ""}
          onClose={() => setInquiringId(null)}
        />
      )}
    </div>
  );
}

function QueueTableRow({
  row,
  tab,
  pictograms,
  rowProps,
  onVerify,
  onInquire,
}: {
  row: QueueRow;
  tab: Tab;
  pictograms: RowPictogramSources;
  rowProps: ComponentProps<"tr">;
  onVerify: () => void;
  onInquire: () => void;
}) {
  const returnLinkState = useReturnLinkState();
  const { task, patient, order } = row;
  const summary = rxVerificationSummaryOf(task);
  const result = rxVerificationResultOf(task);
  const priority = isUrgent(task) ? priorityDisplay(task.priority) : "";
  const head = [summary.setting, summary.category].filter(Boolean).join(" ");

  return (
    <tr {...rowProps} className={`${rowProps.className ?? ""}${priority ? " rx-verification__row--urgent" : ""}`}>
      <td className="sticky-table__fix-1">{patient?.identifier?.[0]?.value ?? "-"}</td>
      <td className="sticky-table__fix-2">
        {patient ? (
          <>
            <Link to={`/patients/${patient.id}/karte`} state={returnLinkState}>
              {displayName(patient)}
            </Link>
            <PatientKana patient={patient} />
            <RowPictograms patientId={patient.id ?? ""} {...pictograms} />
          </>
        ) : (
          "-"
        )}
      </td>
      <PatientProfileCells patient={patient} />
      <td className="lab-worklist__compact">{summary.orderDate || "-"}</td>
      <td className="lab-worklist__compact">
        {summary.kind === "injection" ? "注射" : "処方"}
        {head && <span className="order-select__muted"> {head}</span>}
        {priority && <span className="rx-verification__urgent">{priority}</span>}
      </td>
      <td className="rx-worklist__content">
        <span className="rx-worklist__medicines" title={summary.medicines.join("・")}>
          {summary.medicines.join("・") || "-"}
        </span>
        {summary.periodLabel && <span className="order-select__muted"> {summary.periodLabel}</span>}
        {summary.reverify && <span className="rx-verification__reverify">再監査</span>}
      </td>
      <td className="lab-worklist__compact">{(order && wardOf(order).wardName) || "-"}</td>
      <td>{[summary.departmentName, summary.requesterName].filter(Boolean).join(" | ") || "-"}</td>
      {tab === "pending" ? (
        <td className="lab-worklist__compact">{progressLabel(row)}</td>
      ) : (
        <>
          <td>
            {rxVerificationResultLabel(result) || "-"}
            {result?.outcome && (
              <span className="order-select__muted"> {interventionOutcomeDisplay(result.outcome)}</span>
            )}
          </td>
          <td className="lab-worklist__compact">
            {summary.verifierName || "-"}
            <span className="order-select__muted"> {dateTimeLabel(summary.verifiedAt)}</span>
          </td>
        </>
      )}
      <td className="lab-worklist__actions sticky-table__fix-actions">
        <RowButtons row={row} tab={tab} onVerify={onVerify} onInquire={onInquire} />
      </td>
    </tr>
  );
}

function RowButtons({
  row,
  tab,
  onVerify,
  onInquire,
}: {
  row: QueueRow;
  tab: Tab;
  onVerify: () => void;
  onInquire: () => void;
}) {
  return (
    <>
      <button type="button" onClick={onVerify}>
        {tab === "pending" ? "監査" : "表示"}
      </button>
      {tab === "pending" && row.order && (
        <button type="button" onClick={onInquire}>
          疑義照会
        </button>
      )}
    </>
  );
}
