import { describeMealSyncEntries } from "../fhir/mealEncounterSync";

// 入退院・外出泊のモーダルに出す「食事オーダーも一緒にこう変わる」の節。
// チェックを外すと連動しない。対象が無ければ何も出さない。

export function MealSyncSummary({
  title,
  entries,
  orders,
  enabled,
  onToggle,
  note,
}: {
  title: string;
  entries: fhir4.BundleEntry[];
  orders: fhir4.ServiceRequest[];
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  /** 一覧の下に添える注意(食止め食種が無い など)。 */
  note?: string;
}) {
  if (entries.length === 0 && !note) return null;
  const lines = describeMealSyncEntries(entries, orders);
  return (
    <div className="discharge__meal">
      {entries.length > 0 && (
        <label className="discharge__meal-toggle">
          <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
          {title}
        </label>
      )}
      {entries.length > 0 && (
        <ul className="discharge__meal-list">
          {lines.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      )}
      {note && <p className="order-select__muted">{note}</p>}
    </div>
  );
}
