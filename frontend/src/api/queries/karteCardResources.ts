import { useQuery } from "@tanstack/react-query";
import { searchResource } from "../fhirClient";
import { appendDetailRevincludes, detailKeySuffix } from "./core";

/**
 * オーダー系以外のカード(診療記録・バイタル・テンプレートなど)の記録を、来歴と Task を添えて
 * 引き直す。カルテカードの FHIRリソース表示で、モーダルを開いたときだけ走る。
 */
export function useKarteCardResources(type: fhir4.FhirResource["resourceType"], ids: string[]) {
  const options = { audit: true };
  const params = new URLSearchParams();
  params.set("_id", ids.join(","));
  params.set("_count", String(Math.max(ids.length, 1)));
  appendDetailRevincludes(params, options);

  return useQuery({
    queryKey: [type, "search", "karte-card", ids, ...detailKeySuffix(options)],
    queryFn: () => searchResource<fhir4.Resource>(type, params),
    enabled: ids.length > 0,
  });
}
