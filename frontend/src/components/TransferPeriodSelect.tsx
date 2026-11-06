// 転記・取込のモーダルでオーダーを読む期間。0 は全期間。
const PERIOD_OPTIONS: { months: number; label: string }[] = [
  { months: 1, label: "1か月" },
  { months: 3, label: "3か月" },
  { months: 6, label: "6か月" },
  { months: 12, label: "1年" },
  { months: 0, label: "全期間" },
];

export function TransferPeriodSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (months: number) => void;
}) {
  return (
    <select aria-label="期間" value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {PERIOD_OPTIONS.map((option) => (
        <option key={option.months} value={option.months}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
