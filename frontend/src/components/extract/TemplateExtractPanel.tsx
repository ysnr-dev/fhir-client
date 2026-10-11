import { useMemo, useState } from "react";
import { useQuestionnaireOptions, useSelfDepartments, useTemplateExtract } from "../../api/queries";
import { departmentDisplayName, sortDepartmentsByCode } from "../../fhir/departmentHelpers";
import {
  patientColumnsOf,
  resolvePeriod,
  type ExtractOutput,
  type ExtractPeriod,
} from "../../fhir/extractQueryHelpers";
import { sortVersionsDesc } from "../../fhir/templateExtractHelpers";
import { today } from "../../lib/dates";
import { downloadBlob } from "../../lib/download";
import { ErrorBanner } from "../ErrorBanner";
import { TemplateSelect } from "../TemplateSelect";
import { PeriodFields } from "./ExtractLeafFields";
import { FolderRegisterButton } from "./FolderRegisterButton";
import { PatientColumnsField } from "./PatientColumnsField";
import { compactDefinition, type TemplateExtractDefinition } from "../../fhir/extractRecordQuery";
import { templateRunner, recordCountLabel } from "../../fhir/extractTabRunners";
import type { BreakdownSettings } from "../../fhir/recordBreakdownHelpers";
import { applyScopeDefinition, scopeDefinition, useExtractPatientScope } from "../../hooks/useExtractPatientScope";
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
 * テンプレートの抽出(docs/data-extract-design.md §8)。1 つのテンプレートの回答を表と CSV にする。
 * 患者の条件を選んだら、先にその条件で患者を抽出し、該当した患者の回答だけを読む。
 * 患者フォルダを選んだら、そのフォルダ(下位フォルダを含む)の患者の回答だけを読む。両方なら両方に入る患者。
 */
export function TemplateExtractPanel() {
  const options = useQuestionnaireOptions();
  const { departments } = useSelfDepartments();
  const departmentOptions = sortDepartmentsByCode(departments).filter((d) => d.id);
  const scope = useExtractPatientScope();
  const context = useExtractRunContext();
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

  const patientColumns = patientColumnsOf(output);
  const running = scope.running || extract.running;

  const definition = compactDefinition<TemplateExtractDefinition>({
    schema_version: 1,
    period,
    ...scopeDefinition(scope),
    output,
    breakdown: Object.keys(breakdown).length ? breakdown : undefined,
    template_url: templateUrl || undefined,
    latest_only: latestOnly || undefined,
    department_id: departmentId || undefined,
  });
  const table = useRecordTable(templateRunner, extract.result, definition, context);
  const attributes = useRecordPatientAttributes(scope.ran, table?.rows);

  /** 保存した条件を入力欄に戻す(null なら初期値)。 */
  function applyDefinition(saved: TemplateExtractDefinition | null) {
    setTemplateUrl(saved?.template_url ?? "");
    setPeriod(saved?.period ?? DEFAULT_PERIOD);
    setDepartmentId(saved?.department_id ?? "");
    applyScopeDefinition(scope, saved);
    setLatestOnly(saved?.latest_only ?? false);
    setOutput(saved?.output);
    setBreakdown(saved?.breakdown ?? {});
  }

  async function handleRun() {
    const patientIds = await scope.resolve(period);
    if (patientIds === null) return;
    const criteria = templateRunner.criteria(definition, { range: resolvePeriod(period, today()), patientIds }, context);
    if (criteria) void extract.run(criteria);
  }

  function handleCancel() {
    scope.cancel();
    extract.cancel();
  }

  return (
    <>
      <RecordQueryBar tab="template" current={definition} onLoad={applyDefinition} />
      <div className="extract-form">
        <ExtractFormRow label="記録">
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
        </ExtractFormRow>
        <PatientScopeRow scope={scope} />
        <CompareRow scope={scope} />
        <ExtractFormRow label="表" help="実行し直さなくても結果に反映します。">
          <label className="extract-checks__item">
            <input type="checkbox" checked={latestOnly} onChange={(e) => setLatestOnly(e.target.checked)} />
            患者ごとに最新
          </label>
          <PatientColumnsField
            value={patientColumns}
            selected={Boolean(output?.patient_columns?.length)}
            onChange={(patient_columns) => setOutput(patient_columns.length ? { patient_columns } : undefined)}
          />
        </ExtractFormRow>
      </div>

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
            <FolderRegisterButton patientIds={table.rows.map((r) => r.patient.patientId)} />
            <button
              type="button"
              disabled={table.rows.length === 0}
              onClick={() =>
                downloadBlob(recordTableCsv(table.header, patientColumns, table.rows, attributes.attributes), `template_${selected?.title ?? selected?.name ?? "テンプレート"}_${today()}.csv`)
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
          <RecordResultNotices runner={templateRunner} truncated={extract.result?.truncated} table={table} />
          <PatientAttributesStatus attributes={attributes} />
          <RecordResultTable
            header={table.header}
            patientAttributes={attributes.attributes}
            patientColumns={patientColumns}
            breakdown={breakdown}
            onBreakdownChange={setBreakdown}
            rows={table.rows}
            emptyLabel={table.incomplete ? "" : templateRunner.emptyLabel}
          />
        </section>
      )}
    </>
  );
}
