import { useMemo, useRef, useState } from "react";
import type { CdsCard, CdsOverrideReason } from "../api/cdsClient";
import { useCdsOrderSelect, useSendCdsFeedback } from "../api/cdsQueries";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { overrideReasonsOf } from "../fhir/cdsCardHelpers";
import { CdsCardList } from "./CdsCardList";
import { Modal } from "./Modal";

// 処方フォームの CDS Hooks(docs/cds-hooks-design.md §3.3)。

/** 入力が落ち着いてから order-select を呼ぶまでの間。 */
const ORDER_SELECT_DELAY_MS = 1000;

function feedbackParams(card: CdsCard, reason: CdsOverrideReason) {
  return {
    service_id: card.service.id,
    service: card.service.service,
    card: card.uuid,
    outcome: "overridden" as const,
    override_reason: { code: reason.code, system: reason.system },
  };
}

function orderIds(bundle: fhir4.Bundle): Map<string, string> {
  return new Map(
    (bundle.entry ?? []).map((entry) => [
      `MedicationRequest/${entry.resource?.id}`,
      JSON.stringify(entry.resource),
    ]),
  );
}

/**
 * order-select: 薬剤・用法・用量が変わった行を selections にして呼び、カードを入力欄の前に並べる。
 * 登録は止めない。開いたときの内容(編集の読み込み)は「選んだ」ではないので呼ばない。
 */
export function PrescriptionOrderSelectCards({
  patientId,
  draftOrders,
}: {
  patientId: string;
  draftOrders: fhir4.Bundle;
}) {
  const debounced = useDebouncedValue(draftOrders, ORDER_SELECT_DELAY_MS);
  const previous = useRef<Map<string, string> | null>(null);
  const lastParams = useRef<{ key: string; selections: string[] } | null>(null);

  const params = useMemo(() => {
    const current = orderIds(debounced);
    const before = previous.current;
    previous.current = current;
    const key = JSON.stringify(debounced);
    if (lastParams.current?.key === key) {
      return { patient_id: patientId, draft_orders: debounced, selections: lastParams.current.selections };
    }
    if (before === null || current.size === 0) return null;
    const selections = [...current].filter(([id, json]) => before.get(id) !== json).map(([id]) => id);
    if (selections.length === 0) return null;
    lastParams.current = { key, selections };
    return { patient_id: patientId, draft_orders: debounced, selections };
  }, [debounced, patientId]);

  const result = useCdsOrderSelect(params);
  const feedback = useSendCdsFeedback();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const cards = (result.data?.cards ?? []).filter((card) => !dismissed.has(card.uuid));
  if (cards.length === 0) return null;

  return (
    <div className="prescription-cds" role="note" aria-label="判断支援">
      <CdsCardList
        cards={cards}
        patientId={patientId}
        onOverride={(card, reason) => {
          feedback.mutate(feedbackParams(card, reason));
          setDismissed((current) => new Set(current).add(card.uuid));
        }}
      />
    </div>
  );
}

/**
 * order-sign の確認。カードを並べ、「登録」で続ける。重要(critical)のカードは無視の理由を
 * 選ぶまで登録できない。選んだ理由は登録するときに feedback で送る。
 * フォームの中に置くので、ボタンは type="button"(外側の form を submit させない)。
 */
export function PrescriptionOrderSignModal({
  patientId,
  cards,
  submitting,
  onConfirm,
  onCancel,
}: {
  patientId: string;
  cards: CdsCard[];
  submitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const feedback = useSendCdsFeedback();
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const missing = cards.filter((card) => card.indicator === "critical" && !overrides[card.uuid]);

  function confirm() {
    for (const card of cards) {
      const reason = overrideReasonsOf(card).find((r) => r.code === overrides[card.uuid]);
      if (reason) feedback.mutate(feedbackParams(card, reason));
    }
    onConfirm();
  }

  return (
    <Modal title="判断支援の確認" onClose={onCancel} className="prescription-cds-modal">
      <CdsCardList
        cards={cards}
        patientId={patientId}
        overrides={overrides}
        overridePlaceholder="理由…"
        onOverride={(card, reason) => setOverrides((current) => ({ ...current, [card.uuid]: reason.code }))}
      />
      {missing.length > 0 && (
        <p className="prescription-cds-modal__required" role="alert">
          重要のカードは理由を選んでください。
        </p>
      )}
      <div className="lab-order-item__actions">
        <button type="button" onClick={confirm} disabled={missing.length > 0 || submitting}>
          登録
        </button>
        <button type="button" onClick={onCancel} disabled={submitting}>
          戻る
        </button>
      </div>
    </Modal>
  );
}
