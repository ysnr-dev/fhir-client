import { useState } from "react";
import {
  useConditionExtract,
  type ConditionExtractCategory,
  type ConditionExtractSuspected,
} from "../../api/queries";
import {
  CLINICAL_STATUS_OPTIONS,
  patientColumnsOf,
  resolvePeriod,
  type ExtractCode,
  type ExtractLeaf,
  type ExtractOutput,
  type ExtractPeriod,
} from "../../fhir/extractQueryHelpers";
import { compactDefinition, type ConditionExtractDefinition } from "../../fhir/extractRecordQuery";
import { conditionRunner, recordCountLabel } from "../../fhir/extractTabRunners";
import type { BreakdownSettings } from "../../fhir/recordBreakdownHelpers";
import { recordTableCsv } from "../../fhir/recordTableHelpers";
import { applyScopeDefinition, scopeDefinition, useExtractPatientScope } from "../../hooks/useExtractPatientScope";
import { useExtractRunContext } from "../../hooks/useExtractRunContext";
import { useRecordPatientAttributes } from "../../hooks/useRecordPatientAttributes";
import { useRecordTable } from "../../hooks/useRecordTable";
import { today } from "../../lib/dates";
import { downloadBlob } from "../../lib/download";
import { ErrorBanner } from "../ErrorBanner";
import { CheckGroup, ConditionCodes, PeriodFields } from "./ExtractLeafFields";
import { ExtractFormRow } from "./ExtractFormRow";
import { FolderRegisterButton } from "./FolderRegisterButton";
import { PatientColumnsField } from "./PatientColumnsField";
import { CompareRow, PatientAttributesStatus, PatientScopeProgress, PatientScopeRow, PatientScopeSummary } from "./PatientScope";
import { RecordQueryBar } from "./RecordQueryBar";
import { RecordResultNotices } from "./RecordResultNotices";
import { RecordResultTable } from "./RecordResultTable";

const DEFAULT_PERIOD: ExtractPeriod = { mode: "relative", days: 365 };

const CATEGORIES: { value: ConditionExtractCategory; label: string }[] = [
  { value: "billing", label: "保険病名" },
  { value: "problem", label: "プロブレム" },
  { value: "past", label: "既往歴" },
];

const SUSPECTED: { value: ConditionExtractSuspected; label: string }[] = [
  { value: "exclude", label: "疑いを除く" },
  { value: "only", label: "疑いのみ" },
];

/**
 * 病名の抽出(docs/data-extract-design.md §20)。病名 1 件を 1 行にした表と CSV にする。病名・ICD10 の選び方は
 * 「患者」タブの病名の条件と同じ。患者の絞り込みはテンプレートの抽出と同じ。
 */
export function ConditionExtractPanel() {
  const scope = useExtractPatientScope();
  const context = useExtractRunContext();
  const extract = useConditionExtract();

  const [codes, setCodes] = useState<ExtractCode[]>([]);
  const [clinicalStatus, setClinicalStatus] = useState<string[]>([]);
  const [category, setCategory] = useState<ConditionExtractCategory | "">("");
  const [suspected, setSuspected] = useState<ConditionExtractSuspected | "">("");
  const [dateField, setDateField] = useState<"onset" | "recorded">("onset");
  const [period, setPeriod] = useState<ExtractPeriod>(DEFAULT_PERIOD);
  const [output, setOutput] = useState<ExtractOutput | undefined>(undefined);
  const [breakdown, setBreakdown] = useState<BreakdownSettings>({});

  // 病名の入力欄は「患者」タブの条件の部品なので、条件 1 つの形で渡す。
  const codeLeaf: ExtractLeaf = { key: "condition", kind: "condition", codes };

  const patientColumns = patientColumnsOf(output);
  const running = scope.running || extract.running;

  const definition = compactDefinition<ConditionExtractDefinition>({
    schema_version: 1,
    period,
    ...scopeDefinition(scope),
    output,
    breakdown: Object.keys(breakdown).length ? breakdown : undefined,
    codes,
    clinical_status: clinicalStatus,
    category: category || undefined,
    suspected: suspected || undefined,
    date_field: dateField,
  });
  const table = useRecordTable(conditionRunner, extract.result, definition, context);
  const attributes = useRecordPatientAttributes(scope.ran, table?.rows);

  /** 保存した条件を入力欄に戻す(null なら初期値)。 */
  function applyDefinition(saved: ConditionExtractDefinition | null) {
    setCodes(saved?.codes ?? []);
    setClinicalStatus(saved?.clinical_status ?? []);
    setCategory(saved?.category ?? "");
    setSuspected(saved?.suspected ?? "");
    setDateField(saved?.date_field ?? "onset");
    setPeriod(saved?.period ?? DEFAULT_PERIOD);
    applyScopeDefinition(scope, saved);
    setOutput(saved?.output);
    setBreakdown(saved?.breakdown ?? {});
  }

  async function handleRun() {
    const patientIds = await scope.resolve(period);
    if (patientIds === null) return;
    const criteria = conditionRunner.criteria(definition, { range: resolvePeriod(period, today()), patientIds }, context);
    if (criteria) void extract.run(criteria);
  }

  function handleCancel() {
    scope.cancel();
    extract.cancel();
  }

  return (
    <>
      <RecordQueryBar tab="condition" current={definition} onLoad={applyDefinition} />
      <div className="extract-form">
        <ExtractFormRow label="記録">
          <div className="extract-form-row__line">
            <ConditionCodes leaf={codeLeaf} patch={(next) => next.codes && setCodes(next.codes)} />
          </div>
          <label className="extract-field">
            区分
            <select value={category} onChange={(e) => setCategory(e.target.value as ConditionExtractCategory | "")}>
              <option value="">すべて</option>
              {CATEGORIES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="extract-field">
            疑い
            <select value={suspected} onChange={(e) => setSuspected(e.target.value as ConditionExtractSuspected | "")}>
              <option value="">含める</option>
              {SUSPECTED.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="extract-field">
            日付
            <select value={dateField} onChange={(e) => setDateField(e.target.value as "onset" | "recorded")}>
              <option value="onset">開始日</option>
              <option value="recorded">登録日</option>
            </select>
          </label>
          <PeriodFields period={period} onChange={(next) => next && setPeriod(next)} />
          <CheckGroup
            label="転帰"
            options={CLINICAL_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            values={clinicalStatus}
            onChange={setClinicalStatus}
          />
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
                downloadBlob(recordTableCsv(table.header, patientColumns, table.rows, attributes.attributes), `condition_${today()}.csv`)
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
          <RecordResultNotices runner={conditionRunner} truncated={extract.result?.truncated} table={table} />
          <PatientAttributesStatus attributes={attributes} />
          <RecordResultTable
            header={table.header}
            patientAttributes={attributes.attributes}
            patientColumns={patientColumns}
            breakdown={breakdown}
            onBreakdownChange={setBreakdown}
            rows={table.rows}
            emptyLabel={table.incomplete ? "" : conditionRunner.emptyLabel}
          />
        </section>
      )}
    </>
  );
}
