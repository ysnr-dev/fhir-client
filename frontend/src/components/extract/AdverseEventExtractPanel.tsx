import { useMemo, useState } from "react";
import { useAdverseEventExtract } from "../../api/queries";
import type { TreatmentType } from "../../fhir/adverseEventHelpers";
import {
  ADVERSE_EVENT_ROW_MODES,
  TREATMENT_TYPE_OPTIONS,
  adverseEventExtractCsv,
  adverseEventExtractHeader,
  adverseEventExtractTable,
  type AdverseEventRowMode,
} from "../../fhir/adverseEventExtractHelpers";
import {
  RECORD_DISPLAY_LIMIT,
  patientColumnsOf,
  resolvePeriod,
  type ExtractOutput,
  type ExtractPeriod,
} from "../../fhir/extractQueryHelpers";
import { compactDefinition, type ExtractRecordDefinition } from "../../fhir/extractRecordQuery";
import { applyScopeDefinition, scopeDefinition, useExtractPatientScope } from "../../hooks/useExtractPatientScope";
import { today } from "../../lib/dates";
import { downloadBlob } from "../../lib/download";
import { CtcaeTermSearchModal } from "../CtcaeTermSearchModal";
import { ErrorBanner } from "../ErrorBanner";
import { TruncatedNotice } from "../TruncatedNotice";
import { PeriodFields } from "./ExtractLeafFields";
import { FolderRegisterButton } from "./FolderRegisterButton";
import { PatientColumnsField } from "./PatientColumnsField";
import { PatientScopeFields, PatientScopeProgress, PatientScopeSummary } from "./PatientScope";
import { RecordQueryBar } from "./RecordQueryBar";
import { RecordResultTable } from "./RecordResultTable";

const DEFAULT_PERIOD: ExtractPeriod = { mode: "relative", days: 365 };

/** 保存する条件(docs/data-extract-design.md §17)。 */
interface AdverseEventCriteria extends ExtractRecordDefinition {
  treatment_type?: TreatmentType;
  terms?: string[];
  mode?: AdverseEventRowMode;
}

/**
 * 有害事象の抽出(docs/data-extract-design.md §12)。有害事象の記録を 1 件ごと、または患者・治療ごと
 * (用語ごとの最大 Grade)の表と CSV にする。患者の絞り込みはテンプレートの抽出と同じ。
 */
export function AdverseEventExtractPanel() {
  const scope = useExtractPatientScope();
  const extract = useAdverseEventExtract();

  const [period, setPeriod] = useState<ExtractPeriod>(DEFAULT_PERIOD);
  const [treatmentType, setTreatmentType] = useState<TreatmentType | "">("");
  const [terms, setTerms] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [mode, setMode] = useState<AdverseEventRowMode>("event");
  const [output, setOutput] = useState<ExtractOutput | undefined>(undefined);

  const table = useMemo(
    () => (extract.result ? adverseEventExtractTable(extract.result.observations, extract.result.patients, mode) : null),
    [extract.result, mode],
  );
  // 患者・治療ごとの件数・最大 Grade は欠けた記録では嘘になるので、読み切れなかったら出さない。
  const incomplete = mode === "treatment" && Boolean(extract.result?.truncated);
  const rows = incomplete ? [] : (table?.rows ?? []);
  const patientColumns = patientColumnsOf(output);
  const running = scope.running || extract.running;

  async function handleRun() {
    const patientIds = await scope.resolve();
    if (patientIds === null) return;
    const range = resolvePeriod(period, today());
    void extract.run({
      from: range?.from ?? "",
      to: range?.to ?? "",
      treatmentType: treatmentType || undefined,
      terms,
      patientIds,
    });
  }

  const definition = compactDefinition<AdverseEventCriteria>({
    schema_version: 1,
    period,
    ...scopeDefinition(scope),
    output,
    treatment_type: treatmentType || undefined,
    terms,
    mode,
  });

  /** 保存した条件を入力欄に戻す(null なら初期値)。 */
  function applyDefinition(saved: AdverseEventCriteria | null) {
    setPeriod(saved?.period ?? DEFAULT_PERIOD);
    setTreatmentType(saved?.treatment_type ?? "");
    setTerms(saved?.terms ?? []);
    applyScopeDefinition(scope, saved);
    setMode(saved?.mode ?? "event");
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
      <RecordQueryBar tab="adverse" current={definition} onLoad={applyDefinition} />
      <div className="data-extract__toolbar">
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

      <div className="data-extract__toolbar data-extract__toolbar--fields">
        <PeriodFields period={period} onChange={(next) => next && setPeriod(next)} />
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
        <PatientScopeFields scope={scope} />
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
        {table && (
          <span className="data-extract__exports">
            <FolderRegisterButton patientIds={rows.map((r) => r.patient.patientId)} />
            <button
              type="button"
              disabled={rows.length === 0}
              onClick={() =>
                downloadBlob(adverseEventExtractCsv({ ...table, rows }, output), `adverse_event_${today()}.csv`)
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
            <span className="extract-results__count">
              {`${rows.length} ${mode === "event" ? "件" : "行"}(${new Set(rows.map((r) => r.patient.patientId)).size} 人)`}
            </span>
            <PatientScopeSummary scope={scope} />
          </div>
          <TruncatedNotice show={extract.result?.truncated && !incomplete}>
            記録が多いため、新しいものから一部だけを読みました。期間を絞ってください。
          </TruncatedNotice>
          <TruncatedNotice show={incomplete}>
            記録が多く読み切れなかったため、患者・治療ごとの集計は出せません。期間か患者を絞ってください。
          </TruncatedNotice>
          <TruncatedNotice show={rows.length > RECORD_DISPLAY_LIMIT}>
            {`先頭の ${RECORD_DISPLAY_LIMIT} 行を表示しています。すべては CSV に出ます。`}
          </TruncatedNotice>
          <RecordResultTable
            header={adverseEventExtractHeader(table, output)}
            patientColumns={patientColumns}
            rows={rows.map(({ key, patient, cells }) => ({
              key,
              patient,
              fixed: cells.slice(0, table.fixedCount),
              values: cells.slice(table.fixedCount),
            }))}
            emptyLabel={incomplete ? "" : "該当する有害事象はありません"}
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
