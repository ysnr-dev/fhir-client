import { useMemo, useState } from "react";
import { useClusterExtract } from "../../api/queries";
import { clusterMetricColumns, metricName } from "../../fhir/clusterExtractHelpers";
import {
  patientColumnsOf,
  resolvePeriod,
  validateExtractQuery,
  type ExtractOutput,
  type ExtractPeriod,
} from "../../fhir/extractQueryHelpers";
import {
  MAX_METRICS,
  compactDefinition,
  isMetric,
  stratumLeaf,
  type ClusterExtractDefinition,
  type ExtractMetric,
} from "../../fhir/extractRecordQuery";
import { clusterRunner, recordCountLabel } from "../../fhir/extractTabRunners";
import type { BreakdownSettings } from "../../fhir/recordBreakdownHelpers";
import { CLUSTER_COLUMN, recordTableCsv } from "../../fhir/recordTableHelpers";
import { applyScopeDefinition, scopeDefinition, useExtractPatientScope } from "../../hooks/useExtractPatientScope";
import { useExtractRunContext } from "../../hooks/useExtractRunContext";
import { useRecordPatientAttributes } from "../../hooks/useRecordPatientAttributes";
import { useRecordTable } from "../../hooks/useRecordTable";
import { today } from "../../lib/dates";
import { downloadBlob } from "../../lib/download";
import { ErrorBanner } from "../ErrorBanner";
import { ClusterSummaryView } from "./ClusterSummaryView";
import { DataExtractGuide } from "./DataExtractGuide";
import { PeriodFields } from "./ExtractLeafFields";
import { ExtractFormRow } from "./ExtractFormRow";
import { FolderRegisterButton } from "./FolderRegisterButton";
import { PatientColumnsField } from "./PatientColumnsField";
import {
  AttendingField,
  PatientAttributesStatus,
  PatientScopeProgress,
  PatientScopeRow,
  PatientScopeSummary,
  StrataField,
} from "./PatientScope";
import { RecordQueryBar } from "./RecordQueryBar";
import { RecordResultNotices } from "./RecordResultNotices";
import { RecordResultTable } from "./RecordResultTable";
import { StrataEditorModal } from "./StrataEditorModal";

const DEFAULT_PERIOD: ExtractPeriod = { mode: "relative", days: 365 };

/**
 * クラスタの比較(docs/data-extract-design.md §22)。「患者」タブに保存した条件・患者フォルダ・条件 1 件を
 * クラスタにして、クラスタごとの人数・性別・年齢と指標(記録の件数・最新の値)、クラスタどうしの重なりを比べる。
 * 結果の表は患者 1 人を 1 行にし、内訳(§18)でクラスタを軸にも数えられる。
 */
export function ClusterExtractPanel() {
  const scope = useExtractPatientScope({ groupLabel: CLUSTER_COLUMN, strataOnly: true });
  const context = useExtractRunContext();
  const extract = useClusterExtract();

  const [period, setPeriod] = useState<ExtractPeriod>(DEFAULT_PERIOD);
  const [metrics, setMetrics] = useState<ExtractMetric[]>([]);
  const [output, setOutput] = useState<ExtractOutput | undefined>(undefined);
  const [breakdown, setBreakdown] = useState<BreakdownSettings>({});
  const [editingMetrics, setEditingMetrics] = useState(false);
  const [guide, setGuide] = useState(false);
  const [inputError, setInputError] = useState<unknown>(null);

  const patientColumns = patientColumnsOf(output);
  const running = scope.running || extract.running;

  const definition = compactDefinition<ClusterExtractDefinition>({
    schema_version: 1,
    period,
    ...scopeDefinition(scope),
    output,
    breakdown: Object.keys(breakdown).length ? breakdown : undefined,
    metrics: metrics.length ? metrics.map((m) => compactDefinition(m)) : undefined,
  });
  const table = useRecordTable(clusterRunner, extract.result, definition, context);
  const attributes = useRecordPatientAttributes(scope.ran, table?.rows);

  const clusterNames = useMemo(() => scope.summary.strata.map((s) => s.name), [scope.summary]);
  const metricColumns = useMemo(
    () => clusterMetricColumns((extract.result?.metrics ?? []).map((m) => ({ name: m.name, numeric: Boolean(m.values) }))),
    [extract.result],
  );

  /** 保存した条件を入力欄に戻す(null なら初期値)。 */
  function applyDefinition(saved: ClusterExtractDefinition | null) {
    setPeriod(saved?.period ?? DEFAULT_PERIOD);
    setMetrics(saved?.metrics ?? []);
    applyScopeDefinition(scope, saved);
    setOutput(saved?.output);
    setBreakdown(saved?.breakdown ?? {});
  }

  /** 実行の前に確かめる入力の誤り(クラスタの誤りは患者の絞り込みを解くときに確かめる)。 */
  function inputErrors(): string[] {
    const errors: string[] = [];
    if (scope.strata.length === 0) errors.push("クラスタを追加してください。");
    const names = metrics.map(metricName);
    for (const name of new Set(names.filter((n, i) => names.indexOf(n) !== i))) {
      errors.push(`指標の名前「${name}」が重なっています。名前を付けて分けてください。`);
    }
    if (metrics.length > 0) {
      const children = metrics.map((m) => stratumLeaf(m, period, metricName(m)));
      errors.push(...validateExtractQuery({ schema_version: 1, root: { op: "or", children } }));
    }
    return errors;
  }

  async function handleRun() {
    const errors = inputErrors();
    setInputError(errors.length ? new Error(errors.join("\n")) : null);
    if (errors.length) return;
    const patientIds = await scope.resolve(period);
    if (patientIds === null) return;
    const criteria = clusterRunner.criteria(definition, { range: resolvePeriod(period, today()), patientIds }, context);
    if (criteria) void extract.run(criteria);
  }

  function handleCancel() {
    scope.cancel();
    extract.cancel();
  }

  return (
    <>
      <RecordQueryBar tab="cluster" current={definition} onLoad={applyDefinition} />
      <div className="extract-form">
        <ExtractFormRow label="クラスタ" onGuide={() => setGuide(true)}>
          <StrataField scope={scope} />
        </ExtractFormRow>
        <ExtractFormRow label="記録">
          <PeriodFields period={period} onChange={(next) => next && setPeriod(next)} />
          <span className="extract-checks">
            <button type="button" className="rp-card__compact-button" onClick={() => setEditingMetrics(true)}>
              指標
            </button>
            {metrics.length > 0 && (
              <span className="extract-chips">
                {metrics.map((metric) => (
                  <span key={metric.key} className="extract-chip">
                    {metricName(metric)}
                  </span>
                ))}
              </span>
            )}
          </span>
        </ExtractFormRow>
        <PatientScopeRow scope={scope} />
        <ExtractFormRow label="比較">
          <AttendingField scope={scope} />
        </ExtractFormRow>
        <ExtractFormRow label="表" help="実行し直さなくても結果に反映します。">
          <PatientColumnsField
            value={patientColumns}
            selected={Boolean(output?.patient_columns?.length)}
            onChange={(patient_columns) => setOutput(patient_columns.length ? { patient_columns } : undefined)}
          />
        </ExtractFormRow>
      </div>
      {editingMetrics && (
        <StrataEditorModal
          strata={metrics}
          queries={scope.queries}
          folders={scope.folders}
          itemLabel="指標"
          allow={{ saved: false, folder: false }}
          max={MAX_METRICS}
          indexDate={false}
          onChange={(next) => setMetrics(next.filter(isMetric))}
          onClose={() => setEditingMetrics(false)}
        />
      )}
      {guide && <DataExtractGuide topic="cluster" onClose={() => setGuide(false)} />}

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
                downloadBlob(recordTableCsv(table.header, patientColumns, table.rows, attributes.attributes), `cluster_${today()}.csv`)
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
            <span className="extract-results__count">{recordCountLabel(table)}</span>
            <PatientScopeSummary scope={scope} />
          </div>
          <RecordResultNotices runner={clusterRunner} truncated={false} table={table} />
          <PatientAttributesStatus attributes={attributes} />
          <RecordResultTable
            header={table.header}
            patientAttributes={attributes.attributes}
            patientColumns={patientColumns}
            breakdown={breakdown}
            onBreakdownChange={setBreakdown}
            rows={table.rows}
            unit="人"
            emptyLabel={clusterRunner.emptyLabel}
            extraView={{
              key: "cluster",
              label: "クラスタ",
              initial: true,
              render: (drill) => (
                <ClusterSummaryView
                  rows={table.rows}
                  groupsOf={scope.ran?.groupsOf ?? null}
                  clusterNames={clusterNames}
                  metricColumns={metricColumns}
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
