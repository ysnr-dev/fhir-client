import { useState } from "react";
import { useMicroExtract } from "../../api/queries";
import {
  patientColumnsOf,
  resolvePeriod,
  type ExtractOutput,
  type ExtractPeriod,
} from "../../fhir/extractQueryHelpers";
import { MICRO_SUSCEPTIBILITY_FIELDS, type MicroSusceptibilityField } from "../../fhir/microExtractHelpers";
import { compactDefinition, type MicroExtractDefinition } from "../../fhir/extractRecordQuery";
import { microRunner, recordCountLabel } from "../../fhir/extractTabRunners";
import type { BreakdownSettings } from "../../fhir/recordBreakdownHelpers";
import { applyScopeDefinition, scopeDefinition, useExtractPatientScope } from "../../hooks/useExtractPatientScope";
import { today } from "../../lib/dates";
import { downloadBlob } from "../../lib/download";
import { ErrorBanner } from "../ErrorBanner";
import { CheckGroup, PeriodFields } from "./ExtractLeafFields";
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
const DEFAULT_SUSCEPTIBILITY: MicroSusceptibilityField[] = ["sir"];


/**
 * 細菌検査の抽出(docs/data-extract-design.md §10)。細菌検査結果を分離菌 1 株 = 1 行、抗菌薬 = 列の
 * 表と CSV にする。患者の絞り込みはテンプレートの抽出と同じ。
 */
export function MicroExtractPanel() {
  const scope = useExtractPatientScope();
  const context = useExtractRunContext();
  const extract = useMicroExtract();

  const [period, setPeriod] = useState<ExtractPeriod>(DEFAULT_PERIOD);
  const [includeNoIsolate, setIncludeNoIsolate] = useState(false);
  const [firstIsolateOnly, setFirstIsolateOnly] = useState(false);
  const [susceptibility, setSusceptibility] = useState<MicroSusceptibilityField[]>(DEFAULT_SUSCEPTIBILITY);
  const [output, setOutput] = useState<ExtractOutput | undefined>(undefined);
  const [breakdown, setBreakdown] = useState<BreakdownSettings>({});

  const patientColumns = patientColumnsOf(output);
  const running = scope.running || extract.running;

  async function handleRun() {
    const patientIds = await scope.resolve(period);
    if (patientIds === null) return;
    const criteria = microRunner.criteria(definition, { range: resolvePeriod(period, today()), patientIds }, context);
    if (criteria) void extract.run(criteria);
  }

  const definition = compactDefinition<MicroExtractDefinition>({
    schema_version: 1,
    period,
    ...scopeDefinition(scope),
    output,
    breakdown: Object.keys(breakdown).length ? breakdown : undefined,
    include_no_isolate: includeNoIsolate || undefined,
    first_isolate_only: firstIsolateOnly || undefined,
    susceptibility,
  });
  const table = useRecordTable(microRunner, extract.result, definition, context);
  const attributes = useRecordPatientAttributes(scope.ran, table?.rows);

  /** 保存した条件を入力欄に戻す(null なら初期値)。 */
  function applyDefinition(saved: MicroExtractDefinition | null) {
    setPeriod(saved?.period ?? DEFAULT_PERIOD);
    applyScopeDefinition(scope, saved);
    setIncludeNoIsolate(saved?.include_no_isolate ?? false);
    setFirstIsolateOnly(saved?.first_isolate_only ?? false);
    setSusceptibility(saved?.susceptibility ?? DEFAULT_SUSCEPTIBILITY);
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
      <RecordQueryBar tab="micro" current={definition} onLoad={applyDefinition} />
      <div className="extract-form">
        <ExtractFormRow label="記録">
          <PeriodFields period={period} onChange={(next) => next && setPeriod(next)} />
        </ExtractFormRow>
        <PatientScopeRow scope={scope} />
        <CompareRow scope={scope} />
        <ExtractFormRow label="表" help="実行し直さなくても結果に反映します。">
          <label className="extract-checks__item">
            <input type="checkbox" checked={includeNoIsolate} onChange={(e) => setIncludeNoIsolate(e.target.checked)} />
            分離菌なしの検体
          </label>
          <label className="extract-checks__item">
            <input type="checkbox" checked={firstIsolateOnly} onChange={(e) => setFirstIsolateOnly(e.target.checked)} />
            患者・菌ごとに初回
          </label>
          <CheckGroup
            label="感受性"
            options={MICRO_SUSCEPTIBILITY_FIELDS}
            values={susceptibility}
            onChange={(next) => next.length > 0 && setSusceptibility(next as MicroSusceptibilityField[])}
          />
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
              onClick={() => downloadBlob(recordTableCsv(table.header, patientColumns, table.rows, attributes.attributes), `micro_${today()}.csv`)}
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
          <RecordResultNotices runner={microRunner} truncated={extract.result?.truncated} table={table} />
          <PatientAttributesStatus attributes={attributes} />
          <RecordResultTable
            header={table.header}
            patientAttributes={attributes.attributes}
            patientColumns={patientColumns}
            breakdown={breakdown}
            onBreakdownChange={setBreakdown}
            rows={table.rows}
            emptyLabel={table.incomplete ? "" : microRunner.emptyLabel}
          />
        </section>
      )}
    </>
  );
}
