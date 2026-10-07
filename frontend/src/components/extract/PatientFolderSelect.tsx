import type { PatientFolder, PatientFolderScope } from "../../api/masterClient";
import { buildPatientFolderTree, flattenPatientFolders } from "../patientFolderTree";

const SCOPE_LABELS: Record<PatientFolderScope, string> = {
  facility: "院内共通",
  department: "診療科",
  practitioner: "自分",
};

/** 患者フォルダの選択(持ち主ごとにまとめ、階層は字下げで出す)。 */
export function PatientFolderSelect({
  folders,
  value,
  emptyLabel,
  onChange,
}: {
  folders: PatientFolder[];
  value: number | null;
  emptyLabel: string;
  onChange: (folder: PatientFolder | null) => void;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(folders.find((f) => f.id === Number(e.target.value)) ?? null)}
    >
      <option value="">{emptyLabel}</option>
      {(["practitioner", "department", "facility"] as const).map((scope) => {
        const ownerIds = [...new Set(folders.filter((f) => f.scope === scope).map((f) => f.owner_id))];
        return ownerIds.map((ownerId) => {
          const rows = flattenPatientFolders(buildPatientFolderTree(folders, scope, ownerId));
          if (rows.length === 0) return null;
          const ownerName = scope === "department" ? rows[0].folder.owner_name : null;
          return (
            <optgroup key={`${scope}:${ownerId ?? ""}`} label={ownerName ?? SCOPE_LABELS[scope]}>
              {rows.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.label}
                </option>
              ))}
            </optgroup>
          );
        });
      })}
    </select>
  );
}
