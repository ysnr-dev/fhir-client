import type { OrderSetScope } from "../../api/masterClient";

const SCOPE_LABELS: Record<string, string> = { facility: "院内共通", department: "診療科", practitioner: "自分" };

/** 持ち主ごとに保存する定義(データ抽出の条件・ダッシュボード)の、選択に要る項目。 */
interface ScopedRecord {
  id: number;
  scope: OrderSetScope;
  name: string;
  owner_id: string | null;
  owner_name: string | null;
}

/** 保存した条件の選択(持ち主ごとにまとめる。チームの条件はスクリーニングとしてチームごと)。 */
export function ExtractQuerySelect<T extends ScopedRecord>({
  queries,
  value,
  emptyLabel,
  teamLabel = "スクリーニング",
  onChange,
}: {
  queries: T[];
  value: number | null;
  emptyLabel: string;
  /** チームの定義のグループ名の頭(ダッシュボードは「チーム」)。 */
  teamLabel?: string;
  onChange: (query: T | null) => void;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(queries.find((q) => q.id === Number(e.target.value)) ?? null)}
    >
      <option value="">{emptyLabel}</option>
      {(["practitioner", "department", "facility"] as const).map((scope) => {
        const items = queries.filter((q) => q.scope === scope);
        if (items.length === 0) return null;
        return (
          <optgroup key={scope} label={SCOPE_LABELS[scope]}>
            {items.map((q) => (
              <option key={q.id} value={q.id}>
                {q.name}
              </option>
            ))}
          </optgroup>
        );
      })}
      {[...new Set(queries.filter((q) => q.scope === "team").map((q) => q.owner_id ?? ""))].map((teamId) => {
        const items = queries.filter((q) => q.scope === "team" && (q.owner_id ?? "") === teamId);
        return (
          <optgroup key={`team:${teamId}`} label={`${teamLabel}: ${items[0]?.owner_name ?? teamId}`}>
            {items.map((q) => (
              <option key={q.id} value={q.id}>
                {q.name}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}
