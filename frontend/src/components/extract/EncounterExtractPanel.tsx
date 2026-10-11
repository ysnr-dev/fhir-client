import { useState } from "react";
import { useEncounterExtract, useSelfDepartments, useWardOptions, type EncounterExtractKind } from "../../api/queries";
import { departmentDisplayName, sortDepartmentsByCode } from "../../fhir/departmentHelpers";
import {
  ADMISSION_DATE_MODES,
  patientColumnsOf,
  resolvePeriod,
  type AdmissionDateMode,
  type ExtractOutput,
  type ExtractPeriod,
} from "../../fhir/extractQueryHelpers";
import { compactDefinition, type EncounterExtractDefinition } from "../../fhir/extractRecordQuery";
import { encounterRunner, recordCountLabel } from "../../fhir/extractTabRunners";
import type { BreakdownSettings } from "../../fhir/recordBreakdownHelpers";
import { locationDisplayName } from "../../fhir/locationHelpers";
import { applyScopeDefinition, scopeDefinition, useExtractPatientScope } from "../../hooks/useExtractPatientScope";
import { today } from "../../lib/dates";
import { downloadBlob } from "../../lib/download";
import { ErrorBanner } from "../ErrorBanner";
import { PeriodFields } from "./ExtractLeafFields";
import { FolderRegisterButton } from "./FolderRegisterButton";
import { PatientColumnsField } from "./PatientColumnsField";
import { ExtractFormRow } from "./ExtractFormRow";
import { CompareRow, PatientAttributesStatus, PatientScopeProgress, PatientScopeRow, PatientScopeSummary } from "./PatientScope";
import { RecordQueryBar } from "./RecordQueryBar";
import { RecordResultNotices } from "./RecordResultNotices";
import { RecordResultTable } from "./RecordResultTable";
import { recordTableCsv } from "../../fhir/recordTableHelpers";
import { useExtractRunContext } from "../../hooks/useExtractRunContext";
import { useRecordPatientAttributes } from "../../hooks/useRecordPatientAttributes";
import { useRecordTable } from "../../hooks/useRecordTable";

const DEFAULT_PERIOD: ExtractPeriod = { mode: "relative", days: 30 };

const KINDS: { value: EncounterExtractKind; label: string }[] = [
  { value: "inpatient", label: "入院" },
  { value: "outpatient", label: "外来" },
  { value: "emergency", label: "救急" },
];

/**
 * 入院・外来の抽出(docs/data-extract-design.md §19)。入院 1 件・外来受診 1 件を 1 行にした表と CSV にする。
 * 患者の絞り込みはテンプレートの抽出と同じ。
 */
export function EncounterExtractPanel() {
  const { departments } = useSelfDepartments();
  const departmentOptions = sortDepartmentsByCode(departments).filter((d) => d.id);
  const { wards } = useWardOptions();
  const scope = useExtractPatientScope();
  const context = useExtractRunContext();
  const extract = useEncounterExtract();

  const [kind, setKind] = useState<EncounterExtractKind>("inpatient");
  const [dateMode, setDateMode] = useState<AdmissionDateMode>("overlap");
  const [period, setPeriod] = useState<ExtractPeriod>(DEFAULT_PERIOD);
  const [departmentId, setDepartmentId] = useState("");
  const [wardId, setWardId] = useState("");
  const [output, setOutput] = useState<ExtractOutput | undefined>(undefined);
  const [breakdown, setBreakdown] = useState<BreakdownSettings>({});

  const patientColumns = patientColumnsOf(output);
  const running = scope.running || extract.running;
  const inpatient = kind === "inpatient";
  // 救急の受診は診療科を持たないので、診療科では絞らない。
  const byDepartment = kind !== "emergency";

  const definition = compactDefinition<EncounterExtractDefinition>({
    schema_version: 1,
    period,
    ...scopeDefinition(scope),
    output,
    breakdown: Object.keys(breakdown).length ? breakdown : undefined,
    kind,
    date_mode: inpatient ? dateMode : undefined,
    department_id: byDepartment ? departmentId || undefined : undefined,
    ward_id: inpatient ? wardId || undefined : undefined,
  });
  const table = useRecordTable(encounterRunner, extract.result, definition, context);
  const attributes = useRecordPatientAttributes(scope.ran, table?.rows);

  /** 保存した条件を入力欄に戻す(null なら初期値)。 */
  function applyDefinition(saved: EncounterExtractDefinition | null) {
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
    const patientIds = await scope.resolve(period);
    if (patientIds === null) return;
    const criteria = encounterRunner.criteria(definition, { range: resolvePeriod(period, today()), patientIds }, context);
    if (criteria) void extract.run(criteria);
  }

  function handleCancel() {
    scope.cancel();
    extract.cancel();
  }

  return (
    <>
      <RecordQueryBar tab="encounter" current={definition} onLoad={applyDefinition} />
      <div className="extract-form">
        <ExtractFormRow label="記録">
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
          {byDepartment && (
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
          )}
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
        </ExtractFormRow>
        <PatientScopeRow scope={scope} />
        <CompareRow scope={scope} />
        <ExtractFormRow label="表" help="実行し直さなくても結果に反映します。">
          <PatientColumnsField
            value={patientColumns}
            selected={Boolean(output?.patient_columns?.length)}
            onChange={(patient_columns) => setOutput(patient_columns.length ? { patient_columns } : undefined)}
          />
        </ExtractFormRow>
      </div>

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
        {table && (
          <span className="data-extract__exports">
            <FolderRegisterButton patientIds={table.rows.map((r) => r.patient.patientId)} />
            <button
              type="button"
              disabled={table.rows.length === 0}
              onClick={() =>
                downloadBlob(recordTableCsv(table.header, patientColumns, table.rows, attributes.attributes), `${extract.result?.kind ?? "encounter"}_${today()}.csv`)
              }
            >
              CSV
            </button>
          </span>
        )}
      </div>

      <ErrorBanner error={scope.error ?? extract.error} />
      {table && (
        <section className="extract-results">
          <div className="extract-results__summary">
            <span className="extract-results__count">{recordCountLabel(table)}</span>
            <PatientScopeSummary scope={scope} />
          </div>
          <RecordResultNotices runner={encounterRunner} truncated={extract.result?.truncated} table={table} />
          <PatientAttributesStatus attributes={attributes} />
          <RecordResultTable
            header={table.header}
            patientAttributes={attributes.attributes}
            patientColumns={patientColumns}
            breakdown={breakdown}
            onBreakdownChange={setBreakdown}
            rows={table.rows}
            emptyLabel={table.incomplete ? "" : encounterRunner.emptyLabel}
          />
        </section>
      )}
    </>
  );
}
