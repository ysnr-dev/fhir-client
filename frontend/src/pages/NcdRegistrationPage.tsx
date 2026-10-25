import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useFacilitySettings, useNcdRegistrations, useNcdSurgeries, useSelfDepartments } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { PatientKana } from "../components/PatientRowCells";
import { TruncatedNotice } from "../components/TruncatedNotice";
import { cancerRegistryCsv } from "../fhir/cancerRegistryHelpers";
import {
  DEFAULT_NCD_REGISTRATION,
  NCD_FOLLOW_UP_DAYS,
  NCD_REGISTRATION_STATE_LABELS,
  defaultNcdFrom,
  ncdRegistrationRows,
  surgeryNameOf,
  type NcdRegistrationRow,
  type NcdRegistrationState,
} from "../fhir/ncdHelpers";
import { calculateAge, displayName, genderLabel, patientNumberOf } from "../fhir/patientHelpers";
import { containedPractitionerName } from "../fhir/questionnaireResponseHelpers";
import { formatKarteDetail, formatKarteOpen, KARTE_DETAIL_PARAM, KARTE_OPEN_PARAM } from "../karteUrl";
import { csvBlob } from "../lib/csv";
import { today } from "../lib/dates";
import { downloadBlob } from "../lib/download";
import { useReturnLinkState } from "../returnTo";

// NCD の症例登録(docs/ncd-registration-design.md §4)。手術の実施記録を入室日の期間で並べ、症例登録のテンプレートの
// 回答(partOf でハブを指す)で登録の状況を出す。行の「登録」からカルテの右ペインで症例登録を書き始め、
// 登録済の回答は項目順の CSV に出す。

interface Filters {
  state: "" | NcdRegistrationState;
  departmentId: string;
}

const emptyFilters: Filters = { state: "", departmentId: "" };

export function NcdRegistrationPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const todayValue = today();
  const from = searchParams.get("from") || defaultNcdFrom(todayValue);
  const to = searchParams.get("to") || todayValue;
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const returnLinkState = useReturnLinkState();

  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const facility = useFacilitySettings();
  const templateUrl = (facility.data?.ncd_registration ?? DEFAULT_NCD_REGISTRATION).template;
  const departments = useSelfDepartments();
  const surgeries = useNcdSurgeries(from, to, filters.departmentId);
  const patientIds = useMemo(
    () => (surgeries.data?.surgeries ?? []).map((s) => s.hub.subject?.reference?.split("/").pop() ?? ""),
    [surgeries.data],
  );
  const registrations = useNcdRegistrations(templateUrl, patientIds);

  const rows = useMemo(
    () => ncdRegistrationRows(surgeries.data?.surgeries ?? [], registrations.data?.responses ?? [], todayValue),
    [surgeries.data, registrations.data, todayValue],
  );
  const visible = rows.filter((row) => !filters.state || row.state === filters.state);
  const doneCount = visible.filter((row) => row.state === "done").length;
  const loading = surgeries.isLoading || registrations.isLoading || facility.isLoading;
  const patientsById = surgeries.data?.patients ?? new Map<string, fhir4.Patient>();

  function setRange(key: "from" | "to", value: string) {
    const params = new URLSearchParams(searchParams);
    if (value) params.set(key, value);
    else params.delete(key);
    setSearchParams(params);
  }

  function exportCsv() {
    const done = visible
      .filter((row) => row.state === "done" && row.response)
      .map((row) => row.response as fhir4.QuestionnaireResponse);
    const { header, rows: body } = cancerRegistryCsv(registrations.data?.questionnaires ?? [], done);
    downloadBlob(csvBlob(header, body), `ncd-cases-${from}-${to}.csv`);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>NCD症例登録</h1>
        <div className="page__header-actions">
          <button type="button" onClick={exportCsv} disabled={doneCount === 0}>
            CSV
          </button>
        </div>
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
          依頼科
          <select
            value={filters.departmentId}
            onChange={(e) => setFilters({ ...filters, departmentId: e.target.value })}
          >
            <option value="">すべて</option>
            {departments.departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
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
            {(Object.keys(NCD_REGISTRATION_STATE_LABELS) as NcdRegistrationState[]).map((state) => (
              <option key={state} value={state}>
                {NCD_REGISTRATION_STATE_LABELS[state]}
              </option>
            ))}
          </select>
        </label>
        <div className="patient-search-form__actions">
          <button type="button" onClick={() => setFilters(emptyFilters)}>
            クリア
          </button>
        </div>
      </form>

      <ErrorBanner error={surgeries.error} />
      <ErrorBanner error={registrations.error} />
      <ErrorBanner error={facility.error} />
      <ErrorBanner error={departments.error} />
      <TruncatedNotice show={surgeries.data?.truncated || registrations.data?.truncated} />

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
                  <th className="lab-worklist__compact">手術日</th>
                  <th>術式</th>
                  <th className="lab-worklist__compact">依頼科</th>
                  <th className="lab-worklist__compact">予定区分</th>
                  <th className="lab-worklist__compact">執刀医</th>
                  <th className="lab-worklist__compact">術後日数</th>
                  <th className="lab-worklist__compact">登録</th>
                  <th className="lab-worklist__compact">登録日</th>
                  <th className="lab-worklist__compact">記入者</th>
                  <th className="lab-worklist__compact"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const patient = patientsById.get(row.patientId);
                  const surgeon = row.record.staff
                    .filter((s) => s.role === "surgeon")
                    .map((s) => s.name)
                    .join("、");
                  const followUpDone = row.postoperativeDays !== null && row.postoperativeDays >= NCD_FOLLOW_UP_DAYS;
                  return (
                    <tr key={row.hub.id}>
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
                      <td className="lab-worklist__compact">{row.surgeryDate || "-"}</td>
                      <td>{surgeryNameOf(row.record, row.hub)}</td>
                      <td className="lab-worklist__compact">{row.departmentName}</td>
                      <td className="lab-worklist__compact">{row.priorityDisplay}</td>
                      <td className="lab-worklist__compact">{surgeon}</td>
                      <td className={`lab-worklist__compact${followUpDone && row.state !== "done" ? " admission-documents__overdue" : ""}`}>
                        {row.postoperativeDays ?? "-"}
                      </td>
                      <td className={`lab-worklist__compact admission-documents__cell--${row.state === "written" ? "draft" : row.state}`}>
                        {NCD_REGISTRATION_STATE_LABELS[row.state]}
                      </td>
                      <td className="lab-worklist__compact">{row.registeredOn}</td>
                      <td className="lab-worklist__compact">
                        {row.response ? containedPractitionerName(row.response) : ""}
                      </td>
                      <td className="master-search__actions cancer-registry__actions">
                        <Link className="button" to={registrationHref(row, templateUrl)} state={returnLinkState}>
                          {row.state === "missing" ? "登録" : "開く"}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={14} className="master-search__empty">
                      {rows.length === 0 ? "手術の実施記録はありません。" : "絞り込みに一致する手術がありません。"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="order-select__muted lab-worklist__count">
            {visible.length} 件 / 登録済 {doneCount} 件
          </p>
        </>
      )}
    </div>
  );
}

/** 行の操作の行き先。未登録ならカルテで症例登録を始め、記入中・記入済・登録済はその回答の詳細を開く。 */
function registrationHref(row: NcdRegistrationRow, templateUrl: string): string {
  const params = new URLSearchParams();
  if (row.response?.id) {
    params.set(KARTE_DETAIL_PARAM, formatKarteDetail({ kind: "qr", id: row.response.id }));
  } else {
    params.set(
      KARTE_OPEN_PARAM,
      formatKarteOpen({ kind: "procedure-template", procedureId: row.hub.id ?? "", url: templateUrl }),
    );
  }
  return `/patients/${row.patientId}/karte?${params.toString()}`;
}
