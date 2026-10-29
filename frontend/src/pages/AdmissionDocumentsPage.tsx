import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  useAdmissionDocumentResources,
  useBedWardIndex,
  useEncountersInRange,
  useFacilitySettings,
  useSelfDepartments,
  useWardOptions,
} from "../api/queries";
import { DateStepper } from "../components/DateStepper";
import { ErrorBanner } from "../components/ErrorBanner";
import { PatientKana } from "../components/PatientRowCells";
import { TruncatedNotice } from "../components/TruncatedNotice";
import {
  ADMISSION_DOCUMENT_KINDS,
  DEFAULT_ADMISSION_DOCUMENTS,
  admissionDocumentCells,
  admissionDocumentTemplate,
  type AdmissionDocumentCell,
  type AdmissionDocumentKind,
} from "../fhir/admissionDocumentHelpers";
import { DEFAULT_DOCUMENT_REMINDER } from "../fhir/documentDueHelpers";
import {
  DISCHARGED_STATUS,
  encounterAdmissionDate,
  encounterAttendingId,
  encounterAttendingName,
  encounterBedId,
  encounterBedLabel,
  encounterDepartmentId,
  encounterDepartmentName,
  encounterDischargeDate,
  encounterPatientId,
  encounterStayDays,
} from "../fhir/encounterHelpers";
import { locationDisplayName } from "../fhir/locationHelpers";
import { displayName } from "../fhir/patientHelpers";
import { formatKarteOpen, KARTE_OPEN_PARAM, type KarteOpenTarget } from "../karteUrl";
import { addDays, today } from "../lib/dates";
import { useReturnLinkState } from "../returnTo";

// 入退院文書の作成状況。入院中と、期間内に退院した入院を並べ、入院診療計画書・栄養スクリーニング・
// 栄養管理計画書・褥瘡リスク評価・褥瘡対策計画書・退院時サマリー・看護サマリー(退院)の作成状況と期限を出す
// (docs/bed-management-design.md §4、docs/nutrition-care-plan-design.md、docs/pressure-ulcer-plan-design.md)。判定は
// fhir/admissionDocumentHelpers.ts、対象と期限は施設設定(テンプレート・日数)。
//
// セルを押すとカルテを開き、未作成ならその入院の文書の登録を右ペインで始める。

interface Filters {
  wardId: string;
  departmentId: string;
  attendingId: string;
  /** missing = 未作成(作成中を含む)のある入院、overdue = 期限を過ぎた文書のある入院。 */
  status: "" | "missing" | "overdue";
}

const emptyFilters: Filters = { wardId: "", departmentId: "", attendingId: "", status: "" };

export function AdmissionDocumentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  // 退院した入院をどこまで遡るか(退院日がこの日以降)。入院中の入院は常に出す。
  const from = searchParams.get("from") || addDays(today(), -30);
  const todayValue = today();
  const [filters, setFilters] = useState<Filters>(() => ({
    ...emptyFilters,
    wardId: searchParams.get("ward") ?? "",
  }));
  const returnLinkState = useReturnLinkState();

  // 列が多いのでこの画面だけ幅を広げる(他の一覧と同じ)。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const wardOptions = useWardOptions();
  const departments = useSelfDepartments();
  const bedWards = useBedWardIndex();
  const facility = useFacilitySettings();
  const settings = facility.data?.admission_documents ?? DEFAULT_ADMISSION_DOCUMENTS;
  const dischargeSummaryDays = (facility.data?.document_reminder ?? DEFAULT_DOCUMENT_REMINDER).discharge_summary_days;
  const encounters = useEncountersInRange(from, todayValue);

  // 入院中と、from 以降に退院した入院(入院中に from より前で終わったものは出ない)。
  const targets = useMemo(
    () =>
      (encounters.data?.encounters ?? []).filter(
        (encounter) =>
          encounter.status !== DISCHARGED_STATUS || (encounter.period?.end?.slice(0, 10) ?? "") >= from,
      ),
    [encounters.data, from],
  );
  // テンプレートで書く種別は、テンプレートが設定されているときだけ列を出す。
  const kinds = ADMISSION_DOCUMENT_KINDS.filter((k) => admissionDocumentTemplate(k.kind, settings) !== "");
  const documents = useAdmissionDocumentResources(
    targets.map((encounter) => encounter.id ?? ""),
    targets.map((encounter) => encounterPatientId(encounter) ?? ""),
    kinds.map((k) => admissionDocumentTemplate(k.kind, settings) ?? ""),
  );

  const rows = useMemo(() => {
    const list = targets.map((encounter) => {
      const ward = bedWards.bedWards.get(encounterBedId(encounter) ?? "");
      return {
        encounter,
        patientId: encounterPatientId(encounter) ?? "",
        wardId: ward?.wardId ?? "",
        wardName: ward?.wardName ?? "",
        cells: admissionDocumentCells({
          encounter,
          compositions: documents.data?.compositions ?? [],
          responses: documents.data?.responses ?? [],
          settings,
          dischargeSummaryDays,
          today: todayValue,
        }),
      };
    });
    return list.sort(
      (a, b) =>
        a.wardName.localeCompare(b.wardName, "ja") ||
        encounterBedLabel(a.encounter).localeCompare(encounterBedLabel(b.encounter), "ja", { numeric: true }) ||
        encounterAdmissionDate(a.encounter).localeCompare(encounterAdmissionDate(b.encounter)),
    );
  }, [targets, bedWards.bedWards, documents.data, settings, dischargeSummaryDays, todayValue]);

  // 主治医の選択肢は、並んでいる入院に出てくる人。
  const attendings = useMemo(() => {
    const byId = new Map<string, string>();
    for (const row of rows) {
      const id = encounterAttendingId(row.encounter);
      if (id) byId.set(id, encounterAttendingName(row.encounter));
    }
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1], "ja"));
  }, [rows]);

  const visible = rows.filter((row) => {
    if (filters.wardId && row.wardId !== filters.wardId) return false;
    if (filters.departmentId && encounterDepartmentId(row.encounter) !== filters.departmentId) return false;
    if (filters.attendingId && encounterAttendingId(row.encounter) !== filters.attendingId) return false;
    const cells = kinds.map((k) => row.cells[k.kind]);
    if (filters.status === "missing" && !cells.some((c) => c.state === "missing" || c.state === "draft")) return false;
    if (filters.status === "overdue" && !cells.some((c) => c.overdue)) return false;
    return true;
  });
  const overdueCount = visible.reduce(
    (sum, row) => sum + kinds.filter((k) => row.cells[k.kind].overdue).length,
    0,
  );
  const loading = encounters.isLoading || documents.isLoading || bedWards.isLoading;

  return (
    <div className="page">
      <div className="page__header">
        <h1>入退院文書</h1>
      </div>

      <form className="patient-search-form" onSubmit={(e: FormEvent) => e.preventDefault()}>
        <label>
          退院日
          <DateStepper
            value={from}
            onChange={(value) => {
              if (!value) return;
              const params = new URLSearchParams(searchParams);
              params.set("from", value);
              setSearchParams(params);
            }}
          />
        </label>
        <label>
          病棟
          <select value={filters.wardId} onChange={(e) => setFilters({ ...filters, wardId: e.target.value })}>
            <option value="">すべて</option>
            {wardOptions.wards.map((ward) => (
              <option key={ward.id} value={ward.id}>
                {locationDisplayName(ward)}
              </option>
            ))}
          </select>
        </label>
        <label>
          診療科
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
          主治医
          <select
            value={filters.attendingId}
            onChange={(e) => setFilters({ ...filters, attendingId: e.target.value })}
          >
            <option value="">すべて</option>
            {attendings.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          状態
          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value as Filters["status"] })}
          >
            <option value="">すべて</option>
            <option value="missing">未作成あり</option>
            <option value="overdue">期限超過あり</option>
          </select>
        </label>
        <div className="patient-search-form__actions">
          <button type="button" onClick={() => setFilters(emptyFilters)}>
            クリア
          </button>
        </div>
      </form>

      <ErrorBanner error={encounters.error} />
      <ErrorBanner error={documents.error} />
      <ErrorBanner error={bedWards.error} />
      <ErrorBanner error={wardOptions.error} />
      <ErrorBanner error={departments.error} />
      <TruncatedNotice show={encounters.data?.truncated || documents.data?.truncated} />

      {loading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <div className="lab-worklist-wrap sticky-table-wrap">
            <table className="lab-worklist sticky-table admission-documents">
              <thead>
                <tr>
                  <th className="lab-worklist__compact">病棟</th>
                  <th className="lab-worklist__compact">病室</th>
                  <th>患者</th>
                  <th className="lab-worklist__compact">診療科</th>
                  <th className="lab-worklist__compact">主治医</th>
                  <th className="lab-worklist__compact">入院日</th>
                  <th className="lab-worklist__compact">退院日</th>
                  <th className="lab-worklist__compact">在院</th>
                  {kinds.map((k) => (
                    <th key={k.kind} className="lab-worklist__compact">
                      {k.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const patient = encounters.data?.patientsById.get(row.patientId);
                  return (
                    <tr key={row.encounter.id}>
                      <td className="lab-worklist__compact">{row.wardName || "-"}</td>
                      <td className="lab-worklist__compact">{encounterBedLabel(row.encounter).split(" ")[0]}</td>
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
                      <td className="lab-worklist__compact">{encounterDepartmentName(row.encounter)}</td>
                      <td className="lab-worklist__compact">{encounterAttendingName(row.encounter)}</td>
                      <td className="lab-worklist__compact">{encounterAdmissionDate(row.encounter)}</td>
                      <td className="lab-worklist__compact">{encounterDischargeDate(row.encounter)}</td>
                      <td className="lab-worklist__compact">
                        {encounterStayDays(row.encounter, todayValue) ?? "-"}日
                      </td>
                      {kinds.map((k) => (
                        <td key={k.kind} className="lab-worklist__compact">
                          <DocumentCellView
                            kind={k.kind}
                            templateUrl={admissionDocumentTemplate(k.kind, settings) ?? ""}
                            cell={row.cells[k.kind]}
                            encounterId={row.encounter.id ?? ""}
                            patientId={row.patientId}
                            returnLinkState={returnLinkState}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={8 + kinds.length} className="master-search__empty">
                      {rows.length === 0 ? "対象の入院はありません。" : "絞り込みに一致する入院がありません。"}
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

/**
 * カルテで開く先。未作成なら登録を始め、作成済・作成中はその文書を開く。
 * 計画書は再評価日を過ぎていれば書き直し(新しい計画書)を始める。
 */
function openTargetOf(
  kind: AdmissionDocumentKind,
  cell: AdmissionDocumentCell,
  encounterId: string,
  templateUrl: string,
): KarteOpenTarget {
  switch (kind) {
    case "admission-plan":
      return cell.state === "missing"
        ? { kind: "admission-plan", encounterId }
        : { kind: "questionnaire-response", responseId: cell.resourceId };
    case "nutrition-screening":
    case "nutrition-plan":
    case "pressure-ulcer-risk":
    case "pressure-ulcer-plan":
      return cell.state === "missing" || (cell.state === "done" && cell.overdue)
        ? { kind: "encounter-template", encounterId, url: templateUrl }
        : { kind: "questionnaire-response", responseId: cell.resourceId };
    case "discharge-summary":
      return { kind: "discharge-summary", encounterId };
    case "nursing-summary":
      return cell.resourceId
        ? { kind: "nursing-summary", compositionId: cell.resourceId }
        : { kind: "nursing-summary-create", encounterId };
  }
}

function DocumentCellView({
  kind,
  templateUrl,
  cell,
  encounterId,
  patientId,
  returnLinkState,
}: {
  kind: AdmissionDocumentKind;
  templateUrl: string;
  cell: AdmissionDocumentCell;
  encounterId: string;
  patientId: string;
  returnLinkState: ReturnType<typeof useReturnLinkState>;
}) {
  if (cell.state === "pending" || cell.state === "not-required") {
    // 退院前で、まだ書き始めていない退院系の文書と、必要性が判定前・無の計画書。
    return <span className="order-select__muted">{cell.label || "退院後"}</span>;
  }
  const target = openTargetOf(kind, cell, encounterId, templateUrl);
  const href = `/patients/${patientId}/karte?${KARTE_OPEN_PARAM}=${encodeURIComponent(formatKarteOpen(target))}`;
  const due = cell.due ? `期限 ${cell.due.slice(5).replace("-", "/")}` : "";
  // 押すと登録を始めるセル(未作成・再評価)は、カルテを開くだけのセルより目立たせる。
  const starts = cell.state === "missing" || (cell.state === "done" && cell.overdue);
  return (
    <Link
      to={href}
      state={returnLinkState}
      className={[
        "admission-documents__cell",
        `admission-documents__cell--${cell.state}`,
        starts ? "admission-documents__cell--start" : "",
        cell.overdue ? "admission-documents__cell--overdue" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      title={`${starts ? "登録を開始" : "カルテを開く"}${cell.due ? `(期限 ${cell.due})` : ""}`}
    >
      {cell.state === "missing" ? "未作成" : cell.label}
      {(cell.state !== "done" || cell.overdue) && due && <span className="admission-documents__due">{due}</span>}
    </Link>
  );
}
