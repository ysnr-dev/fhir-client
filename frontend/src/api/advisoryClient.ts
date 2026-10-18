// 警告の発火・無視の台帳(docs/advisory-design.md §3.2)。フォームのセッションごとに 1 回まとめて送る。
import { masterFetch } from "./masterClient";

export type AdvisoryEventOutcome = "fired" | "overridden";

export interface AdvisoryEventPayload {
  key: string;
  kind: string;
  severity: string;
  outcome: AdvisoryEventOutcome;
  reason_code?: string;
  reason_text?: string;
  occurred_at?: string;
}

export interface AdvisoryEventsBatch {
  context: string;
  session_id: string;
  order_reference?: string;
  events: AdvisoryEventPayload[];
}

/**
 * 統計のための記録なので失敗は握りつぶす(診療を止めない)。フォームを閉じる途中でも
 * 届くよう keepalive で送る。同じセッション・同じ警告の再送はサーバーが捨てる。
 */
export function recordAdvisoryEvents(batch: AdvisoryEventsBatch): void {
  if (batch.events.length === 0) return;
  masterFetch("/master/advisory_events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(batch),
    keepalive: true,
  }).catch(() => undefined);
}
