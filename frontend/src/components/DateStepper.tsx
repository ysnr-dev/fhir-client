import { addDays, today } from "../lib/dates";

/** 日付を 1 日ずつ送れる入力。基準日(入院患者)と退院日(退院患者)で使う。 */
export function DateStepper({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return (
    <div className="inpatient__date">
      <button type="button" onClick={() => onChange(addDays(value, -1))} aria-label="前の日">
        &lt;
      </button>
      <input type="date" value={value} onChange={(e) => onChange(e.target.value || today())} />
      <button type="button" onClick={() => onChange(addDays(value, 1))} aria-label="次の日">
        &gt;
      </button>
      <button type="button" onClick={() => onChange(today())} disabled={value === today()}>
        今日
      </button>
    </div>
  );
}
