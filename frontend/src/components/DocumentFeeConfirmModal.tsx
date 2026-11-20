import { useMemo, useState } from "react";
import type { ManagementFeeItem } from "../api/masterClient";
import { usePatientMedicalManagementProcedures } from "../api/queries";
import {
  formatPoints,
  historyLabel,
  medicalManagementHistoryByCode,
} from "../fhir/medicalManagementOrderHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

// 文書作成の「作成」で挟む、指導・管理料の算定の確認(docs/medical-management-order-design.md §6)。
// 作る文書を要件に持つ項目を並べ、チェックした項目を文書と同じ transaction で算定する。
// 候補が 1 つならチェック済み、複数なら択一のことがあるので全部外して出す。
// 当月の上限に達した項目と、先に算定してこの文書を待っている項目は外して出す
// (入れ直せる。上限は表示のみ)。

interface DocumentFeeConfirmModalProps {
  patientId: string;
  /** 文書の診療日。算定日になる。 */
  date: string;
  candidates: ManagementFeeItem[];
  /** 先に算定して、この文書の作成を待っている項目のレセ電算コード。 */
  awaitedCodes: Set<string>;
  onConfirm: (items: ManagementFeeItem[]) => void;
  onClose: () => void;
}

export function DocumentFeeConfirmModal({
  patientId,
  date,
  candidates,
  awaitedCodes,
  onConfirm,
  onClose,
}: DocumentFeeConfirmModalProps) {
  const records = usePatientMedicalManagementProcedures(patientId);
  const history = useMemo(
    () => medicalManagementHistoryByCode(records.data?.procedures ?? [], date),
    [records.data, date],
  );
  // null の間は初期値(履歴が届いてから決まる)を使う。
  const [picked, setPicked] = useState<Set<string> | null>(null);

  const initial = useMemo(() => {
    const only = candidates.length === 1 ? candidates[0] : undefined;
    if (!only || awaitedCodes.has(only.receipt_code)) return new Set<string>();
    const count = history.get(only.receipt_code)?.monthCount ?? 0;
    return only.monthly_limit && count + 1 > only.monthly_limit ? new Set<string>() : new Set([only.receipt_code]);
  }, [candidates, awaitedCodes, history]);
  const checked = picked ?? initial;

  function toggle(code: string, on: boolean) {
    const next = new Set(checked);
    if (on) next.add(code);
    else next.delete(code);
    setPicked(next);
  }

  return (
    <Modal title="算定" onClose={onClose} className="document-fee-modal">
      <ErrorBanner error={records.error} />
      <ul className="medical-management-form__items">
        {candidates.map((item) => {
          const label = historyLabel(history.get(item.receipt_code), item.monthly_limit);
          return (
            <li key={item.id}>
              <label className="medical-management-form__item">
                <input
                  type="checkbox"
                  checked={checked.has(item.receipt_code)}
                  onChange={(e) => toggle(item.receipt_code, e.target.checked)}
                />
                <span className="medical-management-form__name">{item.name}</span>
                <span className="medical-management-form__points">{formatPoints(item.receipt_points)}</span>
                {label && <span className="medical-management-form__history">{label}</span>}
              </label>
            </li>
          );
        })}
      </ul>
      <div className="plain-text-modal__actions">
        <button type="button" onClick={onClose}>
          取消
        </button>
        <button
          type="button"
          disabled={records.isPending}
          onClick={() => onConfirm(candidates.filter((item) => checked.has(item.receipt_code)))}
        >
          作成
        </button>
      </div>
    </Modal>
  );
}
