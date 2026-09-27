import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type AnesthesiaChartData, buildAnesthesiaChartData, isAnesthesiaChartHub } from "../../fhir/anesthesiaChartHelpers";
import { postBundle, searchResource } from "../fhirClient";

// ---- 麻酔チャート(docs/anesthesia-chart-design.md) ----

const PART_OF_PAGE = 500;
// ページ数の上限は暴走ガード(超えたら以降を捨てる。4 ページ = 2000 件)。
const PART_OF_MAX_PAGES = 4;

/**
 * part-of の子を全件読む。5 分毎の打点 × 数時間で 1 ページに収まらないことがあるので、
 * 1 ページ目の total から残りのページ数を決め、2 ページ目以降は並列に読む。
 */
async function fetchAllByPartOf<T extends fhir4.Resource>(
  resourceType: string,
  hubId: string,
): Promise<T[]> {
  const fetchPage = async (page: number) => {
    const params = new URLSearchParams();
    params.set("part-of", `Procedure/${hubId}`);
    params.set("_count", String(PART_OF_PAGE));
    params.set("_offset", String(page * PART_OF_PAGE));
    const { data: bundle } = await searchResource<T>(resourceType, params);
    return {
      total: bundle.total,
      resources: (bundle.entry ?? [])
        .filter((entry) => entry.search?.mode !== "include")
        .map((entry) => entry.resource)
        .filter((resource): resource is T => resource?.resourceType === resourceType),
    };
  };

  const first = await fetchPage(0);
  const total = first.total ?? first.resources.length;
  const pages = Math.min(Math.ceil(total / PART_OF_PAGE), PART_OF_MAX_PAGES);
  if (pages <= 1) return first.resources;

  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, (_, i) => fetchPage(i + 1).then((r) => r.resources)),
  );
  return [...first.resources, ...rest.flat()];
}

async function fetchAnesthesiaChart(orderId: string): Promise<AnesthesiaChartData | null> {
  const params = new URLSearchParams();
  params.set("based-on", `ServiceRequest/${orderId}`);
  params.set("_count", "100");
  const { data: bundle } = await searchResource<fhir4.Procedure>("Procedure", params);
  const hub = (bundle.entry ?? [])
    .map((entry) => entry.resource)
    .filter((resource): resource is fhir4.Procedure => resource?.resourceType === "Procedure")
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
