import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type {
  PatientCaution,
  PatientFolder,
  PatientFolderMember,
  PatientFolderScope,
} from "../api/masterClient";
import {
  usePatientCautions,
  usePatientFolderMembers,
  usePatientFolderMutations,
  usePatientFolders,
} from "../api/masterQueries";
import {
  useAllergiesForPatients,
  useFlagsForPatients,
  useInfectionsForPatients,
  usePatientsByIds,
} from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";
import { PatientProfileDrawer, useRowDrawer } from "../components/PatientProfileDrawer";
import { RowPictograms } from "../components/PatientListRowParts";
import { PatientDeceasedMark, PatientKana } from "../components/PatientRowCells";
import { RowMenu } from "../components/RowMenu";
import { WalkInPatientSearch } from "../components/WalkInCheckInModal";
import {
  buildPatientFolderTree,
  flattenPatientFolders,
  patientFolderPath,
  patientFolderSiblings,
  type PatientFolderNode,
} from "../components/patientFolderTree";
import { ageWithMonthsLabel, displayName, genderShortLabel } from "../fhir/patientHelpers";
import { usePatientFolderOwners, type PatientFolderOwner } from "../hooks/usePatientFolderOwners";
import { localDay } from "../lib/dates";
import { useReturnLinkState } from "../returnTo";

// 患者フォルダ。左で持ち主(院内共通 / 診療科 / 自分)ごとのフォルダの木を管理し、右に選んだ
// フォルダの患者を並べる。選んだフォルダは URL に載せ、カルテから戻ったときに同じフォルダを開く。
// 設計は docs/patient-folder-design.md。

const SCOPES: PatientFolderScope[] = ["facility", "department", "practitioner"];

function isScope(value: string | null): value is PatientFolderScope {
  return SCOPES.includes(value as PatientFolderScope);
}

type FolderEditing =
  | { mode: "new"; owner: PatientFolderOwner; parentId: number | null }
  | { mode: "edit"; owner: PatientFolderOwner; folder: PatientFolder }
  | null;

export function PatientFolderPage() {
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  const { owners, myDepartments, departmentId, setDepartmentId, practitionerId } =
    usePatientFolderOwners();
  const foldersQuery = usePatientFolders(departmentId || undefined, practitionerId ?? undefined);
  const items = useMemo(() => foldersQuery.data?.items ?? [], [foldersQuery.data]);
  const mutations = usePatientFolderMutations();

  const [searchParams, setSearchParams] = useSearchParams();
  const scopeParam = searchParams.get("scope");
  const scope: PatientFolderScope = isScope(scopeParam) ? scopeParam : "facility";
  const selectedId = Number(searchParams.get("folder")) || null;
  const includeDescendants = searchParams.get("sub") === "1";

  function updateParams(next: { scope?: PatientFolderScope; folder?: number | null; sub?: boolean }) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next.scope !== undefined) params.set("scope", next.scope);
        if (next.folder !== undefined) {
          if (next.folder === null) params.delete("folder");
          else params.set("folder", String(next.folder));
        }
        if (next.sub !== undefined) {
          if (next.sub) params.set("sub", "1");
          else params.delete("sub");
        }
        return params;
      },
      { replace: true },
    );
  }

  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [folderEditing, setFolderEditing] = useState<FolderEditing>(null);
  const busy = mutations.update.isPending || mutations.remove.isPending;

  const activeOwner = owners.find((o) => o.scope === scope) ?? owners[0];
  const tree = buildPatientFolderTree(items, activeOwner.scope, activeOwner.ownerId);
  // 表示中の持ち主の木にあるフォルダだけを選択として扱う(診療科を切り替えたときなど)。
  const selected = flattenPatientFolders(tree).find((row) => row.id === selectedId)?.folder ?? null;

  function toggleCollapse(id: number) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // 同じ親の兄弟内で隣と入れ替え、変わった行だけ 1 始まりの連番へ振り直す。
  function move(folder: PatientFolder, direction: -1 | 1) {
    const siblings = patientFolderSiblings(items, folder);
    const index = siblings.findIndex((f) => f.id === folder.id);
    const target = siblings[index + direction];
    if (!target) return;
    siblings[index + direction] = siblings[index];
    siblings[index] = target;
    siblings.forEach((sibling, position) => {
      const display_order = position + 1;
      if (sibling.display_order === display_order) return;
      mutations.update.mutate({ id: sibling.id, payload: { display_order } });
    });
  }

  function remove(folder: PatientFolder) {
    const members = folder.member_count > 0 ? `(登録した患者 ${folder.member_count} 人も外れます)` : "";
    if (!window.confirm(`フォルダ「${folder.name}」を削除しますか？${members}`)) return;
    if (selectedId === folder.id) updateParams({ folder: null });
    mutations.remove.mutate(folder.id);
  }

  function renderNode(node: PatientFolderNode) {
    const { folder, children } = node;
    const siblings = patientFolderSiblings(items, folder);
    const index = siblings.findIndex((f) => f.id === folder.id);
    const isCollapsed = collapsed.has(folder.id);
    const isSelected = selectedId === folder.id;
    const canEdit = activeOwner.canEdit;

    return (
      <li key={folder.id}>
        <div
          className={`order-set-tree__row order-set-tree__row--folder${isSelected ? " is-selected" : ""}`}
        >
          {children.length > 0 ? (
            <button
              type="button"
              className="order-set-tree__toggle"
              aria-label={isCollapsed ? `${folder.name} を展開` : `${folder.name} を折りたたむ`}
              onClick={() => toggleCollapse(folder.id)}
            >
              {isCollapsed ? "▶" : "▼"}
            </button>
          ) : (
            <span className="order-set-tree__leaf" aria-hidden="true" />
          )}
          <button
            type="button"
            className="order-set-tree__name"
            onClick={() => updateParams({ folder: folder.id })}
          >
            {folder.name}
            {folder.member_count > 0 && (
              <span className="patient-folder__count">{folder.member_count}</span>
            )}
          </button>
          <span className="schema-master__cat-actions">
            <button
              type="button"
              aria-label={`${folder.name} を上へ`}
              disabled={index <= 0 || busy || !canEdit}
              onClick={() => move(folder, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label={`${folder.name} を下へ`}
              disabled={index === siblings.length - 1 || busy || !canEdit}
              onClick={() => move(folder, 1)}
            >
              ↓
            </button>
            <button
              type="button"
              title="このフォルダの中にフォルダを追加"
              disabled={busy || !canEdit}
              onClick={() => setFolderEditing({ mode: "new", owner: activeOwner, parentId: folder.id })}
            >
              +フォルダ
            </button>
            <button
              type="button"
              title="フォルダ名・親フォルダを変更"
              disabled={busy || !canEdit}
              onClick={() => setFolderEditing({ mode: "edit", owner: activeOwner, folder })}
            >
              編集
            </button>
            <button type="button" title="削除" disabled={busy || !canEdit} onClick={() => remove(folder)}>
              削除
            </button>
          </span>
        </div>
        {!isCollapsed && children.length > 0 && (
          <ul className="order-set-tree__children">{children.map(renderNode)}</ul>
        )}
      </li>
    );
  }

  return (
    <div className="page patient-folder-page">
      <div className="page__header">
        <h1>患者フォルダ</h1>
      </div>

      <ErrorBanner error={foldersQuery.error} />
      <ErrorBanner error={mutations.update.error ?? mutations.remove.error} />

      <div className="schema-master order-set">
        <div className="schema-master__categories order-set__tree">
          <div className="order-set-picker__tabs" role="tablist" aria-label="フォルダの持ち主">
            {owners.map((owner) => (
              <button
                key={owner.scope}
                type="button"
                role="tab"
                aria-selected={owner.scope === activeOwner.scope}
                className={`order-set-picker__tab${
                  owner.scope === activeOwner.scope ? " order-set-picker__tab--active" : ""
                }`}
                onClick={() => updateParams({ scope: owner.scope, folder: null })}
              >
                {owner.label}
              </button>
            ))}
          </div>
          <div className="order-set__tree-head">
            {activeOwner.scope === "department" && myDepartments.length > 1 && (
              <select
                value={departmentId}
                onChange={(e) => {
                  setDepartmentId(e.target.value);
                  updateParams({ folder: null });
                }}
                aria-label="診療科"
              >
                {myDepartments.map((d) => (
                  <option key={d.organizationId} value={d.organizationId}>
                    {d.name}
                  </option>
                ))}
              </select>
            )}
            <span className="schema-master__cat-actions order-set__root-actions">
              <button
                type="button"
                disabled={busy || !activeOwner.canEdit}
                onClick={() => setFolderEditing({ mode: "new", owner: activeOwner, parentId: null })}
              >
                +フォルダ
              </button>
            </span>
          </div>
          {foldersQuery.isPending ? (
            <p className="order-set__empty">読み込み中...</p>
          ) : tree.length === 0 ? (
            <p className="order-set__empty">フォルダはありません。</p>
          ) : (
            <ul className="order-set-tree">{tree.map(renderNode)}</ul>
          )}
        </div>

        <div className="schema-master__schemas patient-folder__members">
          {selected ? (
            <FolderMembers
              key={selected.id}
              folder={selected}
              items={items}
              owner={activeOwner}
              includeDescendants={includeDescendants}
              onIncludeDescendantsChange={(sub) => updateParams({ sub })}
            />
          ) : (
            <p className="karte-right__placeholder">左のフォルダを選ぶと、登録した患者が並びます。</p>
          )}
        </div>
      </div>

      {folderEditing && (
        <FolderEditModal
          editing={folderEditing}
          items={items}
          onClose={() => setFolderEditing(null)}
          onCreated={(folder) => updateParams({ folder: folder.id })}
        />
      )}
    </div>
  );
}

// ---- 右ペイン: フォルダの患者 ----

type MemberEditing =
  | { mode: "note"; member: PatientFolderMember; label: string }
  | { mode: "move"; member: PatientFolderMember; label: string }
  | null;

function FolderMembers({
  folder,
  items,
  owner,
  includeDescendants,
  onIncludeDescendantsChange,
}: {
  folder: PatientFolder;
  items: PatientFolder[];
  owner: PatientFolderOwner;
  includeDescendants: boolean;
  onIncludeDescendantsChange: (value: boolean) => void;
}) {
  const membersQuery = usePatientFolderMembers(folder.id, includeDescendants);
  const members = useMemo(() => membersQuery.data?.items ?? [], [membersQuery.data]);
  const patientIds = useMemo(() => members.map((m) => m.patient_id), [members]);
  const patientsQuery = usePatientsByIds(patientIds);
  const patients = patientsQuery.data;
  const mutations = usePatientFolderMutations();
  const returnLinkState = useReturnLinkState();

  const uniquePatientIds = useMemo(() => [...new Set(patientIds)], [patientIds]);
  const cautions = usePatientCautions();
  const cautionsByCode = useMemo(
    () => new Map<string, PatientCaution>((cautions.data?.items ?? []).map((c) => [c.code, c])),
    [cautions.data],
  );
  const flags = useFlagsForPatients(uniquePatientIds);
  const allergies = useAllergiesForPatients(uniquePatientIds);
  const infections = useInfectionsForPatients(uniquePatientIds);

  const drawer = useRowDrawer();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<MemberEditing>(null);
  const canEdit = owner.canEdit;
  const hasSubfolders = items.some((f) => f.parent_id === folder.id);
  const drawerPatient = drawer.selectedKey ? patients?.get(drawer.selectedKey) : undefined;

  function labelOf(member: PatientFolderMember): string {
    const patient = patients?.get(member.patient_id);
    return patient ? displayName(patient) || member.patient_id : member.patient_id;
  }

  function handleRemove(member: PatientFolderMember) {
    const folderName = items.find((f) => f.id === member.patient_folder_id)?.name ?? folder.name;
    if (!window.confirm(`${labelOf(member)} をフォルダ「${folderName}」から外しますか？`)) return;
    mutations.removeMember.mutate(member.id);
  }

  function menuItems(member: PatientFolderMember) {
    const label = labelOf(member);
    return (
      <>
        <button
          type="button"
          className="row-menu__item"
          disabled={!canEdit}
          onClick={() => setEditing({ mode: "note", member, label })}
        >
          メモ
        </button>
        <button
          type="button"
          className="row-menu__item"
          disabled={!canEdit}
          onClick={() => setEditing({ mode: "move", member, label })}
        >
          移動
        </button>
        <button
          type="button"
          className="row-menu__item row-menu__item--danger"
          disabled={!canEdit || mutations.removeMember.isPending}
          onClick={() => handleRemove(member)}
        >
          削除
        </button>
      </>
    );
  }

  return (
    <>
      <div className="schema-master__pane-header">
        <h2>{patientFolderPath(items, folder.id)}</h2>
        <div className="patient-folder__header-actions">
          {hasSubfolders && (
            <label className="patient-folder__sub-toggle">
              <input
                type="checkbox"
                checked={includeDescendants}
                onChange={(e) => onIncludeDescendantsChange(e.target.checked)}
              />
              下位フォルダを含める
            </label>
          )}
          <button type="button" disabled={!canEdit} onClick={() => setAdding(true)}>
            患者追加
          </button>
        </div>
      </div>

      <ErrorBanner error={membersQuery.error ?? patientsQuery.error} />
      <ErrorBanner error={mutations.removeMember.error} />

      {membersQuery.isPending ? (
        <p>読み込み中...</p>
      ) : members.length === 0 ? (
        <p className="patient-table__empty">登録した患者はいません。</p>
      ) : (
        <table className="patient-table patient-list">
          <thead>
            <tr>
              <th>患者番号</th>
              <th>氏名</th>
              <th>性別</th>
              <th>生年月日</th>
              {includeDescendants && <th>フォルダ</th>}
              <th>メモ</th>
              <th>登録日</th>
              <th>登録者</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const patient = patients?.get(member.patient_id);
              const missing = !patient && !patientsQuery.isPending;
              return (
                <tr key={member.id} {...drawer.rowProps(patient ? member.patient_id : undefined)}>
                  <td>{patient?.identifier?.[0]?.value ?? "-"}</td>
                  <td>
                    {patient ? (
                      <span className="outpatient__name-cell">
                        <span className="outpatient__name">
                          {displayName(patient) || "-"}
                          <PatientKana patient={patient} />
                        </span>
                        <PatientDeceasedMark patient={patient} />
                        <RowPictograms
                          patientId={member.patient_id}
                          flags={flags.byPatient}
                          allergies={allergies.byPatient}
                          infections={infections.byPatient}
                          cautionsByCode={cautionsByCode}
                        />
                      </span>
                    ) : missing ? (
                      <span className="patient-folder__missing">患者が見つかりません({member.patient_id})</span>
                    ) : (
                      "…"
                    )}
                  </td>
                  <td>{patient ? genderShortLabel(patient.gender) : "-"}</td>
                  <td>
                    {patient?.birthDate ?? "-"}
                    {patient?.birthDate && ageWithMonthsLabel(patient.birthDate) && (
                      <span className="patient-cells__age">（{ageWithMonthsLabel(patient.birthDate)}）</span>
                    )}
                  </td>
                  {includeDescendants && (
                    <td>{patientFolderPath(items, member.patient_folder_id)}</td>
                  )}
                  <td className="patient-folder__note">{member.note ?? ""}</td>
                  <td>{localDay(member.created_at)}</td>
                  <td>{member.added_by_name ?? ""}</td>
                  <td className="patient-table__actions">
                    {patient && (
                      <Link
                        className="button"
                        to={`/patients/${member.patient_id}/karte`}
                        state={returnLinkState}
                      >
                        カルテ
                      </Link>
                    )}
                    <RowMenu label={`${labelOf(member)} の操作`}>{menuItems(member)}</RowMenu>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {drawerPatient?.id && (
        <PatientProfileDrawer
          patientId={drawerPatient.id}
          patient={drawerPatient}
          onClose={drawer.close}
        />
      )}
      {adding && (
        <AddPatientModal folder={folder} onClose={() => setAdding(false)} />
      )}
      {editing?.mode === "note" && (
        <MemberNoteModal member={editing.member} label={editing.label} onClose={() => setEditing(null)} />
      )}
      {editing?.mode === "move" && (
        <MemberMoveModal
          member={editing.member}
          label={editing.label}
          items={items}
          owner={owner}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

// ---- モーダル ----

function FolderEditModal({
  editing,
  items,
  onClose,
  onCreated,
}: {
  editing: NonNullable<FolderEditing>;
  items: PatientFolder[];
  onClose: () => void;
  onCreated: (folder: PatientFolder) => void;
}) {
  const mutations = usePatientFolderMutations();
  const { owner } = editing;
  const [name, setName] = useState(editing.mode === "edit" ? editing.folder.name : "");
  const [parentId, setParentId] = useState<string>(() => {
    const initial = editing.mode === "edit" ? editing.folder.parent_id : editing.parentId;
    return initial === null ? "" : String(initial);
  });
  // 編集時は自分自身と子孫を親の選択肢から除いて循環を作らせない。
  const parentOptions = flattenPatientFolders(
    buildPatientFolderTree(items, owner.scope, owner.ownerId),
    editing.mode === "edit" ? editing.folder.id : undefined,
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const parent_id = parentId === "" ? null : Number(parentId);
    if (editing.mode === "new") {
      const created = await mutations.create.mutateAsync({
        scope: owner.scope,
        owner_id: owner.ownerId,
        owner_name: owner.ownerName,
        parent_id,
        name: trimmed,
      });
      onCreated(created);
    } else {
      await mutations.update.mutateAsync({ id: editing.folder.id, payload: { name: trimmed, parent_id } });
    }
    onClose();
  }

  return (
    <Modal title={editing.mode === "new" ? "フォルダ追加" : "フォルダ編集"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="lab-order-item__fields">
          <label>
            フォルダ名
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </label>
          <label>
            親フォルダ
            <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">(最上位)</option>
              {parentOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ErrorBanner error={mutations.create.error ?? mutations.update.error} />
        <div className="lab-order-item__actions">
          <button type="submit" disabled={mutations.create.isPending || mutations.update.isPending}>
            保存
          </button>
        </div>
      </form>
    </Modal>
  );
}

// 患者を検索して 1 人ずつ足す。続けて何人も足せるよう、足しても閉じない。
function AddPatientModal({ folder, onClose }: { folder: PatientFolder; onClose: () => void }) {
  const mutations = usePatientFolderMutations();
  const { practitionerName } = usePatientFolderOwners();
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");

  async function handleSelect(patient: fhir4.Patient) {
    if (!patient.id) return;
    const label = displayName(patient) || patient.id;
    // すでに入っているかは backend が判定し、作った件数で返す。
    const result = await mutations.addMembers.mutateAsync({
      patient_folder_id: folder.id,
      patient_ids: [patient.id],
      note: note.trim() || null,
      added_by_name: practitionerName || null,
    });
    setMessage(result.created > 0 ? `${label} を追加しました。` : `${label} はすでに登録されています。`);
  }

  return (
    <Modal title={`患者追加(${folder.name})`} onClose={onClose} className="modal--wide">
      <div className="lab-order-item__fields">
        <label>
          メモ
          <input type="text" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <WalkInPatientSearch onSelect={handleSelect} />
      {message && (
        <p className="patient-folder__message" role="status">
          {message}
        </p>
      )}
      <ErrorBanner error={mutations.addMembers.error} />
    </Modal>
  );
}

function MemberNoteModal({
  member,
  label,
  onClose,
}: {
  member: PatientFolderMember;
  label: string;
  onClose: () => void;
}) {
  const mutations = usePatientFolderMutations();
  const [note, setNote] = useState(member.note ?? "");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    await mutations.updateMember.mutateAsync({ id: member.id, payload: { note: note.trim() || null } });
    onClose();
  }

  return (
    <Modal title={`メモ(${label})`} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="lab-order-item__fields">
          <label>
            メモ
            <input
              type="text"
              value={note}
              maxLength={200}
              onChange={(e) => setNote(e.target.value)}
              autoFocus
            />
          </label>
        </div>
        <ErrorBanner error={mutations.updateMember.error} />
        <div className="lab-order-item__actions">
          <button type="submit" disabled={mutations.updateMember.isPending}>
            保存
          </button>
        </div>
      </form>
    </Modal>
  );
}

// 同じ持ち主の木の中で別のフォルダへ移す。
function MemberMoveModal({
  member,
  label,
  items,
  owner,
  onClose,
}: {
  member: PatientFolderMember;
  label: string;
  items: PatientFolder[];
  owner: PatientFolderOwner;
  onClose: () => void;
}) {
  const mutations = usePatientFolderMutations();
  const options = flattenPatientFolders(buildPatientFolderTree(items, owner.scope, owner.ownerId));
  const [target, setTarget] = useState(String(member.patient_folder_id));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const patient_folder_id = Number(target);
    if (patient_folder_id !== member.patient_folder_id) {
      await mutations.updateMember.mutateAsync({ id: member.id, payload: { patient_folder_id } });
    }
    onClose();
  }

  return (
    <Modal title={`移動(${label})`} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="lab-order-item__fields">
          <label>
            移動先
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ErrorBanner error={mutations.updateMember.error} />
        <div className="lab-order-item__actions">
          <button type="submit" disabled={mutations.updateMember.isPending}>
            移動
          </button>
        </div>
      </form>
    </Modal>
  );
}
