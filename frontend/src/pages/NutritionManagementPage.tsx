import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  useAdmissionDocumentResources,
  useBedWardIndex,
  useFacilitySettings,
  useInpatientEncounters,
  useMealOrdersOn,
  useWardOptions,
} from "../api/queries";
import { AdmissionDocumentCellLink } from "../components/AdmissionDocumentCellLink";
import { ErrorBanner } from "../components/ErrorBanner";
import { PatientKana } from "../components/PatientRowCells";
import { TruncatedNotice } from "../components/TruncatedNotice";
import { DEFAULT_ADMISSION_DOCUMENTS } from "../fhir/admissionDocumentHelpers";
import { encounterAdmissionDate, encounterPatientId, encounterStayDays } from "../fhir/encounterHelpers";
import { locationDisplayName } from "../fhir/locationHelpers";
import {
  buildNutritionManagementRows,
  GLIM_MALNUTRITION,
  matchesNutritionFilter,
  nutritionIndicators,
  type NutritionManagementFilter,
} from "../fhir/nutritionManagementHelpers";
import { displayName } from "../fhir/patientHelpers";
import { today } from "../lib/dates";
import { useReturnLinkState } from "../returnTo";

// 栄養管理の一覧(docs/nutrition-care-plan-design.md §6)。今日の入院患者ごとに、栄養スクリーニングの結果・
// 特別な栄養管理の必要性・栄養管理計画書の状況・いまの食事を並べ、上に低栄養などの割合を出す。
// スクリーニング・計画書は施設設定「文書作成の督促」のテンプレートで数える(入退院文書と同じ)。

const NEED_LABELS = { yes: "有", no: "無", unknown: "-" } as const;

function percent(count: number, total: number): string {
  return total > 0 ? `${Math.round((count / total) * 100)}%` : "-";
}

export function NutritionManagementPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const wardId = searchParams.get("ward") ?? "";
  const [filter, setFilter] = useState<NutritionManagementFilter>("");
  const todayValue = today();
  const returnLinkState = useReturnLinkState();

  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const wardOptions = useWardOptions();
  const bedWards = useBedWardIndex();
  const facility = useFacilitySettings();
  const settings = facility.data?.admission_documents ?? DEFAULT_ADMISSION_DOCUMENTS;
  const inpatients = useInpatientEncounters(todayValue);
  const mealOrders = useMealOrdersOn(todayValue);
  const encounters = useMemo(() => inpatients.data?.encounters ?? [], [inpatients.data]);
  const documents = useAdmissionDocumentResources(
    encounters.map((encounter) => encounter.id ?? ""),
    encounters.map((encounter) => encounterPatientId(encounter) ?? ""),
    [settings.admission_plan_template, settings.nutrition_screening_template, settings.nutrition_plan_template],
  );

  const rows = useMemo(
    () =>
      buildNutritionManagementRows({
        encounters,
        patientsById: inpatients.data?.patientsById ?? new Map(),
        responses: documents.data?.responses ?? [],
        mealOrders: mealOrders.data ?? [],
        bedWards: bedWards.bedWards,
        settings,
        today: todayValue,
      }),
    [encounters, inpatients.data, documents.data, mealOrders.data, bedWards.bedWards, settings, todayValue],
  );
  const wardRows = wardId ? rows.filter((row) => row.wardId === wardId) : rows;
  const visible = wardRows.filter((row) => matchesNutritionFilter(row, filter));
  const indicators = nutritionIndicators(wardRows);
  const loading = inpatients.isLoading || documents.isLoading || mealOrders.isLoading || bedWards.isLoading;
  const configured = Boolean(settings.nutrition_screening_template || settings.nutrition_plan_template);

  return (
    <div className="page">
      <div className="page__header">
        <h1>栄養管理</h1>
      </div>

      <form className="patient-search-form" onSubmit={(e: FormEvent) => e.preventDefault()}>
        <label>
          病棟
          <select
            value={wardId}
            onChange={(e) => {
              const params = new URLSearchParams(searchParams);
              if (e.target.value) params.set("ward", e.target.value);
              else params.delete("ward");
              setSearchParams(params);
            }}
          >
            <option value="">すべて</option>
            {wardOptions.wards.map((ward) => (
              <option key={ward.id} value={ward.id}>
                {locationDisplayName(ward)}
              </option>
            ))}
          </select>
        </label>
        <label>
          対象
          <select value={filter} onChange={(e) => setFilter(e.target.value as NutritionManagementFilter)}>
            <option value="">すべて</option>
            <option value="need">特別な栄養管理あり</option>
            <option value="malnutrition">低栄養(GLIM)</option>
            <option value="pending">未対応あり</option>
          </select>
        </label>
      </form>

      <ErrorBanner error={inpatients.error ?? documents.error ?? mealOrders.error ?? bedWards.error ?? wardOptions.error} />
      <TruncatedNotice show={inpatients.data?.truncated || documents.data?.truncated} />
      {!facility.isLoading && !configured && (
        <p className="order-select__muted">施設設定「文書作成の督促」に栄養スクリーニング・栄養管理計画書のテンプレートがありません。</p>
      )}

      {loading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <dl className="nutrition-management__indicators">
            <div>
              <dt>在院</dt>
              <dd>{indicators.inpatients} 人</dd>
            </div>
            <div>
              <dt>スクリーニング実施</dt>
              <dd>
                {indicators.screened} 人({percent(indicators.screened, indicators.inpatients)})
              </dd>
            </div>
            <div>
              <dt>低栄養(GLIM)</dt>
              <dd>
                {indicators.malnourished} 人({percent(indicators.malnourished, indicators.inpatients)})
              </dd>
            </div>
            <div>
              <dt>特別な栄養管理あり</dt>
              <dd>
                {indicators.needed} 人({percent(indicators.needed, indicators.inpatients)})
              </dd>
            </div>
            <div>
              <dt>計画書作成済</dt>
              <dd>
                {indicators.planned} / {indicators.needed} 人({percent(indicators.planned, indicators.needed)})
              </dd>
            </div>
          </dl>

          <div className="lab-worklist-wrap sticky-table-wrap">
            <table className="lab-worklist sticky-table admission-documents">
              <thead>
                <tr>
                  <th className="lab-worklist__compact">病棟</th>
                  <th className="lab-worklist__compact">病室</th>
                  <th>患者</th>
                  <th className="lab-worklist__compact">入院日</th>
                  <th className="lab-worklist__compact">在院</th>
                  <th className="lab-worklist__compact">スクリーニング</th>
                  <th className="lab-worklist__compact">MUST</th>
                  <th className="lab-worklist__compact">GLIM</th>
                  <th className="lab-worklist__compact">SGA</th>
                  <th className="lab-worklist__compact">栄養管理</th>
                  <th className="lab-worklist__compact">栄養管理計画書</th>
                  <th>いまの食事</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.encounter.id}>
                    <td className="lab-worklist__compact">{row.wardName || "-"}</td>
                    <td className="lab-worklist__compact">{row.bedLabel.split(" ")[0]}</td>
                    <td>
                      {row.patient ? (
                        <>
                          <Link to={`/patients/${row.patientId}/karte`} state={returnLinkState}>
                            {displayName(row.patient)}
                          </Link>
                          <PatientKana patient={row.patient} />
                        </>
                      ) : (
                        row.patientId
                      )}
                    </td>
                    <td className="lab-worklist__compact">{encounterAdmissionDate(row.encounter)}</td>
                    <td className="lab-worklist__compact">{encounterStayDays(row.encounter, todayValue) ?? "-"}日</td>
                    <td className="lab-worklist__compact">
                      {settings.nutrition_screening_template ? (
                        <AdmissionDocumentCellLink
                          kind="nutrition-screening"
                          templateUrl={settings.nutrition_screening_template}
                          cell={row.screeningCell}
                          encounterId={row.encounter.id ?? ""}
                          patientId={row.patientId}
                          returnLinkState={returnLinkState}
                        />
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="lab-worklist__compact">
                      {row.screening?.mustTotal !== undefined
                        ? `${row.screening.mustTotal}点 ${row.screening.mustRisk}`
                        : "-"}
                    </td>
                    <td
                      className={`lab-worklist__compact${row.screening?.glim === GLIM_MALNUTRITION ? " nutrition-management__alert" : ""}`}
                    >
                      {row.screening?.glim
                        ? `${row.screening.glim}${row.screening.glimSeverity ? `(${row.screening.glimSeverity})` : ""}`
                        : "-"}
                    </td>
                    <td className="lab-worklist__compact">{row.screening?.sga || "-"}</td>
                    <td className="lab-worklist__compact">{NEED_LABELS[row.need]}</td>
                    <td className="lab-worklist__compact">
                      {settings.nutrition_plan_template ? (
                        <AdmissionDocumentCellLink
                          kind="nutrition-plan"
                          templateUrl={settings.nutrition_plan_template}
                          cell={row.planCell}
                          encounterId={row.encounter.id ?? ""}
                          patientId={row.patientId}
                          returnLinkState={returnLinkState}
                        />
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>{row.meal || "-"}</td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={12} className="master-search__empty">
                      {wardRows.length === 0 ? "入院患者はいません。" : "絞り込みに一致する患者がいません。"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="order-select__muted lab-worklist__count">{visible.length} 件</p>
        </>
      )}
    </div>
  );
}
