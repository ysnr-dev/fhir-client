// 帳票出力(/reports/*)のクライアント。認証は /fhir と同水準
// (ログインセッション Cookie。GET のみなので CSRF トークンは不要)。
import { useQuery } from "@tanstack/react-query";
import { notifyUnauthorized } from "./session";

export interface ReportLayoutStatus {
  registered: boolean;
  name?: string;
  updated_at?: string;
}

export async function fetchReportLayoutStatus(canonical: string): Promise<ReportLayoutStatus> {
  const res = await fetch(`/reports/layouts?canonical=${encodeURIComponent(canonical)}`);
  if (res.status === 401) notifyUnauthorized();
  if (!res.ok) throw new Error(`帳票レイアウトの照会に失敗しました (HTTP ${res.status})`);
  return (await res.json()) as ReportLayoutStatus;
}

/** QuestionnaireResponse の帳票 PDF の URL(新規タブでそのまま開ける)。 */
export function questionnaireResponsePdfUrl(qrId: string): string {
  return `/reports/questionnaire_responses/${encodeURIComponent(qrId)}/pdf`;
}

/** canonical(url|version)に帳票レイアウトが登録されているかを照会する。 */
export function useReportLayoutStatus(canonical: string | undefined) {
  return useQuery({
    queryKey: ["reports", "layout_status", canonical],
    queryFn: () => fetchReportLayoutStatus(canonical!),
    enabled: Boolean(canonical),
    // レイアウトの登録・差し替えは稀なので、画面を行き来するたびに照会しない。
    staleTime: 5 * 60_000,
    retry: false,
  });
}
