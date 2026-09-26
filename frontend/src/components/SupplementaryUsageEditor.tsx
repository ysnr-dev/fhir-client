import type { ReactNode } from "react";
import {
  emptySupplement,
  MAX_COUNT_TIMES,
  MAX_INTERVAL_DAYS,
  SUPPLEMENT_KIND_OPTIONS,
  SUPPLEMENT_PERIOD_OPTIONS,
  WEEKDAY_LABELS,
  type SupplementDateMonth,
  type SupplementPeriod,
  type SupplementaryUsage,
} from "../fhir/supplementaryUsage";

const MONTH_OPTIONS = [
  { value: 0, label: "毎月" },
  ...Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `${i + 1}月` })),
];

const DAYS_OF_MONTH = Array.from({ length: 31 }, (_, i) => i + 1);

function numberValue(value: number): string {
  return value ? String(value) : "";
}

function ToggleDay({
  pressed,
  onToggle,
  children,
}: {
  pressed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`supplement-toggle${pressed ? " supplement-toggle--on" : ""}`}
      aria-pressed={pressed}
      onClick={onToggle}
    >
      {children}
    </button>
  );
}

/** RP の補足用法(日数間隔・曜日・日付・期間内回数)の入力。 */
export function SupplementaryUsageEditor({
  value,
  onChange,
  onRemove,
  removeButton,
  name,
}: {
  value: SupplementaryUsage;
  onChange: (value: SupplementaryUsage) => void;
  onRemove: () => void;
  /** 削除アイコン(フォームの他の削除ボタンと揃える)。 */
  removeButton: (onClick: () => void, label: string) => ReactNode;
  /** 種類のラジオの name(RP ごとに別にする)。 */
  name: string;
}) {
  return (
    <div className="rp-card__supplement">
      <div className="rp-card__supplement-head">
        <span className="rp-card__usage-label">補足用法</span>
        <div className="rp-card__supplement-kinds" role="radiogroup">
          {SUPPLEMENT_KIND_OPTIONS.map((option) => (
            <label key={option.kind} className="rp-card__supplement-kind">
              <input
                type="radio"
                name={name}
                checked={value.kind === option.kind}
                onChange={() => onChange(emptySupplement(option.kind))}
              />
              {option.label}
            </label>
          ))}
        </div>
        {removeButton(onRemove, "補足用法を削除")}
      </div>
      <SupplementBody value={value} onChange={onChange} />
    </div>
  );
}

function SupplementBody({
  value,
  onChange,
}: {
  value: SupplementaryUsage;
  onChange: (value: SupplementaryUsage) => void;
}) {
  switch (value.kind) {
    case "interval":
      return (
        <div className="rp-card__supplement-body">
          <input
            type="number"
            min="1"
            max={MAX_INTERVAL_DAYS}
            className="rp-card__dose-count-input"
            aria-label="服用日数"
            value={numberValue(value.onDays)}
            onChange={(e) => onChange({ ...value, onDays: Number(e.target.value) })}
          />
          <span>日服用</span>
          <input
            type="number"
            min="1"
            max={MAX_INTERVAL_DAYS}
            className="rp-card__dose-count-input"
            aria-label="休薬日数"
            value={numberValue(value.offDays)}
            onChange={(e) => onChange({ ...value, offDays: Number(e.target.value) })}
          />
          <span>日休薬</span>
        </div>
      );
    case "weekday":
      return (
        <div className="rp-card__supplement-body">
          {WEEKDAY_LABELS.map((label, i) => (
            <ToggleDay
              key={label}
              pressed={value.days[i]}
              onToggle={() =>
                onChange({ ...value, days: value.days.map((d, j) => (j === i ? !d : d)) })
              }
            >
              {label}
            </ToggleDay>
          ))}
        </div>
      );
    case "date":
      return <DateMonthsEditor value={value.months} onChange={(months) => onChange({ ...value, months })} />;
    case "count":
      return (
        <div className="rp-card__supplement-body">
          <select
            aria-label="期間"
            value={value.period}
            onChange={(e) => onChange({ ...value, period: e.target.value as SupplementPeriod })}
          >
            {SUPPLEMENT_PERIOD_OPTIONS.map((p) => (
              <option key={p.code} value={p.code}>
                {p.label}
              </option>
            ))}
          </select>
          <input
            type="number"
            min="1"
            max={MAX_COUNT_TIMES}
            className="rp-card__dose-count-input"
            aria-label="回数"
            value={numberValue(value.times)}
            onChange={(e) => onChange({ ...value, times: Number(e.target.value) })}
          />
          <span>回</span>
        </div>
      );
  }
}

function DateMonthsEditor({
  value,
  onChange,
}: {
  value: SupplementDateMonth[];
  onChange: (value: SupplementDateMonth[]) => void;
}) {
  function updateRow(index: number, patch: Partial<SupplementDateMonth>) {
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function toggleDay(index: number, day: number) {
    const days = value[index].days;
    updateRow(index, {
      days: days.includes(day) ? days.filter((d) => d !== day) : [...days, day],
    });
  }

  // 毎月と個別の月は混ぜない。毎月の行があれば行を増やさない。
  const hasEveryMonth = value.some((row) => row.month === 0);
  const usedMonths = new Set(value.map((row) => row.month));
  const nextMonth = MONTH_OPTIONS.find((m) => m.value !== 0 && !usedMonths.has(m.value))?.value;

  return (
    <div className="rp-card__supplement-dates">
      {value.map((row, index) => (
        <div key={index} className="rp-card__supplement-date-row">
          <select
            aria-label="服用月"
            value={row.month}
            onChange={(e) => updateRow(index, { month: Number(e.target.value) })}
          >
            {MONTH_OPTIONS.filter(
              (m) =>
                m.value === row.month ||
                (!usedMonths.has(m.value) && (m.value !== 0 || value.length === 1)),
            ).map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <div className="rp-card__supplement-days">
            {DAYS_OF_MONTH.map((day) => (
              <ToggleDay
                key={day}
                pressed={row.days.includes(day)}
                onToggle={() => toggleDay(index, day)}
              >
                {day}
              </ToggleDay>
            ))}
          </div>
          {value.length > 1 && (
            <button
              type="button"
              className="comment-add-button"
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              削除
            </button>
          )}
        </div>
      ))}
      {!hasEveryMonth && nextMonth !== undefined && (
        <button
          type="button"
          className="comment-add-button"
          onClick={() => onChange([...value, { month: nextMonth, days: [] }])}
        >
          ＋月を追加
        </button>
      )}
    </div>
  );
}

/** 薬剤の不均等投与(服用タイミングごとの量)の入力。 */
export function UnevenDoseEditor({
  labels,
  doses,
  onChange,
  onRemove,
  removeButton,
}: {
  labels: string[];
  doses: string[];
  onChange: (doses: string[]) => void;
  onRemove: () => void;
  removeButton: (onClick: () => void, label: string) => ReactNode;
}) {
  return (
    <div className="rp-card__uneven">
      <span className="rp-card__usage-label">不均等</span>
      {labels.map((label, i) => (
        <label key={i} className="rp-card__uneven-item">
          {label}
          <input
            type="number"
            step="any"
            min="0"
            className="rp-card__uneven-input"
            value={doses[i] ?? ""}
            onChange={(e) => onChange(labels.map((_, j) => (j === i ? e.target.value : (doses[j] ?? ""))))}
          />
        </label>
      ))}
      {removeButton(onRemove, "不均等投与を削除")}
    </div>
  );
}
