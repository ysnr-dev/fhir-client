import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ORDER_TYPE_SYSTEM } from "../../fhir/orderHeader";
import {
  buildTreatmentOrderDeleteBundle,
  isTreatmentServiceRequest,
  TREATMENT_ORDER_TYPE,
  treatmentOrderItemRequests,
  treatmentOrderTime,
} from "../../fhir/treatmentOrderHelpers";
import { buildTreatmentPerformDeleteEntries } from "../../fhir/treatmentResultHelpers";
import {
  buildTreatmentTaskUpdate,
  treatmentTasksByOrderId,
  treatmentTaskStatus,
  type TreatmentTaskStatus,
} from "../../fhir/treatmentTaskHelpers";
import { buildRescheduleEntries } from "../../fhir/appointmentHelpers";
import { postBundle } from "../fhirClient";
import { fetchAppointmentSlots, invalidateAppointments } from "./appointment";
import { makeOrderDetailHook, ORDER_ITEM_REVINCLUDES } from "./core";
import { invalidateProvenance, useWithOrderProvenance } from "./provenance";
import type { RadBookingChange } from "./rad";
import {
  cancelsPerform,
  deleteOrderWithItems,
  fetchWorklistBundles,
  makePerformDetailHook,
  makeUpdateTaskStatusHook,
  performCancelEntries,
  worklistParams,
} from "./worklist";

// ---- 処置オーダー ----
//
// 生理検査と同じ形。ヘッダと明細が別リソースなので 1 リクエストにまとめて取り、
// 部門一覧・実施記録・予約の扱いも同型にしている。違うのは明細がテンプレート回答
// (QuestionnaireResponse)を参照しないので、削除で片付ける対象がオーダーと予約だけな点。

export const useTreatmentOrderDetail = makeOrderDetailHook("treatment-order", ORDER_ITEM_REVINCLUDES);

export const useTreatmentPerformDetail = makePerformDetailHook("treatment-perform", { observations: false });

/** 処置一覧の 1 行。オーダー(ヘッダ)1 件ぶん。 */
export interface TreatmentWorklistRow {
  order: fhir4.ServiceRequest;
  /** 処置項目(明細)。セットの構成項目まで含む平坦な一覧。 */
  itemRequests: fhir4.ServiceRequest[];
  patient?: fhir4.Patient;
  /** 進捗。部門がまだ触っていないオーダーには無い(= 依頼済)。 */
  task?: fhir4.Task;
}

export interface TreatmentWorklistResult {
  rows: TreatmentWorklistRow[];
  /** 上限まで読んでも読み切れなかった。 */
  truncated: boolean;
}

async function fetchTreatmentWorklist(date: string): Promise<TreatmentWorklistResult> {
  const orders: fhir4.ServiceRequest[] = [];
  const items: fhir4.ServiceRequest[] = [];

  const { patientsById, tasks, truncated } = await fetchWorklistBundles(
    (page) => {
      const params = worklistParams(
        `${ORDER_TYPE_SYSTEM}|${TREATMENT_ORDER_TYPE.code}`,
        date,
        page,
        "occurrence",
      );
      // 処置項目も同じ応答に添えてもらう。
      params.set("_revinclude:iterate", "ServiceRequest:based-on");
      params.set("_revinclude", "Task:focus");
      return params;
    },
    (resource) => {
      if (resource.resourceType !== "ServiceRequest") return false;
      const request = resource as fhir4.ServiceRequest;
      // 検索にヒットしたヘッダと、添えられた明細を分ける。
      if (isTreatmentServiceRequest(request) && !request.basedOn?.length) {
        orders.push(request);
        return true;
      }
      items.push(request);
      return false;
    },
  );

  const taskByOrderId = treatmentTasksByOrderId(tasks);

  const rows = orders.map((order) => ({
    order,
    itemRequests: treatmentOrderItemRequests(items, order.id ?? ""),
    patient: patientsById.get(order.subject?.reference?.split("/").pop() ?? ""),
    task: taskByOrderId.get(order.id ?? ""),
  }));

  // 実施時刻の早い順。時刻を指定していないオーダー(実施日だけ)は後ろにまとめる。
  rows.sort((a, b) => treatmentWorklistSortKey(a).localeCompare(treatmentWorklistSortKey(b)));

  return { rows, truncated };
}

function treatmentWorklistSortKey(row: TreatmentWorklistRow): string {
  return treatmentOrderTime(row.order) || "99:99";
}

/** 実施日 1 日ぶんの処置オーダー。日付が未選択の間は読みに行かない。 */
export function useTreatmentWorklist(date: string) {
  return useQuery({
    queryKey: TREATMENT_WORKLIST_KEY(date),
    queryFn: () => fetchTreatmentWorklist(date),
    enabled: Boolean(date),
    placeholderData: keepPreviousData,
  });
}

const TREATMENT_WORKLIST_KEY = (date: string) => ["ServiceRequest", "treatment-worklist", date];

/** 受付・実施などの進捗を書き込む。実施済から戻す(取消)ときは、実施記録も同じ transaction で消す。 */
export const useUpdateTreatmentTaskStatus = makeUpdateTaskStatusHook<TreatmentTaskStatus>(
  buildTreatmentTaskUpdate,
  "treatment-worklist",
  {
    cancelPerform: {
      cancels: cancelsPerform(treatmentTaskStatus),
      entries: (order) =>
        performCancelEntries(order.id ?? "", { observations: false }, buildTreatmentPerformDeleteEntries),
    },
  },
);

/**
 * 処置の実施登録。実施記録(Procedure 一式)と Task の完了を 1 つの
 * transaction で書き込む。Bundle の組み立ては treatmentResultHelpers を参照。
 */
export function useRegisterTreatmentPerform() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "treatment-worklist"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["Procedure", "search"] });
    },
  });
}

/**
 * 処置オーダーの更新。予約日時を変えたときは、予約の付け替え(Appointment の
 * 日時と枠の busy/free)も同じ transaction で書く。オーダーだけ・予約だけが動いて
 * 実施日時が食い違うことを防ぐため。
 */
export function useUpdateTreatmentOrder() {
  const queryClient = useQueryClient();
  const withProvenance = useWithOrderProvenance();
  return useMutation({
    mutationFn: async ({
      bundle,
      booking,
    }: {
      bundle: fhir4.Bundle;
      booking: RadBookingChange | null;
    }) => {
      if (!booking) return postBundle(withProvenance(bundle));
      // 空きに戻す元の枠は参照しか持っていないので、ここで引き直す(取消と同じ)。
      const entries = buildRescheduleEntries(
        booking.appointment,
        await fetchAppointmentSlots(booking.appointment),
        booking.slots,
      );
      return postBundle(withProvenance({ ...bundle, entry: [...(bundle.entry ?? []), ...entries] }));
    },
    onSuccess: () => {
      // 実施日時が動くと処置一覧の当日ぶんも変わるので、ServiceRequest は
      // まとめて読み直させる。
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
      invalidateAppointments(queryClient);
      invalidateProvenance(queryClient);
    },
  });
}

/**
 * 紐づく予約の取消も同じ transaction に同梱する。
 * useDeleteTreatmentOrder の本体(読み直しの指示を伴わない)。パスの取り消しがまとめて消すときにも使う。
 */
export const deleteTreatmentOrderRequest = (srId: string) =>
  deleteOrderWithItems(srId, {
    itemsOf: treatmentOrderItemRequests,
    withAppointment: true,
    build: ({ srId, itemIds, appointmentEntries }) =>
      buildTreatmentOrderDeleteBundle(srId, itemIds, appointmentEntries),
  });

export function useDeleteTreatmentOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteTreatmentOrderRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
      queryClient.invalidateQueries({ queryKey: ["Appointment"] });
      queryClient.invalidateQueries({ queryKey: ["Slot"] });
    },
  });
}
