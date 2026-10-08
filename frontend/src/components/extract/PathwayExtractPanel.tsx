import { useMemo, useState } from "react";
import { usePathwayOptions } from "../../api/masterQueries";
import { usePathwayExtract } from "../../api/queries";
import {
  RECORD_DISPLAY_LIMIT,
  patientColumnsOf,
  resolvePeriod,
  type ExtractOutput,
  type ExtractPeriod,
} from "../../fhir/extractQueryHelpers";
import { pathwayExtractCsv, pathwayExtractHeader, pathwayExtractRows } from "../../fhir/pathwayExtractHelpers";
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
  const extract = usePathwayExtract();

  const [pathwayCode, setPathwayCode] = useState("");
  const [period, setPeriod] = useState<ExtractPeriod>(DEFAULT_PERIOD);
  const [output, setOutput] = useState<ExtractOutput | undefined>(undefined);

  const rows = useMemo(
    () =>
      extract.result
        ? pathwayExtractRows(
            extract.result.applications,
            extract.result.encounters,
            extract.result.goals,
            extract.result.patients,
            today(),
          )
        : null,
    [extract.result],
  );
  // 評価の件数は欠けた記録では嘘になるので、読み切れなかったら出さない。
  const incomplete = Boolean(extract.result?.truncated);
  const shownRows = incomplete ? [] : (rows ?? []);
  const patientColumns = patientColumnsOf(output);
  const running = scope.running || extract.running;

  async function handleRun() {
    const patientIds = await scope.resolve();
    if (patientIds === null) return;
    const range = resolvePeriod(period, today());
    void extract.run({
      from: range?.from ?? "",
      to: range?.to ?? "",
      pathwayCode: pathwayCode || undefined,
      patientIds,
    });
  }

  function handleClear() {
    setPathwayCode("");
    setPeriod(DEFAULT_PERIOD);
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
        <PatientScopeFields scope={scope} />
      </div>

      <PatientColumnsField
        value={patientColumns}
        selected={Boolean(output?.patient_columns?.length)}
        onChange={(patient_columns) => setOutput(patient_columns.length ? { patient_columns } : undefined)}
      />

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
        {rows && (
          <span className="data-extract__exports">
            <FolderRegisterButton patientIds={shownRows.map((r) => r.patientId)} />
            <button
              type="button"
              disabled={shownRows.length === 0}
              onClick={() => downloadBlob(pathwayExtractCsv(shownRows, output), `pathway_${today()}.csv`)}
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
              {`${shownRows.length} 件(${new Set(shownRows.map((r) => r.patientId)).size} 人)`}
            </span>
            <PatientScopeSummary scope={scope} />
          </div>
          <TruncatedNotice show={incomplete}>
            適用か評価が多く読み切れなかったため、表を出せません。期間かパスを絞ってください。
          </TruncatedNotice>
          <TruncatedNotice show={shownRows.length > RECORD_DISPLAY_LIMIT}>
            {`先頭の ${RECORD_DISPLAY_LIMIT} 件を表示しています。すべては CSV に出ます。`}
          </TruncatedNotice>
          <RecordResultTable
            header={pathwayExtractHeader(output)}
            patientColumns={patientColumns}
            rows={shownRows.map((row) => ({ key: row.rowKey, patient: row, fixed: row.fixed, values: row.values }))}
            emptyLabel={incomplete ? "" : "該当する適用はありません"}
          />
        </section>
      )}
    </>
  );
}
