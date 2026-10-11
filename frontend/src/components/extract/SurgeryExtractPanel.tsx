import { useState } from "react";
import type { MedicalProcedure } from "../../api/masterClient";
import { useSelfDepartments, useSurgeryExtract } from "../../api/queries";
import { departmentDisplayName, sortDepartmentsByCode } from "../../fhir/departmentHelpers";
import {
  patientColumnsOf,
  resolvePeriod,
  type ExtractOutput,
  type ExtractPeriod,
} from "../../fhir/extractQueryHelpers";
import { compactDefinition, type SurgeryExtractDefinition } from "../../fhir/extractRecordQuery";
import { surgeryRunner, recordCountLabel } from "../../fhir/extractTabRunners";
import type { BreakdownSettings } from "../../fhir/recordBreakdownHelpers";
import { applyScopeDefinition, scopeDefinition, useExtractPatientScope } from "../../hooks/useExtractPatientScope";
import { today } from "../../lib/dates";
import { downloadBlob } from "../../lib/download";
import { ErrorBanner } from "../ErrorBanner";
import { MedicalProcedureSearchModal } from "../MedicalProcedureSearchModal";
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

const DEFAULT_PERIOD: ExtractPeriod = { mode: "relative", days: 365 };

/**
 * 手術実績の抽出(docs/data-extract-design.md §11)。手術の実施記録 1 件を 1 行にした表と CSV にする。
 * 患者の絞り込みはテンプレートの抽出と同じ。
 */
export function SurgeryExtractPanel() {
  const { departments } = useSelfDepartments();
  const departmentOptions = sortDepartmentsByCode(departments).filter((d) => d.id);
  const scope = useExtractPatientScope();
  const context = useExtractRunContext();
  const extract = useSurgeryExtract();

  const [period, setPeriod] = useState<ExtractPeriod>(DEFAULT_PERIOD);
  const [departmentId, setDepartmentId] = useState("");
  const [procedures, setProcedures] = useState<{ code: string; name: string }[]>([]);
  const [picking, setPicking] = useState(false);
  const [output, setOutput] = useState<ExtractOutput | undefined>(undefined);
  const [breakdown, setBreakdown] = useState<BreakdownSettings>({});

  const patientColumns = patientColumnsOf(output);
  const running = scope.running || extract.running;

  async function handleRun() {
    const patientIds = await scope.resolve(period);
    if (patientIds === null) return;
    const criteria = surgeryRunner.criteria(definition, { range: resolvePeriod(period, today()), patientIds }, context);
    if (criteria) void extract.run(criteria);
  }

  const definition = compactDefinition<SurgeryExtractDefinition>({
    schema_version: 1,
    period,
    ...scopeDefinition(scope),
    output,
    breakdown: Object.keys(breakdown).length ? breakdown : undefined,
    procedures,
    department_id: departmentId || undefined,
  });
  const table = useRecordTable(surgeryRunner, extract.result, definition, context);
  const attributes = useRecordPatientAttributes(scope.ran, table?.rows);

  /** 保存した条件を入力欄に戻す(null なら初期値)。 */
  function applyDefinition(saved: SurgeryExtractDefinition | null) {
    setPeriod(saved?.period ?? DEFAULT_PERIOD);
    setDepartmentId(saved?.department_id ?? "");
    setProcedures(saved?.procedures ?? []);
    applyScopeDefinition(scope, saved);
    setOutput(saved?.output);
    setBreakdown(saved?.breakdown ?? {});
  }

  function handleClear() {
    applyDefinition(null);
  }

  function handleCancel() {
    scope.cancel();
    extract.cancel();
  }

  return (
    <>
      <RecordQueryBar tab="surgery" current={definition} onLoad={applyDefinition} />
      <div className="extract-form">
        <ExtractFormRow label="記録">
          <div className="extract-form-row__line">
            <button type="button" className="rp-card__compact-button" onClick={() => setPicking(true)}>
              術式
            </button>
            {procedures.length > 0 && (
              <span className="extract-chips">
                {procedures.map((procedure) => (
                  <span key={procedure.code} className="extract-chip">
                    {procedure.name || procedure.code}
                    <button
                      type="button"
                      className="extract-chip__remove"
                      aria-label={`${procedure.name || procedure.code} を外す`}
                      onClick={() => setProcedures((current) => current.filter((p) => p.code !== procedure.code))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </span>
            )}
          </div>
          <PeriodFields period={period} onChange={(next) => next && setPeriod(next)} />
          <label className="extract-field">
            依頼科
            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">すべて</option>
              {departmentOptions.map((d) => (
                <option key={d.id} value={d.id}>
                  {departmentDisplayName(d)}
                </option>
              ))}
            </select>
          </label>
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
            <button type="button" onClick={handleClear}>
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
              onClick={() => downloadBlob(recordTableCsv(table.header, patientColumns, table.rows, attributes.attributes), `surgery_${today()}.csv`)}
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
          <RecordResultNotices runner={surgeryRunner} truncated={extract.result?.truncated} table={table} />
          <PatientAttributesStatus attributes={attributes} />
          <RecordResultTable
            header={table.header}
            patientAttributes={attributes.attributes}
            patientColumns={patientColumns}
            breakdown={breakdown}
            onBreakdownChange={setBreakdown}
            rows={table.rows}
            emptyLabel={table.incomplete ? "" : surgeryRunner.emptyLabel}
          />
        </section>
      )}
      {picking && (
        <MedicalProcedureSearchModal
          defaultSection="K"
          onSelect={(procedure: MedicalProcedure) => {
            setPicking(false);
            setProcedures((current) =>
              current.some((p) => p.code === procedure.procedure_code)
                ? current
                : [...current, { code: procedure.procedure_code, name: procedure.name ?? "" }],
            );
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}
