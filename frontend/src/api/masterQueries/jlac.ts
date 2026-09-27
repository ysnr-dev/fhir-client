import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchJlacItemFilterOptions, type JlacItemDrilldown, searchJlacItems } from "../masterClient";
import { MASTER_SEARCH_PER } from "./medicine";

// 検査項目選択モーダルの結果一覧。名称検索は大項目リストの絞り込み専用なので
// ここには渡さない(一覧は区分名称・大項目・材料・測定法の選択だけで決まる)。
export function useJlacItemSearch(drilldown: JlacItemDrilldown, page: number, enabled: boolean) {
  return useQuery({
    queryKey: ["master", "jlac_items", "search", drilldown, page],
    queryFn: () => searchJlacItems({ ...drilldown, page, per: MASTER_SEARCH_PER }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

// 段階的絞り込みの選択肢。選択が変わるたびに引き直すため、リストが一瞬空に
// ならないよう前回値を保持する。
export function useJlacItemFilterOptions(
  params: JlacItemDrilldown & { name?: string },
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["master", "jlac_items", "filter_options", params],
    queryFn: () => fetchJlacItemFilterOptions(params),
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    enabled,
  });
}
