// Web 問診の職員向け API クライアント(docs/web-intake-design.md §2.2)。ログインセッションで叩く。
import { masterFetch, MasterApiError } from "./masterClient";

export type IntakeLinkStatus = "issued" | "answered" | "imported" | "expired";
export type IntakeResponseStatus = "pending" | "imported" | "discarded";

export interface IssuedIntakeLink {
  id: number;
  /** 患者が開くパス("/q/<token>")。トークンはこの応答にだけ出る。 */
  path: string;
  expires_at: string;
  questionnaire_urls: string[];
}

export interface IntakeLinkSummary {
  appointment_fhir_id: string;
  status: IntakeLinkStatus;
  expires_at: string;
}

export interface IntakeResponseRecord {
  id: number;
  patient_fhir_id: string;
  appointment_fhir_id: string | null;
  questionnaire_url: string;
  questionnaire_version: string | null;
  answers: fhir4.QuestionnaireResponseItem[];
  submitted_at: string;
  status: IntakeResponseStatus;
  imported_qr_id: string | null;
}

async function intakeJson<T>(path: string, init?: RequestInit): Promise<T> {
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

function send<T>(path: string, method: string, body: unknown): Promise<T> {
  return intakeJson<T>(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export function issueIntakeLink(payload: {
  appointment_id?: string;
  patient_id?: string;
  questionnaire_urls?: string[];
}): Promise<IssuedIntakeLink> {
  return send("/intake/links", "POST", payload);
}

export async function fetchIntakeLinks(appointmentIds: string[]): Promise<IntakeLinkSummary[]> {
  if (appointmentIds.length === 0) return [];
  const body = await intakeJson<{ items: IntakeLinkSummary[] }>(
    `/intake/links?appointment_ids=${encodeURIComponent(appointmentIds.join(","))}`,
  );
  return body.items;
}

export async function fetchIntakeResponses(patientId: string, status: IntakeResponseStatus | "all" = "pending") {
  const body = await intakeJson<{ items: IntakeResponseRecord[] }>(
    `/intake/responses?patient_id=${encodeURIComponent(patientId)}&status=${status}`,
  );
  return body.items;
}

export function fetchIntakeResponse(id: number): Promise<IntakeResponseRecord> {
  return intakeJson(`/intake/responses/${id}`);
}

export function markIntakeResponse(
  id: number,
  payload: { status: "imported"; imported_qr_id: string } | { status: "discarded" },
): Promise<IntakeResponseRecord> {
  return send(`/intake/responses/${id}`, "PATCH", payload);
}
