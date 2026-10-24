import { useEffect, useState } from "react";
import { useCareTeams, useQuestionnaireOptions, useSaveCareTeam, useSelfOrganization } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { TrashIcon } from "../components/icons/TrashIcon";
import { Modal } from "../components/Modal";
import { PractitionerSearchModal } from "../components/PractitionerSearchModal";
import {
  CARE_TEAM_KIND_OPTIONS,
  CARE_TEAM_ROLE_OPTIONS,
  buildCareTeam,
  careTeamKind,
  careTeamKindLabel,
  careTeamMembers,
  careTeamName,
  careTeamRoleLabel,
  careTeamRoundTemplate,
  emptyCareTeamForm,
  parseCareTeamForm,
  validateCareTeamForm,
  withCareTeamMembers,
  type CareTeamFormValues,
  type CareTeamMember,
  type CareTeamRole,
} from "../fhir/careTeamHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { questionnaireCanonical } from "../fhir/questionnaireResponseHelpers";

// チーム医療のチームのマスタ(docs/care-team-design.md §1)。左にチーム、右に選んだチームのメンバー。
// 指導医グループと同じ作りで、保存先は上流の CareTeam(メンバーの追加・削除も CareTeam の PUT)。

export function CareTeamPage() {
  const teams = useCareTeams({ includeInactive: true });
  const save = useSaveCareTeam();
  const self = useSelfOrganization();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // チームの編集モーダル。"new" は新規作成。
  const [editing, setEditing] = useState<string | "new" | null>(null);
  // メンバーを選ぶモーダル。開いた役割で追加する。
  const [adding, setAdding] = useState<CareTeamRole | null>(null);

  const selected = teams.data?.find((t) => t.id === selectedId) ?? null;

  useEffect(() => {
    if (!teams.data) return;
    if (selectedId !== null && !teams.data.some((t) => t.id === selectedId)) setSelectedId(null);
    if (selectedId === null && teams.data.length > 0) setSelectedId(teams.data[0].id ?? null);
  }, [teams.data, selectedId]);

  function saveMembers(team: fhir4.CareTeam, members: CareTeamMember[]) {
    save.mutate(withCareTeamMembers(team, members));
  }

  function handleRemoveMember(team: fhir4.CareTeam, member: CareTeamMember) {
    if (!window.confirm(`${member.name || member.practitionerId} を外しますか？`)) return;
    saveMembers(
      team,
      careTeamMembers(team).filter((m) => m.practitionerId !== member.practitionerId),
    );
  }

  function handleChangeRole(team: fhir4.CareTeam, member: CareTeamMember, role: CareTeamRole) {
    saveMembers(
      team,
      careTeamMembers(team).map((m) => (m.practitionerId === member.practitionerId ? { ...m, role } : m)),
    );
  }

  const members = selected ? careTeamMembers(selected) : [];

  return (
    <div className="page">
      <div className="page__header">
        <h1>チーム医療</h1>
        <button type="button" onClick={() => setEditing("new")}>
          チーム追加
        </button>
      </div>

      <ErrorBanner error={teams.error} />
      <ErrorBanner error={save.error} />

      <div className="supervisor-groups">
        <ul className="supervisor-groups__list">
          {(teams.data ?? []).map((team) => (
            <li key={team.id}>
              <button
                type="button"
                className={`supervisor-groups__item${team.id === selectedId ? " is-active" : ""}${team.status === "inactive" ? " is-inactive" : ""}`}
                onClick={() => setSelectedId(team.id ?? null)}
              >
                <span>
                  {careTeamName(team)}
                  {team.status === "inactive" && <span className="order-select__muted">(無効)</span>}
                </span>
                <span className="supervisor-groups__count">{careTeamMembers(team).length}</span>
              </button>
            </li>
          ))}
          {teams.data?.length === 0 && <li className="patient-table__empty">チームがありません。</li>}
        </ul>

        {selected && (
          <div className="supervisor-groups__detail">
            <div className="supervisor-groups__detail-header">
              <h2>{careTeamName(selected)}</h2>
              <div className="supervisor-groups__detail-actions">
                <button type="button" className="rp-card__compact-button" onClick={() => setEditing(selected.id ?? null)}>
                  編集
                </button>
              </div>
            </div>
            <p className="supervisor-groups__note">
              {careTeamKindLabel(careTeamKind(selected))}
              {careTeamRoundTemplate(selected) && <> ・ 回診記録テンプレート: {careTeamRoundTemplate(selected)}</>}
            </p>

            {CARE_TEAM_ROLE_OPTIONS.map((role) => (
              <section key={role.code} className="supervisor-groups__section">
                <div className="supervisor-groups__section-header">
                  <h3>{role.label}</h3>
                  <button type="button" className="rp-card__compact-button" onClick={() => setAdding(role.code)}>
                    追加
                  </button>
                </div>
                <table className="patient-table">
                  <tbody>
                    {members
                      .filter((m) => m.role === role.code)
                      .map((member) => (
                        <tr key={member.practitionerId}>
                          <td>{member.name || member.practitionerId}</td>
                          <td className="patient-table__actions">
                            <select
                              value={member.role}
                              aria-label={`${member.name} の役割`}
                              disabled={save.isPending}
                              onChange={(e) => handleChangeRole(selected, member, e.target.value as CareTeamRole)}
                            >
                              {CARE_TEAM_ROLE_OPTIONS.map((r) => (
                                <option key={r.code} value={r.code}>
                                  {careTeamRoleLabel(r.code)}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="rp-card__icon-button"
                              title={`${member.name} を削除`}
                              aria-label={`${member.name} を削除`}
                              disabled={save.isPending}
                              onClick={() => handleRemoveMember(selected, member)}
                            >
                              <TrashIcon />
                            </button>
                          </td>
                        </tr>
                      ))}
                    {members.every((m) => m.role !== role.code) && (
                      <tr>
                        <td colSpan={2} className="patient-table__empty">
                          {role.label}がいません。
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
        <TeamModal
          team={editing === "new" ? null : (teams.data?.find((t) => t.id === editing) ?? null)}
          submitting={save.isPending}
          error={save.error}
          onSubmit={(values) => {
            const existing = editing === "new" ? undefined : teams.data?.find((t) => t.id === editing);
            const team = buildCareTeam(values, existing ? careTeamMembers(existing) : [], {
              selfOrganizationId: self.selfOrganizationId,
              existing,
            });
            save.mutate(team, {
              onSuccess: (saved) => {
                setSelectedId(saved.id ?? null);
                setEditing(null);
              },
            });
          }}
          onClose={() => setEditing(null)}
        />
      )}

      {adding && selected && (
        <PractitionerSearchModal
          organizationId={self.selfOrganizationId ?? undefined}
          onSelect={(practitioner) => {
            if (!practitioner.id) return;
            const current = careTeamMembers(selected).filter((m) => m.practitionerId !== practitioner.id);
            saveMembers(selected, [
              ...current,
              { practitionerId: practitioner.id, name: practitionerDisplayName(practitioner), role: adding },
            ]);
            setAdding(null);
          }}
          onClose={() => setAdding(null)}
        />
      )}
    </div>
  );
}

// Modal はポータルではないので <form> は書かない。
function TeamModal({
  team,
  submitting,
  error,
  onSubmit,
  onClose,
}: {
  team: fhir4.CareTeam | null;
  submitting: boolean;
  error: unknown;
  onSubmit: (values: CareTeamFormValues) => void;
  onClose: () => void;
}) {
  const [values, setValues] = useState<CareTeamFormValues>(() => (team ? parseCareTeamForm(team) : emptyCareTeamForm()));
  const questionnaires = useQuestionnaireOptions({ status: "active" });
  const message = validateCareTeamForm(values);
  return (
    <Modal title={team ? "チーム編集" : "チーム追加"} onClose={onClose}>
      <ErrorBanner error={error} />
      <div className="prescription-form">
        <label>
          チーム名
          <input type="text" value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} />
        </label>
        <label>
          区分
          <select value={values.kind} onChange={(e) => setValues({ ...values, kind: e.target.value as CareTeamFormValues["kind"] })}>
            {CARE_TEAM_KIND_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          回診記録テンプレート
          <select value={values.roundTemplate} onChange={(e) => setValues({ ...values, roundTemplate: e.target.value })}>
            <option value="">なし</option>
            {questionnaires.questionnaires.map((q) => (
              <option key={q.id} value={questionnaireCanonical(q)}>
                {q.title ?? q.name ?? q.id}
              </option>
            ))}
          </select>
        </label>
        <label className="prescription-form__check">
          <input type="checkbox" checked={values.active} onChange={(e) => setValues({ ...values, active: e.target.checked })} />
          有効
        </label>
        <div className="lab-order-item__actions">
          <button type="button" disabled={Boolean(message) || submitting} onClick={() => onSubmit(values)}>
            {team ? "更新" : "登録"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
