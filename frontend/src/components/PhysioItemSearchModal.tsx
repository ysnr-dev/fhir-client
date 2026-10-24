import { usePhysioExamTypeOptions, usePhysioItemSearch } from "../api/masterQueries";
import {
  ExamItemSearchModal,
  type ExamItemSearchConfig,
  type ExamItemSearchModalProps,
} from "./ExamItemSearchModal";

const CONFIG: ExamItemSearchConfig = {
  title: "生理検査オーダー項目を選択",
  useExamTypeOptions: usePhysioExamTypeOptions,
  useItemSearch: usePhysioItemSearch,
};

export function PhysioItemSearchModal(props: ExamItemSearchModalProps) {
  return <ExamItemSearchModal config={CONFIG} {...props} />;
}
