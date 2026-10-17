import { useState } from "react";
import { useEventExtract } from "../../api/queries";
import { extractKindDef } from "../../fhir/extractKinds";
import {
  leafLabel,
  newLeaf,
  patientColumnsOf,
  resolvePeriod,
  validateExtractQuery,
  type ExtractLeaf,
  type ExtractOutput,
  type ExtractPeriod,
} from "../../fhir/extractQueryHelpers";
import {
  DEATH_OUTCOME_KIND,
  compactDefinition,
  isDeathOutcome,
  isMetric,
  stratumLeaf,
  type EventExtractDefinition,
  type EventOutcome,
  type ExtractMetric,
} from "../../fhir/extractRecordQuery";
import { eventRunner, recordCountLabel } from "../../fhir/extractTabRunners";
import type { BreakdownSettings } from "../../fhir/recordBreakdownHelpers";
import { recordTableCells, recordTableCsv, recordTableHeader } from "../../fhir/recordTableHelpers";
import { applyScopeDefinition, scopeDefinition, useExtractPatientScope } from "../../hooks/useExtractPatientScope";
import { useExtractRunContext } from "../../hooks/useExtractRunContext";
import { useRecordPatientAttributes } from "../../hooks/useRecordPatientAttributes";
import { useRecordTable } from "../../hooks/useRecordTable";
import { today } from "../../lib/dates";
import { downloadBlob } from "../../lib/download";
import { ErrorBanner } from "../ErrorBanner";
import { CumulativeIncidenceView } from "./CumulativeIncidenceView";
import { DataExtractGuide } from "./DataExtractGuide";
import { PeriodFields } from "./ExtractLeafFields";
import { ExtractFormRow } from "./ExtractFormRow";
import { FolderRegisterButton } from "./FolderRegisterButton";
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
const DEFAULT_FROM_DAYS = 1;

/** 条件 1 件のボタンとチップ、入力のモーダル(比較群の入力を条件だけ・1 件で使う)。 */
function MetricField({
  label,
  value,
  scope,
  onChange,
}: {
  label: string;
  value: ExtractMetric | undefined;
  scope: ReturnType<typeof useExtractPatientScope>;
  onChange: (next: ExtractMetric | undefined) => void;
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
            <span className="extract-chip">{leafLabel(value as ExtractLeaf)}</span>
          </span>
        )}
      </span>
      {editing && (
        <StrataEditorModal
          strata={value ? [value] : []}
          queries={scope.queries}
          folders={scope.folders}
          itemLabel={label}
          allow={{ saved: false, folder: false }}
          max={1}
          indexDate={false}
          onChange={(next) => onChange(next.filter(isMetric)[0])}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  );
}

function numberOrUndefined(value: string): number | undefined {
  return value === "" ? undefined : Number(value);
}

/**
 * イベントまでの日数(docs/data-extract-design.md §25)。基準イベントの最初の記録の日から結果イベント(条件 1 件か死亡)までの
 * 日数と転帰を患者 1 人 1 行にし、累積発生率(Kaplan-Meier)を全体と比較群ごとに出す。
 */
export function EventExtractPanel() {
  const scope = useExtractPatientScope();
  const context = useExtractRunContext();
  const extract = useEventExtract();

  const [period, setPeriod] = useState<ExtractPeriod>(DEFAULT_PERIOD);
  const [index, setIndex] = useState<ExtractMetric | undefined>(undefined);
  const [indexAnchor, setIndexAnchor] = useState<"start" | "end">("start");
  const [outcome, setOutcome] = useState<EventOutcome | undefined>(undefined);
  const [fromDays, setFromDays] = useState<number | undefined>(DEFAULT_FROM_DAYS);
  const [followDays, setFollowDays] = useState<number | undefined>(undefined);
  const [output, setOutput] = useState<ExtractOutput | undefined>(undefined);
  const [breakdown, setBreakdown] = useState<BreakdownSettings>({});
  const [guide, setGuide] = useState(false);
  const [inputError, setInputError] = useState<unknown>(null);

  const patientColumns = patientColumnsOf(output);
  const running = scope.running || extract.running;
  const indexHasEnd = index ? Boolean(extractKindDef(index.kind).hasEndDay?.(index as ExtractLeaf)) : false;

  const definition = compactDefinition<EventExtractDefinition>({
    schema_version: 1,
    period,
    index: index ? compactDefinition(index) : undefined,
    index_anchor: indexHasEnd && indexAnchor === "end" ? "end" : undefined,
    outcome: outcome ? compactDefinition(outcome) : undefined,
    outcome_from_days: fromDays,
    follow_days: followDays,
    ...scopeDefinition(scope),
    output,
    breakdown: Object.keys(breakdown).length ? breakdown : undefined,
  });
  const table = useRecordTable(eventRunner, extract.result, definition, context);
  const attributes = useRecordPatientAttributes(scope.ran, table?.rows);

  function applyDefinition(saved: EventExtractDefinition | null) {
    setPeriod(saved?.period ?? DEFAULT_PERIOD);
    setIndex(saved?.index);
    setIndexAnchor(saved?.index_anchor ?? "start");
    setOutcome(saved?.outcome);
    setFromDays(saved?.outcome_from_days ?? DEFAULT_FROM_DAYS);
    setFollowDays(saved?.follow_days);
    applyScopeDefinition(scope, saved);
    setOutput(saved?.output);
    setBreakdown(saved?.breakdown ?? {});
  }

  function inputErrors(): string[] {
    const errors: string[] = [];
    if (!index) errors.push("基準イベントを選んでください。");
    if (!outcome) errors.push("結果イベントを選んでください。");
    if (!resolvePeriod(period, today())?.from) errors.push("期間の開始を入れてください。");
    if (fromDays == null || fromDays < 0) errors.push("数え始めは 0 日以上にしてください。");
    if (followDays != null && followDays < 1) errors.push("最大追跡は 1 日以上にしてください。");
    const leaves = [
      ...(index ? [stratumLeaf({ ...index, period: null }, period, "基準イベント")] : []),
      ...(outcome && !isDeathOutcome(outcome) ? [stratumLeaf(outcome, { mode: "relative", days: 1 }, "結果イベント")] : []),
    ];
    if (leaves.length > 0) errors.push(...validateExtractQuery({ schema_version: 1, root: { op: "or", children: leaves } }));
    return errors;
  }

  async function handleRun() {
    const errors = inputErrors();
    setInputError(errors.length ? new Error(errors.join("\n")) : null);
    if (errors.length) return;
    const patientIds = await scope.resolve(period);
    if (patientIds === null) return;
    const criteria = eventRunner.criteria(definition, { range: resolvePeriod(period, today()), patientIds }, context);
    if (criteria) void extract.run(criteria);
  }

  function handleCancel() {
    scope.cancel();
    extract.cancel();
  }

  const outcomeKind = outcome ? (isDeathOutcome(outcome) ? DEATH_OUTCOME_KIND : "leaf") : "leaf";

  return (
    <>
      <RecordQueryBar tab="event" current={definition} onLoad={applyDefinition} />
      <div className="extract-form">
        <ExtractFormRow label="イベント" onGuide={() => setGuide(true)}>
          <MetricField label="基準" value={index} scope={scope} onChange={setIndex} />
          {indexHasEnd && (
            <label className="extract-field">
              基準の日
              <select value={indexAnchor} onChange={(e) => setIndexAnchor(e.target.value as "start" | "end")}>
                <option value="start">開始日</option>
                <option value="end">終了日</option>
              </select>
            </label>
          )}
          <label className="extract-field">
            結果
            <select
              value={outcomeKind}
              onChange={(e) =>
                setOutcome(
                  e.target.value === DEATH_OUTCOME_KIND
                    ? { key: newLeaf("condition").key, kind: DEATH_OUTCOME_KIND }
                    : outcome && !isDeathOutcome(outcome)
                      ? outcome
                      : undefined,
                )
              }
            >
              <option value="leaf">条件</option>
              <option value={DEATH_OUTCOME_KIND}>死亡</option>
            </select>
          </label>
          {outcomeKind === "leaf" && (
            <MetricField
              label="結果の条件"
              value={outcome && !isDeathOutcome(outcome) ? outcome : undefined}
              scope={scope}
              onChange={setOutcome}
            />
          )}
          <label className="extract-field extract-field--inline">
            数え始め
            <input
              type="number"
              min={0}
              max={365}
              className="extract-field__number"
              aria-label="数え始め(日)"
              value={fromDays ?? ""}
              onChange={(e) => setFromDays(numberOrUndefined(e.target.value))}
            />
            日後から
          </label>
          <label className="extract-field extract-field--inline">
            最大追跡
            <input
              type="number"
              min={1}
              max={3650}
              className="extract-field__number"
              aria-label="最大追跡(日)"
              value={followDays ?? ""}
              onChange={(e) => setFollowDays(numberOrUndefined(e.target.value))}
            />
            日
          </label>
        </ExtractFormRow>
        <ExtractFormRow label="記録">
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
      {guide && <DataExtractGuide topic="event" onClose={() => setGuide(false)} />}

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
                downloadBlob(recordTableCsv(table.header, patientColumns, table.rows, attributes.attributes), `event_${today()}.csv`)
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
          <RecordResultNotices runner={eventRunner} truncated={false} table={table} />
          <PatientAttributesStatus attributes={attributes} />
          <RecordResultTable
            header={table.header}
            patientAttributes={attributes.attributes}
            patientColumns={patientColumns}
            breakdown={breakdown}
            onBreakdownChange={setBreakdown}
            rows={table.rows}
            unit="人"
            emptyLabel={eventRunner.emptyLabel}
            extraView={{
              key: "incidence",
              label: "累積発生率",
              initial: true,
              render: (drill) => (
                <CumulativeIncidenceView
                  header={recordTableHeader(table.header, patientColumns, attributes.attributes)}
                  cells={recordTableCells(table.rows, patientColumns, attributes.attributes)}
                  followDays={followDays}
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
