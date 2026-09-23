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

/** 剤に並ぶ 1 行。kind は手技(加算を含む)・薬剤・材料・コメント。 */
export type BillingLineKind = "procedure" | "medicine" | "material" | "comment";

export interface BillingLine {
  code: string;
  name: string;
  quantity?: string;
  unit?: string;
  kind: BillingLineKind;
  /** 点数表の区分番号(章記号 + 3 桁)。診療行為マスタに無いコードでは付かない。 */
  section?: string;
}

/**
 * 画面に見せる剤。レセコンが実際に受ける並び(区分ごと)に分けてある。
 * class_code / class_name はレセコン側の区分で、接続設定が無いプレビューでは付かない。
 */
export interface BillingItem {
  /** 内服・頓用・外用・検査・処置など。 */
  category: string;
  name: string;
  class_code?: string;
  class_name?: string;
  /** 回数(処置など)。 */
  count?: string;
  /** 投与日数(内服)。 */
  days?: string;
  usage_name?: string;
  /** 実施日時。実施記録から組んだ剤に付く。 */
  performed_at?: string;
  lines: BillingLine[];
}

export interface BillingDiagnosis {
  name: string | null;
  sendable: boolean;
  suspected: boolean;
  start_date: string | null;
  end_date: string | null;
}

/** 担当医がレセコンの医師コードに対応付いているか。無いまま送るとレセコンで弾かれる。 */
export interface BillingPhysician {
  mapped: boolean;
  name: string;
  message?: string;
}

export interface BillingPreview {
  items: BillingItem[];
  diagnoses: BillingDiagnosis[];
  skipped: ReceiptSkipped[];
  /** 担当医を渡したときだけ付く。 */
  physician?: BillingPhysician;
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
      // 送信・取消の失敗は結果(outcome / message)の形で返る。理由をそのまま出す。
      else if (typeof body?.billing?.message === "string") message = body.billing.message;
      else if (typeof body?.message === "string") message = body.message;
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

/**
 * 送信・取消。レセコンが受け付けなかったときも backend は結果(outcome: failed と理由)を
 * 502 で返すので、それは例外にせず結果として返し、画面に理由・警告・送れなかった項目を出す。
 */
async function sendResult<T>(path: string, method: string, body: unknown): Promise<T> {
  const response = await masterFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.ok || response.status === 502) {
    try {
      const parsed = (await response.json()) as T & { billing?: unknown; outcome?: unknown };
      if (parsed && (parsed.billing !== undefined || parsed.outcome !== undefined)) return parsed;
    } catch {
      // 結果の形でなければ下で例外にする。
    }
  }
  throw new MasterApiError(`${response.status} ${response.statusText}`, response.status);
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
  practitioner_id?: string;
}): Promise<BillingPreview> {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v) as [string, string][],
  ).toString();
  return receiptJson<BillingPreview>(`${BASE}/billings/preview?${query}`);
}

/**
 * レセコン側での 1 受診の状態。none = 未送信、sent = カルテから送ってあり送り直し・取消ができる、
 * opened = レセコン側で展開・編集されていてカルテからは触れない、settled = 会計済み。
 * message は opened / settled の理由。
 */
/** レセコンで済んだ 1 件の会計(伝票)。金額は円、points は点数。 */
export interface Settlement {
  date: string;
  department_code: string | null;
  invoice_number: string | null;
  issued_on: string | null;
  /** 請求額 */
  charge: number;
  /** 入金額 */
  paid: number;
  /** 未収額 */
  unpaid: number;
  /** 自費分 */
  self_pay: number;
  /** 負担割合(%) */
  copay_rate: number | null;
  points: number;
}

export interface BillingStatus {
  sent: boolean;
  state: "none" | "sent" | "opened" | "settled";
  message?: string;
  /** 会計済みのときの会計(伝票ごと)。 */
  settlements?: Settlement[];
}

/** その日に会計が済んだ受診。患者番号はカルテの形(ゼロ埋めなし)、診療科はカルテのコード。 */
export interface SettledReception {
  patient_number: string;
  department_code: string | null;
}

export function fetchSettledReceptions(date: string): Promise<{ settled: SettledReception[] }> {
  const query = new URLSearchParams({ date }).toString();
  return receiptJson<{ settled: SettledReception[] }>(`${BASE}/billings/settled?${query}`);
}

/** レセコン側の状態。控えを持たずレセコンに訊く。 */
export function fetchBillingStatus(params: {
  patient_id: string;
  date: string;
  department_code?: string;
}): Promise<BillingStatus> {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v) as [string, string][],
  ).toString();
  return receiptJson<BillingStatus>(`${BASE}/billings/status?${query}`);
}

export function sendBilling(body: {
  patient_id: string;
  date: string;
  department_code?: string;
  practitioner_id?: string;
  coverage_set_key?: string;
}): Promise<BillingSendResult> {
  return sendResult<BillingSendResult>(`${BASE}/billings`, "POST", body);
}

export function cancelBilling(body: {
  patient_id: string;
  date: string;
  department_code?: string;
}): Promise<ReceiptResult> {
  return sendResult<ReceiptResult>(`${BASE}/billings`, "DELETE", body);
}
