import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAnesthesiaPreopList, useFacilitySettings } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { RowPictograms } from "../components/PatientListRowParts";
import { PatientKana, PatientProfileCells, PatientProfileHeadCells } from "../components/PatientRowCells";
import { TruncatedNotice } from "../components/TruncatedNotice";
import {
  ANESTHESIA_PREOP_STATE_LABELS,
  DEFAULT_ANESTHESIA_PREOP,
  summarizeAnesthesiaPreop,
} from "../fhir/anesthesiaPreopHelpers";
import type { TemplateRecordState } from "../fhir/conditionTemplateHelpers";
import { displayName, patientNumberOf } from "../fhir/patientHelpers";
import {
  SURGERY_ANESTHESIA_MANAGEMENT_OPTIONS,
  summarizeSurgeryOrder,
  surgeryAnesthesiaManagementDisplay,
  surgeryAnesthesiaMethodDisplay,
  surgeryOrderItems,
} from "../fhir/surgeryOrderHelpers";
import { useRowPictogramSources } from "../hooks/useRowPictogramSources";
import { anesthesiaPreopKarteHref } from "../karteUrl";
import { addDays, today } from "../lib/dates";
import { useReturnLinkState } from "../returnTo";

// 麻酔科術前診察の一覧(docs/anesthesia-preop-design.md §4)。手術予定日の期間と日程未定の手術を、術前診察の
// 状況と評価の列つきで並べる。行の「記入」からカルテの右ペインで術前診察を書き始める。

/** 既定で何日先の手術まで出すか。術前外来は手術の 2 週間前までに受けることが多い。 */
const DEFAULT_RANGE_DAYS = 14;

interface Filters {
  management: string;
  anesthesiologist: string;
  state: "" | TemplateRecordState;
}

const defaultFilters: Filters = { management: "anesthesiologist", anesthesiologist: "", state: "" };

export function AnesthesiaPreopPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const todayValue = today();
  const from = searchParams.get("from") || todayValue;
  const to = searchParams.get("to") || addDays(todayValue, DEFAULT_RANGE_DAYS);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const returnLinkState = useReturnLinkState();

  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const facility = useFacilitySettings();
  const templateUrl = (facility.data?.anesthesia_preop ?? DEFAULT_ANESTHESIA_PREOP).template;
  const list = useAnesthesiaPreopList(from, to);

  const rows = useMemo(
    () =>
      (list.data?.rows ?? []).map((row) => {
        const summary = summarizeSurgeryOrder(row.order);
        return {
          ...row,
          summary,
          anesthesiologist: summary.staff.find((line) => line.role === "anesthetist")?.practitionerName ?? "",
          preop: summarizeAnesthesiaPreop(row.anesthesiaPreop),
        };
      }),
    [list.data],
  );
  const anesthesiologists = [...new Set(rows.map((row) => row.anesthesiologist).filter(Boolean))].sort();
  const visible = rows.filter(
    (row) =>
      (!filters.management || row.summary.anesthesiaManagement === filters.management) &&
      (!filters.anesthesiologist || row.anesthesiologist === filters.anesthesiologist) &&
      (!filters.state || row.preop.state === filters.state),
  );
  const doneCount = visible.filter((row) => row.preop.state === "done").length;
  const patientIds = useMemo(
    () => rows.map((row) => row.patient?.id ?? "").filter(Boolean),
    [rows],
  );
  const pictograms = useRowPictogramSources(patientIds);

  function setRange(key: "from" | "to", value: string) {
    const params = new URLSearchParams(searchParams);
    if (value) params.set(key, value);
    else params.delete(key);
    setSearchParams(params);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>麻酔科術前診察</h1>
      </div>

      <form className="patient-search-form" onSubmit={(e: FormEvent) => e.preventDefault()}>
        <label>
          手術日
          <span className="cancer-registry__range">
            <input type="date" value={from} onChange={(e) => setRange("from", e.target.value)} />
            〜
            <input type="date" aria-label="手術日の終わり" value={to} onChange={(e) => setRange("to", e.target.value)} />
          </span>
        </label>
        <label>
          管理区分
          <select
            value={filters.management}
            onChange={(e) => setFilters({ ...filters, management: e.target.value })}
          >
            <option value="">すべて</option>
            {SURGERY_ANESTHESIA_MANAGEMENT_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.display}
              </option>
            ))}
          </select>
        </label>
        <label>
          麻酔科医
          <select
            value={filters.anesthesiologist}
            onChange={(e) => setFilters({ ...filters, anesthesiologist: e.target.value })}
          >
            <option value="">すべて</option>
            {anesthesiologists.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          状況
          <select
            value={filters.state}
            onChange={(e) => setFilters({ ...filters, state: e.target.value as Filters["state"] })}
          >
            <option value="">すべて</option>
            {(Object.keys(ANESTHESIA_PREOP_STATE_LABELS) as TemplateRecordState[]).map((state) => (
              <option key={state} value={state}>
                {ANESTHESIA_PREOP_STATE_LABELS[state]}
              </option>
            ))}
          </select>
        </label>
        <div className="patient-search-form__actions">
          <button type="button" onClick={() => setFilters(defaultFilters)}>
            クリア
          </button>
        </div>
      </form>

      <ErrorBanner error={list.error} />
      <ErrorBanner error={facility.error} />
      <TruncatedNotice show={list.data?.truncated} />

      {list.isLoading || facility.isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <div className="lab-worklist-wrap sticky-table-wrap">
            <table className="lab-worklist sticky-table">
              <thead>
                <tr>
                  <th className="lab-worklist__compact">手術日</th>
                  <th className="lab-worklist__compact">患者番号</th>
                  <th>患者</th>
                  <PatientProfileHeadCells />
                  <th>術式</th>
                  <th className="lab-worklist__compact">麻酔方法</th>
                  <th className="lab-worklist__compact">管理区分</th>
                  <th className="lab-worklist__compact">麻酔科医</th>
                  <th className="lab-worklist__compact">状況</th>
                  <th className="lab-worklist__compact">ASA</th>
                  <th className="lab-worklist__compact">NYHA</th>
                  <th className="lab-worklist__compact">Mallampati</th>
                  <th className="lab-worklist__compact">予測困難気道</th>
                  <th className="lab-worklist__compact">診察日</th>
                  <th className="lab-worklist__compact">記入者</th>
                  <th className="lab-worklist__compact sticky-table__fix-actions"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const { summary, preop, patient } = row;
                  const items = surgeryOrderItems(row.order, row.itemRequests);
                  return (
                    <tr key={row.order.id}>
                      <td className="lab-worklist__compact">
                        {summary.scheduledDate
                          ? `${summary.scheduledDate} ${summary.scheduledTime}`.trim()
                          : "日程未定"}
                      </td>
                      <td className="lab-worklist__compact">{patient ? patientNumberOf(patient) : ""}</td>
                      <td>
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
                      <td>{items[0]?.name || "術式なし"}</td>
                      <td className="lab-worklist__compact">
                        {summary.anesthesiaMethods.map(surgeryAnesthesiaMethodDisplay).join("・") || "-"}
                      </td>
                      <td className="lab-worklist__compact">
                        {surgeryAnesthesiaManagementDisplay(summary.anesthesiaManagement) || "-"}
                      </td>
                      <td className="lab-worklist__compact">{row.anesthesiologist || "-"}</td>
                      <td className={`lab-worklist__compact admission-documents__cell--${preop.state}`}>
                        {ANESTHESIA_PREOP_STATE_LABELS[preop.state]}
                      </td>
                      <td className="lab-worklist__compact">{preop.asa}</td>
                      <td className="lab-worklist__compact">{preop.nyha}</td>
                      <td className="lab-worklist__compact">{preop.mallampati}</td>
                      <td className={`lab-worklist__compact${preop.isDifficultAirway ? " admission-documents__overdue" : ""}`}>
                        {preop.difficultAirway}
                      </td>
                      <td className="lab-worklist__compact">{preop.authoredOn}</td>
                      <td className="lab-worklist__compact">{preop.authorName}</td>
                      <td className="master-search__actions cancer-registry__actions sticky-table__fix-actions">
                        <Link
                          className="button"
                          to={anesthesiaPreopKarteHref(row.order, row.anesthesiaPreop, templateUrl)}
                          state={returnLinkState}
                        >
                          {preop.state === "missing" ? "記入" : "開く"}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={17} className="master-search__empty">
                      {rows.length === 0 ? "対象の手術はありません。" : "絞り込みに一致する手術がありません。"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="order-select__muted lab-worklist__count">
            {visible.length} 件 / 済 {doneCount} 件
          </p>
        </>
      )}
    </div>
  );
}
