import type { ExtractQuery } from "../../api/masterClient";

const SCOPE_LABELS: Record<string, string> = { facility: "院内共通", department: "診療科", practitioner: "自分" };

/** 保存した患者の条件の選択(持ち主ごとにまとめる)。 */
export function ExtractQuerySelect({
  queries,
  value,
  emptyLabel,
  onChange,
}: {
  queries: ExtractQuery[];
  value: number | null;
  emptyLabel: string;
  onChange: (query: ExtractQuery | null) => void;
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
    </select>
  );
}
