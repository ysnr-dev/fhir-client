import { labOrderItemLayoutHooks, useLabOrderItemSearch } from "../api/masterQueries";
import type { LabOrderItem } from "../api/masterClient";
import { LabOrderItemSearchModal } from "../components/LabOrderItemSearchModal";
import { ItemLayoutPage, type ItemLayoutPageConfig } from "./ItemLayoutPage";

const CONFIG: ItemLayoutPageConfig<"order_item_code", LabOrderItem> = {
  title: "検査オーダーレイアウト",
  hooks: labOrderItemLayoutHooks,
  useCandidates: (query, enabled) => useLabOrderItemSearch({ name: query }, 1, enabled),
  SearchModal: LabOrderItemSearchModal,
  labelPlaceholder: "◆ 生化学",
  placeItemLabel: "検査項目を配置",
  searchPlaceholder: "名称で検索",
};

export function LabOrderItemLayoutPage() {
  return <ItemLayoutPage config={CONFIG} />;
}
