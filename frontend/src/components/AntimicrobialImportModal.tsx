import { useMemo, useState } from "react";
import { useAntimicrobialSuggestions } from "../hooks/useAntimicrobialSuggestions";
import { addMonths, today } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { TransferPeriodSelect } from "./TransferPeriodSelect";
import { TruncatedNotice } from "./TruncatedNotice";

// 細菌検査オーダーの前投与抗菌薬に、患者の処方・注射の抗菌薬を選んで追記する。
// 様式文書の「転記」モーダルと同じ組み方(期間で絞った一覧から複数選んで追記)。
// フォームの中から開くので <form> は書かない(Modal はポータルではない)。

const DEFAULT_PERIOD_MONTHS = 3;

const KIND_LABELS = { prescription: "処方", injection: "注射" } as const;

export function AntimicrobialImportModal({
  patientId,
  onAppend,
  onClose,
}: {
  patientId: string;
  onAppend: (lines: string[]) => void;
  onClose: () => void;
}) {
  const [periodMonths, setPeriodMonths] = useState(DEFAULT_PERIOD_MONTHS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const since = useMemo(() => (periodMonths ? addMonths(today(), -periodMonths) : ""), [periodMonths]);
  const query = useAntimicrobialSuggestions(patientId, since, true);
  const suggestions = query.data?.suggestions ?? [];

  function toggle(code: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(code);
      else next.delete(code);
      return next;
    });
  }

  function handleAppend() {
    const lines = suggestions.filter((s) => selected.has(s.code)).map((s) => s.label);
    if (lines.length === 0) return;
    onAppend(lines);
    onClose();
  }

  return (
    <Modal title="処方取込" onClose={onClose} className="modal--wide">
      <div className="order-transfer">
        <div className="order-transfer__toolbar">
          <div className="order-transfer__controls">
            <TransferPeriodSelect
              value={periodMonths}
              onChange={(months) => {
                setPeriodMonths(months);
                setSelected(new Set());
              }}
            />
          </div>
        </div>
        <ErrorBanner error={query.error} />
        {query.isLoading ? (
          <p>読み込み中...</p>
        ) : suggestions.length === 0 ? (
          <p className="order-select__muted">該当なし</p>
        ) : (
          <ul className="discharge-summary__checklist order-transfer__list">
            {suggestions.map((suggestion) => (
              <li key={suggestion.code}>
                <div className="order-transfer__row">
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.has(suggestion.code)}
                      onChange={(e) => toggle(suggestion.code, e.target.checked)}
                    />
                    {[suggestion.period, KIND_LABELS[suggestion.kind], suggestion.name]
                      .filter(Boolean)
                      .join(" ")}
                  </label>
                </div>
              </li>
            ))}
          </ul>
        )}
        <TruncatedNotice show={query.data?.truncated} />
        <div className="order-transfer__actions">
          <button type="button" disabled={selected.size === 0} onClick={handleAppend}>
            取込
          </button>
          <button type="button" onClick={onClose}>
            キャンセル
          </button>
        </div>
      </div>
    </Modal>
  );
}
