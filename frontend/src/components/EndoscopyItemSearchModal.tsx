import { useEndoscopyExamTypeOptions, useEndoscopyItemSearch } from "../api/masterQueries";
import {
  ExamItemSearchModal,
  type ExamItemSearchConfig,
  type ExamItemSearchModalProps,
} from "./ExamItemSearchModal";

const CONFIG: ExamItemSearchConfig = {
  title: "内視鏡オーダー項目を選択",
  useExamTypeOptions: useEndoscopyExamTypeOptions,
  useItemSearch: useEndoscopyItemSearch,
};

export function EndoscopyItemSearchModal(props: ExamItemSearchModalProps) {
  return <ExamItemSearchModal config={CONFIG} {...props} />;
}
