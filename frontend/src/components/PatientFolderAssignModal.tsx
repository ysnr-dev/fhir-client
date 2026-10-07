import { useState } from "react";
import type { PatientFolderScope } from "../api/masterClient";
import {
  usePatientFolderMembershipsOf,
  usePatientFolderMutations,
  usePatientFolders,
} from "../api/masterQueries";
import { usePatientFolderOwners } from "../hooks/usePatientFolderOwners";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { buildPatientFolderTree, flattenPatientFolders } from "./patientFolderTree";

// 1 人の患者をどのフォルダに入れるか(患者検索の行メニューから開く)。持ち主ごとの木に
// チェックボックスを並べ、付けたら入れ、外したら出す(その場で保存する)。
export function PatientFolderAssignModal({
  patientId,
  patientLabel,
  onClose,
}: {
  patientId: string;
  patientLabel: string;
  onClose: () => void;
}) {
  const { owners, myDepartments, departmentId, setDepartmentId, practitionerId, practitionerName } =
    usePatientFolderOwners();
  const folders = usePatientFolders(departmentId || undefined, practitionerId ?? undefined);
  const memberships = usePatientFolderMembershipsOf(
    patientId,
    departmentId || undefined,
    practitionerId ?? undefined,
  );
  const mutations = usePatientFolderMutations();
  // 既定は自分のフォルダ(医療従事者と紐付かないログインでは院内共通)。
  const [chosenScope, setScope] = useState<PatientFolderScope | null>(null);
  const scope = chosenScope ?? (practitionerId ? "practitioner" : "facility");

  const owner = owners.find((o) => o.scope === scope) ?? owners[0];
  const rows = flattenPatientFolders(
    buildPatientFolderTree(folders.data?.items ?? [], owner.scope, owner.ownerId),
  );
  const memberByFolder = new Map(
    (memberships.data?.items ?? []).map((m) => [m.patient_folder_id, m]),
  );
  const busy =
    mutations.addMembers.isPending || mutations.removeMember.isPending || memberships.isFetching;

  // 持ち主ごとの登録数(タブに添える)。
  const countByScope = new Map<PatientFolderScope, number>();
  for (const folder of folders.data?.items ?? []) {
    if (memberByFolder.has(folder.id)) {
      countByScope.set(folder.scope, (countByScope.get(folder.scope) ?? 0) + 1);
    }
  }

  function toggle(folderId: number, checked: boolean) {
    if (checked) {
      mutations.addMembers.mutate({
        patient_folder_id: folderId,
        patient_ids: [patientId],
        added_by_name: practitionerName || null,
      });
    } else {
      const member = memberByFolder.get(folderId);
      if (member) mutations.removeMember.mutate(member.id);
    }
  }

  return (
    <Modal title={`患者フォルダ(${patientLabel})`} onClose={onClose}>
      <div className="order-set-picker__tabs" role="tablist" aria-label="フォルダの持ち主">
        {owners.map((o) => (
          <button
            key={o.scope}
            type="button"
            role="tab"
            aria-selected={o.scope === owner.scope}
            className={`order-set-picker__tab${o.scope === owner.scope ? " order-set-picker__tab--active" : ""}`}
            onClick={() => setScope(o.scope)}
          >
            {o.label}
            {(countByScope.get(o.scope) ?? 0) > 0 && (
              <span className="patient-folder__count">{countByScope.get(o.scope)}</span>
            )}
          </button>
        ))}
      </div>
      {owner.scope === "department" && myDepartments.length > 1 && (
        <div className="order-set__tree-head">
          <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} aria-label="診療科">
            {myDepartments.map((d) => (
              <option key={d.organizationId} value={d.organizationId}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <ErrorBanner error={folders.error ?? memberships.error} />
      <ErrorBanner error={mutations.addMembers.error ?? mutations.removeMember.error} />
      {folders.isPending ? (
        <p>読み込み中...</p>
      ) : rows.length === 0 ? (
        <p className="order-set__empty">フォルダはありません。</p>
      ) : (
        <ul className="patient-folder__assign-list">
          {rows.map((row) => (
            <li key={row.id} style={{ paddingLeft: `${row.depth * 18}px` }}>
              <label>
                <input
                  type="checkbox"
                  checked={memberByFolder.has(row.id)}
                  disabled={busy || !owner.canEdit}
                  onChange={(e) => toggle(row.id, e.target.checked)}
                />
                {row.folder.name}
              </label>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
