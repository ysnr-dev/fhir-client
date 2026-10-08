import { useMemo, useState } from "react";
import { useMicroExtract } from "../../api/queries";
import {
  RECORD_DISPLAY_LIMIT,
  patientColumnsOf,
  resolvePeriod,
  type ExtractOutput,
  type ExtractPeriod,
} from "../../fhir/extractQueryHelpers";
import {
  MICRO_SUSCEPTIBILITY_FIELDS,
  microExtractCsv,
  microExtractHeader,
  microExtractTable,
  type MicroSusceptibilityField,
} from "../../fhir/microExtractHelpers";
import { useExtractPatientScope } from "../../hooks/useExtractPatientScope";
import { today } from "../../lib/dates";
import { downloadBlob } from "../../lib/download";
import { ErrorBanner } from "../ErrorBanner";
import { TruncatedNotice } from "../TruncatedNotice";
import { CheckGroup, PeriodFields } from "./ExtractLeafFields";
import { FolderRegisterButton } from "./FolderRegisterButton";
import { PatientColumnsField } from "./PatientColumnsField";
import { PatientScopeFields, PatientScopeProgress, PatientScopeSummary } from "./PatientScope";
import { RecordResultTable } from "./RecordResultTable";

const DEFAULT_PERIOD: ExtractPeriod = { mode: "relative", days: 365 };
const DEFAULT_SUSCEPTIBILITY: MicroSusceptibilityField[] = ["sir"];
/** 折り返さない固定列の数(採取日〜培養)。塗抹の所見から後ろは長いので折り返す。 */
const FIXED_COLUMNS = 6;

/**
 * 細菌検査の抽出(docs/data-extract-design.md §10)。細菌検査結果を分離菌 1 株 = 1 行、抗菌薬 = 列の
 * 表と CSV にする。患者の絞り込みはテンプレートの抽出と同じ。
 */
export function MicroExtractPanel() {
  const scope = useExtractPatientScope();
  const extract = useMicroExtract();

  const [period, setPeriod] = useState<ExtractPeriod>(DEFAULT_PERIOD);
  const [includeNoIsolate, setIncludeNoIsolate] = useState(false);
  const [firstIsolateOnly, setFirstIsolateOnly] = useState(false);
  const [susceptibility, setSusceptibility] = useState<MicroSusceptibilityField[]>(DEFAULT_SUSCEPTIBILITY);
  const [output, setOutput] = useState<ExtractOutput | undefined>(undefined);

  const table = useMemo(
    () =>
      extract.result
        ? microExtractTable(
            extract.result.reports,
            extract.result.observations,
            extract.result.specimens,
            extract.result.patients,
            { includeNoIsolate, firstIsolateOnly, susceptibility },
          )
        : null,
    [extract.result, includeNoIsolate, firstIsolateOnly, susceptibility],
  );
  // 「患者・菌ごとに初回」は欠けた結果だと初回を取り違えるので、読み切れなかったら出さない。
  const incomplete = firstIsolateOnly && Boolean(extract.result?.truncated);
  const rows = incomplete ? [] : (table?.rows ?? []);
  const patientColumns = patientColumnsOf(output);
  const running = scope.running || extract.running;

  async function handleRun() {
    const patientIds = await scope.resolve();
    if (patientIds === null) return;
    const range = resolvePeriod(period, today());
    void extract.run({ from: range?.from ?? "", to: range?.to ?? "", patientIds });
  }

  function handleClear() {
    setPeriod(DEFAULT_PERIOD);
    scope.setQueryId(null);
    scope.setFolderId(null);
    setIncludeNoIsolate(false);
    setFirstIsolateOnly(false);
    setSusceptibility(DEFAULT_SUSCEPTIBILITY);
    setOutput(undefined);
  }

  function handleCancel() {
    scope.cancel();
    extract.cancel();
  }

  return (
    <>
      <div className="data-extract__toolbar data-extract__toolbar--fields">
        <PeriodFields period={period} onChange={(next) => next && setPeriod(next)} />
        <PatientScopeFields scope={scope} />
        <label className="extract-checks__item">
          <input type="checkbox" checked={includeNoIsolate} onChange={(e) => setIncludeNoIsolate(e.target.checked)} />
          分離菌なしの検体
        </label>
        <label className="extract-checks__item">
          <input type="checkbox" checked={firstIsolateOnly} onChange={(e) => setFirstIsolateOnly(e.target.checked)} />
          患者・菌ごとに初回
        </label>
        <CheckGroup
          label="感受性"
          options={MICRO_SUSCEPTIBILITY_FIELDS}
          values={susceptibility}
          onChange={(next) => next.length > 0 && setSusceptibility(next as MicroSusceptibilityField[])}
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
              onClick={() => downloadBlob(microExtractCsv(table.drugColumns, rows, output), `micro_${today()}.csv`)}
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
              {`${rows.length} 行(${new Set(rows.map((r) => r.patientId)).size} 人)`}
            </span>
            <PatientScopeSummary scope={scope} />
          </div>
          <TruncatedNotice show={extract.result?.truncated && !incomplete}>
            結果が多いため、新しいものから一部だけを読みました。期間を絞ってください。
          </TruncatedNotice>
          <TruncatedNotice show={incomplete}>
            結果が多く読み切れなかったため、患者・菌ごとの初回は出せません。期間か患者を絞ってください。
          </TruncatedNotice>
          <TruncatedNotice show={rows.length > RECORD_DISPLAY_LIMIT}>
            {`先頭の ${RECORD_DISPLAY_LIMIT} 行を表示しています。すべては CSV に出ます。`}
          </TruncatedNotice>
          <RecordResultTable
            header={microExtractHeader(table.drugColumns, output)}
            patientColumns={patientColumns}
            rows={rows.map((row) => ({
              key: row.rowKey,
              patient: row,
              fixed: row.fixed.slice(0, FIXED_COLUMNS),
              values: [
                ...row.fixed.slice(FIXED_COLUMNS),
                ...table.drugColumns.map((column) => row.drugs.get(column.key) ?? ""),
              ],
            }))}
            emptyLabel={incomplete ? "" : "該当する結果はありません"}
          />
        </section>
      )}
    </>
  );
}
