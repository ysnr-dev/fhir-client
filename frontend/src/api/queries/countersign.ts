import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  NOTE_COUNTERSIGN_TASK_CODE,
  NOTE_RETURNED_TASK_CODE,
  type Supervisor,
} from "../../fhir/countersignHelpers";
import { splitNotificationBundle } from "../../fhir/notificationHelpers";
import { ORDER_APPROVAL_TASK_CODE } from "../../fhir/orderApprovalTaskHelpers";
import {
  practitionerDisplayName,
  traineeLevelOf,
  type TraineeLevel,
} from "../../fhir/practitionerHelpers";
import type { OrderEnterer } from "../../fhir/provenanceHelpers";
import { transactionBundle, withVersionLock } from "../../fhir/shared";
import { TASK_CODE_SYSTEM } from "../../fhir/taskHelpers";
import { useCurrentPractitioner } from "../authQueries";
import { postBundle, searchResource } from "../fhirClient";
import { useMySupervision } from "../masterQueries";
import { NOTIFICATION_TASK_KEY, resourcesOfType } from "./core";

// 研修医のカウンターサイン(docs/countersign-design.md)の読み書き。

/** ログイン中の医療従事者が、研修医・指導医としてどう見えるか。 */
export interface CountersignContext {
  /** 来歴・通知に名乗る本人。研修区分と指導医を添える。医療従事者に紐付かないアカウントでは null。 */
  enterer: OrderEnterer | null;
  practitionerId: string | null;
  traineeLevel: TraineeLevel | "";
  /** 研修医として仰ぐ指導医。 */
  supervisors: Supervisor[];
  /** 指導医として受け持つ研修医の id。 */
  trainees: Set<string>;
}

export function useCountersignContext(): CountersignContext {
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const mine = useMySupervision(practitionerId);
  const traineeLevel = traineeLevelOf(practitioner);
  const supervisors = useMemo<Supervisor[]>(
    () =>
      (mine.data?.supervisors ?? []).map((m) => ({ practitionerId: m.practitioner_fhir_id, display: m.display_name })),
    [mine.data],
  );
  const trainees = useMemo(
    () => new Set((mine.data?.trainees ?? []).map((m) => m.practitioner_fhir_id)),
    [mine.data],
  );
  const enterer = useMemo<OrderEnterer | null>(
    () =>
      practitionerId && practitioner
        ? { practitionerId, display: practitionerDisplayName(practitioner), traineeLevel, supervisors }
        : null,
    [practitionerId, practitioner, traineeLevel, supervisors],
  );
  return { enterer, practitionerId, traineeLevel, supervisors, trainees };
}

/** その記録のカウンターサインの通知(承認待ち・差戻し)。閉じたものも含めて全部(コメント歴のため)。 */
export async function fetchNoteTasks(compositionIds: string[]): Promise<fhir4.Task[]> {
  const ids = compositionIds.filter(Boolean);
  if (ids.length === 0) return [];
  const params = new URLSearchParams();
  params.set(
    "code",
    [NOTE_COUNTERSIGN_TASK_CODE, NOTE_RETURNED_TASK_CODE].map((c) => `${TASK_CODE_SYSTEM}|${c.code}`).join(","),
  );
  params.set("focus", ids.map((id) => `Composition/${id}`).join(","));
  params.set("_sort", "authored-on");
  params.set("_count", "200");
  const { data } = await searchResource<fhir4.Task>("Task", params);
  return resourcesOfType<fhir4.Task>(data, "Task");
}

export function useNoteTasks(compositionId: string | undefined) {
  return useQuery({
    queryKey: [...NOTIFICATION_TASK_KEY, "note", compositionId],
    queryFn: () => fetchNoteTasks([compositionId as string]),
    enabled: Boolean(compositionId),
  });
}

function invalidateCountersign(queryClient: ReturnType<typeof useQueryClient>, compositionId?: string) {
  queryClient.invalidateQueries({ queryKey: ["Composition", "search"] });
  if (compositionId) queryClient.invalidateQueries({ queryKey: ["Composition", compositionId] });
  queryClient.invalidateQueries({ queryKey: NOTIFICATION_TASK_KEY });
  queryClient.invalidateQueries({ queryKey: ["Task"] });
}

/** 承認・差戻し。Composition の PUT(読んだ版を添える)と通知の entry を 1 transaction で書く。 */
export function useReviewNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      original,
      next,
      extraEntries = [],
    }: {
      original: fhir4.Composition;
      next: fhir4.Composition;
      extraEntries?: fhir4.BundleEntry[];
    }) =>
      postBundle(
        withVersionLock(
          transactionBundle([
            { resource: next, request: { method: "PUT", url: `Composition/${original.id}` } },
            ...extraEntries,
          ]),
          original,
        ),
      ),
    onSuccess: (_result, { original }) => invalidateCountersign(queryClient, original.id),
  });
}

/** コメントの追加・修正・削除(Task の PUT。読んだ版を添える)。 */
export function useSaveNoteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (task: fhir4.Task) =>
      postBundle(transactionBundle([{ resource: task, request: { method: "PUT", url: `Task/${task.id}` } }])),
    onSuccess: () => invalidateCountersign(queryClient),
  });
}

export interface CountersignTaskList {
  tasks: fhir4.Task[];
  patients: Map<string, fhir4.Patient>;
}

/**
 * カルテ承認一覧。自分あてのカウンターサイン(記録・オーダー)を未対応・対応済みで引く。
 * 患者は `_include=Task:subject` で同じ応答に付く。
 */
export function useMyCountersignTasks(ownerId: string | null, status: "requested" | "completed") {
  return useQuery({
    queryKey: [...NOTIFICATION_TASK_KEY, "countersign-list", ownerId ?? "", status],
    queryFn: async (): Promise<CountersignTaskList> => {
      const params = new URLSearchParams();
      params.set(
        "code",
        [NOTE_COUNTERSIGN_TASK_CODE, ORDER_APPROVAL_TASK_CODE].map((c) => `${TASK_CODE_SYSTEM}|${c.code}`).join(","),
      );
      params.set("owner", `Practitioner/${ownerId}`);
      params.set("status", status);
      params.set("_include", "Task:subject");
      params.set("_sort", "-authored-on");
      params.set("_count", "500");
      const { data } = await searchResource<fhir4.Resource>("Task", params);
      return splitNotificationBundle(data);
    },
    enabled: Boolean(ownerId),
  });
}
