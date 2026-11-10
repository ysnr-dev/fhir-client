import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type AnesthesiaChartData, buildAnesthesiaChartData, isAnesthesiaChartHub } from "../../fhir/anesthesiaChartHelpers";
import { postBundle, searchResource } from "../fhirClient";
import { fetchAllByPartOf, resourcesOfType } from "./core";

// ---- 麻酔チャート(docs/anesthesia-chart-design.md) ----

async function fetchAnesthesiaChart(orderId: string): Promise<AnesthesiaChartData | null> {
  const params = new URLSearchParams();
  params.set("based-on", `ServiceRequest/${orderId}`);
  params.set("_count", "100");
  const { data: bundle } = await searchResource<fhir4.Procedure>("Procedure", params);
  const hub = resourcesOfType<fhir4.Procedure>(bundle, "Procedure")
    .find(
      (procedure) => isAnesthesiaChartHub(procedure) && procedure.status !== "entered-in-error",
    );
  if (!hub?.id) return null;

  const [observations, administrations] = await Promise.all([
    fetchAllByPartOf<fhir4.Observation>("Observation", hub.id),
    fetchAllByPartOf<fhir4.MedicationAdministration>("MedicationAdministration", hub.id),
  ]);
  return buildAnesthesiaChartData(hub, observations, administrations);
}

/** オーダー 1 件の麻酔チャート。無ければ null(ページは「開始」ボタンを出す)。 */
export function useAnesthesiaChart(orderId: string | undefined) {
  return useQuery({
    queryKey: ["anesthesia-chart", orderId],
    queryFn: () => fetchAnesthesiaChart(orderId ?? ""),
    enabled: Boolean(orderId),
  });
}

/**
 * チャートへの書き込み。開始(ハブ POST)・打点/イベント/薬剤の追加・持続の終了や
 * 確定(PUT)・削除まで、すべて transaction Bundle のエントリで受ける。打点は
 * 1 時点の組を 1 transaction で書き、途中失敗で組が欠けないようにする。
 */
export function useAnesthesiaChartWrite(orderId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entries: fhir4.BundleEntry[]) =>
      postBundle({ resourceType: "Bundle", type: "transaction", entry: entries }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["anesthesia-chart", orderId] });
      // 実施取消のフェッチ(based-on 検索)にもチャートの子が載るので読み直させる。
      queryClient.invalidateQueries({ queryKey: ["Procedure", "search"] });
    },
  });
}
