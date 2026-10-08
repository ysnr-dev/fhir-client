import { useMemo, useState } from "react";
import {
  useConditionExtract,
  type ConditionExtractCategory,
  type ConditionExtractSuspected,
} from "../../api/queries";
import { conditionExtractCsv, conditionExtractHeader, conditionExtractRows } from "../../fhir/conditionExtractHelpers";
import {
  CLINICAL_STATUS_OPTIONS,
  RECORD_DISPLAY_LIMIT,
  patientColumnsOf,
  resolvePeriod,
  type ExtractCode,
  type ExtractLeaf,
  type ExtractOutput,
  type ExtractPeriod,
} from "../../fhir/extractQueryHelpers";
import { compactDefinition, type ExtractRecordDefinition } from "../../fhir/extractRecordQuery";
import { applyScopeDefinition, scopeDefinition, useExtractPatientScope } from "../../hooks/useExtractPatientScope";
import { today } from "../../lib/dates";
import { downloadBlob } from "../../lib/download";
import { ErrorBanner } from "../ErrorBanner";
import { TruncatedNotice } from "../TruncatedNotice";
import { CheckGroup, ConditionCodes, PeriodFields } from "./ExtractLeafFields";
import { FolderRegisterButton } from "./FolderRegisterButton";
import { PatientColumnsField } from "./PatientColumnsField";
import { PatientScopeFields, PatientScopeProgress, PatientScopeSummary } from "./PatientScope";
import { RecordQueryBar } from "./RecordQueryBar";
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

/** 保存する条件(docs/data-extract-design.md §17)。 */
interface ConditionCriteria extends ExtractRecordDefinition {
  codes?: ExtractCode[];
  clinical_status?: string[];
  category?: ConditionExtractCategory;
  suspected?: ConditionExtractSuspected;
  date_field?: "onset" | "recorded";
}

/**
 * 病名の抽出(docs/data-extract-design.md §20)。病名 1 件を 1 行にした表と CSV にする。病名・ICD10 の選び方は
 * 「患者」タブの病名の条件と同じ。患者の絞り込みはテンプレートの抽出と同じ。
 */
export function ConditionExtractPanel() {
  const scope = useExtractPatientScope();
  const extract = useConditionExtract();

  const [codes, setCodes] = useState<ExtractCode[]>([]);
  const [clinicalStatus, setClinicalStatus] = useState<string[]>([]);
  const [category, setCategory] = useState<ConditionExtractCategory | "">("");
  const [suspected, setSuspected] = useState<ConditionExtractSuspected | "">("");
  const [dateField, setDateField] = useState<"onset" | "recorded">("onset");
  const [period, setPeriod] = useState<ExtractPeriod>(DEFAULT_PERIOD);
  const [output, setOutput] = useState<ExtractOutput | undefined>(undefined);
  // 行の日付の見方は、実行したときのもの。
  const [ranDateField, setRanDateField] = useState<"onset" | "recorded">("onset");

  // 病名の入力欄は「患者」タブの条件の部品なので、条件 1 つの形で渡す。
  const codeLeaf: ExtractLeaf = { key: "condition", kind: "condition", codes };

  const rows = useMemo(
    () => (extract.result ? conditionExtractRows(extract.result.conditions, extract.result.patients, ranDateField) : null),
    [extract.result, ranDateField],
  );
  const patientColumns = patientColumnsOf(output);
  const running = scope.running || extract.running;

  const definition = compactDefinition<ConditionCriteria>({
    schema_version: 1,
    period,
    ...scopeDefinition(scope),
    output,
    codes,
    clinical_status: clinicalStatus,
    category: category || undefined,
    suspected: suspected || undefined,
    date_field: dateField,
  });

  /** 保存した条件を入力欄に戻す(null なら初期値)。 */
  function applyDefinition(saved: ConditionCriteria | null) {
    setCodes(saved?.codes ?? []);
    setClinicalStatus(saved?.clinical_status ?? []);
    setCategory(saved?.category ?? "");
    setSuspected(saved?.suspected ?? "");
    setDateField(saved?.date_field ?? "onset");
    setPeriod(saved?.period ?? DEFAULT_PERIOD);
    applyScopeDefinition(scope, saved);
    setOutput(saved?.output);
  }

  async function handleRun() {
    const patientIds = await scope.resolve();
    if (patientIds === null) return;
    const range = resolvePeriod(period, today());
    setRanDateField(dateField);
    void extract.run({
      codes,
      clinicalStatus,
      category: category || undefined,
      suspected: suspected || undefined,
      dateField,
      from: range?.from ?? "",
      to: range?.to ?? "",
      patientIds,
    });
  }

  function handleCancel() {
    scope.cancel();
    extract.cancel();
  }

  return (
    <>
      <RecordQueryBar tab="condition" current={definition} onLoad={applyDefinition} />
      <ConditionCodes leaf={codeLeaf} patch={(next) => next.codes && setCodes(next.codes)} />

      <div className="data-extract__toolbar data-extract__toolbar--fields">
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
        <PatientScopeFields scope={scope} />
        <CheckGroup
          label="転帰"
          options={CLINICAL_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          values={clinicalStatus}
          onChange={setClinicalStatus}
        />
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
              onClick={() => downloadBlob(conditionExtractCsv(rows, output), `condition_${today()}.csv`)}
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
            病名が多いため、新しいものから一部だけを読みました。期間か病名を絞ってください。
          </TruncatedNotice>
          <TruncatedNotice show={rows.length > RECORD_DISPLAY_LIMIT}>
            {`先頭の ${RECORD_DISPLAY_LIMIT} 件を表示しています。すべては CSV に出ます。`}
          </TruncatedNotice>
          <RecordResultTable
            header={conditionExtractHeader(output)}
            patientColumns={patientColumns}
            rows={rows.map((row) => ({ key: row.rowKey, patient: row, fixed: row.fixed, values: row.values }))}
            emptyLabel="該当する病名はありません"
          />
        </section>
      )}
    </>
  );
}
