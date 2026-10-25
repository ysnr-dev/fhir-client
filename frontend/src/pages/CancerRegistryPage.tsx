import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useCancerRegistryCandidates, useCancerRegistryResponses, useFacilitySettings } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { PatientKana } from "../components/PatientRowCells";
import { TruncatedNotice } from "../components/TruncatedNotice";
import {
  CANCER_REGISTRATION_STATE_LABELS,
  cancerRegistryCsv,
  cancerRegistryRows,
  DEFAULT_CANCER_REGISTRY,
  defaultCancerRegistryFrom,
  isUnreportedStatus,
  type CancerRegistrationState,
  type CancerRegistryRow,
} from "../fhir/cancerRegistryHelpers";
import { summarizeCondition } from "../fhir/conditionHelpers";
import { calculateAge, displayName, genderLabel, patientNumberOf } from "../fhir/patientHelpers";
import { containedPractitionerName } from "../fhir/questionnaireResponseHelpers";
import { formatKarteDetail, formatKarteOpen, KARTE_DETAIL_PARAM, KARTE_OPEN_PARAM } from "../karteUrl";
import { csvBlob } from "../lib/csv";
import { today } from "../lib/dates";
import { downloadBlob } from "../lib/download";
import { useReturnLinkState } from "../returnTo";

// 院内がん登録(docs/cancer-registry-design.md §4)。登録対象の病名(ICD-10 が悪性新生物などに当たる Condition)を
// 診断日(病名の開始日)の期間で並べ、施設設定のテンプレートへの回答で登録・届出の状況を出す。
// 行の「登録」からカルテの右ペインで登録を始め、登録済の回答は項目順の CSV に出す。

interface Filters {
  state: "" | CancerRegistrationState;
  unreportedOnly: boolean;
}

const emptyFilters: Filters = { state: "", unreportedOnly: false };

export function CancerRegistryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const todayValue = today();
  const from = searchParams.get("from") || defaultCancerRegistryFrom(todayValue);
  const to = searchParams.get("to") || todayValue;
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const returnLinkState = useReturnLinkState();

  // 列が多いのでこの画面だけ幅を広げる(他の一覧と同じ)。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const facility = useFacilitySettings();
  const templateUrl = (facility.data?.cancer_registry ?? DEFAULT_CANCER_REGISTRY).template;
  const candidates = useCancerRegistryCandidates(from, to);
  const conditions = useMemo(() => candidates.data?.conditions ?? [], [candidates.data]);
  const patientIds = useMemo(
    () => conditions.map((c) => c.subject?.reference?.split("/").pop() ?? ""),
    [conditions],
  );
  const responses = useCancerRegistryResponses(templateUrl, patientIds);

  const rows = useMemo(
    () => cancerRegistryRows(conditions, responses.data?.responses ?? []),
    [conditions, responses.data],
  );
  const visible = rows.filter(
    (row) =>
      (!filters.state || row.state === filters.state) &&
      (!filters.unreportedOnly || isUnreportedStatus(row.reportStatusCode)),
  );
  const loading = candidates.isLoading || responses.isLoading || facility.isLoading;
  const patientsById = candidates.data?.patients ?? new Map<string, fhir4.Patient>();

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
    const { header, rows: body } = cancerRegistryCsv(responses.data?.questionnaires ?? [], done);
    downloadBlob(csvBlob(header, body), `cancer-registry-${from}-${to}.csv`);
  }

  const doneCount = visible.filter((row) => row.state === "done").length;

  return (
    <div className="page">
      <div className="page__header">
        <h1>院内がん登録</h1>
        <div className="page__header-actions">
          <button type="button" onClick={exportCsv} disabled={doneCount === 0}>
            CSV
          </button>
        </div>
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
          状態
          <select
            value={filters.state}
            onChange={(e) => setFilters({ ...filters, state: e.target.value as Filters["state"] })}
          >
            <option value="">すべて</option>
            {(Object.keys(CANCER_REGISTRATION_STATE_LABELS) as CancerRegistrationState[]).map((state) => (
              <option key={state} value={state}>
                {CANCER_REGISTRATION_STATE_LABELS[state]}
              </option>
            ))}
          </select>
        </label>
        <label>
          届出
          <select
            value={filters.unreportedOnly ? "unreported" : ""}
            onChange={(e) => setFilters({ ...filters, unreportedOnly: e.target.value === "unreported" })}
          >
            <option value="">すべて</option>
            <option value="unreported">未届出</option>
          </select>
        </label>
        <div className="patient-search-form__actions">
          <button type="button" onClick={() => setFilters(emptyFilters)}>
            クリア
          </button>
        </div>
      </form>

      <ErrorBanner error={candidates.error} />
      <ErrorBanner error={responses.error} />
      <ErrorBanner error={facility.error} />
      <TruncatedNotice show={candidates.data?.truncated || responses.data?.truncated} />

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
                  <th className="lab-worklist__compact">ICD-10</th>
                  <th className="lab-worklist__compact">診断日</th>
                  <th className="lab-worklist__compact">転帰</th>
                  <th className="lab-worklist__compact">登録</th>
                  <th className="lab-worklist__compact">登録日</th>
                  <th className="lab-worklist__compact">届出状況</th>
                  <th className="lab-worklist__compact">届出日</th>
                  <th className="lab-worklist__compact">登録者</th>
                  <th className="lab-worklist__compact"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const patient = patientsById.get(row.patientId);
                  const summary = summarizeCondition(row.condition);
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
                      <td>{summary.name}</td>
                      <td className="lab-worklist__compact">{row.icd10}</td>
                      <td className="lab-worklist__compact">{row.diagnosisDate || "-"}</td>
                      <td className="lab-worklist__compact">{summary.outcomeDisplay}</td>
                      <td className={`lab-worklist__compact admission-documents__cell--${row.state}`}>
                        {CANCER_REGISTRATION_STATE_LABELS[row.state]}
                      </td>
                      <td className="lab-worklist__compact">{row.response?.authored?.slice(0, 10) ?? ""}</td>
                      <td className="lab-worklist__compact">{row.reportStatus}</td>
                      <td className="lab-worklist__compact">{row.reportDate}</td>
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
                      {rows.length === 0 ? "登録対象の病名はありません。" : "絞り込みに一致する病名がありません。"}
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

/** 行の操作の行き先。未登録ならカルテで登録を始め、登録中・登録済はその回答の詳細を開く。 */
function registrationHref(row: CancerRegistryRow, templateUrl: string): string {
  const params = new URLSearchParams();
  if (row.response?.id) {
    params.set(KARTE_DETAIL_PARAM, formatKarteDetail({ kind: "qr", id: row.response.id }));
  } else {
    params.set(
      KARTE_OPEN_PARAM,
      formatKarteOpen({ kind: "cancer-registry", conditionId: row.condition.id ?? "", url: templateUrl }),
    );
  }
  return `/patients/${row.patientId}/karte?${params.toString()}`;
}
