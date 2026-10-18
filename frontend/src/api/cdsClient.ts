// CDS Hooks(docs/cds-hooks-design.md)。カルテを開いたときの patient-view と、カードの無視の feedback。
// サービスの呼び出しは backend が行い、画面は正規化済みのカードだけを受け取る。
import { buildError, masterFetch } from "./masterClient";

export type CdsIndicator = "info" | "warning" | "critical";

export interface CdsCardLink {
  label: string;
  type: "absolute" | "smart";
  url: string;
  /** smart のとき、起動 URL が一致した登録済みアプリ。無ければ起動できない。 */
  smart_app_id?: number | null;
  app_context?: string | null;
}

export interface CdsOverrideReason {
  code: string;
  system: string | null;
  display: string;
}

export interface CdsCard {
  uuid: string;
  summary: string;
  detail?: string | null;
  indicator: CdsIndicator;
  source: { label: string; url?: string; topic?: string };
  links: CdsCardLink[];
  suggestions: { label: string; actions: string[] }[];
  override_reasons: CdsOverrideReason[];
  /** feedback の宛先(提供元の id と discovery のサービス id)。 */
  service: { id: number; name: string; service: string };
}

export interface CdsPatientViewResult {
  cards: CdsCard[];
  services: { id: number; name: string; status: "ok" | "failed"; error?: string }[];
  skipped?: string;
}

export interface CdsFeedbackParams {
  service_id: number;
  service: string;
  card: string;
  outcome: "overridden";
  override_reason?: { code: string; system: string | null };
  user_comment?: string;
}

export async function fetchCdsPatientView(
  patientId: string,
  encounterId?: string,
): Promise<CdsPatientViewResult> {
  const res = await masterFetch("/integrations/cds/patient_view", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patient_id: patientId, encounter_id: encounterId }),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as CdsPatientViewResult;
}

export async function sendCdsFeedback(params: CdsFeedbackParams): Promise<void> {
  const res = await masterFetch("/integrations/cds/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw await buildError(res);
}
