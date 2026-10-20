import { treatmentItemLayoutHooks, useTreatmentItemSearch } from "../api/masterQueries";
import type { TreatmentItem } from "../api/masterClient";
import { TreatmentItemSearchModal } from "../components/TreatmentItemSearchModal";
import { ItemLayoutPage, type ItemLayoutPageConfig } from "./ItemLayoutPage";

const CONFIG: ItemLayoutPageConfig<"item_code", TreatmentItem> = {
  title: "処置オーダーレイアウト",
  hooks: treatmentItemLayoutHooks,
  // 打った語を名称・略称・カナのどれにも当てる。
  useCandidates: (query, enabled) => useTreatmentItemSearch({ keyword: query }, 1, enabled),
  SearchModal: TreatmentItemSearchModal,
  labelPlaceholder: "◆ 創傷処置",
  placeItemLabel: "処置項目を配置",
  searchPlaceholder: "名称・略称・カナで検索",
};

export function TreatmentItemLayoutPage() {
  return <ItemLayoutPage config={CONFIG} />;
}
