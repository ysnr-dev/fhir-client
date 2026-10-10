import { useState, type FormEvent } from "react";
import { definitionOwnerKey, type DefinitionOwnerOption } from "../../hooks/useDefinitionOwners";
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
  const [ownerKey, setOwnerKey] = useState(() => {
    const first = editable.find((o) => o.scope === "practitioner") ?? editable[0];
    return first ? definitionOwnerKey(first) : "";
  });
  const owner = editable.find((o) => definitionOwnerKey(o) === ownerKey);

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
          <select value={ownerKey} onChange={(e) => setOwnerKey(e.target.value)}>
            {editable.map((o) => (
              <option key={definitionOwnerKey(o)} value={definitionOwnerKey(o)}>
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
