import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  buildPrescriptionDeleteBundle,
  isPrescriptionServiceRequest,
  PRESCRIPTION_CATEGORY_SYSTEM,
} from "../../fhir/prescriptionHelpers";
import { rxTasksByOrderId } from "../../fhir/rxTaskHelpers";
import { postBundle } from "../fhirClient";
import { comparePatientNumber, fetchWorklistBundles, worklistParams } from "./worklist";

// ---- 処方一覧(部門ワークリスト) ----
//
// 処方日(交付日 = 登録日 authoredOn の日付)で 1 日ぶんの処方オーダーを読む。画面の作りは
// 検体検査一覧と同じで、入外区分・処方区分・診療科での絞り込みは画面側で行う(理由は
// 検体検査一覧の節のコメントを参照)。
//
// 他の部門一覧と違って開始日(occurrence = 投与開始日)で引かないのは、薬剤部は「今日交付
// された処方」を当日に受け取って開始日の前日までに調剤するため。入院の定期処方は木曜に
// 出して月曜開始のような形になるので、開始日で引くと月曜まで一覧に出てこない。開始日は
// 一覧の列で見せる。
//
// 処方オーダーはオーダー種別(order-type)を持たない(種別が無いものを処方とする)ので、
// 検体検査・放射線検査のように種別コードでは引けない。代わりに処方オーダーだけが持つ
// 処方区分の CodeSystem を system だけ指定して引く(FHIR token 検索の `system|` 形式)。

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
      // 処方オーダーはオーダー種別(order-type)を持たない(種別が無いものを処方とする)ので、
      // 処方オーダーだけが持つ処方区分の CodeSystem を system だけ指定して引く
      // (FHIR token 検索の `system|` 形式。注射は別の CodeSystem なので混ざらない)。
      const params = worklistParams(`${PRESCRIPTION_CATEGORY_SYSTEM}|`, date, page, "authoredon");
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
        // 検索で絞り込んではいるが、オーダー種別を持たないことも確かめてから並べる
        // (注射・検体検査が処方として混ざらないようにする最後の砦)。
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
