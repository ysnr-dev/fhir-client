import { useEndoscopyWorklist, useUpdateEndoscopyTaskStatus } from "../api/queries";
import { useEndoscopyExamTypeOptions, useEndoscopyItemsByCodes } from "../api/masterQueries";
import { EndoscopyPerformModal } from "../components/EndoscopyPerformModal";
import { EXAM_REPORT_CONFIGS } from "../fhir/examReportHelpers";
import {
  endoscopyOrderItems,
  endoscopyOrderTime,
  entryLabel,
  orderEntries,
  summarizeEndoscopyOrder,
} from "../fhir/endoscopyOrderHelpers";
import { endoscopyTaskStatus, endoscopyTaskStatusDisplay } from "../fhir/endoscopyTaskHelpers";
import { ExamWorklistPage, type ExamWorklistConfig } from "./ExamWorklistPage";

const CONFIG: ExamWorklistConfig = {
  name: "内視鏡",
  contentHeader: "オーダー内容",
  emptyItemsLabel: "オーダー項目なし",
  reportConfig: EXAM_REPORT_CONFIGS.endoscopy,
  useWorklist: useEndoscopyWorklist,
  useUpdateTaskStatus: useUpdateEndoscopyTaskStatus,
  useExamTypeOptions: useEndoscopyExamTypeOptions,
  useItemsByCodes: useEndoscopyItemsByCodes,
  PerformModal: EndoscopyPerformModal,
  orderItems: endoscopyOrderItems,
  orderEntries: (order, itemRequests) =>
    orderEntries(endoscopyOrderItems(order, itemRequests)).map((entry) => ({
      key: entry.item.code,
      label: entryLabel(entry),
    })),
  orderTime: endoscopyOrderTime,
  summarizeOrder: summarizeEndoscopyOrder,
  taskStatus: endoscopyTaskStatus,
  taskStatusDisplay: endoscopyTaskStatusDisplay,
};

export function EndoscopyWorklistPage() {
  return <ExamWorklistPage config={CONFIG} />;
}
