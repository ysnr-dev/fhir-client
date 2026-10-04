import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  buildPrescriptionDeleteBundle,
  isPrescriptionServiceRequest,
  PRESCRIPTION_ORDER_TYPE,
} from "../../fhir/prescriptionHelpers";
import { INJECTION_ORDER_TYPE } from "../../fhir/injectionHelpers";
import { ORDER_TYPE_SYSTEM } from "../../fhir/orderHeader";
import { rxTasksByOrderId } from "../../fhir/rxTaskHelpers";
import { resourcesOfType } from "../../fhir/shared";
import { postBundle, searchResource } from "../fhirClient";
import { comparePatientNumber, fetchWorklistBundles, worklistParams } from "./worklist";

// ---- 処方一覧(部門ワークリスト) ----
//
// 処方日(交付日 = 登録日 authoredOn の日付)で 1 日ぶんの処方オーダーを読む。画面の作りは
// 検体検査一覧と同じで、入外区分・処方区分・診療科での絞り込みは画面側で行う
// (理由は api/queries/rad.ts の「放射線検査一覧」の節)。
//
// 他の部門一覧と違って開始日(occurrence = 投与開始日)で引かないのは、薬剤部は「今日交付
// された処方」を当日に受け取って開始日の前日までに調剤するため。入院の定期処方は木曜に
// 出して月曜開始のような形になるので、開始日で引くと月曜まで一覧に出てこない。開始日は
// 一覧の列で見せる。

/** 処方一覧の 1 行。オーダー(ヘッダ)1 件ぶん。 */
export interface RxWorklistRow {
  order: fhir4.ServiceRequest;
  /** 処方明細。RP ごとの用法・医薬品はここから組み立てる(groupByRp)。 */
  medicationRequests: fhir4.MedicationRequest[];
  patient?: fhir4.Patient;
  /** 進捗。部門がまだ触っていないオーダーには無い(= 依頼済)。 */
  task?: fhir4.Task;
}

export interface RxWorklistResult {
  rows: RxWorklistRow[];
  /** 上限まで読んでも読み切れなかった。 */
  truncated: boolean;
}

export async function fetchRxWorklist(date: string): Promise<RxWorklistResult> {
  const orders: fhir4.ServiceRequest[] = [];
  const medicationRequests: fhir4.MedicationRequest[] = [];

  const { patientsById, tasks, truncated } = await fetchWorklistBundles(
    (page) => {
      const params = worklistParams(`${ORDER_TYPE_SYSTEM}|${PRESCRIPTION_ORDER_TYPE.code}`, date, page, "authoredon");
      // 処方明細も同じ応答に添えてもらう。
      params.set("_revinclude", "MedicationRequest:based-on");
      params.append("_revinclude", "Task:focus");
      return params;
    },
    (resource) => {
      if (resource.resourceType === "MedicationRequest") {
        medicationRequests.push(resource as fhir4.MedicationRequest);
      } else if (resource.resourceType === "ServiceRequest") {
        const request = resource as fhir4.ServiceRequest;
        if (isPrescriptionServiceRequest(request) && !request.basedOn?.length) {
          orders.push(request);
          return true;
        }
      }
      return false;
    },
  );

  const rxTaskByOrderId = rxTasksByOrderId(tasks);
  const medicationRequestsByOrderId = new Map<string, fhir4.MedicationRequest[]>();
  for (const mr of medicationRequests) {
    for (const reference of mr.basedOn ?? []) {
      const orderId = reference.reference?.match(/^ServiceRequest\/(.+)$/)?.[1];
      if (!orderId) continue;
      const list = medicationRequestsByOrderId.get(orderId);
      if (list) list.push(mr);
      else medicationRequestsByOrderId.set(orderId, [mr]);
    }
  }

  const rows = orders.map((order) => ({
    order,
    medicationRequests: medicationRequestsByOrderId.get(order.id ?? "") ?? [],
    patient: patientsById.get(order.subject?.reference?.split("/").pop() ?? ""),
    task: rxTaskByOrderId.get(order.id ?? ""),
  }));

  // 処方オーダーは時刻を持たない(処方日だけ)ので、患者番号順に並べる(検体検査と同じ)。
  rows.sort(comparePatientNumber);

  return { rows, truncated };
}

/** useDeletePrescription の本体(読み直しの指示を伴わない)。パスの取り消しがまとめて消すときにも使う。 */
export const deletePrescriptionRequest = (srId: string) => postBundle(buildPrescriptionDeleteBundle(srId));

export function useDeletePrescription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deletePrescriptionRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
    },
  });
}

/**
 * 患者の処方・注射の薬剤(MedicationRequest)を、オーダーの新しい順に orderCount オーダーぶん読む。
 * 細菌検査オーダーの前投与抗菌薬の候補(useAntimicrobialSuggestions)に使う。
 */
export async function fetchRecentMedicationRequests(
  patientId: string,
  orderCount: number,
): Promise<fhir4.MedicationRequest[]> {
  const params = new URLSearchParams();
  params.set("patient", `Patient/${patientId}`);
  // 処方と注射のヘッダだけ。
  params.set(
    "category",
    `${ORDER_TYPE_SYSTEM}|${PRESCRIPTION_ORDER_TYPE.code},${ORDER_TYPE_SYSTEM}|${INJECTION_ORDER_TYPE.code}`,
  );
  params.set("based-on:missing", "true");
  params.set("_sort", "-authoredon");
  params.set("_count", String(orderCount));
  params.set("_revinclude", "MedicationRequest:based-on");
  const { data: bundle } = await searchResource<fhir4.Resource>("ServiceRequest", params);
  return resourcesOfType<fhir4.MedicationRequest>(bundle, "MedicationRequest");
}
