// アプリ本体のログイン(/auth/*)クライアント。
//
// 認証は HttpOnly のセッション Cookie で、資格情報をブラウザ側に保持しない。
// 非 GET には CSRF トークン(ログイン応答で受け取る値)を X-CSRF-Token で付ける
// (adminClient と同じ設計。トークンの実体は api/session.ts で共有)。

import { notifyUnauthorized, setCsrfToken, withCsrfHeaders } from "./session";

export interface AuthUser {
  login_id: string;
  /** 紐付く上流 Practitioner の ID。administrator(固定ユーザー)は null。 */
  practitioner_id: string | null;
  administrator: boolean;
}

export interface AuthSession {
  authenticated: boolean;
  /** ADMIN_TOKEN が設定されているか。false ならログイン画面を出さない。 */
  auth_required: boolean;
  csrf_token: string | null;
  user: AuthUser | null;
}

/** 医療従事者のログインアカウント(登録有無と login_id のみ。秘密は返らない)。 */
export interface LoginAccount {
  registered: boolean;
  login_id: string | null;
}

export class AuthApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthApiError";
    this.status = status;
  }
}

async function buildError(res: Response): Promise<AuthApiError> {
  let message = `サーバーエラーが発生しました (HTTP ${res.status})`;
  try {
    const body = (await res.json()) as { error?: string; errors?: string[] };
    if (body.error) message = body.error;
    else if (body.errors?.length) message = body.errors.join(" / ");
  } catch {
    // 非JSONレスポンスはデフォルトメッセージのまま
  }
  return new AuthApiError(message, res.status);
}

async function authJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const res = await fetch(path, { ...init, headers: withCsrfHeaders(method, init.headers) });
  // ログイン試行自体の 401(パスワード誤り)でセッション照会を引き直しても害はない
  if (res.status === 401) notifyUnauthorized();
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as T;
}

function jsonBody(payload: unknown): RequestInit {
  return { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}

// --- ログインセッション ------------------------------------------------------

const SESSION = "/auth/session";

function rememberCsrf(session: AuthSession): AuthSession {
  setCsrfToken(session.csrf_token);
  return session;
}

export async function fetchAuthSession(): Promise<AuthSession> {
  return rememberCsrf(await authJson<AuthSession>(SESSION));
}

export async function login(loginId: string, password: string): Promise<AuthSession> {
  return rememberCsrf(
    await authJson<AuthSession>(SESSION, {
      method: "POST",
      ...jsonBody({ login_id: loginId, password }),
    }),
  );
}

export async function logout(): Promise<AuthSession> {
  return rememberCsrf(await authJson<AuthSession>(SESSION, { method: "DELETE" }));
}

// --- 医療従事者のログインアカウント ------------------------------------------

const ACCOUNT = "/auth/account";

export async function fetchLoginAccount(practitionerId: string): Promise<LoginAccount> {
  return authJson<LoginAccount>(`${ACCOUNT}?practitioner_id=${encodeURIComponent(practitionerId)}`);
}

export async function upsertLoginAccount(payload: {
  practitionerId: string;
  loginId: string;
  /** 空・未指定なら既存パスワードを変更しない(新規作成時は必須)。 */
  password?: string;
}): Promise<LoginAccount> {
  return authJson<LoginAccount>(ACCOUNT, {
    method: "PUT",
    ...jsonBody({
      practitioner_id: payload.practitionerId,
      login_id: payload.loginId,
      password: payload.password ?? "",
    }),
  });
}

export async function deleteLoginAccount(practitionerId: string): Promise<LoginAccount> {
  return authJson<LoginAccount>(
    `${ACCOUNT}?practitioner_id=${encodeURIComponent(practitionerId)}`,
    { method: "DELETE" },
  );
}
