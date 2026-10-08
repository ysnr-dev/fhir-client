import { useState, type FormEvent } from "react";
import type { DefinitionOwnerOption } from "../../hooks/useDefinitionOwners";
import { ErrorBanner } from "../ErrorBanner";
import { Modal } from "../Modal";

/** データ抽出の条件を名前と持ち主を付けて保存する(「患者」タブと記録を表にするタブで共通)。 */
export function SaveQueryModal({
  owners,
  initialName,
  pending,
  error,
  onClose,
  onSave,
}: {
  owners: DefinitionOwnerOption[];
  initialName: string;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (name: string, owner: DefinitionOwnerOption) => void;
}) {
  const editable = owners.filter((o) => o.canEdit);
  const [name, setName] = useState(initialName);
  const [scope, setScope] = useState(editable.find((o) => o.scope === "practitioner")?.scope ?? editable[0]?.scope);
  const owner = editable.find((o) => o.scope === scope);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !owner) return;
    onSave(name.trim(), owner);
  }

  return (
    <Modal title="条件を保存" onClose={onClose}>
      <form className="data-extract__save" onSubmit={handleSubmit}>
        <ErrorBanner error={error} />
        <label className="extract-field">
          名前
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="extract-field">
          保存先
          <select value={scope ?? ""} onChange={(e) => setScope(e.target.value as DefinitionOwnerOption["scope"])}>
            {editable.map((o) => (
              <option key={o.scope} value={o.scope}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <div className="lab-order-item__actions">
          <button type="submit" disabled={pending || !name.trim() || !owner}>
            {pending ? "保存中..." : "保存"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
