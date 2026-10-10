import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ORDER_TYPE_SYSTEM } from "../../fhir/orderHeader";
import { PRESCRIPTION_ORDER_TYPE } from "../../fhir/prescriptionHelpers";
import { addDays } from "../../fhir/scheduleHelpers";
import { WORKSHEET_ORDER_TYPES } from "../../fhir/nursingWorksheetHelpers";
import { ORAL_LOOKBACK_DAYS, resourcesOfType, searchAllPages } from "./core";
import { fetchOrdersWithPerforms, type OrdersWithPerforms } from "./encounter";

// ---- 看護ワークシート(病棟の患者の 1 日) ----
//
// 看護指示と注射は指示簿・血糖インスリン一覧と同じ hook(useNursingWorklist /
// useWardInjectionOrders)で読み、ここには残りの種別を置く。病棟はどれもオーダー登録時に
// 焼き付けた order-ward で上流が絞る。

/**
 * 病棟の入院処方のうち、その日にかかりうるもの。処方は 1 件が投与日数ぶん続くので、
 * 経過表の内服欄と同じく「その日 − 92 日」から引き、有効な日かどうかは画面側で決める。
 */
export function useWardOralPrescriptions(date: string, wardId: string | undefined) {
  return useQuery({
    queryKey: ["ServiceRequest", "search", "ward-oral", date, wardId ?? ""],
    queryFn: async (): Promise<OrdersWithPerforms> => {
      const params = new URLSearchParams();
      params.set("category", `${ORDER_TYPE_SYSTEM}|${PRESCRIPTION_ORDER_TYPE.code}`);
      params.set("ward", `Location/${wardId}`);
      params.append("occurrence", `ge${addDays(date, -ORAL_LOOKBACK_DAYS)}`);
      params.append("occurrence", `le${date}`);
      params.set("status:not", "revoked,entered-in-error");
      params.set("_include", "ServiceRequest:subject");
      return fetchOrdersWithPerforms(params);
    },
    enabled: Boolean(date) && Boolean(wardId),
    placeholderData: keepPreviousData,
  });
}

/** 検体の採取・検査・処置などのオーダー(ヘッダ)と、明細・進捗・実施記録・検体ラベル。 */
export interface WardDayOrders {
  headers: fhir4.ServiceRequest[];
  items: fhir4.ServiceRequest[];
  tasks: fhir4.Task[];
  procedures: fhir4.Procedure[];
  specimens: fhir4.Specimen[];
  patients: fhir4.Patient[];
  truncated: boolean;
}

/** 病棟のその日の検体検査・細菌検査・放射線・内視鏡・生理・処置・輸血・手術のオーダー。 */
export function useWardDayOrders(date: string, wardId: string | undefined) {
  return useQuery({
    queryKey: ["ServiceRequest", "search", "ward-day-orders", date, wardId ?? ""],
    queryFn: async (): Promise<WardDayOrders> => {
      const params = new URLSearchParams();
      params.set(
        "category",
        WORKSHEET_ORDER_TYPES.map((type) => `${ORDER_TYPE_SYSTEM}|${type.code}`).join(","),
      );
      params.set("ward", `Location/${wardId}`);
      params.set("occurrence", date);
      params.set("based-on:missing", "true");
      params.set("status:not", "revoked,entered-in-error");
      params.append("_revinclude:iterate", "ServiceRequest:based-on");
      params.append("_revinclude", "Task:focus");
      params.append("_revinclude", "Procedure:based-on");
      params.append("_revinclude", "Specimen:request");
      params.set("_include", "ServiceRequest:subject");
      const { matches, bundles, truncated } = await searchAllPages<fhir4.ServiceRequest>(
        "ServiceRequest",
        params,
        { page: 500, maxPages: 4 },
      );
      const of = <T extends fhir4.Resource>(type: T["resourceType"]) =>
        bundles.flatMap((bundle) => resourcesOfType<T>(bundle, type));
      const headerIds = new Set(matches.map((sr) => sr.id));
      return {
        headers: matches,
        // 明細は _revinclude で届いた ServiceRequest のうちヘッダでないもの。
        items: of<fhir4.ServiceRequest>("ServiceRequest").filter((sr) => !headerIds.has(sr.id)),
        tasks: of<fhir4.Task>("Task"),
        procedures: of<fhir4.Procedure>("Procedure"),
        specimens: of<fhir4.Specimen>("Specimen"),
        patients: of<fhir4.Patient>("Patient"),
        truncated,
      };
    },
    enabled: Boolean(date) && Boolean(wardId),
    placeholderData: keepPreviousData,
  });
}
