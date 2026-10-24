import { usePhysioExamTypeMutations, usePhysioExamTypeSearch } from "../api/masterQueries";
import { ExamTypePage, type ExamTypePageConfig } from "./ExamTypePage";

const CONFIG: ExamTypePageConfig = {
  name: "生理検査",
  itemTerm: "検査項目",
  searchPlaceholder: "心電図、US など",
  namePlaceholder: "心電図、超音波検査 など",
  shortNamePlaceholder: "ECG、US など",
  useSearch: usePhysioExamTypeSearch,
  useMutations: usePhysioExamTypeMutations,
};

export function PhysioExamTypePage() {
  return <ExamTypePage config={CONFIG} />;
}
