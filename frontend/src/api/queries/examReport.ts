import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { examCriticalFindingEntries } from "../../fhir/examCriticalFindingHelpers";
import {
  buildExamReportDeleteEntries,
  EXAM_REPORT_TOO_LARGE_MESSAGE,
  examCriticalFindingOf,
  examReportBundleTooLarge,
  examReportCategorySearch,
  isExamReport,
  type ExamReportConfig,
} from "../../fhir/examReportHelpers";
import { buildCancelledNotificationTask, notificationTaskEntry } from "../../fhir/notificationHelpers";
import {
  isReviewableReportStatus,
  RESULT_REVIEW_TASK_CODE,
  urgentAwareReviewTaskEntries,
  urgentNotificationOpenAfter,
} from "../../fhir/resultReviewHelpers";
import { postBundle, readResource, searchResource } from "../fhirClient";
import { NOTIFICATION_TASK_KEY, resourcesOfType } from "./core";
import { useLabResultDetail } from "./labResult";
import { fetchOrderRequester, fetchReportTasks } from "./notification";

// ---- 検査レポート(読影・生理検査・内視鏡の所見) ----
//
// 構造は fhir/examReportHelpers(docs/exam-report-design.md)。オーダー 1 件にレポート 1 件。

/** オーダーにレポートが付いているか。実施の取消を止めるのに使う。 */
export async function orderHasExamReport(config: ExamReportConfig, orderId: string): Promise<boolean> {
  const params = new URLSearchParams();
  params.set("based-on", `ServiceRequest/${orderId}`);
  params.set("category", examReportCategorySearch(config));
  params.set("_summary", "count");
  const { data: bundle } = await searchResource<fhir4.DiagnosticReport>("DiagnosticReport", params);
  return (bundle.total ?? 0) > 0;
}

/**
 * 実施の取消を止める。実施記録を消すとレポートの検査日時の根拠が消え、
 * 実施していない検査に所見が残る(docs/rad-report-design.md §8)。
 */
export async function assertNoExamReportForCancel(config: ExamReportConfig, orderId: string) {
  if (await orderHasExamReport(config, orderId)) {
    const { report } = config.labels;
    throw new Error(`${report}があるため取り消せません。${report}を削除してから取り消してください。`);
  }
}

/**
 * オーダーの削除を止める(`revincludes: ["DiagnosticReport:based-on"]` で添えたレポートを見る)。
 * レポートの basedOn が指す先が無くなるため。
 */
export function examReportDeleteGuard(config: ExamReportConfig) {
  return (bundle: fhir4.Bundle) => {
    const reports = resourcesOfType<fhir4.DiagnosticReport>(bundle, "DiagnosticReport");
    if (reports.some((report) => isExamReport(config, report))) {
      const { report } = config.labels;
      throw new Error(`${report}があるため削除できません。${report}を削除してから削除してください。`);
    }
  };
}

/** オーダーに付いたレポート(所見の Observation を添える)。入力モーダルが使う。 */
export function useExamReportByOrder(config: ExamReportConfig, orderId: string | undefined) {
  const params = new URLSearchParams();
  if (orderId) params.set("based-on", `ServiceRequest/${orderId}`);
  params.append("_include", "DiagnosticReport:result");
  params.set("_count", "10");

  return useQuery({
    queryKey: ["DiagnosticReport", "detail", `${config.kind}-order`, orderId],
    queryFn: () => searchResource<fhir4.Resource>("DiagnosticReport", params),
    enabled: Boolean(orderId),
  });
}

/** レポートの内容(所見の Observation を添える)。取得の形は検体検査結果と同じ。 */
export function useExamReportDetail(reportId: string | undefined) {
  return useLabResultDetail(reportId);
}

/**
 * レポート保存の Bundle に通知を足す。宛先(依頼医)と既存の通知 2 種はここで引く。
 *
 * - 重要所見: 要点があれば暫定報告でも出す。要点の変更で未確認に戻し、外したら取り下げる
 * - 検査結果確認: 最終報告・訂正報告になったとき(暫定報告では出さない)。ただし重要所見が
 *   未確認で残る間は出さず、未確認のものは取り下げる(重要所見の確認で既読も残すため)
 */
async function withExamReportTasks(
  config: ExamReportConfig,
  bundle: fhir4.Bundle,
): Promise<fhir4.Bundle> {
  const entry = bundle.entry ?? [];
  const reportEntry = entry.find((e) => e.resource?.resourceType === "DiagnosticReport");
  const report = reportEntry?.resource as fhir4.DiagnosticReport | undefined;
  const reference = report?.id ? `DiagnosticReport/${report.id}` : reportEntry?.fullUrl;
  if (!report || !reference) return bundle;

  const criticalCode = config.critical.taskCode.code;
  const patientId = report.subject?.reference?.split("/").pop() ?? "";
  const orderReference = report.basedOn?.[0]?.reference;
  const orderId = orderReference?.split("/").pop();
  const [owner, tasks] = await Promise.all([
    orderId ? fetchOrderRequester(orderId) : Promise.resolve(undefined),
    report.id
      ? fetchReportTasks(report.id, [RESULT_REVIEW_TASK_CODE.code, criticalCode])
      : Promise.resolve(new Map<string, fhir4.Task>()),
  ]);

  const date = report.effectiveDateTime?.slice(0, 10) ?? "";
  const exam = report.code?.text ?? "";
  const basedOn = orderReference ? [{ reference: orderReference }] : undefined;

  const existingCritical = tasks.get(criticalCode);
  const criticalEntries = examCriticalFindingEntries(
    config,
    {
      reportReference: reference,
      patientId,
      owner,
      date,
      exam,
      point: examCriticalFindingOf(config, report),
      basedOn,
    },
    existingCritical,
  );

  return {
    ...bundle,
    entry: [
      ...entry,
      ...criticalEntries,
      ...urgentAwareReviewTaskEntries(
        { reportReference: reference, patientId, owner, kind: config.kind, date, summary: exam, basedOn },
        isReviewableReportStatus(report.status),
        tasks.get(RESULT_REVIEW_TASK_CODE.code),
        urgentNotificationOpenAfter(criticalEntries, existingCritical),
      ),
    ],
  };
}

function invalidateExamReport(
  queryClient: ReturnType<typeof useQueryClient>,
  config: ExamReportConfig,
) {
  queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "search"] });
  queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "detail"] });
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", `${config.kind}-worklist`] });
  queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse"] });
  queryClient.invalidateQueries({ queryKey: NOTIFICATION_TASK_KEY });
}

/**
 * レポートの登録・更新(Bundle は examReportHelpers の buildExamReportBundle)。
 * 新しく送る画像が上流の本文上限に届く量なら、送る前に止める。
 */
export function useSaveExamReport(config: ExamReportConfig) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (bundle: fhir4.Bundle) => {
      if (examReportBundleTooLarge(bundle)) throw new Error(EXAM_REPORT_TOO_LARGE_MESSAGE);
      return postBundle(await withExamReportTasks(config, bundle));
    },
    retry: false,
    onSuccess: () => invalidateExamReport(queryClient, config),
  });
}

/**
 * レポートの削除。所見・テンプレート回答を消し、未確認の通知(検査結果確認・重要所見)を
 * 取り下げる。削除したレポートを指す通知が未確認のまま残らないようにするため。
 */
export function useDeleteExamReport(config: ExamReportConfig) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (reportId: string) => {
      const [{ data: report }, tasks] = await Promise.all([
        readResource<fhir4.DiagnosticReport>("DiagnosticReport", reportId),
        fetchReportTasks(reportId, [RESULT_REVIEW_TASK_CODE.code, config.critical.taskCode.code]),
      ]);
      const cancelEntries = Array.from(tasks.values())
        .filter((task) => task.status === "requested")
        .map((task) => notificationTaskEntry(buildCancelledNotificationTask(task), task.id));
      return postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: [...buildExamReportDeleteEntries(config, report), ...cancelEntries],
      });
    },
    retry: false,
    onSuccess: () => invalidateExamReport(queryClient, config),
  });
}
