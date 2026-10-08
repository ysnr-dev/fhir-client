import { useMemo, useState } from "react";
import { useEncounterExtract, useSelfDepartments, useWardOptions, type EncounterExtractKind } from "../../api/queries";
import { departmentCode, departmentDisplayName, sortDepartmentsByCode } from "../../fhir/departmentHelpers";
import { encounterExtractCsv, encounterExtractHeader, encounterExtractRows } from "../../fhir/encounterExtractHelpers";
import {
  ADMISSION_DATE_MODES,
  RECORD_DISPLAY_LIMIT,
  patientColumnsOf,
  resolvePeriod,
  type AdmissionDateMode,
  type ExtractOutput,
  type ExtractPeriod,
} from "../../fhir/extractQueryHelpers";
import { compactDefinition, type ExtractRecordDefinition } from "../../fhir/extractRecordQuery";
import type { BreakdownSettings } from "../../fhir/recordBreakdownHelpers";
import { locationDisplayName } from "../../fhir/locationHelpers";
import { applyScopeDefinition, scopeDefinition, useExtractPatientScope } from "../../hooks/useExtractPatientScope";
import { today } from "../../lib/dates";
import { downloadBlob } from "../../lib/download";
import { ErrorBanner } from "../ErrorBanner";
import { TruncatedNotice } from "../TruncatedNotice";
import { PeriodFields } from "./ExtractLeafFields";
import { FolderRegisterButton } from "./FolderRegisterButton";
import { PatientColumnsField } from "./PatientColumnsField";
import { PatientScopeFields, PatientScopeProgress, PatientScopeSummary } from "./PatientScope";
import { RecordQueryBar } from "./RecordQueryBar";
import { RecordResultTable } from "./RecordResultTable";

const DEFAULT_PERIOD: ExtractPeriod = { mode: "relative", days: 30 };

const KINDS: { value: EncounterExtractKind; label: string }[] = [
  { value: "inpatient", label: "入院" },
  { value: "outpatient", label: "外来" },
];

/** 保存する条件(docs/data-extract-design.md §17)。 */
interface EncounterCriteria extends ExtractRecordDefinition {
  kind?: EncounterExtractKind;
  date_mode?: AdmissionDateMode;
  department_id?: string;
  ward_id?: string;
}

/**
 * 入院・外来の抽出(docs/data-extract-design.md §19)。入院 1 件・外来受診 1 件を 1 行にした表と CSV にする。
 * 患者の絞り込みはテンプレートの抽出と同じ。
 */
export function EncounterExtractPanel() {
  const { departments } = useSelfDepartments();
  const departmentOptions = sortDepartmentsByCode(departments).filter((d) => d.id);
  const { wards } = useWardOptions();
  const scope = useExtractPatientScope();
  const extract = useEncounterExtract();

  const [kind, setKind] = useState<EncounterExtractKind>("inpatient");
  const [dateMode, setDateMode] = useState<AdmissionDateMode>("overlap");
  const [period, setPeriod] = useState<ExtractPeriod>(DEFAULT_PERIOD);
  const [departmentId, setDepartmentId] = useState("");
  const [wardId, setWardId] = useState("");
  const [output, setOutput] = useState<ExtractOutput | undefined>(undefined);
  const [breakdown, setBreakdown] = useState<BreakdownSettings>({});

  const resultKind = extract.result?.kind ?? kind;
  const rows = useMemo(
    () =>
      extract.result
        ? encounterExtractRows(
            extract.result.kind,
            extract.result.encounters,
            extract.result.locations,
            extract.result.appointments,
            extract.result.patients,
            today(),
          )
        : null,
    [extract.result],
  );
  const patientColumns = patientColumnsOf(output);
  const running = scope.running || extract.running;
  const inpatient = kind === "inpatient";

  const definition = compactDefinition<EncounterCriteria>({
    schema_version: 1,
    period,
    ...scopeDefinition(scope),
    output,
    breakdown: Object.keys(breakdown).length ? breakdown : undefined,
    kind,
    date_mode: inpatient ? dateMode : undefined,
    department_id: departmentId || undefined,
    ward_id: inpatient ? wardId || undefined : undefined,
  });

  /** 保存した条件を入力欄に戻す(null なら初期値)。 */
  function applyDefinition(saved: EncounterCriteria | null) {
    setKind(saved?.kind ?? "inpatient");
    setDateMode(saved?.date_mode ?? "overlap");
    setPeriod(saved?.period ?? DEFAULT_PERIOD);
    setDepartmentId(saved?.department_id ?? "");
    setWardId(saved?.ward_id ?? "");
    applyScopeDefinition(scope, saved);
    setOutput(saved?.output);
    setBreakdown(saved?.breakdown ?? {});
  }

  async function handleRun() {
    const patientIds = await scope.resolve();
    if (patientIds === null) return;
    const range = resolvePeriod(period, today());
    const department = departmentOptions.find((d) => d.id === departmentId);
    void extract.run({
      kind,
      from: range?.from ?? "",
      to: range?.to ?? "",
      dateMode,
      departmentId: inpatient ? departmentId || undefined : undefined,
      departmentCode: !inpatient && department ? departmentCode(department) || undefined : undefined,
      wardId: inpatient ? wardId || undefined : undefined,
      patientIds,
    });
  }

  function handleCancel() {
    scope.cancel();
    extract.cancel();
  }

  return (
    <>
      <RecordQueryBar tab="encounter" current={definition} onLoad={applyDefinition} />
      <div className="data-extract__toolbar data-extract__toolbar--fields">
        <label className="extract-field">
          区分
          <select value={kind} onChange={(e) => setKind(e.target.value as EncounterExtractKind)}>
            {KINDS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {inpatient && (
          <label className="extract-field">
            見方
            <select value={dateMode} onChange={(e) => setDateMode(e.target.value as AdmissionDateMode)}>
              {ADMISSION_DATE_MODES.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <PeriodFields period={period} onChange={(next) => next && setPeriod(next)} />
        <label className="extract-field">
          診療科
          <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">すべて</option>
            {departmentOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {departmentDisplayName(d)}
              </option>
            ))}
          </select>
        </label>
        {inpatient && (
          <label className="extract-field">
            病棟
            <select value={wardId} onChange={(e) => setWardId(e.target.value)}>
              <option value="">すべて</option>
              {wards.map((w) => (
                <option key={w.id} value={w.id}>
                  {locationDisplayName(w)}
                </option>
              ))}
            </select>
          </label>
        )}
        <PatientScopeFields scope={scope} />
      </div>

      <PatientColumnsField
        value={patientColumns}
        selected={Boolean(output?.patient_columns?.length)}
        onChange={(patient_columns) => setOutput(patient_columns.length ? { patient_columns } : undefined)}
      />

      <ErrorBanner error={scope.listError} />

      <div className="data-extract__actions">
        {running ? (
          <button type="button" onClick={handleCancel}>
            中止
          </button>
        ) : (
          <>
            <button type="button" onClick={() => void handleRun()}>
              実行
            </button>
            <button type="button" onClick={() => applyDefinition(null)}>
              クリア
            </button>
          </>
        )}
        <PatientScopeProgress scope={scope} />
        {extract.running && <span className="order-select__muted">実行中</span>}
        {rows && (
          <span className="data-extract__exports">
            <FolderRegisterButton patientIds={rows.map((r) => r.patientId)} />
            <button
              type="button"
              disabled={rows.length === 0}
              onClick={() =>
                downloadBlob(encounterExtractCsv(resultKind, rows, output), `${resultKind}_${today()}.csv`)
              }
            >
              CSV
            </button>
          </span>
        )}
      </div>

      <ErrorBanner error={scope.error ?? extract.error} />
      {rows && (
        <section className="extract-results">
          <div className="extract-results__summary">
            <span className="extract-results__count">
              {`${resultKind === "inpatient" ? "入院" : "外来受診"} ${rows.length} 件(${new Set(rows.map((r) => r.patientId)).size} 人)`}
            </span>
            <PatientScopeSummary scope={scope} />
          </div>
          <TruncatedNotice show={extract.result?.truncated}>
            件数が多いため、新しいものから一部だけを読みました。期間を絞ってください。
          </TruncatedNotice>
          <TruncatedNotice show={rows.length > RECORD_DISPLAY_LIMIT}>
            {`先頭の ${RECORD_DISPLAY_LIMIT} 件を表示しています。すべては CSV に出ます。`}
          </TruncatedNotice>
          <RecordResultTable
            header={encounterExtractHeader(resultKind, output)}
            patientColumns={patientColumns}
            breakdown={breakdown}
            onBreakdownChange={setBreakdown}
            rows={rows.map((row) => ({ key: row.rowKey, patient: row, fixed: row.fixed, values: row.values }))}
            emptyLabel="該当する受診はありません"
          />
        </section>
      )}
    </>
  );
}
