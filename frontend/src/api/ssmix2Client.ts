// SS-MIX2 標準化ストレージ出力の状態と、失敗・警告の確認(/integrations/ssmix2/*)。
// 施設設定画面の区画と「SS-MIX2 出力の確認」画面が使う。
import { notifyUnauthorized, withCsrfHeaders } from "./session";

export interface Ssmix2Failure {
  kind: "transaction" | "message";
  id: number;
  occurred_at: string;
  data_kind?: string;
  patient_id?: string;
  error: string | null;
}

export interface Ssmix2Status {
  enabled: boolean;
  /** 起こしていない transaction と、エージェントがまだ書いていないメッセージの合計。 */
  pending: number;
  failed: number;
  written_today: number;
  warnings_today: number;
  last_written_at: string | null;
  last_polled_at: string | null;
  recent_failures: Ssmix2Failure[];
}

/** メッセージに起こせなかった書き込み。 */
export interface Ssmix2FailedTransaction {
  id: number;
  occurred_at: string;
  failed_at: string | null;
  method: string;
  path: string;
  resource_types: string[];
  attempts: number;
  error: string | null;
}

export type Ssmix2MessageStatus = "pending" | "leased" | "written" | "failed" | "discarded";

export interface Ssmix2MessageSummary {
  id: number;
  created_at: string;
  updated_at: string;
  patient_id: string;
  service_date: string;
  data_kind: string;
  order_no: string;
  process: "INS" | "DEL";
  status: Ssmix2MessageStatus;
  attempts: number;
  /** ファイル名(コンディションフラグを除く)。 */
  file_stem: string;
  error: string | null;
  warnings: string[];
}

export interface Ssmix2Failures {
  transactions: Ssmix2FailedTransaction[];
  messages: Ssmix2MessageSummary[];
}

export interface Ssmix2Warnings {
  messages: Ssmix2MessageSummary[];
  truncated: boolean;
}

export interface Ssmix2FailureSelection {
  transaction_ids: number[];
  message_ids: number[];
}

/** 再実行・破棄で状態を変えた件数。 */
export interface Ssmix2FailureUpdate {
  transactions: number;
  messages: number;
}

async function request<T>(path: string, label: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? "GET";
  const res = await fetch(path, {
    ...init,
    headers: withCsrfHeaders(method, { "Content-Type": "application/json", ...init.headers }),
  });
  if (res.status === 401) notifyUnauthorized();
  if (!res.ok) throw new Error(`${label} (HTTP ${res.status})`);
  return (await res.json()) as T;
}

export function fetchSsmix2Status(): Promise<Ssmix2Status> {
  return request("/integrations/ssmix2/status", "SS-MIX2 出力の状態を取得できませんでした");
}

export function fetchSsmix2Failures(): Promise<Ssmix2Failures> {
  return request("/integrations/ssmix2/failures", "SS-MIX2 出力の失敗を取得できませんでした");
}

export function fetchSsmix2Warnings(): Promise<Ssmix2Warnings> {
  return request("/integrations/ssmix2/warnings", "SS-MIX2 出力の警告を取得できませんでした");
}

export function retrySsmix2Failures(selection: Ssmix2FailureSelection): Promise<Ssmix2FailureUpdate> {
  return request("/integrations/ssmix2/failures/retry", "再実行できませんでした", {
    method: "POST",
    body: JSON.stringify(selection),
  });
}

export function discardSsmix2Failures(selection: Ssmix2FailureSelection): Promise<Ssmix2FailureUpdate> {
  return request("/integrations/ssmix2/failures/discard", "破棄できませんでした", {
    method: "POST",
    body: JSON.stringify(selection),
  });
}
