// レセコン連携の API クライアント。
//
// 患者・保険・受付はレセコンが正本でカルテへ取り込まれ、カルテからは
// 病名と診療行為(会計)だけを送る(docs/receipt-computer-integration.md)。
// レセコンの製品ごとの語彙は backend のアダプタに閉じているので、ここには出てこない。
import { masterFetch, MasterApiError } from "./masterClient";

export interface ReceiptStatus {
  enabled: boolean;
  system_type: string;
  base_url: string | null;
}

/** 連携 1 回の結果。 */
export type ReceiptOutcome = "succeeded" | "warning" | "failed";

/** レセコンが返した警告 1 件。受理されていても部分的に落ちていることがある。 */
export interface ReceiptWarning {
  layer?: string;
  code?: string;
  message: string;
  position?: string;
  target_code?: string;
  target_name?: string;
}

/** 送れなかった項目。黙って消さずに理由まで出す。 */
export interface ReceiptSkipped {
  kind: string;
  name: string;
  reason: string;
}

export interface ReceiptResult {
  outcome: ReceiptOutcome;
  code: string | null;
  message: string | null;
  warnings: ReceiptWarning[];
  skipped: ReceiptSkipped[];
}

export interface BillingLine {
  code: string;
  name: string;
  quantity: string | null;
}

export interface BillingItem {
  /** 内服・頓用・外用・検査・処置など。 */
  category: string;
  name: string;
  days?: string;
  usage_name?: string;
  lines: BillingLine[];
}

export interface BillingDiagnosis {
  name: string | null;
  sendable: boolean;
  suspected: boolean;
  start_date: string | null;
  end_date: string | null;
}

export interface BillingPreview {
  items: BillingItem[];
  diagnoses: BillingDiagnosis[];
  skipped: ReceiptSkipped[];
}

export interface BillingSendResult {
  billing: ReceiptResult;
  diagnoses: ReceiptResult | null;
}

export interface PatientRefreshResult {
  patient_fhir_id: string;
  coverages: number;
  cancelled: number;
}

const BASE = "/integrations/receipt";

async function receiptJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await masterFetch(path, init);
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (typeof body?.error === "string") message = body.error;
      else if (Array.isArray(body?.errors)) message = body.errors.join(" / ");
    } catch {
      // ボディが JSON でないときはステータスのまま出す。
    }
    throw new MasterApiError(message, response.status);
  }
  return (await response.json()) as T;
}

function send<T>(path: string, method: string, body?: unknown): Promise<T> {
  return receiptJson<T>(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function fetchReceiptStatus(): Promise<ReceiptStatus> {
  return receiptJson<ReceiptStatus>(`${BASE}/status`);
}

/** 患者・保険をレセコンから取り直す。通知を取りこぼしたときの回復手段。 */
export function refreshReceiptPatient(patientId: string): Promise<PatientRefreshResult> {
  return send<PatientRefreshResult>(`${BASE}/patients/refresh`, "POST", { patient_id: patientId });
}

export function fetchBillingPreview(params: {
  patient_id: string;
  date: string;
}): Promise<BillingPreview> {
  const query = new URLSearchParams(params).toString();
  return receiptJson<BillingPreview>(`${BASE}/billings/preview?${query}`);
}

/** 既にレセコンへ送ってあるか。控えを持たずレセコンに訊く。 */
export function fetchBillingStatus(params: {
  patient_id: string;
  date: string;
  department_code?: string;
}): Promise<{ sent: boolean }> {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v) as [string, string][],
  ).toString();
  return receiptJson<{ sent: boolean }>(`${BASE}/billings/status?${query}`);
}

export function sendBilling(body: {
  patient_id: string;
  date: string;
  department_code?: string;
  practitioner_id?: string;
  coverage_set_key?: string;
}): Promise<BillingSendResult> {
  return send<BillingSendResult>(`${BASE}/billings`, "POST", body);
}

export function cancelBilling(body: {
  patient_id: string;
  date: string;
  department_code?: string;
}): Promise<ReceiptResult> {
  return send<ReceiptResult>(`${BASE}/billings`, "DELETE", body);
}
