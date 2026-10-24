import {
  endoscopyDatasetHooks,
  useEndoscopyExamTypeOptions,
  useEndoscopyItem,
  useEndoscopyItemMutations,
  useEndoscopyItemSearch,
  useEndoscopySetItemMutations,
} from "../api/masterQueries";
import { EndoscopyItemSearchModal } from "../components/EndoscopyItemSearchModal";
import { ExamItemPage, type ExamItemPageConfig } from "./ExamItemPage";

const CONFIG: ExamItemPageConfig = {
  name: "内視鏡",
  itemTerm: "項目",
  useItemSearch: useEndoscopyItemSearch,
  useExamTypeOptions: useEndoscopyExamTypeOptions,
  useItem: useEndoscopyItem,
  useItemMutations: useEndoscopyItemMutations,
  useSetItemMutations: useEndoscopySetItemMutations,
  datasetHooks: endoscopyDatasetHooks,
  SearchModal: EndoscopyItemSearchModal,
};

export function EndoscopyItemPage() {
  return <ExamItemPage config={CONFIG} />;
}
