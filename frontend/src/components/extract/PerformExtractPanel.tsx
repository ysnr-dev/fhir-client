import { useMemo, useState } from "react";
import { usePerformExtract, useSelfDepartments } from "../../api/queries";
import { departmentDisplayName, sortDepartmentsByCode } from "../../fhir/departmentHelpers";
import {
  RECORD_DISPLAY_LIMIT,
  patientColumnsOf,
  resolvePeriod,
  type ExtractOutput,
  type ExtractPeriod,
} from "../../fhir/extractQueryHelpers";
import {
  PERFORM_EXTRACT_KINDS,
  performExtractCsv,
  performExtractHeader,
  performExtractTable,
  performRowCells,
} from "../../fhir/performExtractHelpers";
import { useExtractPatientScope } from "../../hooks/useExtractPatientScope";
import { today } from "../../lib/dates";
import { downloadBlob } from "../../lib/download";
import { ErrorBanner } from "../ErrorBanner";
import { TruncatedNotice } from "../TruncatedNotice";
import { PeriodFields } from "./ExtractLeafFields";
import { FolderRegisterButton } from "./FolderRegisterButton";
import { PatientColumnsField } from "./PatientColumnsField";
import { PatientScopeFields, PatientScopeProgress, PatientScopeSummary } from "./PatientScope";
import { RecordResultTable } from "./RecordResultTable";

const DEFAULT_PERIOD: ExtractPeriod = { mode: "relative", days: 365 };
const DEFAULT_KIND = PERFORM_EXTRACT_KINDS[0].code;

/**
 * 部門オーダーの実施記録の抽出(docs/data-extract-design.md §13)。種別を 1 つ選び、実施 1 件を 1 行にした
 * 表と CSV にする。患者の絞り込みはテンプレートの抽出と同じ。
 */
export function PerformExtractPanel() {
  const { departments } = useSelfDepartments();
  const departmentOptions = sortDepartmentsByCode(departments).filter((d) => d.id);
  const scope = useExtractPatientScope();
  const extract = usePerformExtract();

  const [kind, setKind] = useState(DEFAULT_KIND);
  const [period, setPeriod] = useState<ExtractPeriod>(DEFAULT_PERIOD);
  const [departmentId, setDepartmentId] = useState("");
  const [output, setOutput] = useState<ExtractOutput | undefined>(undefined);
  // 表の見出しに出す種別は、実行したときの種別(選び直しても読み直すまで変えない)。
  const [ranKind, setRanKind] = useState(DEFAULT_KIND);

  const table = useMemo(
    () =>
      extract.result
        ? performExtractTable(
            extract.result.hubs,
            extract.result.children,
            extract.result.administrations,
            extract.result.observations,
            extract.result.serviceRequests,
            extract.result.patients,
          )
        : null,
    [extract.result],
  );
  const rows = table?.rows ?? [];
  const patientColumns = patientColumnsOf(output);
  const running = scope.running || extract.running;
  const ranLabel = PERFORM_EXTRACT_KINDS.find((k) => k.code === ranKind)?.label ?? "";

  async function handleRun() {
    const patientIds = await scope.resolve();
    if (patientIds === null) return;
    const range = resolvePeriod(period, today());
    setRanKind(kind);
    void extract.run({
      orderType: kind,
      from: range?.from ?? "",
      to: range?.to ?? "",
      departmentId: departmentId || undefined,
      patientIds,
    });
  }

  function handleClear() {
    setKind(DEFAULT_KIND);
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
      <div className="data-extract__toolbar data-extract__toolbar--fields">
        <label className="extract-field">
          種別
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {PERFORM_EXTRACT_KINDS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
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
        {table && (
          <span className="data-extract__exports">
            <FolderRegisterButton patientIds={rows.map((r) => r.patientId)} />
            <button
              type="button"
              disabled={rows.length === 0}
              onClick={() =>
                downloadBlob(performExtractCsv(table.measureColumns, rows, output), `perform_${ranKind}_${today()}.csv`)
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
              {`${ranLabel} ${rows.length} 件(${new Set(rows.map((r) => r.patientId)).size} 人)`}
            </span>
            <PatientScopeSummary scope={scope} />
          </div>
          <TruncatedNotice show={extract.result?.truncated}>
            実施が多いため、新しいものから一部だけを読みました。期間を絞ってください。
          </TruncatedNotice>
          <TruncatedNotice show={rows.length > RECORD_DISPLAY_LIMIT}>
            {`先頭の ${RECORD_DISPLAY_LIMIT} 件を表示しています。すべては CSV に出ます。`}
          </TruncatedNotice>
          <RecordResultTable
            header={performExtractHeader(table.measureColumns, output)}
            patientColumns={patientColumns}
            rows={rows.map((row) => ({
              key: row.rowKey,
              patient: row,
              fixed: row.fixed,
              values: performRowCells(row, table.measureColumns),
            }))}
            emptyLabel="該当する実施はありません"
          />
        </section>
      )}
    </>
  );
}
