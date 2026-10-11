import { useState } from "react";
import { useMedicationExtract, useSelfDepartments } from "../../api/queries";
import { departmentDisplayName, sortDepartmentsByCode } from "../../fhir/departmentHelpers";
import {
  EXTRACT_ORDER_TYPES,
  patientColumnsOf,
  resolvePeriod,
  type ExtractCode,
  type ExtractDrugClass,
  type ExtractLeaf,
  type ExtractOrderType,
  type ExtractOutput,
  type ExtractPeriod,
} from "../../fhir/extractQueryHelpers";
import { compactDefinition, type MedicationExtractDefinition } from "../../fhir/extractRecordQuery";
import { medicationRunner, recordCountLabel } from "../../fhir/extractTabRunners";
import type { BreakdownSettings } from "../../fhir/recordBreakdownHelpers";
import { applyScopeDefinition, scopeDefinition, useExtractPatientScope } from "../../hooks/useExtractPatientScope";
import { today } from "../../lib/dates";
import { downloadBlob } from "../../lib/download";
import { ErrorBanner } from "../ErrorBanner";
import { MedicationCodes, PeriodFields } from "./ExtractLeafFields";
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
 * 投薬の抽出(docs/data-extract-design.md §15)。処方・注射のオーダーの薬剤 1 件を 1 行にした表と CSV にする。
 * 薬剤・薬効分類の選び方は「患者」タブの処方・注射の条件と同じ。患者の絞り込みはテンプレートの抽出と同じ。
 */
export function MedicationExtractPanel() {
  const { departments } = useSelfDepartments();
  const departmentOptions = sortDepartmentsByCode(departments).filter((d) => d.id);
  const scope = useExtractPatientScope();
  const context = useExtractRunContext();
  const extract = useMedicationExtract();

  const [codes, setCodes] = useState<ExtractCode[]>([]);
  const [drugClasses, setDrugClasses] = useState<ExtractDrugClass[]>([]);
  const [orderType, setOrderType] = useState<ExtractOrderType | "">("");
  const [period, setPeriod] = useState<ExtractPeriod>(DEFAULT_PERIOD);
  const [departmentId, setDepartmentId] = useState("");
  const [output, setOutput] = useState<ExtractOutput | undefined>(undefined);
  const [breakdown, setBreakdown] = useState<BreakdownSettings>({});

  // 薬剤の入力欄は「患者」タブの条件の部品なので、条件 1 つの形で渡す。
  const drugLeaf: ExtractLeaf = { key: "drug", kind: "medication", codes, drug_classes: drugClasses };

  const patientColumns = patientColumnsOf(output);
  const running = scope.running || extract.running;

  async function handleRun() {
    const patientIds = await scope.resolve(period);
    if (patientIds === null) return;
    const criteria = medicationRunner.criteria(definition, { range: resolvePeriod(period, today()), patientIds }, context);
    if (criteria) void extract.run(criteria);
  }

  const definition = compactDefinition<MedicationExtractDefinition>({
    schema_version: 1,
    period,
    ...scopeDefinition(scope),
    output,
    breakdown: Object.keys(breakdown).length ? breakdown : undefined,
    codes,
    drug_classes: drugClasses,
    order_type: orderType || undefined,
    department_id: departmentId || undefined,
  });
  const table = useRecordTable(medicationRunner, extract.result, definition, context);
  const attributes = useRecordPatientAttributes(scope.ran, table?.rows);

  /** 保存した条件を入力欄に戻す(null なら初期値)。 */
  function applyDefinition(saved: MedicationExtractDefinition | null) {
    setCodes(saved?.codes ?? []);
    setDrugClasses(saved?.drug_classes ?? []);
    setOrderType(saved?.order_type ?? "");
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
      <RecordQueryBar tab="medication" current={definition} onLoad={applyDefinition} />
      <div className="extract-form">
        <ExtractFormRow label="記録">
          <div className="extract-form-row__line">
            <MedicationCodes
              leaf={drugLeaf}
              patch={(next) => {
                if (next.codes) setCodes(next.codes);
                if (next.drug_classes) setDrugClasses(next.drug_classes);
              }}
            />
          </div>
          <label className="extract-field">
            区分
            <select value={orderType} onChange={(e) => setOrderType(e.target.value as ExtractOrderType | "")}>
              <option value="">処方・注射</option>
              {EXTRACT_ORDER_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <PeriodFields period={period} onChange={(next) => next && setPeriod(next)} />
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
              onClick={() => downloadBlob(recordTableCsv(table.header, patientColumns, table.rows, attributes.attributes), `medication_${today()}.csv`)}
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
          <RecordResultNotices runner={medicationRunner} truncated={extract.result?.truncated} table={table} />
          <PatientAttributesStatus attributes={attributes} />
          <RecordResultTable
            header={table.header}
            patientAttributes={attributes.attributes}
            patientColumns={patientColumns}
            breakdown={breakdown}
            onBreakdownChange={setBreakdown}
            rows={table.rows}
            emptyLabel={table.incomplete ? "" : medicationRunner.emptyLabel}
          />
        </section>
      )}
    </>
  );
}
