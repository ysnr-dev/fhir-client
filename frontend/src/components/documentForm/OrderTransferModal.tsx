import { useMemo, useState } from "react";
import { useKarteConditions, useRecentLabResults, useTransferOrders } from "../../api/queries";
import { TRANSFER_KIND_LABELS, type TransferKind } from "../../fhir/documentFormLayout";
import {
  transferKindOfItem,
  transferRowOfItem,
  transferRowsOfConditions,
  transferRowsOfLabResults,
  type TransferRow,
} from "../../fhir/documentFormTransfer";
import { ErrorBanner } from "../ErrorBanner";
import { Modal } from "../Modal";
import { TruncatedNotice } from "../TruncatedNotice";

// 様式文書の項目に、患者のオーダー・病名・検査結果を文字で追記する。開いたタブのぶんだけ読む。
// フォームの中から開くので <form> は書かない(Modal はポータルではない)。

export function OrderTransferModal({
  patientId,
  kinds,
  onAppend,
  onClose,
}: {
  patientId: string;
  kinds: TransferKind[];
  onAppend: (lines: string[]) => void;
  onClose: () => void;
}) {
  const [active, setActive] = useState<TransferKind>(kinds[0] ?? "prescription");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const orderKinds: TransferKind[] = ["prescription", "injection", "order"];
  const orders = useTransferOrders(patientId, orderKinds.includes(active));
  const conditions = useKarteConditions(active === "condition" ? patientId : undefined);
  const labs = useRecentLabResults(active === "lab" ? patientId : undefined);

  const rows = useMemo<TransferRow[]>(() => {
    if (active === "condition") return transferRowsOfConditions(conditions.conditions);
    if (active === "lab") return transferRowsOfLabResults(labs.observations);
    return (orders.data?.items ?? [])
      .filter(({ item }) => transferKindOfItem(item) === active)
      .map(({ day, item }) => transferRowOfItem(day, item));
  }, [active, conditions.conditions, labs.observations, orders.data]);

  const loading =
    active === "condition" ? conditions.isLoading : active === "lab" ? labs.isLoading : orders.isLoading;
  const error = active === "condition" ? conditions.error : active === "lab" ? labs.error : orders.error;

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function handleAppend() {
    const lines = rows.filter((row) => selected.has(row.id)).flatMap((row) => row.lines);
    if (lines.length === 0) return;
    onAppend(lines);
    onClose();
  }

  return (
    <Modal title="転記" onClose={onClose} className="modal--wide">
      <div className="order-transfer">
        {kinds.length > 1 && (
          <div className="order-transfer__tabs" role="tablist">
            {kinds.map((kind) => (
              <button
                type="button"
                key={kind}
                role="tab"
                aria-selected={kind === active}
                className={`rp-card__compact-button${kind === active ? " is-selected" : ""}`}
                onClick={() => {
                  setActive(kind);
                  setSelected(new Set());
                }}
              >
                {TRANSFER_KIND_LABELS[kind]}
              </button>
            ))}
          </div>
        )}
        <ErrorBanner error={error} />
        {loading ? (
          <p>読み込み中...</p>
        ) : rows.length === 0 ? (
          <p className="order-select__muted">該当なし</p>
        ) : (
          <ul className="discharge-summary__checklist order-transfer__list">
            {rows.map((row) => (
              <li key={row.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.has(row.id)}
                    onChange={(e) => toggle(row.id, e.target.checked)}
                  />
                  {row.label}
                </label>
              </li>
            ))}
          </ul>
        )}
        <TruncatedNotice show={orderKinds.includes(active) && orders.data?.truncated} />
        <div className="order-transfer__actions">
          <button type="button" disabled={selected.size === 0} onClick={handleAppend}>
            転記
          </button>
          <button type="button" onClick={onClose}>
            キャンセル
          </button>
        </div>
      </div>
    </Modal>
  );
}
