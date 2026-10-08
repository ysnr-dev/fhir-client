import { useMemo, useState } from "react";
import { useMedicationExtract, useSelfDepartments } from "../../api/queries";
import { departmentDisplayName, sortDepartmentsByCode } from "../../fhir/departmentHelpers";
import {
  EXTRACT_ORDER_TYPES,
  RECORD_DISPLAY_LIMIT,
  patientColumnsOf,
  resolvePeriod,
  type ExtractCode,
  type ExtractDrugClass,
  type ExtractLeaf,
  type ExtractOrderType,
  type ExtractOutput,
  type ExtractPeriod,
} from "../../fhir/extractQueryHelpers";
import { medicationExtractCsv, medicationExtractHeader, medicationExtractRows } from "../../fhir/medicationExtractHelpers";
import { useExtractPatientScope } from "../../hooks/useExtractPatientScope";
import { today } from "../../lib/dates";
import { downloadBlob } from "../../lib/download";
import { ErrorBanner } from "../ErrorBanner";
import { TruncatedNotice } from "../TruncatedNotice";
import { MedicationCodes, PeriodFields } from "./ExtractLeafFields";
import { FolderRegisterButton } from "./FolderRegisterButton";
import { PatientColumnsField } from "./PatientColumnsField";
import { PatientScopeFields, PatientScopeProgress, PatientScopeSummary } from "./PatientScope";
import { RecordResultTable } from "./RecordResultTable";

const DEFAULT_PERIOD: ExtractPeriod = { mode: "relative", days: 365 };

/**
 * 投薬の抽出(docs/data-extract-design.md §15)。処方・注射のオーダーの薬剤 1 件を 1 行にした表と CSV にする。
 * 薬剤・薬効分類の選び方は「患者」タブの処方・注射の条件と同じ。患者の絞り込みはテンプレートの抽出と同じ。
 */
export function MedicationExtractPanel() {
  const { departments } = useSelfDepartments();
  const departmentOptions = sortDepartmentsByCode(departments).filter((d) => d.id);
  const scope = useExtractPatientScope();
  const extract = useMedicationExtract();

  const [codes, setCodes] = useState<ExtractCode[]>([]);
  const [drugClasses, setDrugClasses] = useState<ExtractDrugClass[]>([]);
  const [orderType, setOrderType] = useState<ExtractOrderType | "">("");
  const [period, setPeriod] = useState<ExtractPeriod>(DEFAULT_PERIOD);
  const [departmentId, setDepartmentId] = useState("");
  const [output, setOutput] = useState<ExtractOutput | undefined>(undefined);

  // 薬剤の入力欄は「患者」タブの条件の部品なので、条件 1 つの形で渡す。
  const drugLeaf: ExtractLeaf = { key: "drug", kind: "medication", codes, drug_classes: drugClasses };

  const rows = useMemo(
    () =>
      extract.result
        ? medicationExtractRows(extract.result.requests, extract.result.headers, extract.result.patients)
        : null,
    [extract.result],
  );
  const patientColumns = patientColumnsOf(output);
  const running = scope.running || extract.running;

  async function handleRun() {
    const patientIds = await scope.resolve();
    if (patientIds === null) return;
    const range = resolvePeriod(period, today());
    void extract.run({
      codes,
      drugClasses,
      orderType: orderType || undefined,
      from: range?.from ?? "",
      to: range?.to ?? "",
      departmentId: departmentId || undefined,
      patientIds,
    });
  }

  function handleClear() {
    setCodes([]);
    setDrugClasses([]);
    setOrderType("");
    setPeriod(DEFAULT_PERIOD);
    setDepartmentId("");
    scope.setQueryId(null);
    scope.setFolderId(null);
    setOutput(undefined);
  }

  function handleCancel() {
    scope.cancel();
    extract.cancel();
  }

  return (
    <>
      <MedicationCodes
        leaf={drugLeaf}
        patch={(next) => {
          if (next.codes) setCodes(next.codes);
          if (next.drug_classes) setDrugClasses(next.drug_classes);
        }}
      />

      <div className="data-extract__toolbar data-extract__toolbar--fields">
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
        <PatientScopeFields scope={scope} />
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
        {rows && (
          <span className="data-extract__exports">
            <FolderRegisterButton patientIds={rows.map((r) => r.patientId)} />
            <button
              type="button"
              disabled={rows.length === 0}
              onClick={() => downloadBlob(medicationExtractCsv(rows, output), `medication_${today()}.csv`)}
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
            オーダーが多いため、新しいものから一部だけを読みました。期間か薬剤を絞ってください。
          </TruncatedNotice>
          <TruncatedNotice show={rows.length > RECORD_DISPLAY_LIMIT}>
            {`先頭の ${RECORD_DISPLAY_LIMIT} 件を表示しています。すべては CSV に出ます。`}
          </TruncatedNotice>
          <RecordResultTable
            header={medicationExtractHeader(output)}
            patientColumns={patientColumns}
            rows={rows.map((row) => ({ key: row.rowKey, patient: row, fixed: row.fixed, values: row.values }))}
            emptyLabel="該当する投薬はありません"
          />
        </section>
      )}
    </>
  );
}
