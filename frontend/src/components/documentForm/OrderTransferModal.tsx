import { useMemo, useState } from "react";
import { useKarteConditions, useTransferLabResults, useTransferOrders } from "../../api/queries";
import { TRANSFER_KIND_LABELS, type TransferKind } from "../../fhir/documentFormLayout";
import {
  transferKindOfItem,
  transferRowOfItem,
  transferRowsOfConditions,
  transferRowsOfLabResults,
  type TransferRow,
} from "../../fhir/documentFormTransfer";
import { addMonths, today } from "../../lib/dates";
import { ErrorBanner } from "../ErrorBanner";
import { Modal } from "../Modal";
import { TruncatedNotice } from "../TruncatedNotice";

// 様式文書の項目に、患者のオーダー・病名・検査結果を文字で追記する。開いたタブのぶんだけ、
// 選んだ期間のぶんだけ読む(病名は期間で絞らない)。
// フォームの中から開くので <form> は書かない(Modal はポータルではない)。

/** 期間の選択肢。0 は全期間。 */
const PERIOD_OPTIONS: { months: number; label: string }[] = [
  { months: 1, label: "1か月" },
  { months: 3, label: "3か月" },
  { months: 6, label: "6か月" },
  { months: 12, label: "1年" },
  { months: 0, label: "全期間" },
];
const DEFAULT_PERIOD_MONTHS = 3;

const ORDER_KINDS: TransferKind[] = ["prescription", "injection", "order"];

/** 展開して見せる内容があるか(1 行の行は一覧の表示そのままなので展開しない)。 */
function expandable(row: TransferRow): boolean {
  return row.lines.length > 1 || (row.lines.length === 1 && row.lines[0] !== row.label);
}

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
  const [periodMonths, setPeriodMonths] = useState(DEFAULT_PERIOD_MONTHS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const since = useMemo(() => (periodMonths ? addMonths(today(), -periodMonths) : ""), [periodMonths]);
  const isOrderTab = ORDER_KINDS.includes(active);
  const orders = useTransferOrders(patientId, since, isOrderTab);
  const conditions = useKarteConditions(active === "condition" ? patientId : undefined);
  const labs = useTransferLabResults(patientId, since, active === "lab");

  const rows = useMemo<TransferRow[]>(() => {
    if (active === "condition") return transferRowsOfConditions(conditions.conditions);
    if (active === "lab") return transferRowsOfLabResults(labs.data?.observations ?? []);
    return (orders.data?.items ?? [])
      .filter(({ item }) => transferKindOfItem(item) === active)
      .map(({ day, item }) => transferRowOfItem(day, item));
  }, [active, conditions.conditions, labs.data, orders.data]);

  const loading =
    active === "condition" ? conditions.isLoading : active === "lab" ? labs.isLoading : orders.isLoading;
  const error = active === "condition" ? conditions.error : active === "lab" ? labs.error : orders.error;
  const truncated = active === "lab" ? labs.data?.truncated : isOrderTab ? orders.data?.truncated : false;
  const expandableRows = rows.filter(expandable);
  const allExpanded = expandableRows.length > 0 && expandableRows.every((row) => expanded.has(row.id));

  function reset() {
    setSelected(new Set());
    setExpanded(new Set());
  }

  function toggleIn(set: Set<string>, id: string, on: boolean): Set<string> {
    const next = new Set(set);
    if (on) next.add(id);
    else next.delete(id);
    return next;
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
        {(kinds.length > 1 || active !== "condition" || expandableRows.length > 0) && (
          <div className="order-transfer__toolbar">
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
                      reset();
                    }}
                  >
                    {TRANSFER_KIND_LABELS[kind]}
                  </button>
                ))}
              </div>
          )}
          <div className="order-transfer__controls">
            {active !== "condition" && (
              <select
                aria-label="期間"
                value={periodMonths}
                onChange={(e) => {
                  setPeriodMonths(Number(e.target.value));
                  reset();
                }}
              >
                {PERIOD_OPTIONS.map((option) => (
                  <option key={option.months} value={option.months}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
            {expandableRows.length > 0 && (
              <button
                type="button"
                className="rp-card__compact-button"
                onClick={() =>
                  setExpanded(allExpanded ? new Set() : new Set(expandableRows.map((row) => row.id)))
                }
              >
                {allExpanded ? "すべて閉じる" : "すべて展開"}
              </button>
            )}
          </div>
        </div>
        )}
        <ErrorBanner error={error} />
        {loading ? (
          <p>読み込み中...</p>
        ) : rows.length === 0 ? (
          <p className="order-select__muted">該当なし</p>
        ) : (
          <ul className="discharge-summary__checklist order-transfer__list">
            {rows.map((row) => {
              const isOpen = expanded.has(row.id);
              return (
                <li key={row.id}>
                  <div className="order-transfer__row">
                    <label>
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={(e) => setSelected((prev) => toggleIn(prev, row.id, e.target.checked))}
                      />
                      {row.label}
                    </label>
                    {expandable(row) && (
                      <button
                        type="button"
                        className="order-transfer__toggle"
                        aria-expanded={isOpen}
                        aria-label={`${row.label} の内容を${isOpen ? "閉じる" : "開く"}`}
                        onClick={() => setExpanded((prev) => toggleIn(prev, row.id, !isOpen))}
                      >
                        {isOpen ? "▾" : "▸"}
                      </button>
                    )}
                  </div>
                  {isOpen && <pre className="order-transfer__preview">{row.lines.join("\n")}</pre>}
                </li>
              );
            })}
          </ul>
        )}
        <TruncatedNotice show={truncated} />
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
