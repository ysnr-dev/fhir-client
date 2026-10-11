import { useState } from "react";
import { useAdverseEventExtract } from "../../api/queries";
import type { TreatmentType } from "../../fhir/adverseEventHelpers";
import {
  ADVERSE_EVENT_ROW_MODES,
  TREATMENT_TYPE_OPTIONS,
  type AdverseEventRowMode,
} from "../../fhir/adverseEventExtractHelpers";
import {
  patientColumnsOf,
  resolvePeriod,
  type ExtractOutput,
  type ExtractPeriod,
} from "../../fhir/extractQueryHelpers";
import { compactDefinition, type AdverseEventExtractDefinition } from "../../fhir/extractRecordQuery";
import { adverseEventRunner, recordCountLabel } from "../../fhir/extractTabRunners";
import type { BreakdownSettings } from "../../fhir/recordBreakdownHelpers";
import { applyScopeDefinition, scopeDefinition, useExtractPatientScope } from "../../hooks/useExtractPatientScope";
import { today } from "../../lib/dates";
import { downloadBlob } from "../../lib/download";
import { CtcaeTermSearchModal } from "../CtcaeTermSearchModal";
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

const DEFAULT_PERIOD: ExtractPeriod = { mode: "relative", days: 365 };

/**
 * 有害事象の抽出(docs/data-extract-design.md §12)。有害事象の記録を 1 件ごと、または患者・治療ごと
 * (用語ごとの最大 Grade)の表と CSV にする。患者の絞り込みはテンプレートの抽出と同じ。
 */
export function AdverseEventExtractPanel() {
  const scope = useExtractPatientScope();
  const context = useExtractRunContext();
  const extract = useAdverseEventExtract();

  const [period, setPeriod] = useState<ExtractPeriod>(DEFAULT_PERIOD);
  const [treatmentType, setTreatmentType] = useState<TreatmentType | "">("");
  const [terms, setTerms] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [mode, setMode] = useState<AdverseEventRowMode>("event");
  const [output, setOutput] = useState<ExtractOutput | undefined>(undefined);
  const [breakdown, setBreakdown] = useState<BreakdownSettings>({});

  const patientColumns = patientColumnsOf(output);
  const running = scope.running || extract.running;

  async function handleRun() {
    const patientIds = await scope.resolve(period);
    if (patientIds === null) return;
    const criteria = adverseEventRunner.criteria(definition, { range: resolvePeriod(period, today()), patientIds }, context);
    if (criteria) void extract.run(criteria);
  }

  const definition = compactDefinition<AdverseEventExtractDefinition>({
    schema_version: 1,
    period,
    ...scopeDefinition(scope),
    output,
    breakdown: Object.keys(breakdown).length ? breakdown : undefined,
    treatment_type: treatmentType || undefined,
    terms,
    mode,
  });
  const table = useRecordTable(adverseEventRunner, extract.result, definition, context);
  const attributes = useRecordPatientAttributes(scope.ran, table?.rows);

  /** 保存した条件を入力欄に戻す(null なら初期値)。 */
  function applyDefinition(saved: AdverseEventExtractDefinition | null) {
    setPeriod(saved?.period ?? DEFAULT_PERIOD);
    setTreatmentType(saved?.treatment_type ?? "");
    setTerms(saved?.terms ?? []);
    applyScopeDefinition(scope, saved);
    setMode(saved?.mode ?? "event");
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
      <RecordQueryBar tab="adverse" current={definition} onLoad={applyDefinition} />
      <div className="extract-form">
        <ExtractFormRow label="記録">
          <div className="extract-form-row__line">
            <button type="button" className="rp-card__compact-button" onClick={() => setPicking(true)}>
              用語
            </button>
            {terms.length > 0 && (
              <span className="extract-chips">
                {terms.map((term) => (
                  <span key={term} className="extract-chip">
                    {term}
                    <button
                      type="button"
                      className="extract-chip__remove"
                      aria-label={`${term} を外す`}
                      onClick={() => setTerms((current) => current.filter((t) => t !== term))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </span>
            )}
          </div>
          <label className="extract-field">
            治療
            <select value={treatmentType} onChange={(e) => setTreatmentType(e.target.value as TreatmentType | "")}>
              <option value="">すべて</option>
              {TREATMENT_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <PeriodFields period={period} onChange={(next) => next && setPeriod(next)} />
        </ExtractFormRow>
        <PatientScopeRow scope={scope} />
        <CompareRow scope={scope} />
        <ExtractFormRow label="表" help="実行し直さなくても結果に反映します。">
          <label className="extract-field">
            行
            <select value={mode} onChange={(e) => setMode(e.target.value as AdverseEventRowMode)}>
              {ADVERSE_EVENT_ROW_MODES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
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
                downloadBlob(recordTableCsv(table.header, patientColumns, table.rows, attributes.attributes), `adverse_event_${today()}.csv`)
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
          <RecordResultNotices runner={adverseEventRunner} truncated={extract.result?.truncated} table={table} />
          <PatientAttributesStatus attributes={attributes} />
          <RecordResultTable
            header={table.header}
            patientAttributes={attributes.attributes}
            patientColumns={patientColumns}
            breakdown={breakdown}
            onBreakdownChange={setBreakdown}
            rows={table.rows}
            emptyLabel={table.incomplete ? "" : adverseEventRunner.emptyLabel}
          />
        </section>
      )}
      {picking && (
        <CtcaeTermSearchModal
          onSelect={(term) => {
            setPicking(false);
            setTerms((current) => (current.includes(term.term_ja) ? current : [...current, term.term_ja]));
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}
