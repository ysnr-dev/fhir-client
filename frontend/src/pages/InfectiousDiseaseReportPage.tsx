import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useFacilitySettings, useInfectiousDiseaseReports, useNotifiableConditions } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { PatientKana } from "../components/PatientRowCells";
import { TruncatedNotice } from "../components/TruncatedNotice";
import { summarizeCondition } from "../fhir/conditionHelpers";
import {
  DEFAULT_INFECTIOUS_DISEASE_REPORT,
  INFECTIOUS_REPORT_STATE_LABELS,
  deadlineLabel,
  defaultInfectiousReportFrom,
  infectiousDiseaseReportRows,
  type InfectiousDiseaseReportRow,
  type InfectiousReportState,
  type NotifiableDiseaseClass,
} from "../fhir/infectiousDiseaseReportHelpers";
import { calculateAge, displayName, genderLabel, patientNumberOf } from "../fhir/patientHelpers";
import { containedPractitionerName } from "../fhir/questionnaireResponseHelpers";
import { formatKarteDetail, formatKarteOpen, KARTE_DETAIL_PARAM, KARTE_OPEN_PARAM } from "../karteUrl";
import { today } from "../lib/dates";
import { useReturnLinkState } from "../returnTo";

// 感染症の発生届(docs/infectious-disease-report-design.md §4)。届出対象の感染症(全数把握)に当たる病名を
// 診断日(病名の開始日)の期間で並べ、発生届のテンプレートの回答で届出の状況と期限を出す。
// 行の「届出」からカルテの右ペインで発生届を書き始める。

interface Filters {
  state: "" | InfectiousReportState;
  diseaseClass: "" | NotifiableDiseaseClass;
  overdueOnly: boolean;
}

const emptyFilters: Filters = { state: "", diseaseClass: "", overdueOnly: false };
const CLASSES: NotifiableDiseaseClass[] = ["一類", "二類", "三類", "四類", "五類", "新型インフルエンザ等"];

export function InfectiousDiseaseReportPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const todayValue = today();
  const from = searchParams.get("from") || defaultInfectiousReportFrom(todayValue);
  const to = searchParams.get("to") || todayValue;
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const returnLinkState = useReturnLinkState();

  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const facility = useFacilitySettings();
  const templateUrl = (facility.data?.infectious_disease_report ?? DEFAULT_INFECTIOUS_DISEASE_REPORT).template;
  const candidates = useNotifiableConditions(from, to);
  const conditions = useMemo(() => candidates.data?.conditions ?? [], [candidates.data]);
  const patientIds = useMemo(() => conditions.map((c) => c.subject?.reference?.split("/").pop() ?? ""), [conditions]);
  const reports = useInfectiousDiseaseReports(templateUrl, patientIds);

  const rows = useMemo(
    () => infectiousDiseaseReportRows(conditions, reports.data?.responses ?? [], todayValue),
    [conditions, reports.data, todayValue],
  );
  const visible = rows.filter(
    (row) =>
      (!filters.state || row.state === filters.state) &&
      (!filters.diseaseClass || row.disease.class === filters.diseaseClass) &&
      (!filters.overdueOnly || isOverdue(row)),
  );
  const overdueCount = visible.filter(isOverdue).length;
  const loading = candidates.isLoading || reports.isLoading || facility.isLoading;
  const patientsById = candidates.data?.patients ?? new Map<string, fhir4.Patient>();

  function setRange(key: "from" | "to", value: string) {
    const params = new URLSearchParams(searchParams);
    if (value) params.set(key, value);
    else params.delete(key);
    setSearchParams(params);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>感染症発生届</h1>
      </div>

      <form className="patient-search-form" onSubmit={(e: FormEvent) => e.preventDefault()}>
        <label>
          診断日
          <span className="cancer-registry__range">
            <input type="date" value={from} onChange={(e) => setRange("from", e.target.value)} />
            〜
            <input
              type="date"
              aria-label="診断日の終わり"
              value={to}
              onChange={(e) => setRange("to", e.target.value)}
            />
          </span>
        </label>
        <label>
          類型
          <select
            value={filters.diseaseClass}
            onChange={(e) => setFilters({ ...filters, diseaseClass: e.target.value as Filters["diseaseClass"] })}
          >
            <option value="">すべて</option>
            {CLASSES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          状態
          <select
            value={filters.state}
            onChange={(e) => setFilters({ ...filters, state: e.target.value as Filters["state"] })}
          >
            <option value="">すべて</option>
            {(Object.keys(INFECTIOUS_REPORT_STATE_LABELS) as InfectiousReportState[]).map((state) => (
              <option key={state} value={state}>
                {INFECTIOUS_REPORT_STATE_LABELS[state]}
              </option>
            ))}
          </select>
        </label>
        <label>
          期限
          <select
            value={filters.overdueOnly ? "overdue" : ""}
            onChange={(e) => setFilters({ ...filters, overdueOnly: e.target.value === "overdue" })}
          >
            <option value="">すべて</option>
            <option value="overdue">期限超過</option>
          </select>
        </label>
        <div className="patient-search-form__actions">
          <button type="button" onClick={() => setFilters(emptyFilters)}>
            クリア
          </button>
        </div>
      </form>

      <ErrorBanner error={candidates.error} />
      <ErrorBanner error={reports.error} />
      <ErrorBanner error={facility.error} />
      <TruncatedNotice show={candidates.data?.truncated || reports.data?.truncated} />

      {loading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <div className="lab-worklist-wrap sticky-table-wrap">
            <table className="lab-worklist sticky-table">
              <thead>
                <tr>
                  <th className="lab-worklist__compact">患者番号</th>
                  <th>患者</th>
                  <th className="lab-worklist__compact">性別</th>
                  <th className="lab-worklist__compact">年齢</th>
                  <th>病名</th>
                  <th>届出対象の感染症</th>
                  <th className="lab-worklist__compact">類型</th>
                  <th className="lab-worklist__compact">診断日</th>
                  <th className="lab-worklist__compact">届出期限</th>
                  <th className="lab-worklist__compact">期限日</th>
                  <th className="lab-worklist__compact">届出</th>
                  <th className="lab-worklist__compact">届出日</th>
                  <th className="lab-worklist__compact">記入者</th>
                  <th className="lab-worklist__compact"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const patient = patientsById.get(row.patientId);
                  const overdue = isOverdue(row);
                  return (
                    <tr key={row.condition.id}>
                      <td className="lab-worklist__compact">{patient ? patientNumberOf(patient) : ""}</td>
                      <td>
                        {patient ? (
                          <>
                            <Link to={`/patients/${row.patientId}/karte`} state={returnLinkState}>
                              {displayName(patient)}
                            </Link>
                            <PatientKana patient={patient} />
                          </>
                        ) : (
                          row.patientId
                        )}
                      </td>
                      <td className="lab-worklist__compact">{patient ? genderLabel(patient.gender) : ""}</td>
                      <td className="lab-worklist__compact">
                        {patient?.birthDate ? calculateAge(patient.birthDate, new Date(`${todayValue}T00:00:00`)) : ""}
                      </td>
                      <td>{summarizeCondition(row.condition).name}</td>
                      <td>{row.disease.name}</td>
                      <td className="lab-worklist__compact">{row.disease.class}</td>
                      <td className="lab-worklist__compact">{row.diagnosisDate || "-"}</td>
                      <td className="lab-worklist__compact">{deadlineLabel(row.disease)}</td>
                      <td className={`lab-worklist__compact${overdue ? " admission-documents__overdue" : ""}`}>
                        {row.dueDate || "-"}
                      </td>
                      <td
                        className={`lab-worklist__compact admission-documents__cell--${row.state === "written" ? "draft" : row.state}${
                          overdue ? " admission-documents__cell--overdue" : ""
                        }`}
                      >
                        {INFECTIOUS_REPORT_STATE_LABELS[row.state]}
                      </td>
                      <td className="lab-worklist__compact">{row.notifiedOn}</td>
                      <td className="lab-worklist__compact">
                        {row.response ? containedPractitionerName(row.response) : ""}
                      </td>
                      <td className="master-search__actions cancer-registry__actions">
                        <Link className="button" to={reportHref(row, templateUrl)} state={returnLinkState}>
                          {row.state === "missing" ? "届出" : "開く"}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={14} className="master-search__empty">
                      {rows.length === 0 ? "届出対象の病名はありません。" : "絞り込みに一致する病名がありません。"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="order-select__muted lab-worklist__count">
            {visible.length} 件
            {overdueCount > 0 && <span className="admission-documents__overdue"> / 期限超過 {overdueCount} 件</span>}
          </p>
        </>
      )}
    </div>
  );
}

/** 届出が済んでいないまま期限を過ぎた行。 */
function isOverdue(row: InfectiousDiseaseReportRow): boolean {
  return row.state !== "done" && row.daysLeft !== null && row.daysLeft < 0;
}

/** 行の操作の行き先。未届出ならカルテで発生届を書き始め、記入中・記入済・届出済はその回答の詳細を開く。 */
function reportHref(row: InfectiousDiseaseReportRow, templateUrl: string): string {
  const params = new URLSearchParams();
  if (row.response?.id) {
    params.set(KARTE_DETAIL_PARAM, formatKarteDetail({ kind: "qr", id: row.response.id }));
  } else {
    params.set(
      KARTE_OPEN_PARAM,
      formatKarteOpen({ kind: "condition-template", conditionId: row.condition.id ?? "", url: templateUrl }),
    );
  }
  return `/patients/${row.patientId}/karte?${params.toString()}`;
}
