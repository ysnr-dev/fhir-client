import { radItemLayoutHooks, useRadItemSearch } from "../api/masterQueries";
import type { RadItem } from "../api/masterClient";
import { RadItemSearchModal } from "../components/RadItemSearchModal";
import { ItemLayoutPage, type ItemLayoutPageConfig } from "./ItemLayoutPage";

const CONFIG: ItemLayoutPageConfig<"item_code", RadItem> = {
  title: "放射線オーダーレイアウト",
  hooks: radItemLayoutHooks,
  // 打った語を名称・モダリティ・部位のどれにも当てる。
  useCandidates: (query, enabled) => useRadItemSearch({ keyword: query }, 1, enabled),
  SearchModal: RadItemSearchModal,
  labelPlaceholder: "◆ 一般撮影",
  placeItemLabel: "放射線項目を配置",
  searchPlaceholder: "名称・モダリティ・部位で検索",
};

export function RadItemLayoutPage() {
  return <ItemLayoutPage config={CONFIG} />;
}
