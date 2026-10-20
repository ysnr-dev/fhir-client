import { physioItemLayoutHooks, usePhysioItemSearch } from "../api/masterQueries";
import type { PhysioItem } from "../api/masterClient";
import { PhysioItemSearchModal } from "../components/PhysioItemSearchModal";
import { ItemLayoutPage, type ItemLayoutPageConfig } from "./ItemLayoutPage";

const CONFIG: ItemLayoutPageConfig<"item_code", PhysioItem> = {
  title: "生理検査オーダーレイアウト",
  hooks: physioItemLayoutHooks,
  // 打った語を名称・検査種別のどちらにも当てる。
  useCandidates: (query, enabled) => usePhysioItemSearch({ keyword: query }, 1, enabled),
  SearchModal: PhysioItemSearchModal,
  labelPlaceholder: "◆ 心電図",
  placeItemLabel: "生理検査項目を配置",
  searchPlaceholder: "名称・検査種別で検索",
};

export function PhysioItemLayoutPage() {
  return <ItemLayoutPage config={CONFIG} />;
}
