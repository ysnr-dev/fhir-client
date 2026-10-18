import { useMemo, useRef, useState } from "react";
import { recordAdvisoryEvents } from "../api/advisoryClient";
import type { CdsCard, CdsOverrideReason } from "../api/cdsClient";
import { useCdsOrderSelect, useSendCdsFeedback } from "../api/cdsQueries";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { cdsCardAdvisories } from "../fhir/cdsCardHelpers";
import { CdsCardList } from "./CdsCardList";

// 処方フォームの CDS Hooks(docs/cds-hooks-design.md §3.3)。order-select はここ、登録前の order-sign は
// 共通の警告の確認(AdvisoryConfirmModal)に PrescriptionForm が載せる。

/** 入力が落ち着いてから order-select を呼ぶまでの間。 */
const ORDER_SELECT_DELAY_MS = 1000;

export function feedbackParams(card: CdsCard, reason: CdsOverrideReason) {
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
  // 台帳(発火・無視)の記録。登録を止めないので、カードが出たとき・無視したときにその都度送る。
  const sessionId = useRef(crypto.randomUUID());
  const recorded = useRef(new Set<string>());
  const cards = (result.data?.cards ?? []).filter((card) => !dismissed.has(card.uuid));
  const fresh = cards.filter((card) => !recorded.current.has(card.uuid));
  if (fresh.length > 0) {
    for (const card of fresh) recorded.current.add(card.uuid);
    recordAdvisoryEvents({
      context: "prescription",
      session_id: sessionId.current,
      events: cdsCardAdvisories(fresh).map((a) => ({ key: a.key, kind: a.kind, severity: a.severity, outcome: "fired" })),
    });
  }
  if (cards.length === 0) return null;

  return (
    <div className="prescription-cds" role="note" aria-label="判断支援">
      <CdsCardList
        cards={cards}
        patientId={patientId}
        onOverride={(card, reason) => {
          feedback.mutate(feedbackParams(card, reason));
          const [advisory] = cdsCardAdvisories([card]);
          recordAdvisoryEvents({
            context: "prescription",
            session_id: sessionId.current,
            events: [{ key: advisory.key, kind: advisory.kind, severity: advisory.severity, outcome: "overridden", reason_code: reason.code, reason_text: `${advisory.message}` }],
          });
          setDismissed((current) => new Set(current).add(card.uuid));
        }}
      />
    </div>
  );
}
