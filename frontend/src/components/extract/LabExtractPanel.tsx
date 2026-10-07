import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { LabResultItem } from "../../api/masterClient";
import { useLabExtract, useSelfDepartments, useVitalThresholds } from "../../api/queries";
import {
  chartItemCodings,
  hasChartItem,
  labChartItem,
  type ChartItem,
} from "../../fhir/chartDefinitionHelpers";
import { departmentDisplayName, sortDepartmentsByCode } from "../../fhir/departmentHelpers";
import {
  patientCell,
  patientColumnsOf,
  resolvePeriod,
  type ExtractOutput,
  type ExtractPeriod,
} from "../../fhir/extractQueryHelpers";
import {
  LAB_EXTRACT_AGGREGATES,
  LAB_EXTRACT_MAX_ITEMS,
  LAB_EXTRACT_ROW_MODES,
  labExtractCsv,
  labExtractHeader,
  labExtractTable,
  labFixedCells,
  type LabExtractAggregate,
  type LabExtractRowMode,
} from "../../fhir/labExtractHelpers";
import { today } from "../../lib/dates";
import { downloadBlob } from "../../lib/download";
import { ErrorBanner } from "../ErrorBanner";
import { LabResultItemSearchModal } from "../LabResultItemSearchModal";
import { TruncatedNotice } from "../TruncatedNotice";
import { CheckGroup, PeriodFields } from "./ExtractLeafFields";
import { PatientColumnsField } from "./PatientColumnsField";
import { useExtractPatientScope } from "../../hooks/useExtractPatientScope";
import { PatientScopeFields, PatientScopeProgress, PatientScopeSummary } from "./PatientScope";
import { VitalItemSelectModal } from "./VitalItemSelectModal";

/** 画面に並べる行の上限(CSV にはすべて出す)。 */
const DISPLAY_LIMIT = 500;

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
  const vitalThresholds = useVitalThresholds();
  const extract = useLabExtract();

  const [items, setItems] = useState<ChartItem[]>([]);
  const [picking, setPicking] = useState<"lab" | "vital" | null>(null);
  const [period, setPeriod] = useState<ExtractPeriod>(DEFAULT_PERIOD);
  const [departmentId, setDepartmentId] = useState("");
  const [mode, setMode] = useState<LabExtractRowMode>("time");
  const [aggregates, setAggregates] = useState<LabExtractAggregate[]>(DEFAULT_AGGREGATES);
  const [interpretation, setInterpretation] = useState(false);
  const [output, setOutput] = useState<ExtractOutput | undefined>(undefined);
  // 実行したときの項目。表は実行したときの項目で組む(項目を足しても読み直すまで列にしない)。
  const [ranItems, setRanItems] = useState<ChartItem[]>([]);

  const addItems = (added: ChartItem[]) =>
    setItems((current) => {
      const next = [...current];
      for (const item of added) if (!hasChartItem(next, item)) next.push(item);
      return next.slice(0, LAB_EXTRACT_MAX_ITEMS);
    });

  const table = useMemo(
    () =>
      extract.result
        ? labExtractTable(ranItems, extract.result.observations, extract.result.patients, {
            mode,
            aggregates,
            interpretation,
            vitalThresholds,
          })
        : null,
    [extract.result, ranItems, mode, aggregates, interpretation, vitalThresholds],
  );
  const rows = table?.rows ?? [];
  // 患者ごとの集計(最初・件数など)は欠けた記録では嘘になるので、読み切れなかったら出さない。
  const incomplete = mode === "patient" && Boolean(extract.result?.truncated);
  const shownRows = incomplete ? [] : rows;
  const patientColumns = patientColumnsOf(output);
  const running = scope.running || extract.running;
  const header = table ? labExtractHeader(table.columns, mode, output) : [];

  async function handleRun() {
    if (items.length === 0) return;
    const patientIds = await scope.resolve();
    if (patientIds === null) return;
    const range = resolvePeriod(period, today());
    setRanItems(items);
    void extract.run({
      codings: chartItemCodings(items),
      from: range?.from ?? "",
      to: range?.to ?? "",
      departmentId: departmentId || undefined,
      patientIds,
    });
  }

  function handleClear() {
    setItems([]);
    setPeriod(DEFAULT_PERIOD);
    setDepartmentId("");
    scope.setQueryId(null);
    scope.setFolderId(null);
    setMode("time");
    setAggregates(DEFAULT_AGGREGATES);
    setInterpretation(false);
    setOutput(undefined);
  }

  function handleCancel() {
    scope.cancel();
    extract.cancel();
  }

  return (
    <>
      <div className="data-extract__toolbar">
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

      <div className="data-extract__toolbar data-extract__toolbar--fields">
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
        <PatientScopeFields scope={scope} />
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
            <button
              type="button"
              disabled={shownRows.length === 0}
              onClick={() => downloadBlob(labExtractCsv(table.columns, shownRows, mode, output), `lab_${today()}.csv`)}
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
              {mode === "patient"
                ? `${shownRows.length} 人`
                : `${shownRows.length} 行(${new Set(shownRows.map((r) => r.patientId)).size} 人)`}
            </span>
            <PatientScopeSummary scope={scope} />
          </div>
          <TruncatedNotice show={extract.result?.truncated && !incomplete}>
            結果が多いため、新しいものから一部だけを読みました。期間を絞ってください。
          </TruncatedNotice>
          <TruncatedNotice show={incomplete}>
            結果が多く読み切れなかったため、患者ごとの集計は出せません。期間か患者を絞ってください。
          </TruncatedNotice>
          <TruncatedNotice show={shownRows.length > DISPLAY_LIMIT}>
            {`先頭の ${DISPLAY_LIMIT} 行を表示しています。すべては CSV に出ます。`}
          </TruncatedNotice>
          <div className="extract-results__table-wrap">
            <table className="master-search__table extract-results__table template-extract__table">
              <thead>
                <tr>
                  {header.map((label, index) => (
                    <th key={index}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shownRows.slice(0, DISPLAY_LIMIT).map((row) => (
                  <tr key={row.rowKey}>
                    <td className="extract-results__nowrap">{row.patientNumber || "-"}</td>
                    <td className="extract-results__nowrap">
                      <Link to={`/patients/${row.patientId}/karte`}>{row.name || row.patientId}</Link>
                    </td>
                    {patientColumns.map((column) => (
                      <td key={column} className={column === "address" ? undefined : "extract-results__nowrap"}>
                        {patientCell(row, column)}
                      </td>
                    ))}
                    {labFixedCells(row, mode).map((cell, index) => (
                      <td key={`fixed-${index}`} className="extract-results__nowrap">
                        {cell}
                      </td>
                    ))}
                    {table.columns.map((column) => {
                      const value = row.values.get(column.key) ?? "";
                      return (
                        <td key={column.key} title={value || undefined}>
                          {value}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {shownRows.length === 0 && !incomplete && (
                  <tr>
                    <td colSpan={header.length} className="master-search__empty">
                      該当する結果はありません
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
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
