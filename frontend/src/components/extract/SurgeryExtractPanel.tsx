import { useMemo, useState } from "react";
import type { MedicalProcedure } from "../../api/masterClient";
import { useSelfDepartments, useSurgeryExtract } from "../../api/queries";
import { departmentDisplayName, sortDepartmentsByCode } from "../../fhir/departmentHelpers";
import {
  RECORD_DISPLAY_LIMIT,
  patientColumnsOf,
  resolvePeriod,
  type ExtractOutput,
  type ExtractPeriod,
} from "../../fhir/extractQueryHelpers";
import { surgeryExtractCsv, surgeryExtractHeader, surgeryExtractRows } from "../../fhir/surgeryExtractHelpers";
import { compactDefinition, type ExtractRecordDefinition } from "../../fhir/extractRecordQuery";
import { applyScopeDefinition, scopeDefinition, useExtractPatientScope } from "../../hooks/useExtractPatientScope";
import { today } from "../../lib/dates";
import { downloadBlob } from "../../lib/download";
import { ErrorBanner } from "../ErrorBanner";
import { MedicalProcedureSearchModal } from "../MedicalProcedureSearchModal";
import { TruncatedNotice } from "../TruncatedNotice";
import { PeriodFields } from "./ExtractLeafFields";
import { FolderRegisterButton } from "./FolderRegisterButton";
import { PatientColumnsField } from "./PatientColumnsField";
import { PatientScopeFields, PatientScopeProgress, PatientScopeSummary } from "./PatientScope";
import { RecordQueryBar } from "./RecordQueryBar";
import { RecordResultTable } from "./RecordResultTable";

const DEFAULT_PERIOD: ExtractPeriod = { mode: "relative", days: 365 };

interface ProcedurePick {
  code: string;
  name: string;
}

/** 保存する条件(docs/data-extract-design.md §17)。 */
interface SurgeryCriteria extends ExtractRecordDefinition {
  procedures?: ProcedurePick[];
  department_id?: string;
}

/**
 * 手術実績の抽出(docs/data-extract-design.md §11)。手術の実施記録 1 件を 1 行にした表と CSV にする。
 * 患者の絞り込みはテンプレートの抽出と同じ。
 */
export function SurgeryExtractPanel() {
  const { departments } = useSelfDepartments();
  const departmentOptions = sortDepartmentsByCode(departments).filter((d) => d.id);
  const scope = useExtractPatientScope();
  const extract = useSurgeryExtract();

  const [period, setPeriod] = useState<ExtractPeriod>(DEFAULT_PERIOD);
  const [departmentId, setDepartmentId] = useState("");
  const [procedures, setProcedures] = useState<ProcedurePick[]>([]);
  const [picking, setPicking] = useState(false);
  const [output, setOutput] = useState<ExtractOutput | undefined>(undefined);

  const rows = useMemo(
    () =>
      extract.result
        ? surgeryExtractRows(
            extract.result.hubs,
            extract.result.children,
            extract.result.observations,
            extract.result.orders,
            extract.result.patients,
          )
        : null,
    [extract.result],
  );
  const patientColumns = patientColumnsOf(output);
  const running = scope.running || extract.running;

  async function handleRun() {
    const patientIds = await scope.resolve();
    if (patientIds === null) return;
    const range = resolvePeriod(period, today());
    void extract.run({
      from: range?.from ?? "",
      to: range?.to ?? "",
      departmentId: departmentId || undefined,
      procedureCodes: procedures.map((p) => p.code),
      patientIds,
    });
  }

  const definition = compactDefinition<SurgeryCriteria>({
    schema_version: 1,
    period,
    ...scopeDefinition(scope),
    output,
    procedures,
    department_id: departmentId || undefined,
  });

  /** 保存した条件を入力欄に戻す(null なら初期値)。 */
  function applyDefinition(saved: SurgeryCriteria | null) {
    setPeriod(saved?.period ?? DEFAULT_PERIOD);
    setDepartmentId(saved?.department_id ?? "");
    setProcedures(saved?.procedures ?? []);
    applyScopeDefinition(scope, saved);
    setOutput(saved?.output);
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
      <div className="data-extract__toolbar">
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

      <div className="data-extract__toolbar data-extract__toolbar--fields">
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
            <button type="button" onClick={handleClear}>
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
              onClick={() => downloadBlob(surgeryExtractCsv(rows, output), `surgery_${today()}.csv`)}
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
              {`${rows.length} 件(${new Set(rows.map((r) => r.patientId)).size} 人)`}
            </span>
            <PatientScopeSummary scope={scope} />
          </div>
          <TruncatedNotice show={extract.result?.truncated}>
            手術が多いため、新しいものから一部だけを読みました。期間を絞ってください。
          </TruncatedNotice>
          <TruncatedNotice show={rows.length > RECORD_DISPLAY_LIMIT}>
            {`先頭の ${RECORD_DISPLAY_LIMIT} 件を表示しています。すべては CSV に出ます。`}
          </TruncatedNotice>
          <RecordResultTable
            header={surgeryExtractHeader(output)}
            patientColumns={patientColumns}
            rows={rows.map((row) => ({ key: row.rowKey, patient: row, fixed: row.fixed, values: row.values }))}
            emptyLabel="該当する手術はありません"
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
