// 検体ラベルの台帳(発行・到着状況)のクライアント(docs/lab-arrival-design.md §3)。
// FHIR ではない backend のプレーン JSON REST。認証は /master と同じ
// (ログインセッション + 非 GET への CSRF トークン)。
import { useQuery } from "@tanstack/react-query";
import { notifyUnauthorized, withCsrfHeaders } from "./session";

/** 発行記録 1 件 = 採取管 1 本。arrived_at が入っていれば到着済み。 */
export interface LabLabelRecord {
  label_number: string;
  order_fhir_id: string;
  specimen_code: string;
  container_code: string;
  issued_at: string;
  arrived_at: string | null;
  arrived_by: string | null;
}

export interface LabLabelArrivalResult extends LabLabelRecord {
  /** 既に到着済みだった(二重スキャン)。記録は上書きされていない。 */
  already_arrived: boolean;
}

export class LabLabelsApiError extends Error {
  status: number;
  /** backend のエラーコード(unknown_number / invalid_number など)。 */
  code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "LabLabelsApiError";
    this.status = status;
    this.code = code;
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  unknown_number: "この番号の発行記録がありません",
  invalid_number: "番号の形式が正しくありません(読み取りエラーの可能性)",
};

async function labLabelsFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const res = await fetch(url, { ...init, headers: withCsrfHeaders(method, init.headers) });
  if (res.status === 401) notifyUnauthorized();
  return res;
}

async function buildError(res: Response): Promise<LabLabelsApiError> {
  let code = "";
  try {
    code = ((await res.json()) as { error?: string }).error ?? "";
  } catch {
    // 非 JSON レスポンスはコードなし
  }
  const message = ERROR_MESSAGES[code] ?? `サーバーエラーが発生しました (HTTP ${res.status})`;
  return new LabLabelsApiError(message, res.status, code);
}

/**
 * スキャン入力の形式検証(11 桁 + M10W3 チェックデジット)。backend でも検証するが、
 * 手入力ミスに送信前のその場で気付けるように同じ計算を持つ。
 */
export function isValidLabelNumber(number: string): boolean {
  if (!/^\d{11}$/.test(number)) return false;
  const digits = number.slice(0, 10);
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    const weight = (digits.length - 1 - i) % 2 === 0 ? 3 : 1;
    sum += Number(digits[i]) * weight;
  }
  return String((10 - (sum % 10)) % 10) === number[10];
}

/** 到着を記録する(冪等。二重スキャンは already_arrived で返る)。 */
export async function recordLabelArrival(labelNumber: string): Promise<LabLabelArrivalResult> {
  const res = await labLabelsFetch("/lab_labels/arrivals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label_number: labelNumber }),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as LabLabelArrivalResult;
}

/** 誤スキャンの取消(到着の記録を消す)。 */
export async function cancelLabelArrival(labelNumber: string): Promise<LabLabelRecord> {
  const res = await labLabelsFetch(`/lab_labels/arrivals/${encodeURIComponent(labelNumber)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as LabLabelRecord;
}

/** オーダーごとの発行・到着状況をまとめて引く。 */
export async function fetchLabLabelRecords(orderIds: string[]): Promise<LabLabelRecord[]> {
  if (orderIds.length === 0) return [];
  const params = new URLSearchParams({ order_ids: orderIds.join(",") });
  const res = await labLabelsFetch(`/lab_labels?${params}`);
  if (!res.ok) throw await buildError(res);
  return ((await res.json()) as { items: LabLabelRecord[] }).items;
}

export const LAB_LABELS_KEY = "lab_labels";

/**
 * 表示中のオーダーの発行・到着状況。検体検査一覧の管ごとのバッジ用。
 * ラベル発行(別タブ)や到着確認(別画面)の後に戻ってきたときは、
 * ウィンドウフォーカスの再取得で追い付く。
 */
export function useLabLabelRecords(orderIds: string[]) {
  const key = [...orderIds].sort().join(",");
  return useQuery({
    queryKey: [LAB_LABELS_KEY, key],
    queryFn: () => fetchLabLabelRecords(orderIds),
    enabled: orderIds.length > 0,
  });
}
