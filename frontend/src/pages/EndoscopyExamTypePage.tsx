import type { JedExamCategory } from "../api/masterClient";
import { useEndoscopyExamTypeMutations, useEndoscopyExamTypeSearch } from "../api/masterQueries";
import { ExamTypePage, type ExamTypePageConfig } from "./ExamTypePage";

// 内視鏡の検査種別は JED(Japan Endoscopy Database)の4区分との対応(jed_exam_category)を持つ。
// 将来のレポート・JED 出力で種別を機械的に判別するための軸。JED は消化器内視鏡のみが
// 対象なので、気管支鏡などは「対象外」。
const JED_CATEGORY_OPTIONS: { code: JedExamCategory | ""; label: string }[] = [
  { code: "", label: "JED 対象外" },
  { code: "upper_gi", label: "上部内視鏡" },
  { code: "small_intestine", label: "小腸内視鏡" },
  { code: "lower_gi", label: "下部内視鏡" },
  { code: "ercp", label: "ERCP" },
];

const CONFIG: ExamTypePageConfig = {
  name: "内視鏡",
  itemTerm: "オーダー項目",
  searchPlaceholder: "上部、EGD など",
  namePlaceholder: "上部消化管内視鏡 など",
  shortNamePlaceholder: "EGD、CS など",
  useSearch: useEndoscopyExamTypeSearch,
  useMutations: useEndoscopyExamTypeMutations,
  jedCategoryOptions: JED_CATEGORY_OPTIONS,
};

export function EndoscopyExamTypePage() {
  return <ExamTypePage config={CONFIG} />;
}
