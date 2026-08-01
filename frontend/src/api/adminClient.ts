// 管理API(/admin/*)のクライアント。
//
// 認証は HttpOnly のセッション Cookie で、ブラウザ側にトークンを保持しない。
// 非 GET には CSRF トークン(ログイン応答で受け取る値)を X-CSRF-Token で付ける。
// この値だけはモジュール変数に持つ -- localStorage に置かないので、タブを
// 閉じれば消える。
//
// 秘密は書込専用: client_secret / FHIR 管理トークンはサーバーから返らず
// (`*_set` で有無のみ)、入力があったときだけ送信する。

export interface ConnectionSettings {
  base_url: string | null;
  client_id: string | null;
  token_path: string;
  host_header: string | null;
  client_secret_set: boolean;
  fhir_admin_token_set: boolean;
  admin_api_available: boolean;
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
  fhir_admin_token?: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  auth?: "backend_services" | "none";
  error?: string;
}

export interface AdminSession {
  authenticated: boolean;
  /** ADMIN_TOKEN が設定されているか。false ならログイン画面を出さない。 */
  auth_required: boolean;
  csrf_token: string | null;
}

export type OauthClientKind = "backend" | "launch";
export type OauthClientAuthMethod = "client_secret" | "private_key_jwt" | "none";

export interface OauthClientSummary {
  client_id: string;
  name: string;
  client_type: "confidential" | "public";
  scopes: string[];
  redirect_uris: string[];
  kind: OauthClientKind;
  auth_method: OauthClientAuthMethod;
  jwks_key_count: number;
  active_access_token_count: number;
  active_refresh_token_count: number;
  created_at: string;
  updated_at: string;
}

/** 登録直後のレスポンス。client_secret は「キーが存在するときだけ」現れる。 */
export interface OauthClientCreated extends Omit<
  OauthClientSummary,
  "active_access_token_count" | "active_refresh_token_count"
> {
  client_secret?: string;
}

export interface NewOauthClient {
  name: string;
  scopes: string[];
  redirect_uris?: string[];
  client_type?: "confidential" | "public";
  jwks?: unknown;
}

export interface OauthClientDeleted {
  client_id: string;
  name: string;
  deleted: {
    access_tokens: number;
    refresh_tokens: number;
    authorization_codes: number;
    client_assertion_jtis: number;
    bulk_exports_detached: number;
  };
}

export interface ScopeOptions {
  resource_types: { type: string; label: string }[];
  system_access: { value: string; label: string }[];
  patient_access: { value: string; label: string }[];
  context_scopes: { scope: string; label: string }[];
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

let csrfToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

/** 401 を受けたときの処理(セッション状態の再取得)を登録する。 */
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

async function adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (method !== "GET" && method !== "HEAD" && csrfToken) {
    headers.set("X-CSRF-Token", csrfToken);
  }

  const res = await fetch(path, { ...init, headers });
  // 401 はこのアプリ自身のセッション失効だけを意味する。上流 FHIR サーバーの
  // 401 は backend が 502 に読み替えるので、設定ミスでログアウトさせられない。
  if (res.status === 401) onUnauthorized?.();
  return res;
}

async function adminJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await adminFetch(path, init);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as T;
}

function jsonBody(payload: unknown): RequestInit {
  return { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}

// --- ログインセッション ------------------------------------------------------

const SESSION = "/admin/session";

function rememberCsrf(session: AdminSession): AdminSession {
  csrfToken = session.csrf_token;
  return session;
}

export async function fetchAdminSession(): Promise<AdminSession> {
  return rememberCsrf(await adminJson<AdminSession>(SESSION));
}

export async function login(token: string): Promise<AdminSession> {
  return rememberCsrf(
    await adminJson<AdminSession>(SESSION, { method: "POST", ...jsonBody({ token }) }),
  );
}

export async function logout(): Promise<AdminSession> {
  return rememberCsrf(await adminJson<AdminSession>(SESSION, { method: "DELETE" }));
}

// --- 接続設定 ----------------------------------------------------------------

const SETTINGS = "/admin/fhir_connection_settings";

export async function fetchConnectionSettings(): Promise<ConnectionSettings> {
  return adminJson<ConnectionSettings>(SETTINGS);
}

export async function updateConnectionSettings(
  payload: ConnectionSettingsUpdate,
): Promise<ConnectionSettings> {
  return adminJson<ConnectionSettings>(SETTINGS, { method: "PATCH", ...jsonBody(payload) });
}

export async function testConnection(): Promise<ConnectionTestResult> {
  return adminJson<ConnectionTestResult>(`${SETTINGS}/test`, { method: "POST" });
}

// --- OAuth クライアント ------------------------------------------------------

const OAUTH_CLIENTS = "/admin/oauth_clients";

export async function fetchOauthClients(): Promise<OauthClientSummary[]> {
  const body = await adminJson<{ total: number; items: OauthClientSummary[] }>(OAUTH_CLIENTS);
  return body.items;
}

export async function createOauthClient(payload: NewOauthClient): Promise<OauthClientCreated> {
  return adminJson<OauthClientCreated>(OAUTH_CLIENTS, { method: "POST", ...jsonBody(payload) });
}

export async function deleteOauthClient(clientId: string): Promise<OauthClientDeleted> {
  return adminJson<OauthClientDeleted>(`${OAUTH_CLIENTS}/${encodeURIComponent(clientId)}`, {
    method: "DELETE",
  });
}

export async function fetchScopeOptions(): Promise<ScopeOptions> {
  return adminJson<ScopeOptions>("/admin/scopes");
}

// --- 帳票レイアウト ----------------------------------------------------------

export interface ReportLayoutSummary {
  id: number;
  name: string;
  questionnaire_url: string;
  questionnaire_version: string;
  canonical: string;
  tlf_bytesize: number;
  /** マッピング定義が登録されているか(本文は show でのみ返る)。 */
  mapping_set: boolean;
  updated_at: string;
}

/** show のみ tlf・mapping 本文(JSON テキスト)を含む。 */
export interface ReportLayoutDetail extends ReportLayoutSummary {
  tlf: string;
  mapping: string;
}

export interface ReportLayoutPayload {
  name: string;
  questionnaire_url: string;
  questionnaire_version: string;
  /** .tlf ファイルの中身(JSON テキスト)。FileReader で読んだ文字列をそのまま送る。 */
  tlf: string;
  /** マッピング定義(JSON 配列のテキスト)。空文字はマッピングなし。 */
  mapping?: string;
}

const REPORT_LAYOUTS = "/admin/report_layouts";

// canonical("url|version")を渡すと該当テンプレート分だけに絞り込む。
export async function fetchReportLayouts(canonical?: string): Promise<ReportLayoutSummary[]> {
  const query = canonical ? `?canonical=${encodeURIComponent(canonical)}` : "";
  const body = await adminJson<{ total: number; items: ReportLayoutSummary[] }>(
    `${REPORT_LAYOUTS}${query}`,
  );
  return body.items;
}

export async function fetchReportLayout(id: number): Promise<ReportLayoutDetail> {
  return adminJson<ReportLayoutDetail>(`${REPORT_LAYOUTS}/${id}`);
}

export async function createReportLayout(
  payload: ReportLayoutPayload,
): Promise<ReportLayoutSummary> {
  return adminJson<ReportLayoutSummary>(REPORT_LAYOUTS, { method: "POST", ...jsonBody(payload) });
}

export async function updateReportLayout(
  id: number,
  payload: Partial<ReportLayoutPayload>,
): Promise<ReportLayoutSummary> {
  return adminJson<ReportLayoutSummary>(`${REPORT_LAYOUTS}/${id}`, {
    method: "PATCH",
    ...jsonBody(payload),
  });
}

export async function deleteReportLayout(id: number): Promise<void> {
  const res = await adminFetch(`${REPORT_LAYOUTS}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}
