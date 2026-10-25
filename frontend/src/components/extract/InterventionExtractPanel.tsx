import { useState } from "react";
import { useInterventionExtract, useSelfDepartments } from "../../api/queries";
import { usePharmacistInterventionTypes } from "../../api/masterQueries";
import { departmentDisplayName, sortDepartmentsByCode } from "../../fhir/departmentHelpers";
import {
  patientColumnsOf,
  resolvePeriod,
  type ExtractOutput,
  type ExtractPeriod,
} from "../../fhir/extractQueryHelpers";
import { compactDefinition, type InterventionExtractDefinition } from "../../fhir/extractRecordQuery";
import { interventionRunner, recordCountLabel } from "../../fhir/extractTabRunners";
import type { BreakdownSettings } from "../../fhir/recordBreakdownHelpers";
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

type ResultFilter = NonNullable<InterventionExtractDefinition["result"]>;
type OrderKindFilter = InterventionExtractDefinition["order_kind"] | "";

/**
 * 薬剤師介入(処方監査の記録)の抽出(docs/rx-verification-design.md §4.2)。監査 1 件を 1 行にした表と CSV に
 * する。結果・種別・介入種別・依頼科の絞り込みは読み込んだ監査に対して行う。患者の絞り込みは他のタブと同じ。
 */
export function InterventionExtractPanel() {
  const { departments } = useSelfDepartments();
  const departmentOptions = sortDepartmentsByCode(departments).filter((d) => d.id);
  const scope = useExtractPatientScope();
  const context = useExtractRunContext();
  const extract = useInterventionExtract();
  const typeOptions = usePharmacistInterventionTypes();

  const [result, setResult] = useState<ResultFilter>("intervened");
  const [orderKind, setOrderKind] = useState<OrderKindFilter>("");
  const [types, setTypes] = useState<string[]>([]);
  const [period, setPeriod] = useState<ExtractPeriod>(DEFAULT_PERIOD);
  const [departmentId, setDepartmentId] = useState("");
  const [output, setOutput] = useState<ExtractOutput | undefined>(undefined);
  const [breakdown, setBreakdown] = useState<BreakdownSettings>({});

  const patientColumns = patientColumnsOf(output);
  const running = scope.running || extract.running;

  async function handleRun() {
    const patientIds = await scope.resolve(period);
    if (patientIds === null) return;
    const criteria = interventionRunner.criteria(definition, { range: resolvePeriod(period, today()), patientIds }, context);
    if (criteria) void extract.run(criteria);
  }

  const definition = compactDefinition<InterventionExtractDefinition>({
    schema_version: 1,
    period,
    ...scopeDefinition(scope),
    output,
    breakdown: Object.keys(breakdown).length ? breakdown : undefined,
    result: result === "intervened" ? undefined : result,
    order_kind: orderKind || undefined,
    types: types.length ? types : undefined,
    department_id: departmentId || undefined,
  });
  const table = useRecordTable(interventionRunner, extract.result, definition, context);
  const attributes = useRecordPatientAttributes(scope.ran, table?.rows);

  /** 保存した条件を入力欄に戻す(null なら初期値)。 */
  function applyDefinition(saved: InterventionExtractDefinition | null) {
    setResult(saved?.result ?? "intervened");
    setOrderKind(saved?.order_kind ?? "");
    setTypes(saved?.types ?? []);
    setPeriod(saved?.period ?? DEFAULT_PERIOD);
    setDepartmentId(saved?.department_id ?? "");
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
      <RecordQueryBar tab="intervention" current={definition} onLoad={applyDefinition} />
      <div className="extract-form">
        <ExtractFormRow label="記録">
          <PeriodFields period={period} onChange={(next) => next && setPeriod(next)} />
          <label className="extract-field">
            監査結果
            <select value={result} onChange={(e) => setResult(e.target.value as ResultFilter)}>
              <option value="intervened">介入あり</option>
              <option value="all">すべて</option>
            </select>
          </label>
          <label className="extract-field">
            種別
            <select value={orderKind} onChange={(e) => setOrderKind(e.target.value as OrderKindFilter)}>
              <option value="">すべて</option>
              <option value="prescription">処方</option>
              <option value="injection">注射</option>
            </select>
          </label>
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
        <ExtractFormRow label="介入種別">
          {typeOptions.map((option) => (
            <label key={option.code} className="extract-field extract-field--inline">
              <input
                type="checkbox"
                checked={types.includes(option.code)}
                onChange={(e) =>
                  setTypes(e.target.checked ? [...types, option.code] : types.filter((code) => code !== option.code))
                }
              />
              {option.name}
            </label>
          ))}
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
              onClick={() =>
                downloadBlob(recordTableCsv(table.header, patientColumns, table.rows, attributes.attributes), `pharmacist_intervention_${today()}.csv`)
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
          <RecordResultNotices runner={interventionRunner} truncated={extract.result?.truncated} table={table} />
          <PatientAttributesStatus attributes={attributes} />
          <RecordResultTable
            header={table.header}
            patientAttributes={attributes.attributes}
            patientColumns={patientColumns}
            breakdown={breakdown}
            onBreakdownChange={setBreakdown}
            rows={table.rows}
            emptyLabel={table.incomplete ? "" : interventionRunner.emptyLabel}
          />
        </section>
      )}
    </>
  );
}
