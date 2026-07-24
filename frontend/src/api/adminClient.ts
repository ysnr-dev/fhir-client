// 上流 FHIR サーバーへの接続設定(SMART Backend Services)の管理 API クライアント。
// client_secret は書込専用: サーバーからは返らず(`client_secret_set` で有無のみ)、
// 入力があったときだけ送信する。

export interface ConnectionSettings {
  base_url: string | null;
  client_id: string | null;
  token_path: string;
  host_header: string | null;
  client_secret_set: boolean;
  auth_enabled: boolean;
  effective_base_url: string;
  effective_auth_source: "db" | "env" | "none";
}

export interface ConnectionSettingsUpdate {
  base_url?: string;
  client_id?: string;
  client_secret?: string;
  token_path?: string;
  host_header?: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  auth?: "backend_services" | "none";
  error?: string;
}

export class AdminApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
  }
}

async function buildError(res: Response): Promise<AdminApiError> {
  let message = `サーバーエラーが発生しました (HTTP ${res.status})`;
  try {
    const body = (await res.json()) as { error?: string; errors?: string[] };
    if (body.error) message = body.error;
    else if (body.errors?.length) message = body.errors.join(" / ");
  } catch {
    // 非JSONレスポンスはデフォルトメッセージのまま
  }
  return new AdminApiError(message, res.status);
}

const BASE = "/admin/fhir_connection_settings";

export async function fetchConnectionSettings(): Promise<ConnectionSettings> {
  const res = await fetch(BASE);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as ConnectionSettings;
}

export async function updateConnectionSettings(
  payload: ConnectionSettingsUpdate,
): Promise<ConnectionSettings> {
  const res = await fetch(BASE, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as ConnectionSettings;
}

export async function testConnection(): Promise<ConnectionTestResult> {
  const res = await fetch(`${BASE}/test`, { method: "POST" });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as ConnectionTestResult;
}
