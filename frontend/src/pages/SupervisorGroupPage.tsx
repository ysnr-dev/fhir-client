import { useEffect, useState } from "react";
import type { SupervisorGroup, SupervisorGroupMember, SupervisorRole } from "../api/masterClient";
import { useSupervisorGroupMutations, useSupervisorGroups } from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { TrashIcon } from "../components/icons/TrashIcon";
import { Modal } from "../components/Modal";
import { PractitionerSearchModal } from "../components/PractitionerSearchModal";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";

// 指導医グループのマスタ(docs/countersign-design.md)。左にグループ、右に選んだグループの
// 指導医と研修医を並べる。構成員は医療従事者から選び、表示名を焼き付ける。

const ROLE_LABELS: Record<SupervisorRole, string> = { supervisor: "指導医", trainee: "研修医" };

export function SupervisorGroupPage() {
  const groups = useSupervisorGroups();
  const mutations = useSupervisorGroupMutations();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // グループの編集モーダル。"new" は新規作成。
  const [editing, setEditing] = useState<number | "new" | null>(null);
  // 構成員を選ぶモーダル。開いた役割で追加する。
  const [adding, setAdding] = useState<SupervisorRole | null>(null);

  const selected = groups.data?.find((g) => g.id === selectedId) ?? null;

  // グループが消えたら選択を外し、まだ何も選んでいなければ先頭を選ぶ。
  useEffect(() => {
    if (!groups.data) return;
    if (selectedId !== null && !groups.data.some((g) => g.id === selectedId)) setSelectedId(null);
    if (selectedId === null && groups.data.length > 0) setSelectedId(groups.data[0].id);
  }, [groups.data, selectedId]);

  function handleRemoveGroup(group: SupervisorGroup) {
    if (!window.confirm(`グループ「${group.name}」を削除しますか？`)) return;
    mutations.removeGroup.mutate(group.id);
  }

  function handleRemoveMember(member: SupervisorGroupMember) {
    if (!window.confirm(`${member.display_name || member.practitioner_fhir_id} を外しますか？`)) return;
    mutations.removeMember.mutate(member.id);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>指導医グループ</h1>
        <button type="button" onClick={() => setEditing("new")}>
          グループ追加
        </button>
      </div>

      <ErrorBanner error={groups.error} />
      <ErrorBanner error={mutations.createMember.error ?? mutations.updateMember.error ?? mutations.removeMember.error} />
      <ErrorBanner error={mutations.removeGroup.error} />

      <div className="supervisor-groups">
        <ul className="supervisor-groups__list">
          {(groups.data ?? []).map((group) => (
            <li key={group.id}>
              <button
                type="button"
                className={`supervisor-groups__item${group.id === selectedId ? " is-active" : ""}`}
                onClick={() => setSelectedId(group.id)}
              >
                {group.name}
                <span className="supervisor-groups__count">{group.members.length}</span>
              </button>
            </li>
          ))}
          {groups.data?.length === 0 && <li className="patient-table__empty">グループがありません。</li>}
        </ul>

        {selected && (
          <div className="supervisor-groups__detail">
            <div className="supervisor-groups__detail-header">
              <h2>{selected.name}</h2>
              <div className="supervisor-groups__detail-actions">
                <button type="button" className="rp-card__compact-button" onClick={() => setEditing(selected.id)}>
                  編集
                </button>
                <button
                  type="button"
                  className="rp-card__icon-button"
                  title="グループを削除"
                  aria-label="グループを削除"
                  onClick={() => handleRemoveGroup(selected)}
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
            {selected.note && <p className="supervisor-groups__note">{selected.note}</p>}

            {(["supervisor", "trainee"] as const).map((role) => (
              <section key={role} className="supervisor-groups__section">
                <div className="supervisor-groups__section-header">
                  <h3>{ROLE_LABELS[role]}</h3>
                  <button type="button" className="rp-card__compact-button" onClick={() => setAdding(role)}>
                    追加
                  </button>
                </div>
                <table className="patient-table">
                  <tbody>
                    {selected.members
                      .filter((m) => m.role === role)
                      .map((member) => (
                        <tr key={member.id}>
                          <td>{member.display_name || member.practitioner_fhir_id}</td>
                          <td className="patient-table__actions">
                            <select
                              value={member.role}
                              aria-label={`${member.display_name} の役割`}
                              onChange={(e) =>
                                mutations.updateMember.mutate({
                                  id: member.id,
                                  payload: { role: e.target.value as SupervisorRole },
                                })
                              }
                            >
                              {(Object.keys(ROLE_LABELS) as SupervisorRole[]).map((r) => (
                                <option key={r} value={r}>
                                  {ROLE_LABELS[r]}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="rp-card__icon-button"
                              title={`${member.display_name} を削除`}
                              aria-label={`${member.display_name} を削除`}
                              onClick={() => handleRemoveMember(member)}
                            >
                              <TrashIcon />
                            </button>
                          </td>
                        </tr>
                      ))}
                    {selected.members.every((m) => m.role !== role) && (
                      <tr>
                        <td colSpan={2} className="patient-table__empty">
                          {ROLE_LABELS[role]}がいません。
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </section>
            ))}
          </div>
        )}
      </div>

      {editing !== null && (
        <GroupModal
          group={editing === "new" ? null : (groups.data?.find((g) => g.id === editing) ?? null)}
          submitting={mutations.createGroup.isPending || mutations.updateGroup.isPending}
          error={mutations.createGroup.error ?? mutations.updateGroup.error}
          onSubmit={(payload) => {
            const done = { onSuccess: () => setEditing(null) };
            if (editing === "new") {
              mutations.createGroup.mutate(payload, {
                onSuccess: (group) => {
                  setSelectedId(group.id);
                  setEditing(null);
                },
              });
            } else {
              mutations.updateGroup.mutate({ id: editing, payload }, done);
            }
          }}
          onClose={() => setEditing(null)}
        />
      )}

      {adding && selected && (
        <PractitionerSearchModal
          onSelect={(practitioner) => {
            if (!practitioner.id) return;
            mutations.createMember.mutate({
              supervisor_group_id: selected.id,
              practitioner_fhir_id: practitioner.id,
              display_name: practitionerDisplayName(practitioner),
              role: adding,
            });
            setAdding(null);
          }}
          onClose={() => setAdding(null)}
        />
      )}
    </div>
  );
}

// Modal はポータルではないので <form> は書かない。
function GroupModal({
  group,
  submitting,
  error,
  onSubmit,
  onClose,
}: {
  group: SupervisorGroup | null;
  submitting: boolean;
  error: unknown;
  onSubmit: (payload: { name: string; note: string | null }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(group?.name ?? "");
  const [note, setNote] = useState(group?.note ?? "");
  return (
    <Modal title={group ? "グループ編集" : "グループ追加"} onClose={onClose}>
      <ErrorBanner error={error} />
      <div className="prescription-form">
        <label>
          名称
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          備考
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="lab-order-item__actions">
          <button
            type="button"
            disabled={!name.trim() || submitting}
            onClick={() => onSubmit({ name: name.trim(), note: note.trim() || null })}
          >
            {group ? "更新" : "登録"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
