// SS-MIX2 標準化ストレージ出力の状態(/integrations/ssmix2/status)。施設設定画面の区画が表示に使う。
import { notifyUnauthorized } from "./session";

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

export async function fetchSsmix2Status(): Promise<Ssmix2Status> {
  const res = await fetch("/integrations/ssmix2/status");
  if (res.status === 401) notifyUnauthorized();
  if (!res.ok) throw new Error(`SS-MIX2 出力の状態を取得できませんでした (HTTP ${res.status})`);
  return (await res.json()) as Ssmix2Status;
}
