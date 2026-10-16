// Web 問診の患者向け API クライアント(docs/web-intake-design.md §2.2)。
//
// ログインは無く、リンクのトークンをヘッダで送る。職員のセッション Cookie は送らず(credentials: "omit")、
// 401 を AuthGate に知らせる仕組み(notifyUnauthorized)も通さない(患者画面は AuthGate の外)。

export type IntakePublicStatus = "verify" | "ready" | "expired" | "locked";

export interface IntakePublicState {
  status: IntakePublicStatus;
  /** 照合済みのときだけ付く。 */
  questionnaires?: fhir4.Questionnaire[];
  /** 送信済みの質問票の canonical。 */
  submitted_urls: string[];
}

export class IntakePublicError extends Error {
  status: number;
  state?: IntakePublicStatus;

  constructor(message: string, status: number, state?: IntakePublicStatus) {
    super(message);
    this.status = status;
    this.state = state;
  }
}

async function request<T>(token: string, path: string, method: "GET" | "POST", body?: unknown): Promise<T> {
  const response = await fetch(`/intake/public${path}`, {
    method,
    credentials: "omit",
    headers: {
      "X-Intake-Token": token,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  type Body = { error?: string; status?: IntakePublicStatus };
  let parsed: Body | null = null;
  try {
    parsed = (await response.json()) as Body;
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    throw new IntakePublicError(parsed?.error ?? `${response.status} ${response.statusText}`, response.status, parsed?.status);
  }
  return parsed as T;
}

export function fetchIntakeState(token: string): Promise<IntakePublicState> {
  return request(token, "", "GET");
}

export function verifyIntakeBirthDate(token: string, birthDate: string): Promise<{ status: IntakePublicStatus }> {
  return request(token, "/verify", "POST", { birth_date: birthDate });
}

export function submitIntakeResponse(
  token: string,
  payload: { questionnaire_url: string; questionnaire_version?: string; answers: fhir4.QuestionnaireResponseItem[] },
): Promise<{ status: "submitted"; submitted_urls: string[] }> {
  return request(token, "/responses", "POST", payload);
}
