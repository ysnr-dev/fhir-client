import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  usePatientBroughtMedications,
  usePatientChartInjections,
  usePatientChartPrescriptions,
  usePatientEncounterEvents,
} from "../api/queries";
import { chartRangeOf, type ChartColumn } from "../fhir/chartDefinitionHelpers";
import {
  MEDICATION_HISTORY_KINDS,
  MEDICATION_HISTORY_KIND_LABELS,
  buildMedicationHistory,
  type MedicationHistoryCell,
} from "../fhir/medicationHistoryHelpers";
import {
  formatMedicationHistoryView,
  parseMedicationHistoryView,
  type KarteDetailTarget,
  type MedicationHistorySetting,
  type MedicationHistoryUnit,
  type MedicationHistoryView,
} from "../karteUrl";
import { addDays, today } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";

// カルテの投薬歴タブ。処方・注射・持参薬を「薬剤 × 日付」の表にして、いつ何をどれだけ
// 使っていたかを読む。セルは 1 日量で、用量が変わった所に増減の印を付ける。
// セルを押すとそのオーダーを右ペインで開く。

interface Props {
  patientId: string;
  view: string;
  onViewChange?: (view: string | null) => void;
  onOpenDetail?: (target: KarteDetailTarget) => void;
}

const COLUMN_CHOICES: Record<MedicationHistoryUnit, number[]> = {
  day: [14, 30, 60],
  month: [6, 12, 24],
};
const DEFAULT_COLUMNS: Record<MedicationHistoryUnit, number> = { day: 30, month: 12 };
const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

const CHANGE_MARKS = { increase: "↑", decrease: "↓", change: "*" } as const;
const CHANGE_LABELS = { increase: "増量", decrease: "減量", change: "変更" } as const;

function shiftBase(baseDate: string, unit: MedicationHistoryUnit, columns: number, direction: number) {
  if (unit === "day") return addDays(baseDate, columns * direction);
  const [year, month, day] = baseDate.split("-").map(Number);
  const target = new Date(year, month - 1 + columns * direction, 1);
  // 月の列は月末で区切るので、送った先の月に無い日(31 日など)は月末に寄せる。
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(Math.min(day, last))}`;
}

/** 列見出しの上段(年・月の変わり目だけ)と下段。 */
function columnHeading(column: ChartColumn, unit: MedicationHistoryUnit, index: number) {
  const [year, month, day] = column.start.split("-").map(Number);
  if (unit === "month") {
    return { upper: column.year, lower: `${month}月`, weekday: -1 };
  }
  const weekday = new Date(year, month - 1, day).getDay();
  const upper = index === 0 || day === 1 ? (index === 0 || month === 1 ? `${year}/${month}` : `${month}月`) : "";
  return { upper, lower: `${day}`, weekday };
}

export function KarteMedicationHistoryTab({ patientId, view, onViewChange, onOpenDetail }: Props) {
  // タブの外(別ペイン)から使うときは URL に載せずローカルに持つ(チャートと同じ)。
  const [localView, setLocalView] = useState("");
  const parsed = parseMedicationHistoryView(onViewChange ? view : localView);
  // Escape の購読から最新の view を読む(毎描画で張り直さないため)。
  const viewRef = useRef(parsed);
  viewRef.current = parsed;
  const updateView = (next: MedicationHistoryView) => {
    const formatted = formatMedicationHistoryView(next, today());
    if (onViewChange) onViewChange(formatted);
    else setLocalView(formatted ?? "");
  };

  const todayDate = today();
  const baseDate = parsed.baseDate ?? todayDate;
  const unit = parsed.unit ?? "day";
  const columns = parsed.columns ?? DEFAULT_COLUMNS[unit];
  const range = useMemo(() => chartRangeOf(baseDate, { unit, columns }), [baseDate, unit, columns]);
  // parse のたびに配列が作り直されるので、中身で固定して集計の memo を効かせる。
  const hiddenKey = (parsed.hidden ?? []).join(",");
  const hidden = useMemo(() => parsed.hidden, [hiddenKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const prescriptions = usePatientChartPrescriptions(patientId, range.rangeStart, range.rangeEnd);
  const injections = usePatientChartInjections(patientId, range.rangeStart, range.rangeEnd);
  const brought = usePatientBroughtMedications(patientId);
  const encounters = usePatientEncounterEvents(patientId, range.rangeStart, range.rangeEnd);

  const sections = useMemo(
    () =>
      buildMedicationHistory({
        prescriptions: prescriptions.data,
        injections: injections.data,
        brought: brought.statements,
        range,
        setting: parsed.setting,
        hidden,
        today: todayDate,
      }),
    [prescriptions.data, injections.data, brought.statements, range, parsed.setting, hidden, todayDate],
  );

  const stays = encounters.data?.stays;
  const inpatientColumns = useMemo(() => {
    const result = new Set<string>();
    for (const column of range.columns) {
      const inside = (stays ?? []).some(
        (stay) => stay.start <= column.end && (stay.end ?? todayDate) >= column.start,
      );
      if (inside) result.add(column.start);
    }
    return result;
  }, [range.columns, stays, todayDate]);

  // 開いたとき・期間を変えたときは、新しい側(右端)が見えるように送る。
  const wrapRef = useRef<HTMLDivElement>(null);
  const loaded = !prescriptions.isPending && !injections.isPending;
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (wrap) wrap.scrollLeft = wrap.scrollWidth;
  }, [range, loaded]);

  const error = prescriptions.error ?? injections.error ?? brought.error ?? encounters.error;
  const truncated = Boolean(prescriptions.data?.truncated || injections.data?.truncated);

  // 全画面はビューポート全体ではなく「患者情報の下」から始める(経過表・チャートと同じ)。
  const fullscreen = Boolean(parsed.fullscreen);
  const panelRef = useRef<HTMLDivElement>(null);
  const [fullscreenTop, setFullscreenTop] = useState(0);
  useEffect(() => {
    if (!fullscreen) return;
    function measure() {
      const layout = panelRef.current?.closest(".karte-layout");
      setFullscreenTop(layout ? Math.max(0, layout.getBoundingClientRect().top) : 0);
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [fullscreen]);

  useEffect(() => {
    if (!fullscreen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") updateView({ ...viewRef.current, fullscreen: false });
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreen]);

  function changeAxis(nextUnit: MedicationHistoryUnit, nextColumns: number) {
    updateView({ ...parsed, unit: nextUnit, columns: nextColumns });
  }

  function toggleKind(kind: (typeof MEDICATION_HISTORY_KINDS)[number]) {
    const current = new Set(hidden ?? []);
    if (current.has(kind)) current.delete(kind);
    else current.add(kind);
    const next = MEDICATION_HISTORY_KINDS.filter((entry) => current.has(entry));
    updateView({ ...parsed, hidden: next.length > 0 ? next : undefined });
  }

  function openCell(cell: MedicationHistoryCell) {
    if (cell.target && onOpenDetail) onOpenDetail(cell.target);
  }

  return (
    <div
      ref={panelRef}
      className={`karte-tabpanel medication-history${fullscreen ? " medication-history--fullscreen" : ""}`}
      style={fullscreen ? { top: fullscreenTop } : undefined}
    >
      <div className="patient-chart__toolbar">
        <h3 className="patient-chart__title">投薬歴</h3>
        <div className="patient-chart__nav">
          <button
            type="button"
            className="patient-chart__step"
            onClick={() => updateView({ ...parsed, baseDate: shiftBase(baseDate, unit, columns, -1) })}
            title="前へ"
            aria-label="前へ"
          >
            ◀
          </button>
          <input
            type="date"
            value={baseDate}
            onChange={(e) => updateView({ ...parsed, baseDate: e.target.value || undefined })}
          />
          <button
            type="button"
            className="patient-chart__step"
            onClick={() => updateView({ ...parsed, baseDate: shiftBase(baseDate, unit, columns, 1) })}
            title="次へ"
            aria-label="次へ"
          >
            ▶
          </button>
          <button type="button" onClick={() => updateView({ ...parsed, baseDate: undefined })}>
            今日
          </button>
        </div>
        <div className="patient-chart__unit">
          <select
            value={unit}
            aria-label="列の単位"
            onChange={(e) => {
              const next = e.target.value as MedicationHistoryUnit;
              changeAxis(next, DEFAULT_COLUMNS[next]);
            }}
          >
            <option value="day">日</option>
            <option value="month">月</option>
          </select>
          <select
            value={columns}
            aria-label="表示する列数"
            onChange={(e) => changeAxis(unit, Number(e.target.value))}
          >
            {(COLUMN_CHOICES[unit].includes(columns)
              ? COLUMN_CHOICES[unit]
              : [...COLUMN_CHOICES[unit], columns].sort((a, b) => a - b)
            ).map((choice) => (
              <option key={choice} value={choice}>
                {choice}
              </option>
            ))}
          </select>
        </div>
        <select
          value={parsed.setting ?? ""}
          aria-label="入外"
          onChange={(e) =>
            updateView({ ...parsed, setting: (e.target.value || undefined) as MedicationHistorySetting | undefined })
          }
        >
          <option value="">入外すべて</option>
          <option value="outpatient">外来</option>
          <option value="inpatient">入院</option>
        </select>
        <div className="medication-history__kinds" role="group" aria-label="表示する区分">
          {MEDICATION_HISTORY_KINDS.map((kind) => (
            <label key={kind} className="medication-history__kind">
              <input
                type="checkbox"
                checked={!hidden?.includes(kind)}
                onChange={() => toggleKind(kind)}
              />
              {MEDICATION_HISTORY_KIND_LABELS[kind]}
            </label>
          ))}
        </div>
        <button type="button" onClick={() => updateView({ ...parsed, fullscreen: !fullscreen })}>
          {fullscreen ? "全画面を終了" : "全画面"}
        </button>
      </div>

      {Boolean(error) && <ErrorBanner error={error} />}
      {truncated && (
        <div className="medication-history__notice">
          オーダーが多いため、期間の後ろの一部を表示できていません。期間を短くしてください。
        </div>
      )}

      {!loaded ? (
        <p className="medication-history__empty">読み込み中...</p>
      ) : sections.length === 0 ? (
        <p className="medication-history__empty">この期間の投薬はありません。</p>
      ) : (
        <div ref={wrapRef} className="medication-history__wrap">
          <table className={`medication-history__table medication-history__table--${unit}`}>
            <thead>
              <tr>
                <th className="medication-history__name-col">薬剤</th>
                <th className="medication-history__unit-col">単位</th>
                {range.columns.map((column, index) => {
                  const heading = columnHeading(column, unit, index);
                  const isToday = column.start <= todayDate && todayDate <= column.end;
                  const classes = [
                    "medication-history__date-col",
                    isToday ? "is-today" : "",
                    inpatientColumns.has(column.start) ? "is-inpatient" : "",
                    heading.weekday === 0 ? "is-sunday" : heading.weekday === 6 ? "is-saturday" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  const weekday = heading.weekday >= 0 ? WEEKDAY_LABELS[heading.weekday] : "";
                  return (
                    <th
                      key={column.start}
                      className={classes}
                      title={`${column.start.replaceAll("-", "/")}${weekday ? `(${weekday})` : ""}${
                        inpatientColumns.has(column.start) ? " 入院中" : ""
                      }`}
                    >
                      <span className="medication-history__date-upper">{heading.upper}</span>
                      <span className="medication-history__date-lower">
                        {heading.lower}
                        {weekday && <small>{weekday}</small>}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            {sections.map((section) => (
              <tbody key={section.kind}>
                <tr className="medication-history__section">
                  <th className="medication-history__name-col" scope="rowgroup">
                    {MEDICATION_HISTORY_KIND_LABELS[section.kind]}
                  </th>
                  <td className="medication-history__unit-col" />
                  <td colSpan={range.columns.length} />
                </tr>
                {section.rows.map((row) => (
                  <tr key={row.key}>
                    <th className="medication-history__name-col" scope="row" title={row.name}>
                      <span className="medication-history__name">{row.name}</span>
                      {row.badge && (
                        <span className={`medication-history__badge medication-history__badge--${row.badgeState}`}>
                          {row.badge}
                        </span>
                      )}
                    </th>
                    <td className="medication-history__unit-col">{row.unit}</td>
                    {range.columns.map((column) => {
                      const cell = row.cells.get(column.start);
                      const isToday = column.start <= todayDate && todayDate <= column.end;
                      if (!cell) {
                        return <td key={column.start} className={isToday ? "is-today" : undefined} />;
                      }
                      const classes = [
                        "medication-history__cell",
                        isToday ? "is-today" : "",
                        cell.change ? `medication-history__cell--${cell.change}` : "",
                        cell.partial ? "medication-history__cell--partial" : "",
                        cell.target && onOpenDetail ? "is-clickable" : "",
                      ]
                        .filter(Boolean)
                        .join(" ");
                      const tooltip = cell.change ? `${CHANGE_LABELS[cell.change]}\n${cell.tooltip}` : cell.tooltip;
                      return (
                        <td
                          key={column.start}
                          className={classes}
                          title={tooltip}
                          onClick={cell.target && onOpenDetail ? () => openCell(cell) : undefined}
                        >
                          {cell.text}
                          {cell.change && (
                            <span className="medication-history__change" aria-hidden="true">
                              {CHANGE_MARKS[cell.change]}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </div>
  );
}
