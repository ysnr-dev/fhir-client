import { useState } from "react";
import type { LabResultItem } from "../../api/masterClient";
import { useLabExtract, useSelfDepartments } from "../../api/queries";
import { hasChartItem, labChartItem, type ChartItem } from "../../fhir/chartDefinitionHelpers";
import { departmentDisplayName, sortDepartmentsByCode } from "../../fhir/departmentHelpers";
import {
  patientColumnsOf,
  resolvePeriod,
  type ExtractOutput,
  type ExtractPeriod,
} from "../../fhir/extractQueryHelpers";
import {
  LAB_EXTRACT_AGGREGATES,
  LAB_EXTRACT_MAX_ITEMS,
  LAB_EXTRACT_ROW_MODES,
  type LabExtractAggregate,
  type LabExtractRowMode,
} from "../../fhir/labExtractHelpers";
import { today } from "../../lib/dates";
import { downloadBlob } from "../../lib/download";
import { ErrorBanner } from "../ErrorBanner";
import { LabResultItemSearchModal } from "../LabResultItemSearchModal";
import { CheckGroup, PeriodFields } from "./ExtractLeafFields";
import { FolderRegisterButton } from "./FolderRegisterButton";
import { PatientColumnsField } from "./PatientColumnsField";
import { compactDefinition, type LabExtractDefinition } from "../../fhir/extractRecordQuery";
import { labRunner, recordCountLabel } from "../../fhir/extractTabRunners";
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
import { VitalItemSelectModal } from "./VitalItemSelectModal";

const DEFAULT_PERIOD: ExtractPeriod = { mode: "relative", days: 365 };
const DEFAULT_AGGREGATES: LabExtractAggregate[] = ["latest"];

/**
 * 検査結果の抽出(docs/data-extract-design.md §9)。選んだ検査・バイタルの項目を列にして、
 * 測定日時・日・患者ごとの表と CSV にする。患者の絞り込みはテンプレートの抽出と同じ。
 */
export function LabExtractPanel() {
  const { departments } = useSelfDepartments();
  const departmentOptions = sortDepartmentsByCode(departments).filter((d) => d.id);
  const scope = useExtractPatientScope();
  const context = useExtractRunContext();
  const extract = useLabExtract();

  const [items, setItems] = useState<ChartItem[]>([]);
  const [picking, setPicking] = useState<"lab" | "vital" | null>(null);
  const [period, setPeriod] = useState<ExtractPeriod>(DEFAULT_PERIOD);
  const [departmentId, setDepartmentId] = useState("");
  const [mode, setMode] = useState<LabExtractRowMode>("time");
  const [aggregates, setAggregates] = useState<LabExtractAggregate[]>(DEFAULT_AGGREGATES);
  const [interpretation, setInterpretation] = useState(false);
  const [output, setOutput] = useState<ExtractOutput | undefined>(undefined);
  const [breakdown, setBreakdown] = useState<BreakdownSettings>({});

  const addItems = (added: ChartItem[]) =>
    setItems((current) => {
      const next = [...current];
      for (const item of added) if (!hasChartItem(next, item)) next.push(item);
      return next.slice(0, LAB_EXTRACT_MAX_ITEMS);
    });

  const patientColumns = patientColumnsOf(output);
  const running = scope.running || extract.running;

  async function handleRun() {
    const patientIds = await scope.resolve(period);
    if (patientIds === null) return;
    const criteria = labRunner.criteria(definition, { range: resolvePeriod(period, today()), patientIds }, context);
    if (criteria) void extract.run(criteria);
  }

  const definition = compactDefinition<LabExtractDefinition>({
    schema_version: 1,
    period,
    ...scopeDefinition(scope),
    output,
    breakdown: Object.keys(breakdown).length ? breakdown : undefined,
    items,
    mode,
    aggregates,
    interpretation: interpretation || undefined,
    department_id: departmentId || undefined,
  });
  const table = useRecordTable(labRunner, extract.result, definition, context);
  const attributes = useRecordPatientAttributes(scope.ran, table?.rows);

  /** 保存した条件を入力欄に戻す(null なら初期値)。 */
  function applyDefinition(saved: LabExtractDefinition | null) {
    setItems(saved?.items ?? []);
    setPeriod(saved?.period ?? DEFAULT_PERIOD);
    setDepartmentId(saved?.department_id ?? "");
    applyScopeDefinition(scope, saved);
    setMode(saved?.mode ?? "time");
    setAggregates(saved?.aggregates ?? DEFAULT_AGGREGATES);
    setInterpretation(saved?.interpretation ?? false);
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
      <RecordQueryBar tab="lab" current={definition} onLoad={applyDefinition} />
      <div className="extract-form">
        <ExtractFormRow label="記録">
          <div className="extract-form-row__line">
            <button type="button" className="rp-card__compact-button" onClick={() => setPicking("lab")}>
              検査項目
            </button>
            <button type="button" className="rp-card__compact-button" onClick={() => setPicking("vital")}>
              バイタル
            </button>
            {items.length > 0 && (
              <span className="extract-chips">
                {items.map((item) => (
                  <span key={item.key} className="extract-chip">
                    {item.name}
                    <button
                      type="button"
                      className="extract-chip__remove"
                      aria-label={`${item.name} を外す`}
                      onClick={() => setItems((current) => current.filter((i) => i.key !== item.key))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </span>
            )}
          </div>
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
          <label className="extract-field">
            行
            <select value={mode} onChange={(e) => setMode(e.target.value as LabExtractRowMode)}>
              {LAB_EXTRACT_ROW_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          {mode === "patient" && (
            <CheckGroup
              label="集計"
              options={LAB_EXTRACT_AGGREGATES}
              values={aggregates}
              onChange={(next) => next.length > 0 && setAggregates(next as LabExtractAggregate[])}
            />
          )}
          <label className="extract-checks__item">
            <input type="checkbox" checked={interpretation} onChange={(e) => setInterpretation(e.target.checked)} />
            H/L
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
            <button type="button" onClick={() => void handleRun()} disabled={items.length === 0}>
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
              onClick={() => downloadBlob(recordTableCsv(table.header, patientColumns, table.rows, attributes.attributes), `lab_${today()}.csv`)}
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
          <RecordResultNotices runner={labRunner} truncated={extract.result?.truncated} table={table} />
          <PatientAttributesStatus attributes={attributes} />
          <RecordResultTable
            header={table.header}
            patientAttributes={attributes.attributes}
            patientColumns={patientColumns}
            breakdown={breakdown}
            onBreakdownChange={setBreakdown}
            rows={table.rows}
            emptyLabel={table.incomplete ? "" : labRunner.emptyLabel}
          />
        </section>
      )}
      {picking === "lab" && (
        <LabResultItemSearchModal
          onSelect={(item: LabResultItem) => {
            addItems([labChartItem(item)]);
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
      {picking === "vital" && (
        <VitalItemSelectModal
          onSelect={(item) => {
            addItems([item]);
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </>
  );
}
