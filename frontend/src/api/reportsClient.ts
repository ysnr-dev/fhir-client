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

/** 検体検査オーダー 1 件ぶんの検体ラベル PDF の URL(1 ページ = 採取管 1 本)。 */
export function labLabelPdfUrl(orderId: string): string {
  return `/reports/lab_labels/${encodeURIComponent(orderId)}/pdf`;
}

/**
 * 処方オーダー 1 件ぶんの処方箋 PDF の URL。院外処方は様式第2号、それ以外は院内の
 * 簡易様式で、どちらで刷るかはオーダーの区分から backend が決める。
 */
export function prescriptionPdfUrl(orderId: string): string {
  return `/reports/prescriptions/${encodeURIComponent(orderId)}/pdf`;
}

/** 注射オーダー(1 日分)1 件ぶんの注射箋(注射指示票を兼ねる)PDF の URL。 */
export function injectionPdfUrl(orderId: string): string {
  return `/reports/injections/${encodeURIComponent(orderId)}/pdf`;
}

/** 注射オーダー 1 件ぶんの注射ラベル PDF の URL(1 ページ = RP 1 つ)。 */
export function injectionLabelPdfUrl(orderId: string): string {
  return `/reports/injection_labels/${encodeURIComponent(orderId)}/pdf`;
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

// ---- DPC 様式1 の提出ファイル ----

export type DpcForm1ExportStatus = "none" | "in-progress" | "completed" | "amended";

/** 対象月に退院した入院 1 件と、その様式1 の状態。 */
export interface DpcForm1ExportEncounter {
  encounter_id: string;
  patient_id: string;
  patient_display: string | null;
  admit_date: string | null;
  discharge_date: string | null;
  form1_status: DpcForm1ExportStatus;
  questionnaire_response_id: string | null;
}

export interface DpcForm1ExportWarning {
  type: string;
  message: string;
  encounter_id: string | null;
  patient_id: string | null;
  patient_display: string | null;
  code: string | null;
}

export interface DpcForm1ExportSummary {
  month: string;
  /** 出力できる様式1 が 1 件も無いときは null。 */
  filename: string | null;
  facility_code: string | null;
  encounters: DpcForm1ExportEncounter[];
  warnings: DpcForm1ExportWarning[];
  /** 出力する様式1 の件数(確定・修正済み)。 */
  exported_count: number;
  /** 出力しない入院の件数(未作成・下書き)。 */
  excluded_count: number;
  record_count: number;
}

async function fetchDpcForm1ExportSummary(month: string): Promise<DpcForm1ExportSummary> {
  const res = await fetch(`/reports/dpc_form1?month=${encodeURIComponent(month)}`);
  if (res.status === 401) notifyUnauthorized();
  if (!res.ok) throw new Error(`様式1 の対象一覧の取得に失敗しました (HTTP ${res.status})`);
  return (await res.json()) as DpcForm1ExportSummary;
}

/** 退院月(YYYY-MM)ごとの、様式1 の対象入院と作成状況。 */
export function useDpcForm1ExportSummary(month: string) {
  return useQuery({
    queryKey: ["reports", "dpc_form1", month],
    queryFn: () => fetchDpcForm1ExportSummary(month),
    enabled: /^\d{4}-\d{2}$/.test(month),
  });
}

/** 様式1 の提出ファイル(FF1)の URL。開くとダウンロードになる。 */
export function dpcForm1FileUrl(month: string): string {
  return `/reports/dpc_form1/file?month=${encodeURIComponent(month)}`;
}
