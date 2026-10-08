import { useMemo, type ReactNode } from "react";
import {
  BREAKDOWN_MAX_CATEGORIES,
  BREAKDOWN_MAX_COLUMN_CATEGORIES,
  MAX_FILLED_PERIODS,
  METRICS,
  TIME_GRAINS,
  breakdownColumns,
  recordBreakdown,
  recordBreakdownCsv,
  type BreakdownAxis,
  type BreakdownCell,
  type BreakdownColumn,
  type BreakdownRatio,
  type BreakdownSettings,
  type Metric,
  type TimeGrain,
} from "../../fhir/recordBreakdownHelpers";
import { today } from "../../lib/dates";
import { downloadBlob } from "../../lib/download";
import { HelpTip } from "../HelpTip";
import { RecordBreakdownChart } from "./RecordBreakdownChart";

interface Props {
  header: string[];
  /** 行ごとのセル(見出しと同じ並び)。 */
  cells: string[][];
  patientIds: string[];
  /** 切り口。保存する条件に含めるので、持ち主(タブ)が持つ。 */
  settings: BreakdownSettings;
  onSettingsChange: (settings: BreakdownSettings) => void;
  /** セルを押したとき、当たった行の位置とセルの名前を渡す(一覧をその行に絞る)。 */
  onDrill?: (indices: number[], label: string) => void;
}

/** 切り口の軸(見出しの名前か "period")を、今の結果の列に当てる。当たらなければ null。 */
function axisOf(value: string, dateIndex: number | null, categories: BreakdownColumn[]): BreakdownAxis | null {
  if (value === "period") return dateIndex === null ? null : { type: "period" };
  const column = categories.find((c) => c.label === value);
  return column ? { type: "category", index: column.index } : null;
}

function percent(part: number, whole: number): string {
  return whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "-";
}

/**
 * 記録を表にするタブの内訳(docs/data-extract-design.md §18)。行と列の軸に期間(年〜日)か分類の列を置き、
 * 件数・患者数・割合か数値の列の集計(合計・平均など)を出す。セルを押すと一覧をその行に絞る。
 */
export function RecordBreakdownView({ header, cells, patientIds, settings, onSettingsChange, onDrill }: Props) {
  const columns = useMemo(() => breakdownColumns(header, cells), [header, cells]);
  const dateColumns = columns.filter((c) => c.kind === "date");
  // 分類には数値の列も選べる(年齢・Grade・クールなど)。
  const categoryColumns = columns.filter((c) => c.kind !== "date");
  const numberColumns = columns.filter((c) => c.kind === "number");
  const update = (patch: BreakdownSettings) => onSettingsChange({ ...settings, ...patch });

  // 既定は最初の日付の列で、行に月、列は分けない、件数。
  const dateLabel = settings.date ?? dateColumns[0]?.label ?? "";
  const dateIndex = dateColumns.find((c) => c.label === dateLabel)?.index ?? null;
  const grain: TimeGrain = settings.grain ?? "month";
  const fillEmpty = settings.fill_empty ?? true;
  const rowValue = settings.rows ?? (dateIndex !== null ? "period" : "");
  const rowAxis = axisOf(rowValue, dateIndex, categoryColumns);
  const rowKey = rowAxis ? rowValue : "";
  const columnValue = settings.columns ?? "";
  const columnAxis = columnValue === rowKey ? null : axisOf(columnValue, dateIndex, categoryColumns);
  const columnKey = columnAxis ? columnValue : "";
  const valueIndex = numberColumns.find((c) => c.label === settings.value)?.index ?? null;
  const metric: Metric = settings.metric ?? "mean";
  const showSub = settings.show_sub ?? true;
  const splitMulti = settings.split_multi ?? false;

  const breakdown = useMemo(
    () =>
      recordBreakdown(header, cells, patientIds, {
        dateIndex,
        grain,
        fillEmpty,
        rows: axisOf(rowKey, dateIndex, categoryColumns),
        columns: axisOf(columnKey, dateIndex, categoryColumns),
        valueIndex,
        metric,
        splitMulti,
      }),
    [header, cells, patientIds, dateIndex, grain, fillEmpty, rowKey, columnKey, categoryColumns, valueIndex, metric, splitMulti],
  );
  const hasColumns = breakdown.columnLabels.length > 0;
  const withValue = breakdown.valueLabel !== null;
  // 割合は件数に対して出す(数値の集計を選んでいるときは出さない)。
  const ratio: BreakdownRatio | null = withValue ? null : (settings.ratio ?? null);
  // 集計値や割合を主にするときは、添える小さな数を件数(母数)にする。
  const subLabel = withValue || ratio ? "件数" : "患者数";

  /** セルの中身を押せるようにする(一覧をそのセルの行に絞る)。 */
  const drillable = (stat: BreakdownCell, label: string, content: ReactNode): ReactNode =>
    onDrill && stat.records > 0 ? (
      <button
        type="button"
        className="extract-breakdown__drill"
        title={`${label} の記録を一覧で見る`}
        onClick={() => onDrill(stat.indices, label)}
      >
        {content}
      </button>
    ) : (
      content
    );

  /** 列に分けた表のセル。主の数(件数・割合・集計値)に、小さく薄い添えの数(患者数か件数)を付ける。 */
  const cell = (stat: BreakdownCell, label: string, rowWhole: number, columnWhole: number): ReactNode => {
    if (stat.records === 0) return null;
    const main = withValue
      ? (stat.value ?? "-")
      : ratio === "row"
        ? percent(stat.records, rowWhole)
        : ratio === "column"
          ? percent(stat.records, columnWhole)
          : stat.records;
    const sub = withValue || ratio ? stat.records : stat.patients;
    return drillable(
      stat,
      label,
      <>
        {main}
        {showSub && <span className="extract-breakdown__patients">({sub})</span>}
      </>,
    );
  };

  const listColumns = (stat: BreakdownCell, label: string): ReactNode => (
    <>
      <td className="extract-breakdown__number">{drillable(stat, label, stat.records)}</td>
      {showSub && !withValue && <td className="extract-breakdown__number">{stat.patients}</td>}
      {ratio && <td className="extract-breakdown__number">{percent(stat.records, breakdown.total.records)}</td>}
      {withValue && <td className="extract-breakdown__number">{stat.value ?? "-"}</td>}
    </>
  );
  const listWidth = 2 + (showSub && !withValue ? 1 : 0) + (ratio ? 1 : 0) + (withValue ? 1 : 0);
  const total = breakdown.total.records;

  return (
    <div className="extract-breakdown__leaf">
      <div className="extract-breakdown__controls">
        <select aria-label="期間にする列" value={dateLabel} onChange={(e) => update({ date: e.target.value })}>
          <option value="">期間なし</option>
          {dateColumns.map((c) => (
            <option key={c.index} value={c.label}>
              {c.label}
            </option>
          ))}
        </select>
        {dateIndex !== null && (
          <>
            <select
              aria-label="期間の刻み"
              value={grain}
              onChange={(e) => update({ grain: e.target.value as TimeGrain })}
            >
              {TIME_GRAINS.map((g) => (
                <option key={g.value} value={g.value}>
                  {`${g.label}ごと`}
                </option>
              ))}
            </select>
            <label className="extract-checks__item">
              <input type="checkbox" checked={fillEmpty} onChange={(e) => update({ fill_empty: e.target.checked })} />
              0 件の期間
            </label>
          </>
        )}
        <label className="extract-checks__item">
          行
          <select aria-label="行の軸" value={rowKey} onChange={(e) => update({ rows: e.target.value })}>
            <option value="">計のみ</option>
            {dateIndex !== null && <option value="period">期間</option>}
            {categoryColumns.map((c) => (
              <option key={c.index} value={c.label}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="extract-checks__item">
          列
          <select aria-label="列の軸" value={columnKey} onChange={(e) => update({ columns: e.target.value })}>
            <option value="">分けない</option>
            {dateIndex !== null && rowKey !== "period" && <option value="period">期間</option>}
            {categoryColumns
              .filter((c) => c.label !== rowKey)
              .map((c) => (
                <option key={c.index} value={c.label}>
                  {c.label}
                </option>
              ))}
          </select>
        </label>
        <select
          aria-label="集計する値"
          value={valueIndex === null ? "" : (settings.value ?? "")}
          onChange={(e) => update({ value: e.target.value || undefined })}
        >
          <option value="">件数</option>
          {numberColumns.map((c) => (
            <option key={c.index} value={c.label}>
              {c.label}
            </option>
          ))}
        </select>
        {withValue ? (
          <select aria-label="集計の方法" value={metric} onChange={(e) => update({ metric: e.target.value as Metric })}>
            {METRICS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        ) : (
          <select
            aria-label="割合"
            value={ratio ?? ""}
            onChange={(e) => update({ ratio: (e.target.value || undefined) as BreakdownRatio | undefined })}
          >
            <option value="">数</option>
            <option value="row">{hasColumns ? "行の中の割合" : "割合"}</option>
            {hasColumns && <option value="column">列の中の割合</option>}
          </select>
        )}
        <span className="extract-checks__item">
          <label className="extract-checks__item">
            <input type="checkbox" checked={showSub} onChange={(e) => update({ show_sub: e.target.checked })} />
            {subLabel}
          </label>
          <HelpTip
            text={
              withValue || ratio
                ? "各セルの値の後ろに、計算に使った記録の件数を小さく添えます。"
                : "各セルの件数の後ろに、その記録の患者数を小さく添えます。同じ患者は 1 人と数えるため、計は各セルの和になりません。"
            }
          />
        </span>
        <span className="extract-checks__item">
          <label className="extract-checks__item">
            <input type="checkbox" checked={splitMulti} onChange={(e) => update({ split_multi: e.target.checked })} />
            分割
          </label>
          <HelpTip text="「、」でつないだ複数の値(麻酔方法・手技・担当看護師など)を、値ごとに分けて数えます。1 件が複数の値に数えられるため、各行・各列の和は計と一致しません。" />
        </span>
        <button
          type="button"
          disabled={cells.length === 0}
          onClick={() =>
            downloadBlob(
              recordBreakdownCsv(breakdown, showSub || withValue, fillEmpty && dateIndex !== null),
              `breakdown_${today()}.csv`,
            )
          }
        >
          内訳CSV
        </button>
      </div>
      <RecordBreakdownChart breakdown={breakdown} periodOnRows={rowKey === "period"} />
      <div className="extract-results__table-wrap">
        <table className="master-search__table extract-breakdown">
          <thead>
            <tr>
              <th>
                {breakdown.rowAxis}
                {hasColumns && breakdown.columnAxis && ` / ${breakdown.columnAxis}`}
              </th>
              {hasColumns ? (
                <>
                  {breakdown.columnLabels.map((label) => (
                    <th key={label} className="extract-breakdown__number">
                      {label}
                    </th>
                  ))}
                  <th className="extract-breakdown__number">計</th>
                </>
              ) : (
                <>
                  <th className="extract-breakdown__number">件数</th>
                  {showSub && !withValue && <th className="extract-breakdown__number">患者数</th>}
                  {ratio && <th className="extract-breakdown__number">割合</th>}
                  {withValue && <th className="extract-breakdown__number">{breakdown.valueLabel}</th>}
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {breakdown.rowLabels.map((rowLabel, r) => (
              <tr key={rowLabel}>
                <td className="extract-breakdown__label">{rowLabel}</td>
                {hasColumns ? (
                  <>
                    {breakdown.columnLabels.map((label, c) => (
                      <td key={label} className="extract-breakdown__number">
                        {cell(
                          breakdown.cells[r][c],
                          `${rowLabel} × ${label}`,
                          breakdown.rowTotals[r].records,
                          breakdown.columnTotals[c].records,
                        )}
                      </td>
                    ))}
                    <td className="extract-breakdown__number">
                      {cell(breakdown.rowTotals[r], rowLabel, breakdown.rowTotals[r].records, total)}
                    </td>
                  </>
                ) : (
                  listColumns(breakdown.rowTotals[r], rowLabel)
                )}
              </tr>
            ))}
            {cells.length === 0 && (
              <tr>
                <td
                  colSpan={hasColumns ? breakdown.columnLabels.length + 2 : listWidth}
                  className="master-search__empty"
                >
                  記録はありません
                </td>
              </tr>
            )}
            {cells.length > 0 && breakdown.rowLabels.length > 1 && (
              <tr className="extract-breakdown__total">
                <td>計</td>
                {hasColumns ? (
                  <>
                    {breakdown.columnTotals.map((columnTotal, c) => (
                      <td key={c} className="extract-breakdown__number">
                        {cell(columnTotal, breakdown.columnLabels[c], total, columnTotal.records)}
                      </td>
                    ))}
                    <td className="extract-breakdown__number">{cell(breakdown.total, "計", total, total)}</td>
                  </>
                ) : (
                  listColumns(breakdown.total, "計")
                )}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {hasColumns && cells.length > 0 && (withValue || ratio || showSub) && (
        <p className="order-select__muted">
          {`各セルは ${withValue ? breakdown.valueLabel : ratio === "row" ? "行の中の割合" : ratio === "column" ? "列の中の割合" : "件数"}`}
          {showSub && <span className="extract-breakdown__patients">{`(${subLabel})`}</span>}
        </p>
      )}
      {withValue && (
        <p className="order-select__muted">{`${breakdown.valueLabel}は、値の入っている記録だけで計算しています。`}</p>
      )}
      {breakdown.multiCounted && (
        <p className="order-select__muted">1 件が複数の値に数えられているため、各行・各列の和は計と一致しません。</p>
      )}
      {breakdown.fillSkipped && (
        <p className="order-select__muted">{`期間が ${MAX_FILLED_PERIODS} 個を超えるため、0 件の期間は並べていません。刻みを粗くしてください。`}</p>
      )}
      {breakdown.truncatedAxes.length > 0 && (
        <p className="order-select__muted">{`${breakdown.truncatedAxes.join("・")}は件数の多い順に(行は ${BREAKDOWN_MAX_CATEGORIES} 個、列は ${BREAKDOWN_MAX_COLUMN_CATEGORIES} 個まで)出し、残りは「その他」にまとめています。`}</p>
      )}
    </div>
  );
}
