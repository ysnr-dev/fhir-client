import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { buildReviewProvenance, latestReview, provenancesOf, reviewProvenanceEntry } from "../../fhir/provenanceHelpers";
import { LAB_PANIC_NOTE, LAB_PANIC_TASK_CODE } from "../../fhir/labPanicHelpers";
import {
  ALERT_PRIORITY_PARAM,
  buildCompletedNotificationTask,
  completeNotificationEntry,
  hasTaskCode,
  splitNotificationBundle,
} from "../../fhir/notificationHelpers";
import { RAD_CRITICAL_FINDING_NOTE, RAD_CRITICAL_FINDING_TASK_CODE } from "../../fhir/radCriticalFindingHelpers";
import {
  RESULT_REVIEW_NOTE,
  RESULT_REVIEW_TASK_CODE,
  resultReviewTaskEntries,
  type ReviewReportKind,
} from "../../fhir/resultReviewHelpers";
import {
  completeNotificationEntries,
  NOTIFICATION_CODES,
  type NotificationRow,
  notificationRows,
} from "../../components/notifications/notificationRegistry";
import { TASK_CODE_SYSTEM } from "../../fhir/taskHelpers";
import { postBundle, readResource, searchResource } from "../fhirClient";
import { NOTIFICATION_TASK_KEY, resourcesOfType, WORKLIST_PAGE } from "./core";
import { useOrderEnterer } from "./provenance";

// 通知(Task) ------------------------------------------------------------------
//
// 緊急異常値・オーダー承認などの通知を 1 つのクエリで引く。種別ごとの見せ方と
// 対応の仕方は components/notifications/notificationRegistry が持つ。

/**
 * このレポートに付いている種別ごとの通知(種別コード → Task)。訂正で出し直す・取り下げるために
 * 引く。複数の種別を 1 回の検索で引く。
 */
export async function fetchReportTasks(
  reportId: string,
  codes: string[],
): Promise<Map<string, fhir4.Task>> {
  const params = new URLSearchParams();
  params.set("focus", `DiagnosticReport/${reportId}`);
  params.set("code", codes.map((code) => `${TASK_CODE_SYSTEM}|${code}`).join(","));
  params.set("_count", String(codes.length * 5));
  const { data: bundle } = await searchResource<fhir4.Task>("Task", params);
  const tasks = resourcesOfType<fhir4.Task>(bundle, "Task");
  const result = new Map<string, fhir4.Task>();
  for (const code of codes) {
    const task = tasks.find((t) => hasTaskCode(t, code));
    if (task) result.set(code, task);
  }
  return result;
}

async function fetchReportTask(reportId: string, code: string): Promise<fhir4.Task | undefined> {
  return (await fetchReportTasks(reportId, [code])).get(code);
}

/**
 * この検査結果を誰がいつ確認したか。詳細を開いたときだけ引く(一覧には載せない)。
 * 確認の正本は来歴なので、通知(Task)ではなくこちらを読む。
 */
export function useResultReviewProvenance(reportId: string | undefined) {
  const params = new URLSearchParams();
  if (reportId) params.set("target", `DiagnosticReport/${reportId}`);
  params.set("_sort", "recorded");
  params.set("_count", "20");

  return useQuery({
    queryKey: ["Provenance", "search", "report", reportId],
    queryFn: () => searchResource<fhir4.Provenance>("Provenance", params),
    select: (result) => latestReview(provenancesOf(result.data)),
    enabled: Boolean(reportId),
    staleTime: 60_000,
  });
}

/**
 * この患者の未確認のレポート id。カルテの採取日ペインの印に使う。
 * 未確認は通知(Task)が未対応であることと同じなので、来歴ではなく通知を引く。
 */
export function useUnreviewedReportIds(patientId: string | undefined) {
  const params = new URLSearchParams();
  params.set("code", `${TASK_CODE_SYSTEM}|${RESULT_REVIEW_TASK_CODE.code}`);
  params.set("status", "requested");
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("_count", String(WORKLIST_PAGE));

  return useQuery({
    queryKey: [...NOTIFICATION_TASK_KEY, "unreviewed", patientId],
    queryFn: () => searchResource<fhir4.Task>("Task", params),
    select: (result) =>
      new Set(
        (result.data.entry ?? [])
          .map((entry) => (entry.resource as fhir4.Task | undefined)?.focus?.reference)
          .map((reference) => reference?.split("/").pop())
          .filter((id): id is string => Boolean(id)),
      ),
    enabled: Boolean(patientId),
    staleTime: 60_000,
  });
}

/**
 * 検査結果を確認する。来歴(正本)を作り、その結果あての通知が未対応なら同じ transaction で
 * 対応済みにする。宛先でない医師が先に読むこともあるので、確認できる人は限らない。
 *
 * 結果を読めば緊急の通知(緊急異常値・重要所見)の内容も読んだことになるので、それらが
 * 未確認なら一緒に確認する(緊急の通知が出ている間は検査結果確認の通知を作らないため)。
 */
export function useMarkResultReviewed() {
  const queryClient = useQueryClient();
  const enterer = useOrderEnterer();
  return useMutation({
    mutationFn: async (reportId: string) => {
      if (!enterer) throw new Error("医療従事者に紐付いたアカウントでログインしてください");
      const notes: Record<string, string> = {
        [RESULT_REVIEW_TASK_CODE.code]: RESULT_REVIEW_NOTE,
        [LAB_PANIC_TASK_CODE.code]: LAB_PANIC_NOTE,
        [RAD_CRITICAL_FINDING_TASK_CODE.code]: RAD_CRITICAL_FINDING_NOTE,
      };
      const tasks = await fetchReportTasks(reportId, Object.keys(notes));
      const entry: fhir4.BundleEntry[] = [
        reviewProvenanceEntry(buildReviewProvenance(`DiagnosticReport/${reportId}`, enterer)),
      ];
      for (const [code, task] of tasks) {
        if (task.status !== "requested") continue;
        entry.push(completeNotificationEntry(buildCompletedNotificationTask(task, enterer, notes[code])));
      }
      return postBundle({ resourceType: "Bundle", type: "transaction", entry });
    },
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Provenance"] });
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_TASK_KEY });
    },
  });
}

/** オーダーの依頼医。通知の宛先に使う。 */
export async function fetchOrderRequester(orderId: string): Promise<fhir4.Reference | undefined> {
  const { data } = await readResource<fhir4.ServiceRequest>("ServiceRequest", orderId);
  return data.requester;
}

/**
 * 結果保存の Bundle に、検査結果確認の通知を足す。
 *
 * 細菌検査・病理は Bundle を組み立ててから保存フックに渡す作りなので、宛先(依頼医)と
 * 既にある通知はここで引く。中間報告のうちは通知しない(検体検査と同じ)。
 */
export async function withResultReviewTask(
  bundle: fhir4.Bundle,
  kind: ReviewReportKind,
  summaryOf: (report: fhir4.DiagnosticReport) => string,
): Promise<fhir4.Bundle> {
  const entry = bundle.entry ?? [];
  const reportEntry = entry.find((e) => e.resource?.resourceType === "DiagnosticReport");
  const report = reportEntry?.resource as fhir4.DiagnosticReport | undefined;
  const reference = report?.id ? `DiagnosticReport/${report.id}` : reportEntry?.fullUrl;
  if (!report || !reference || report.status === "preliminary") return bundle;

  const patientId = report.subject?.reference?.split("/").pop() ?? "";
  const orderReference = report.basedOn?.[0]?.reference;
  const orderId = orderReference?.split("/").pop();
  const [owner, existingTask] = await Promise.all([
    orderId ? fetchOrderRequester(orderId) : Promise.resolve(undefined),
    report.id
      ? fetchReportTask(report.id, RESULT_REVIEW_TASK_CODE.code)
      : Promise.resolve(undefined),
  ]);

  return {
    ...bundle,
    entry: [
      ...entry,
      ...resultReviewTaskEntries(
        {
          reportReference: reference,
          patientId,
          owner,
          kind,
          date: report.effectiveDateTime?.slice(0, 10) ?? "",
          summary: summaryOf(report),
          basedOn: orderReference ? [{ reference: orderReference }] : undefined,
        },
        true,
        existingTask,
      ),
    ],
  };
}

/** 一覧・件数に共通の検索条件。宛先を指定すると自分あてだけに絞る。 */
function notificationParams(ownerId?: string | null): URLSearchParams {
  const params = new URLSearchParams();
  params.set("code", NOTIFICATION_CODES);
  params.set("status", "requested");
  if (ownerId) params.set("owner", `Practitioner/${ownerId}`);
  return params;
}

/**
 * 未対応の通知。患者は `_include=Task:subject` で同じ応答に添える(上流の
 * `_include=Task:focus` は ServiceRequest しか返さないので、対象は id だけ持って
 * カルテへ渡す)。種別の絞り込みは取得済みの行に対して画面側で行う
 * (種別ごとの件数を選択肢に出すので、サーバーで絞ると他の種別の件数が消える)。
 */
export function useNotifications(ownerId?: string | null) {
  const params = notificationParams(ownerId);
  params.set("_include", "Task:subject");
  params.set("_sort", "-authored-on");
  params.set("_count", String(WORKLIST_PAGE));

  return useQuery({
    queryKey: [...NOTIFICATION_TASK_KEY, "list", ownerId ?? "all"],
    queryFn: () => searchResource<fhir4.Resource>("Task", params),
    select: (result) => {
      const { tasks, patients } = splitNotificationBundle(result.data);
      return notificationRows(tasks, patients);
    },
    staleTime: 60_000,
  });
}

/**
 * ヘッダーのベルに出す未対応件数。`_summary=count` で件数だけを引く
 * (本文も `_include` も返らないので、自動更新を入れても軽い)。
 *
 * 全体とアラート(`priority=stat,asap`)の **2 本**を引く。ベルはアラートが 1 件でも
 * あるときだけ赤くするので、内訳が要る。
 *
 * 自動更新は既定では止めてある。上流は FHIR リクエストごとに AuditEvent を 1 行書くので、
 * 無償のサーバーでは開きっぱなしの画面が監査ログとインスタンスの稼働時間を食う。
 * 止めている間も、ページ遷移・ウィンドウのフォーカス復帰・通知の書き込みでは読み直す。
 */
export function useNotificationCounts(ownerId: string | null | undefined, polling: boolean) {
  const all = useNotificationCount(ownerId, polling);
  const alert = useNotificationCount(ownerId, polling, ALERT_PRIORITY_PARAM);

  return {
    total: all.data ?? 0,
    alertTotal: alert.data ?? 0,
    isStale: all.isStale || alert.isStale,
    refetch: () => {
      all.refetch();
      alert.refetch();
    },
  };
}

function useNotificationCount(
  ownerId: string | null | undefined,
  polling: boolean,
  priority?: string,
) {
  const params = notificationParams(ownerId);
  if (priority) params.set("priority", priority);
  params.set("_summary", "count");

  return useQuery({
    queryKey: [...NOTIFICATION_TASK_KEY, "count", ownerId ?? "all", priority ?? "all"],
    queryFn: () => searchResource<fhir4.Resource>("Task", params),
    select: (result) => result.data.total ?? 0,
    staleTime: 60_000,
    refetchInterval: polling ? 60_000 : false,
    // 上流が落ちているときにヘッダーで再試行を繰り返さない(件数を出さないだけにする)。
    retry: false,
  });
}

/**
 * 通知を対応済みにする。誰がいつ対応したかを Task の note に残す。
 * オーダー承認のように別のリソース(来歴の署名)も要る種別は、レジストリが
 * その entry を同じ transaction に足す。
 */
export function useCompleteNotifications() {
  const queryClient = useQueryClient();
  const enterer = useOrderEnterer();
  return useMutation({
    mutationFn: async (rows: NotificationRow[]) => {
      if (!enterer) throw new Error("医療従事者に紐付いたアカウントでログインしてください");
      const entry = await completeNotificationEntries(rows, enterer);
      if (entry.length === 0) return null;
      return postBundle({ resourceType: "Bundle", type: "transaction", entry });
    },
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_TASK_KEY });
      queryClient.invalidateQueries({ queryKey: ["Provenance"] });
    },
  });
}
