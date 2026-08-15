import { useMemo, useState } from "react";
import { useVitalFlowsheet } from "../api/queries";
import {
  BLOOD_PRESSURE_SERIES,
  bloodPressureNumbers,
  buildVitalFlowsheet,
  flowsheetColumnLabel,
  toDateTimeLocal,
  type VitalFlowsheetRow,
} from "../fhir/vitalHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { LabTimelineChart, type LabTimelineSeries } from "./LabTimelineChart";
import { Modal } from "./Modal";

// バイタルの経過表(POMR のフローシート)。読み取り専用で、編集はカルテの
// バイタルカードから行う(編集の導線を 2 つ持つと同期の負債になるため)。
//
// 表・グラフの操作系は検査結果の時系列表示(LabResultTimelinePanel)に合わせる。

const DEFAULT_COLUMN_COUNT = 10;
const MAX_COLUMN_COUNT = 100;

export function VitalFlowsheetPanel({ patientId }: { patientId: string }) {
  const [columnCount, setColumnCount] = useState(DEFAULT_COLUMN_COUNT);
  const [checkedKeys, setCheckedKeys] = useState<ReadonlySet<string>>(new Set());
  const [chartOpen, setChartOpen] = useState(false);

  const { data: observations, isLoading, error } = useVitalFlowsheet(patientId, columnCount);
  const flowsheet = useMemo(
    () => buildVitalFlowsheet(observations ?? [], columnCount),
    [observations, columnCount],
  );

  function handleColumnCountChange(raw: number) {
    if (!Number.isFinite(raw)) return;
    setColumnCount(Math.min(MAX_COLUMN_COUNT, Math.max(1, Math.round(raw))));
  }

  function toggleChecked(key: string) {
    setCheckedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const chartSeries: LabTimelineSeries[] = useMemo(() => {
    // グラフの X 軸は古い順。
    const ascending = [...flowsheet.columns].reverse();
    // 横軸は測定日時。同じ日の朝夕が重ならないよう、日付だけに丸めずローカル日時で渡す。
    const pointsOf = (numbers: Map<string, number>) =>
      ascending.flatMap((at) => {
        const value = numbers.get(at);
        return value != null ? [{ date: toDateTimeLocal(at), value }] : [];
      });

    return flowsheet.rows.flatMap((row) => {
      if (!checkedKeys.has(row.key)) return [];
      // 血圧は 1 行だが、収縮期と拡張期を別の系列にしないと折れ線として読めない。
      if (row.key === "85354-9") {
        return BLOOD_PRESSURE_SERIES.map((series) => ({
          key: series.key,
          name: series.name,
          unit: series.unit,
          points: pointsOf(bloodPressureNumbers(observations ?? [], series.key)),
        })).filter((series) => series.points.length > 0);
      }
      if (row.numbers.size === 0) return [];
      return [{ key: row.key, name: row.name, unit: row.unit, points: pointsOf(row.numbers) }];
    });
  }, [flowsheet, checkedKeys, observations]);

  return (
    <>
      <ErrorBanner error={error} />

      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <div className="lab-timeline__controls">
            <label className="lab-timeline__count">
              履歴の表示数
              <input
                type="number"
                min={1}
                max={MAX_COLUMN_COUNT}
                value={columnCount}
                onChange={(e) => handleColumnCountChange(e.target.valueAsNumber)}
              />
            </label>
            <button
              type="button"
              onClick={() => setChartOpen(true)}
              disabled={chartSeries.length === 0}
            >
              グラフ表示
            </button>
            <span className="lab-timeline__hint" />
          </div>

          {flowsheet.rows.length === 0 ? (
            <p className="patient-table__empty">バイタルの記録がありません</p>
          ) : (
            <div className="lab-timeline__table-wrap">
              <table className="lab-timeline__table">
                <thead>
                  {/* 列は測定 1 回。同じ日の朝夕を潰さないよう、日付の下に時刻を出す。 */}
                  <tr>
                    <th className="lab-timeline__item-col" rowSpan={3}>
                      測定項目
                    </th>
                    <th className="lab-timeline__unit-col" rowSpan={3}>
                      単位
                    </th>
                    {groupColumnsByYear(flowsheet.columns).map((group) => (
                      <th
                        key={group.columns[0]}
                        className="lab-timeline__year-col"
                        colSpan={group.columns.length}
                      >
                        {group.year}年
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {flowsheet.columns.map((at) => (
                      <th key={at} className="lab-timeline__date-col" title={at}>
                        {flowsheetColumnLabel(at).date}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {flowsheet.columns.map((at) => (
                      <th key={at} className="vital-flowsheet__time-col">
                        {flowsheetColumnLabel(at).time}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {flowsheet.rows.map((row) => (
                    <FlowsheetRow
                      key={row.key}
                      row={row}
                      columns={flowsheet.columns}
                      checked={checkedKeys.has(row.key)}
                      onToggle={() => toggleChecked(row.key)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {chartOpen && (
        <Modal title="バイタルグラフ" onClose={() => setChartOpen(false)} className="modal--wide">
          <LabTimelineChart series={chartSeries} />
        </Modal>
      )}
    </>
  );
}

// 連続する同じ年の列をまとめる。年不明の列は単独グループにする。
function groupColumnsByYear(columns: string[]): { year: string; columns: string[] }[] {
  const groups: { year: string; columns: string[] }[] = [];
  for (const at of columns) {
    const year = flowsheetColumnLabel(at).year;
    const last = groups[groups.length - 1];
    if (last && year && last.year === year) last.columns.push(at);
    else groups.push({ year, columns: [at] });
  }
  return groups;
}

function FlowsheetRow({
  row,
  columns,
  checked,
  onToggle,
}: {
  row: VitalFlowsheetRow;
  columns: string[];
  checked: boolean;
  onToggle: () => void;
}) {
  // 血圧は numbers を持たない(グラフでは収縮期・拡張期に分ける)が、折れ線には出せる。
  const plottable = row.numbers.size > 0 || row.key === "85354-9";
  return (
    <tr>
      <td className="lab-timeline__item-col">
        <label className="lab-timeline__item-label">
          <input
            type="checkbox"
            checked={checked && plottable}
            disabled={!plottable}
            onChange={onToggle}
          />
          <span>{row.name}</span>
        </label>
      </td>
      <td className="lab-timeline__unit-col">{row.unit}</td>
      {columns.map((at) => (
        <td key={at} className="lab-timeline__value">
          {row.values.get(at) ?? ""}
        </td>
      ))}
    </tr>
  );
}
