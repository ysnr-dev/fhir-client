import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useIndicatorExtract } from "../../api/queries";
import { patientColumnsOf, resolvePeriod, type ExtractOutput, type ExtractPeriod } from "../../fhir/extractQueryHelpers";
import {
  INDICATOR_GRAINS,
  compactDefinition,
  isFolderStratum,
  type ExtractStratum,
  type IndicatorExtractDefinition,
  type IndicatorGrain,
  type TargetDirection,
} from "../../fhir/extractRecordQuery";
import { indicatorRunner, recordCountLabel } from "../../fhir/extractTabRunners";
import { INDICATOR_HIT_COLUMN, INDICATOR_PERIOD_COLUMN } from "../../fhir/indicatorExtractHelpers";
import type { BreakdownSettings } from "../../fhir/recordBreakdownHelpers";
import { recordTableCells, recordTableCsv, recordTableHeader } from "../../fhir/recordTableHelpers";
import { MAX_INDICATOR_BUCKETS } from "../../api/queries/indicatorExtract";
import { periodBuckets } from "../../fhir/recordBreakdownHelpers";
import {
  applyScopeDefinition,
  scopeDefinition,
  stratumName,
  useExtractPatientScope,
} from "../../hooks/useExtractPatientScope";
import { useExtractRunContext } from "../../hooks/useExtractRunContext";
import { useRecordPatientAttributes } from "../../hooks/useRecordPatientAttributes";
import { useRecordTable } from "../../hooks/useRecordTable";
import { today } from "../../lib/dates";
import { downloadBlob } from "../../lib/download";
import { ErrorBanner } from "../ErrorBanner";
import { DataExtractGuide } from "./DataExtractGuide";
import { PeriodFields } from "./ExtractLeafFields";
import { ExtractFormRow } from "./ExtractFormRow";
import { FolderRegisterButton } from "./FolderRegisterButton";
import { IndicatorTrendView } from "./IndicatorTrendView";
import { PatientColumnsField } from "./PatientColumnsField";
import {
  CompareRow,
  PatientAttributesStatus,
  PatientScopeProgress,
  PatientScopeRow,
  PatientScopeSummary,
} from "./PatientScope";
import { RecordQueryBar } from "./RecordQueryBar";
import { RecordResultNotices } from "./RecordResultNotices";
import { RecordResultTable } from "./RecordResultTable";
import { StrataEditorModal } from "./StrataEditorModal";

const DEFAULT_PERIOD: ExtractPeriod = { mode: "relative", days: 365 };
const DEFAULT_GRAIN: IndicatorGrain = "month";

/** 分母・分子のボタンとチップ、入力のモーダル(比較群の入力を 1 件だけで使う)。 */
function SourceField({
  label,
  value,
  allowFolder,
  scope,
  onChange,
}: {
  label: string;
  value: ExtractStratum | undefined;
  allowFolder: boolean;
  scope: ReturnType<typeof useExtractPatientScope>;
  onChange: (next: ExtractStratum | undefined) => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <>
      <span className="extract-checks">
        <button type="button" className="rp-card__compact-button" onClick={() => setEditing(true)}>
          {label}
        </button>
        {value && (
          <span className="extract-chips">
            <span className="extract-chip">{stratumName(value, scope.queries, scope.folders)}</span>
          </span>
        )}
      </span>
      {editing && (
        <StrataEditorModal
          strata={value ? [value] : []}
          queries={scope.queries}
          folders={scope.folders}
          itemLabel={label}
          allow={{ saved: true, folder: allowFolder }}
          max={1}
          indexDate={false}
          onChange={(next) => onChange(next[0])}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  );
}

/**
 * 臨床指標(docs/data-extract-design.md §23)。分母(患者の集団)と分子(そのうち条件に当たる患者)を期間の刻みごとに
 * 評価し、割合の推移を表とグラフにする。結果の表は分母の患者 × 期間を 1 行にし、内訳(§18)・比較群(§21)が効く。
 */
export function IndicatorExtractPanel() {
  const scope = useExtractPatientScope();
  const context = useExtractRunContext();
  const queryClient = useQueryClient();
  const extract = useIndicatorExtract();

  const [period, setPeriod] = useState<ExtractPeriod>(DEFAULT_PERIOD);
  const [grain, setGrain] = useState<IndicatorGrain>(DEFAULT_GRAIN);
  const [denominator, setDenominator] = useState<ExtractStratum | undefined>(undefined);
  const [numerator, setNumerator] = useState<ExtractStratum | undefined>(undefined);
  const [target, setTarget] = useState<number | undefined>(undefined);
  const [direction, setDirection] = useState<TargetDirection>("ge");
  const [output, setOutput] = useState<ExtractOutput | undefined>(undefined);
  const [breakdown, setBreakdown] = useState<BreakdownSettings>({});
  const [guide, setGuide] = useState(false);
  const [inputError, setInputError] = useState<unknown>(null);

  const patientColumns = patientColumnsOf(output);
  const running = scope.running || extract.running;

  const definition = compactDefinition<IndicatorExtractDefinition>({
    schema_version: 1,
    period,
    grain,
    denominator: denominator ? compactDefinition(denominator) : undefined,
    numerator: numerator ? compactDefinition(numerator) : undefined,
    target,
    target_direction: target != null ? direction : undefined,
    ...scopeDefinition(scope),
    output,
    breakdown: Object.keys(breakdown).length ? breakdown : undefined,
  });
  const table = useRecordTable(indicatorRunner, extract.result, definition, context);
  const attributes = useRecordPatientAttributes(scope.ran, table?.rows);

  /** 保存した条件を入力欄に戻す(null なら初期値)。 */
  function applyDefinition(saved: IndicatorExtractDefinition | null) {
    setPeriod(saved?.period ?? DEFAULT_PERIOD);
    setGrain(saved?.grain ?? DEFAULT_GRAIN);
    setDenominator(saved?.denominator);
    setNumerator(saved?.numerator);
    setTarget(saved?.target ?? undefined);
    setDirection(saved?.target_direction ?? "ge");
    applyScopeDefinition(scope, saved);
    setOutput(saved?.output);
    setBreakdown(saved?.breakdown ?? {});
  }

  function inputErrors(): string[] {
    const errors: string[] = [];
    if (!denominator) errors.push("分母を選んでください。");
    if (!numerator) errors.push("分子を選んでください。");
    if (numerator && isFolderStratum(numerator)) errors.push("分子に患者フォルダは置けません。");
    const range = resolvePeriod(period, today());
    if (!range?.from) errors.push("期間の開始を入れてください。");
    else if (periodBuckets({ from: range.from, to: range.to ?? today() }, grain).length > MAX_INDICATOR_BUCKETS) {
      errors.push(`期間の刻みは ${MAX_INDICATOR_BUCKETS} 個までです。期間を短くするか刻みを粗くしてください。`);
    }
    return errors;
  }

  async function handleRun() {
    const errors = inputErrors();
    setInputError(errors.length ? new Error(errors.join("\n")) : null);
    if (errors.length) return;
    const patientIds = await scope.resolve(period);
    if (patientIds === null) return;
    const criteria = indicatorRunner.criteria(
      definition,
      {
        range: resolvePeriod(period, today()),
        patientIds,
        evaluator: { queries: scope.queries, folders: scope.folders, queryClient },
      },
      context,
    );
    if (criteria) void extract.run(criteria);
  }

  function handleCancel() {
    scope.cancel();
    extract.cancel();
  }

  // 内訳の既定は、行=期間(指標の刻み)・列=分子・行の中の割合(保存した切り口があればそれを使う)。
  const breakdownSettings: BreakdownSettings = {
    date: INDICATOR_PERIOD_COLUMN,
    grain,
    columns: INDICATOR_HIT_COLUMN,
    ratio: "row",
    ...breakdown,
  };

  return (
    <>
      <RecordQueryBar tab="indicator" current={definition} onLoad={applyDefinition} />
      <div className="extract-form">
        <ExtractFormRow label="指標" onGuide={() => setGuide(true)}>
          <SourceField label="分母" value={denominator} allowFolder scope={scope} onChange={setDenominator} />
          <SourceField label="分子" value={numerator} allowFolder={false} scope={scope} onChange={setNumerator} />
        </ExtractFormRow>
        <ExtractFormRow label="記録">
          <PeriodFields period={period} onChange={(next) => next && setPeriod(next)} />
          <label className="extract-field">
            刻み
            <select value={grain} onChange={(e) => setGrain(e.target.value as IndicatorGrain)}>
              {INDICATOR_GRAINS.map((g) => (
                <option key={g.value} value={g.value}>
                  {`${g.label}ごと`}
                </option>
              ))}
            </select>
          </label>
          <label className="extract-field">
            目標
            <span className="extract-field-group">
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                className="extract-field__number"
                aria-label="目標(%)"
                value={target ?? ""}
                onChange={(e) => setTarget(e.target.value === "" ? undefined : Number(e.target.value))}
              />
              <span>%</span>
              <select aria-label="目標の向き" value={direction} onChange={(e) => setDirection(e.target.value as TargetDirection)}>
                <option value="ge">以上</option>
                <option value="le">以下</option>
              </select>
            </span>
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
      {guide && <DataExtractGuide topic="indicator" onClose={() => setGuide(false)} />}

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
        {table && (
          <span className="data-extract__exports">
            <FolderRegisterButton patientIds={table.rows.map((r) => r.patient.patientId)} />
            <button
              type="button"
              disabled={table.rows.length === 0}
              onClick={() =>
                downloadBlob(
                  recordTableCsv(table.header, patientColumns, table.rows, attributes.attributes),
                  `indicator_rows_${today()}.csv`,
                )
              }
            >
              CSV
            </button>
          </span>
        )}
      </div>

      <ErrorBanner error={inputError ?? scope.error ?? extract.error} />
      {table && (
        <section className="extract-results">
          <div className="extract-results__summary">
            <span className="extract-results__count">{table.headline ?? recordCountLabel(table)}</span>
            <PatientScopeSummary scope={scope} />
          </div>
          <RecordResultNotices runner={indicatorRunner} truncated={false} table={table} />
          <PatientAttributesStatus attributes={attributes} />
          <RecordResultTable
            header={table.header}
            patientAttributes={attributes.attributes}
            patientColumns={patientColumns}
            breakdown={breakdownSettings}
            onBreakdownChange={setBreakdown}
            rows={table.rows}
            unit="行"
            emptyLabel={indicatorRunner.emptyLabel}
            extraView={{
              key: "indicator",
              label: "指標",
              initial: true,
              render: (drill) => (
                <IndicatorTrendView
                  header={recordTableHeader(table.header, patientColumns, attributes.attributes)}
                  cells={recordTableCells(table.rows, patientColumns, attributes.attributes)}
                  patientIds={table.rows.map((r) => r.patient.patientId)}
                  definition={definition}
                  periods={table.periods}
                  onDrill={drill}
                />
              ),
            }}
          />
        </section>
      )}
    </>
  );
}
