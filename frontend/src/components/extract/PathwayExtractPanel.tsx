import { useMemo, useState } from "react";
import { usePathwayOptions } from "../../api/masterQueries";
import { usePathwayExtract } from "../../api/queries";
import {
  patientColumnsOf,
  resolvePeriod,
  type ExtractOutput,
  type ExtractPeriod,
} from "../../fhir/extractQueryHelpers";
import { compactDefinition, type PathwayExtractDefinition } from "../../fhir/extractRecordQuery";
import { pathwayRunner, recordCountLabel } from "../../fhir/extractTabRunners";
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

const DEFAULT_PERIOD: ExtractPeriod = { mode: "relative", days: 365 };

/**
 * クリニカルパスの適用の抽出(docs/data-extract-design.md §14)。適用 1 件を 1 行にし、日数・終了区分と
 * アウトカムの評価(達成・バリアンス)を表と CSV にする。患者の絞り込みはテンプレートの抽出と同じ。
 */
export function PathwayExtractPanel() {
  const pathwayList = usePathwayOptions();
  const pathways = useMemo(
    () => [...(pathwayList.data?.items ?? [])].sort((a, b) => a.name.localeCompare(b.name, "ja")),
    [pathwayList.data],
  );
  const scope = useExtractPatientScope();
  const context = useExtractRunContext();
  const extract = usePathwayExtract();

  const [pathwayCode, setPathwayCode] = useState("");
  const [period, setPeriod] = useState<ExtractPeriod>(DEFAULT_PERIOD);
  const [output, setOutput] = useState<ExtractOutput | undefined>(undefined);
  const [breakdown, setBreakdown] = useState<BreakdownSettings>({});

  const patientColumns = patientColumnsOf(output);
  const running = scope.running || extract.running;

  async function handleRun() {
    const patientIds = await scope.resolve(period);
    if (patientIds === null) return;
    const criteria = pathwayRunner.criteria(definition, { range: resolvePeriod(period, today()), patientIds }, context);
    if (criteria) void extract.run(criteria);
  }

  const definition = compactDefinition<PathwayExtractDefinition>({
    schema_version: 1,
    period,
    ...scopeDefinition(scope),
    output,
    breakdown: Object.keys(breakdown).length ? breakdown : undefined,
    pathway_code: pathwayCode || undefined,
  });
  const table = useRecordTable(pathwayRunner, extract.result, definition, context);
  const attributes = useRecordPatientAttributes(scope.ran, table?.rows);

  /** 保存した条件を入力欄に戻す(null なら初期値)。 */
  function applyDefinition(saved: PathwayExtractDefinition | null) {
    setPathwayCode(saved?.pathway_code ?? "");
    setPeriod(saved?.period ?? DEFAULT_PERIOD);
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
      <RecordQueryBar tab="pathway" current={definition} onLoad={applyDefinition} />
      <div className="extract-form">
        <ExtractFormRow label="記録">
          <label className="extract-field">
            パス
            <select value={pathwayCode} onChange={(e) => setPathwayCode(e.target.value)}>
              <option value="">すべて</option>
              {pathways.map((pathway) => (
                <option key={pathway.id} value={pathway.pathway_code}>
                  {pathway.version ? `${pathway.name}(${pathway.version})` : pathway.name}
                </option>
              ))}
            </select>
          </label>
          <PeriodFields period={period} onChange={(next) => next && setPeriod(next)} />
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

      <ErrorBanner error={scope.listError ?? pathwayList.error} />

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
              onClick={() => downloadBlob(recordTableCsv(table.header, patientColumns, table.rows, attributes.attributes), `pathway_${today()}.csv`)}
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
          <RecordResultNotices runner={pathwayRunner} truncated={extract.result?.truncated} table={table} />
          <PatientAttributesStatus attributes={attributes} />
          <RecordResultTable
            header={table.header}
            patientAttributes={attributes.attributes}
            patientColumns={patientColumns}
            breakdown={breakdown}
            onBreakdownChange={setBreakdown}
            rows={table.rows}
            emptyLabel={table.incomplete ? "" : pathwayRunner.emptyLabel}
          />
        </section>
      )}
    </>
  );
}
