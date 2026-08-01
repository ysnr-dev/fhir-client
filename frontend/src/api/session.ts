// アプリ全体で共有するセッション関連の状態。
//
// backend のセッションは 1 つ(Cookie path=/)で、CSRF トークンも
// /auth/session と /admin/session が同じ session[:csrf_token] を共有する。
// トークンはモジュール変数にだけ持つ -- localStorage に置かないので、
// タブを閉じれば消える(値はログイン/セッション照会の応答で受け取る)。

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

/** 非 GET リクエストに X-CSRF-Token を付けたヘッダーを返す。 */
export function withCsrfHeaders(method: string, headers?: HeadersInit): Headers {
  const result = new Headers(headers);
  const upper = method.toUpperCase();
  if (upper !== "GET" && upper !== "HEAD" && csrfToken) {
    result.set("X-CSRF-Token", csrfToken);
  }
  return result;
}

let onUnauthorized: (() => void) | null = null;

/** 401 を受けたときの処理(セッション状態の再取得)を登録する。 */
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

/**
 * どの API クライアントでも、401 はこのアプリ自身のセッション失効だけを意味する
 * (上流 FHIR サーバーの 401 は backend が 502 に読み替える)。ハンドラが
 * セッションクエリを invalidate し、AuthGate / AdminGate がログイン画面へ切り替わる。
 */
export function notifyUnauthorized() {
  onUnauthorized?.();
}
