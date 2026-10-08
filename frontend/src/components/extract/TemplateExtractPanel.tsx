import { useMemo, useState } from "react";
import { useQuestionnaireOptions, useSelfDepartments, useTemplateExtract } from "../../api/queries";
import { departmentDisplayName, sortDepartmentsByCode } from "../../fhir/departmentHelpers";
import {
  RECORD_DISPLAY_LIMIT,
  patientColumnsOf,
  resolvePeriod,
  type ExtractOutput,
  type ExtractPeriod,
} from "../../fhir/extractQueryHelpers";
import {
  latestPerPatient,
  sortVersionsDesc,
  templateExtractCsv,
  templateExtractHeader,
  templateExtractTable,
  templateFixedCells,
} from "../../fhir/templateExtractHelpers";
import { today } from "../../lib/dates";
import { downloadBlob } from "../../lib/download";
import { ErrorBanner } from "../ErrorBanner";
import { TemplateSelect } from "../TemplateSelect";
import { TruncatedNotice } from "../TruncatedNotice";
import { PeriodFields } from "./ExtractLeafFields";
import { FolderRegisterButton } from "./FolderRegisterButton";
import { PatientColumnsField } from "./PatientColumnsField";
import { compactDefinition, type ExtractRecordDefinition } from "../../fhir/extractRecordQuery";
import type { BreakdownSettings } from "../../fhir/recordBreakdownHelpers";
import { applyScopeDefinition, scopeDefinition, useExtractPatientScope } from "../../hooks/useExtractPatientScope";
import { PatientScopeFields, PatientScopeProgress, PatientScopeSummary } from "./PatientScope";
import { RecordQueryBar } from "./RecordQueryBar";
import { RecordResultTable } from "./RecordResultTable";

const DEFAULT_PERIOD: ExtractPeriod = { mode: "relative", days: 365 };

/** 保存する条件(docs/data-extract-design.md §17)。 */
interface TemplateCriteria extends ExtractRecordDefinition {
  template_url?: string;
  latest_only?: boolean;
  department_id?: string;
}

/**
 * テンプレートの抽出(docs/data-extract-design.md §8)。1 つのテンプレートの回答を表と CSV にする。
 * 患者の条件を選んだら、先にその条件で患者を抽出し、該当した患者の回答だけを読む。
 * 患者フォルダを選んだら、そのフォルダ(下位フォルダを含む)の患者の回答だけを読む。両方なら両方に入る患者。
 */
export function TemplateExtractPanel() {
  const options = useQuestionnaireOptions();
  const { departments } = useSelfDepartments();
  const departmentOptions = sortDepartmentsByCode(departments).filter((d) => d.id);
  const scope = useExtractPatientScope();
  const extract = useTemplateExtract();

  const [templateUrl, setTemplateUrl] = useState("");
  const [period, setPeriod] = useState<ExtractPeriod>(DEFAULT_PERIOD);
  const [departmentId, setDepartmentId] = useState("");
  const [latestOnly, setLatestOnly] = useState(false);
  const [output, setOutput] = useState<ExtractOutput | undefined>(undefined);
  const [breakdown, setBreakdown] = useState<BreakdownSettings>({});

  // 版は url ごとにまとめて集めるので、選択肢には url ごとに最新の版だけを出す。
  const templates = useMemo(() => {
    const byUrl = new Map<string, fhir4.Questionnaire[]>();
    for (const q of options.questionnaires) {
      if (!q.url) continue;
      byUrl.set(q.url, [...(byUrl.get(q.url) ?? []), q]);
    }
    return [...byUrl.values()].map((versions) => sortVersionsDesc(versions)[0]);
  }, [options.questionnaires]);
  const selected = templates.find((q) => q.url === templateUrl);

  const table = useMemo(
    () =>
      extract.result
        ? templateExtractTable(extract.result.questionnaires, extract.result.responses, extract.result.patients)
        : null,
    [extract.result],
  );
  const rows = useMemo(() => (table ? (latestOnly ? latestPerPatient(table.rows) : table.rows) : []), [table, latestOnly]);
  const patientColumns = patientColumnsOf(output);
  const running = scope.running || extract.running;

  const definition = compactDefinition<TemplateCriteria>({
    schema_version: 1,
    period,
    ...scopeDefinition(scope),
    output,
    breakdown: Object.keys(breakdown).length ? breakdown : undefined,
    template_url: templateUrl || undefined,
    latest_only: latestOnly || undefined,
    department_id: departmentId || undefined,
  });

  /** 保存した条件を入力欄に戻す(null なら初期値)。 */
  function applyDefinition(saved: TemplateCriteria | null) {
    setTemplateUrl(saved?.template_url ?? "");
    setPeriod(saved?.period ?? DEFAULT_PERIOD);
    setDepartmentId(saved?.department_id ?? "");
    applyScopeDefinition(scope, saved);
    setLatestOnly(saved?.latest_only ?? false);
    setOutput(saved?.output);
    setBreakdown(saved?.breakdown ?? {});
  }

  async function handleRun() {
    if (!selected?.url) return;
    const url = selected.url;
    const patientIds = await scope.resolve();
    if (patientIds === null) return;
    const range = resolvePeriod(period, today());
    void extract.run({
      url,
      from: range?.from ?? "",
      to: range?.to ?? "",
      departmentId: departmentId || undefined,
      patientIds,
    });
  }

  function handleCancel() {
    scope.cancel();
    extract.cancel();
  }

  const title = selected?.title ?? selected?.name ?? "テンプレート";

  return (
    <>
      <RecordQueryBar tab="template" current={definition} onLoad={applyDefinition} />
      <div className="data-extract__toolbar data-extract__toolbar--fields">
        <TemplateSelect
          questionnaires={templates}
          value={selected?.id ?? ""}
          onChange={(id) => setTemplateUrl(templates.find((q) => q.id === id)?.url ?? "")}
        />
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
        <PatientScopeFields scope={scope} />
        <label className="extract-checks__item">
          <input type="checkbox" checked={latestOnly} onChange={(e) => setLatestOnly(e.target.checked)} />
          患者ごとに最新
        </label>
      </div>

      <PatientColumnsField
        value={patientColumns}
        selected={Boolean(output?.patient_columns?.length)}
        onChange={(patient_columns) => setOutput(patient_columns.length ? { patient_columns } : undefined)}
      />

      <ErrorBanner error={options.error ?? scope.listError} />

      <div className="data-extract__actions">
        {running ? (
          <button type="button" onClick={handleCancel}>
            中止
          </button>
        ) : (
          <button type="button" onClick={() => void handleRun()} disabled={!selected}>
            実行
          </button>
        )}
        <PatientScopeProgress scope={scope} />
        {extract.running && <span className="order-select__muted">実行中</span>}
        {table && (
          <span className="data-extract__exports">
            <FolderRegisterButton patientIds={rows.map((r) => r.patientId)} />
            <button
              type="button"
              disabled={rows.length === 0}
              onClick={() =>
                downloadBlob(templateExtractCsv(table.columns, rows, output), `template_${title}_${today()}.csv`)
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
              {latestOnly ? `${rows.length} 人` : `${rows.length} 件(${new Set(rows.map((r) => r.patientId)).size} 人)`}
            </span>
            <PatientScopeSummary scope={scope} />
          </div>
          <TruncatedNotice show={extract.result?.truncated}>
            回答が多いため、新しいものから一部だけを読みました。期間を絞ってください。
          </TruncatedNotice>
          <TruncatedNotice show={rows.length > RECORD_DISPLAY_LIMIT}>
            {`先頭の ${RECORD_DISPLAY_LIMIT} 件を表示しています。すべては CSV に出ます。`}
          </TruncatedNotice>
          <RecordResultTable
            header={templateExtractHeader(table.columns, output)}
            patientColumns={patientColumns}
            breakdown={breakdown}
            onBreakdownChange={setBreakdown}
            rows={rows.map((row) => ({
              key: row.responseId,
              patient: row,
              fixed: templateFixedCells(row),
              values: table.columns.map((column) => row.values.get(column.key) ?? ""),
            }))}
            emptyLabel="該当する回答はありません"
          />
        </section>
      )}
    </>
  );
}
