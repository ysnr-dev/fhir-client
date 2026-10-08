import { useState } from "react";
import type { PatientFolderScope } from "../../api/masterClient";
import { usePatientFolderMutations, usePatientFolders } from "../../api/masterQueries";
import { usePatientFolderOwners } from "../../hooks/usePatientFolderOwners";
import { ErrorBanner } from "../ErrorBanner";
import { Modal } from "../Modal";
import { buildPatientFolderTree, flattenPatientFolders, patientFolderPath } from "../patientFolderTree";

/** 1 回のまとめ登録で送る患者の数(backend の上限)。 */
const MEMBER_CHUNK = 500;

/**
 * データ抽出の結果の患者を、患者フォルダにまとめて入れるボタン(docs/data-extract-design.md §16)。
 * 押すとモーダルで登録先(既存のフォルダか、その場で作るフォルダ)を選ぶ。
 */
export function FolderRegisterButton({ patientIds }: { patientIds: string[] }) {
  const [open, setOpen] = useState(false);
  const ids = [...new Set(patientIds.filter(Boolean))];
  return (
    <>
      <button type="button" disabled={ids.length === 0} onClick={() => setOpen(true)}>
        フォルダ登録
      </button>
      {open && <FolderRegisterModal patientIds={ids} onClose={() => setOpen(false)} />}
    </>
  );
}

type Target = "existing" | "new";

function FolderRegisterModal({ patientIds, onClose }: { patientIds: string[]; onClose: () => void }) {
  const { owners, myDepartments, departmentId, setDepartmentId, practitionerId, practitionerName } =
    usePatientFolderOwners();
  const folders = usePatientFolders(departmentId || undefined, practitionerId ?? undefined);
  const mutations = usePatientFolderMutations();
  // 既定は自分のフォルダ(医療従事者と紐付かないログインでは院内共通)。
  const [chosenScope, setScope] = useState<PatientFolderScope | null>(null);
  const scope = chosenScope ?? (practitionerId ? "practitioner" : "facility");
  const owner = owners.find((o) => o.scope === scope) ?? owners[0];
  const items = folders.data?.items ?? [];
  const rows = flattenPatientFolders(buildPatientFolderTree(items, owner.scope, owner.ownerId));

  const [target, setTarget] = useState<Target>("existing");
  const [folderId, setFolderId] = useState("");
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState("");

  // 持ち主を変えたら、前の持ち主のフォルダの選択は外す。
  function changeScope(next: PatientFolderScope) {
    setScope(next);
    setFolderId("");
    setParentId("");
  }

  const ready = owner.canEdit && (target === "existing" ? Boolean(folderId) : Boolean(name.trim()));

  async function handleRegister() {
    setSaving(true);
    setError(null);
    setMessage("");
    try {
      let folder = items.find((f) => String(f.id) === folderId);
      if (target === "new") {
        folder = await mutations.create.mutateAsync({
          scope: owner.scope,
          owner_id: owner.ownerId,
          owner_name: owner.ownerName,
          parent_id: parentId ? Number(parentId) : null,
          name: name.trim(),
        });
      }
      if (!folder) return;
      let created = 0;
      let skipped = 0;
      for (let i = 0; i < patientIds.length; i += MEMBER_CHUNK) {
        const result = await mutations.addMembers.mutateAsync({
          patient_folder_id: folder.id,
          patient_ids: patientIds.slice(i, i + MEMBER_CHUNK),
          note: note.trim() || null,
          added_by_name: practitionerName || null,
        });
        created += result.created;
        skipped += result.skipped;
      }
      // 作ったフォルダはまだ一覧(items)に無いので、親の道筋に名前を足して出す。
      const path =
        target === "existing"
          ? patientFolderPath(items, folder.id)
          : parentId
            ? `${patientFolderPath(items, Number(parentId))} / ${folder.name}`
            : folder.name;
      setMessage(
        `「${path}」に ${created} 人を登録しました。` + (skipped > 0 ? `(${skipped} 人は登録済み)` : ""),
      );
      // 作ったフォルダは次から既存のフォルダとして選べるようにする。
      if (target === "new") {
        setTarget("existing");
        setFolderId(String(folder.id));
        setName("");
      }
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`患者フォルダに登録(${patientIds.length} 人)`} onClose={onClose}>
      <div className="order-set-picker__tabs" role="tablist" aria-label="フォルダの持ち主">
        {owners.map((o) => (
          <button
            key={o.scope}
            type="button"
            role="tab"
            aria-selected={o.scope === owner.scope}
            className={`order-set-picker__tab${o.scope === owner.scope ? " order-set-picker__tab--active" : ""}`}
            onClick={() => changeScope(o.scope)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {owner.scope === "department" && myDepartments.length > 1 && (
        <div className="order-set__tree-head">
          <select
            value={departmentId}
            onChange={(e) => {
              setDepartmentId(e.target.value);
              setFolderId("");
              setParentId("");
            }}
            aria-label="診療科"
          >
            {myDepartments.map((d) => (
              <option key={d.organizationId} value={d.organizationId}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <ErrorBanner error={folders.error} />
      <div className="extract-checks folder-register__target" role="radiogroup" aria-label="登録先">
        <label className="extract-checks__item">
          <input type="radio" checked={target === "existing"} onChange={() => setTarget("existing")} />
          既存のフォルダ
        </label>
        <label className="extract-checks__item">
          <input type="radio" checked={target === "new"} onChange={() => setTarget("new")} />
          新しいフォルダ
        </label>
      </div>
      <div className="lab-order-item__fields">
        {target === "existing" ? (
          <label>
            フォルダ
            <select value={folderId} onChange={(e) => setFolderId(e.target.value)} disabled={!owner.canEdit}>
              <option value="">選択してください</option>
              {rows.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label>
              フォルダ名
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} disabled={!owner.canEdit} />
            </label>
            <label>
              親フォルダ
              <select value={parentId} onChange={(e) => setParentId(e.target.value)} disabled={!owner.canEdit}>
                <option value="">(最上位)</option>
                {rows.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <label>
          メモ
          <input type="text" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <ErrorBanner error={error} />
      {message && <p className="order-select__muted">{message}</p>}
      <div className="lab-order-item__actions">
        <button type="button" disabled={!ready || saving} onClick={() => void handleRegister()}>
          登録
        </button>
      </div>
    </Modal>
  );
}
