import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  RX_INQUIRY_ANSWERED_TASK_CODE,
  openRxInquiryOf,
  rxInquiriesOf,
} from "../../fhir/rxInquiryHelpers";
import { hasTaskCode } from "../../fhir/notificationHelpers";
import { postBundle, searchResource } from "../fhirClient";
import { resourcesOfType } from "./core";

// 疑義照会(fhir/rxInquiryHelpers.ts)の読み書き。

/**
 * オーダーを焦点にする Task を全部(進捗・照会・回答の通知)。照会の履歴を出す画面と、
 * 回答・取下げ・調剤登録で書き換える元の版を取る画面が使う。
 */
export function useOrderInquiryTasks(orderId: string | undefined) {
  const query = useQuery({
    queryKey: ["Task", "search", "order-tasks", orderId],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("focus", `ServiceRequest/${orderId}`);
      params.set("_count", "100");
      const { data } = await searchResource<fhir4.Task>("Task", params);
      return resourcesOfType<fhir4.Task>(data, "Task");
    },
    enabled: Boolean(orderId),
  });
  const tasks = query.data ?? [];
  return {
    ...query,
    tasks,
    inquiries: rxInquiriesOf(tasks),
    openInquiry: openRxInquiryOf(tasks),
    /** 照会した薬剤師あての、まだ閉じていない回答の通知。調剤登録で閉じる。 */
    answeredNotices: tasks.filter(
      (task) => task.status === "requested" && hasTaskCode(task, RX_INQUIRY_ANSWERED_TASK_CODE.code),
    ),
  };
}

/**
 * 照会の送信・回答・取下げ。Bundle の組み立ては rxInquiryHelpers。照会は進捗も動かすので、
 * 部門一覧・カルテ・通知をまとめて読み直させる。
 */
export function useWriteRxInquiry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Task"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "rx-worklist"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "injection-worklist"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
    },
  });
}
