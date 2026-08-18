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

/**
 * 検体ラベル帳票の引き当てに使う予約 canonical。Questionnaire には紐付かない帳票を
 * 既存の帳票レイアウト管理(canonical キー)にそのまま載せるための予約 URL で、
 * backend の LabLabelReport::LAYOUT_CANONICAL と同じ値。
 */
export const LAB_LABEL_LAYOUT_CANONICAL = "http://fhir-client.local/report/lab-label";

/** 検体検査オーダー 1 件ぶんの検体ラベル PDF の URL(1 ページ = 採取管 1 本)。 */
export function labLabelPdfUrl(orderId: string): string {
  return `/reports/lab_labels/${encodeURIComponent(orderId)}/pdf`;
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
