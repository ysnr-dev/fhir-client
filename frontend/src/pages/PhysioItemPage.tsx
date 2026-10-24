import {
  physioDatasetHooks,
  usePhysioExamTypeOptions,
  usePhysioItem,
  usePhysioItemMutations,
  usePhysioItemSearch,
  usePhysioSetItemMutations,
} from "../api/masterQueries";
import { PhysioItemSearchModal } from "../components/PhysioItemSearchModal";
import { ExamItemPage, type ExamItemPageConfig } from "./ExamItemPage";

const CONFIG: ExamItemPageConfig = {
  name: "生理検査",
  itemTerm: "検査項目",
  useItemSearch: usePhysioItemSearch,
  useExamTypeOptions: usePhysioExamTypeOptions,
  useItem: usePhysioItem,
  useItemMutations: usePhysioItemMutations,
  useSetItemMutations: usePhysioSetItemMutations,
  datasetHooks: physioDatasetHooks,
  SearchModal: PhysioItemSearchModal,
};

export function PhysioItemPage() {
  return <ExamItemPage config={CONFIG} />;
}
