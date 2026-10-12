import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  buildKarteCardVersions,
  karteCardHistoryPlan,
  resourceVersionsOf,
  type HistoryCardItem,
  type ResourceVersion,
} from "../../fhir/karteCardHistory";
import { readHistory, readTypeHistory } from "../fhirClient";
import { hasNextPage, SearchLimitError } from "./core";

const HISTORY_PAGE = 500;
const HISTORY_MAX_PAGES = 10;

// 検索条件で絞った型レベル履歴を全ページ読む。版が欠けるとカードを組み直せないので、
// 上限に達したら投げる。
async function readAllTypeHistory(resourceType: string, params: URLSearchParams): Promise<ResourceVersion[]> {
  const versions: ResourceVersion[] = [];
  for (let page = 0; page < HISTORY_MAX_PAGES; page += 1) {
    const pageParams = new URLSearchParams(params);
    pageParams.set("_count", String(HISTORY_PAGE));
    pageParams.set("_offset", String(page * HISTORY_PAGE));
    const { data: bundle } = await readTypeHistory(resourceType, pageParams);
    versions.push(...resourceVersionsOf(bundle));
    if (!hasNextPage(bundle)) return versions;
  }
  throw new SearchLimitError();
}

function idsOf(versions: ResourceVersion[]): string[] {
  return [...new Set(versions.map((version) => version.reference.split("/").pop() ?? ""))].filter(Boolean);
}

async function readCardVersions(item: HistoryCardItem): Promise<ResourceVersion[]> {
  const plan = karteCardHistoryPlan(item);
  const versions: ResourceVersion[] = [];

  if (plan.identifier) {
    const params = new URLSearchParams({ identifier: plan.identifier });
    versions.push(...(await readAllTypeHistory("Observation", params)));
  }
  if (plan.main) {
    const { data } = await readHistory(plan.main.resourceType, plan.main.id);
    versions.push(...resourceVersionsOf(data));
  }
  if (plan.main && plan.children === "MedicationRequest") {
    const params = new URLSearchParams({ "based-on": `ServiceRequest/${plan.main.id}` });
    versions.push(...(await readAllTypeHistory("MedicationRequest", params)));
  }
  if (plan.main && plan.children === "ServiceRequest") {
    // ヘッダ → 明細 → 構成項目の 2 段。構成項目は明細(消したものも含む)を親に引く。
    const items = await readAllTypeHistory(
      "ServiceRequest",
      new URLSearchParams({ "based-on": `ServiceRequest/${plan.main.id}` }),
    );
    versions.push(...items);
    const itemIds = idsOf(items);
    if (itemIds.length > 0) {
      const params = new URLSearchParams({ "based-on": itemIds.map((id) => `ServiceRequest/${id}`).join(",") });
      versions.push(...(await readAllTypeHistory("ServiceRequest", params)));
    }
  }
  return versions;
}

/**
 * カルテカードの変更履歴(編集ごとのカード。新しい順)。モーダルを開いたときだけ引く。
 * クエリキーは本体の型と id の配下に置き、更新の invalidate が効くようにする。
 */
export function useKarteCardHistory(item: HistoryCardItem) {
  const plan = karteCardHistoryPlan(item);
  const query = useQuery({
    queryKey: [plan.main?.resourceType ?? "Observation", plan.main?.id ?? plan.identifier, "card-history"],
    queryFn: () => readCardVersions(item),
  });
  const versions = useMemo(
    () => (query.data ? buildKarteCardVersions(item, query.data) : []),
    [item, query.data],
  );
  return { ...query, versions };
}
