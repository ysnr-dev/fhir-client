import { endoscopyItemLayoutHooks, useEndoscopyItemSearch } from "../api/masterQueries";
import type { EndoscopyItem } from "../api/masterClient";
import { EndoscopyItemSearchModal } from "../components/EndoscopyItemSearchModal";
import { ItemLayoutPage, type ItemLayoutPageConfig } from "./ItemLayoutPage";

const CONFIG: ItemLayoutPageConfig<"item_code", EndoscopyItem> = {
  title: "内視鏡オーダーレイアウト",
  hooks: endoscopyItemLayoutHooks,
  // 打った語を名称・検査種別のどちらにも当てる。
  useCandidates: (query, enabled) => useEndoscopyItemSearch({ keyword: query }, 1, enabled),
  SearchModal: EndoscopyItemSearchModal,
  labelPlaceholder: "◆ 上部",
  placeItemLabel: "内視鏡オーダー項目を配置",
  searchPlaceholder: "名称・検査種別で検索",
};

export function EndoscopyItemLayoutPage() {
  return <ItemLayoutPage config={CONFIG} />;
}
