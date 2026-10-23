import { useState } from "react";
import {
  CLINICAL_DASHBOARD_CARD_KINDS,
  clinicalDashboardCardLabel,
  type ClinicalDashboardCardKind,
} from "../../fhir/clinicalDashboardLayout";
import { Modal } from "../Modal";

/** 診療ダッシュボードにカードを足す(種別・タイトル)。 */
export function AddClinicalCardModal({
  onAdd,
  onClose,
}: {
  onAdd: (card: { kind: ClinicalDashboardCardKind; title?: string }) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<ClinicalDashboardCardKind>(CLINICAL_DASHBOARD_CARD_KINDS[0].key);
  const [title, setTitle] = useState("");

  return (
    <Modal title="カードを追加" onClose={onClose}>
      <div className="data-extract__save">
        <label className="extract-field">
          種別
          <select value={kind} onChange={(e) => setKind(e.target.value as ClinicalDashboardCardKind)}>
            {CLINICAL_DASHBOARD_CARD_KINDS.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="extract-field">
          タイトル
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={clinicalDashboardCardLabel(kind)}
          />
        </label>
        <div className="lab-order-item__actions">
          <button type="button" onClick={() => onAdd({ kind, title: title.trim() || undefined })}>
            追加
          </button>
        </div>
      </div>
    </Modal>
  );
}
