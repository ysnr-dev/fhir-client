import type { ProblemRef } from "../fhir/conditionHelpers";

// 診療情報(診療記録・処方)の対象プロブレムを選ぶセレクト。既に紐付いているプロブレムが
// 候補に無い(削除された)場合も、保存済みの表示名で選択肢に残して紐付けを失わせない。

export function ProblemSelect({
  value,
  options,
  onChange,
}: {
  value: ProblemRef | null;
  options: ProblemRef[];
  onChange: (problem: ProblemRef | null) => void;
}) {
  const isMissing = Boolean(value) && !options.some((o) => o.conditionId === value?.conditionId);

  return (
    <select
      value={value?.conditionId ?? ""}
      onChange={(e) => {
        const conditionId = e.target.value;
        if (!conditionId) return onChange(null);
        onChange(options.find((o) => o.conditionId === conditionId) ?? value);
      }}
      aria-label="対象プロブレム"
      title="この情報が対象とするプロブレム"
    >
      <option value="">(プロブレムなし)</option>
      {options.map((o) => (
        <option key={o.conditionId} value={o.conditionId}>
          {o.display}
        </option>
      ))}
      {isMissing && value && (
        <option value={value.conditionId}>{value.display || "(不明)"} (削除済み)</option>
      )}
    </select>
  );
}
