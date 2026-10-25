import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { NcdSurgery } from "../../fhir/ncdHelpers";
import { fetchTemplateResponses } from "./cancerRegistry";
import { fetchSurgeryExtract } from "./surgeryExtract";

// NCD の症例登録の対象(手術の実施記録)と登録(docs/ncd-registration-design.md §4)。
// 手術は手術実績の抽出と同じ検索(ハブ + 子 + 測定値 + 申込)、登録は院内がん登録と同じ手(テンプレートの全版の
// canonical と候補の患者)で引き、回答の partOf でハブに当てる。

export interface NcdSurgeries {
  surgeries: NcdSurgery[];
  patients: Map<string, fhir4.Patient>;
  truncated: boolean;
}

/** 入室日が from〜to の手術(実施記録のハブ)。departmentId を渡すと依頼科で絞る。 */
export function useNcdSurgeries(from: string, to: string, departmentId: string) {
  return useQuery({
    queryKey: ["Procedure", "search", "ncd-surgeries", from, to, departmentId],
    queryFn: async (): Promise<NcdSurgeries> => {
      const result = await fetchSurgeryExtract(
        { from, to, departmentId: departmentId || undefined },
        new AbortController().signal,
      );
      const surgeries = result.hubs
        .filter((hub) => hub.status !== "not-done")
        .map((hub): NcdSurgery => {
          const children = result.children.get(hub.id ?? "") ?? [];
          const observations = [hub.id ?? "", ...children.map((c) => c.id ?? "")].flatMap(
            (id) => result.observations.get(id) ?? [],
          );
          const orderId = hub.basedOn?.find((r) => r.reference?.startsWith("ServiceRequest/"))?.reference?.split("/").pop();
          return { hub, children, observations, order: orderId ? result.orders.get(orderId) : undefined };
        });
      return { surgeries, patients: result.patients, truncated: result.truncated };
    },
    enabled: Boolean(from) && Boolean(to),
    placeholderData: keepPreviousData,
  });
}

/** 症例登録のテンプレート(全版)への回答のうち、候補の患者のもの。 */
export function useNcdRegistrations(templateUrl: string, patientIds: string[]) {
  const ids = [...new Set(patientIds.filter(Boolean))].sort();
  return useQuery({
    queryKey: ["QuestionnaireResponse", "search", "ncd-registrations", templateUrl, ids.join(",")],
    queryFn: () => fetchTemplateResponses(templateUrl, ids, new AbortController().signal),
    enabled: Boolean(templateUrl),
    placeholderData: keepPreviousData,
  });
}
