import { usePhysioWorklist, useUpdatePhysioTaskStatus } from "../api/queries";
import { usePhysioExamTypeOptions, usePhysioItemsByCodes } from "../api/masterQueries";
import { PhysioPerformModal } from "../components/PhysioPerformModal";
import { EXAM_REPORT_CONFIGS } from "../fhir/examReportHelpers";
import {
  entryLabel,
  orderEntries,
  physioOrderItems,
  physioOrderTime,
  summarizePhysioOrder,
} from "../fhir/physioOrderHelpers";
import { physioTaskStatus, physioTaskStatusDisplay } from "../fhir/physioTaskHelpers";
import { ExamWorklistPage, type ExamWorklistConfig } from "./ExamWorklistPage";

const CONFIG: ExamWorklistConfig = {
  name: "生理検査",
  contentHeader: "検査内容",
  emptyItemsLabel: "検査項目なし",
  reportConfig: EXAM_REPORT_CONFIGS.physio,
  useWorklist: usePhysioWorklist,
  useUpdateTaskStatus: useUpdatePhysioTaskStatus,
  useExamTypeOptions: usePhysioExamTypeOptions,
  useItemsByCodes: usePhysioItemsByCodes,
  PerformModal: PhysioPerformModal,
  orderItems: physioOrderItems,
  orderEntries: (order, itemRequests) =>
    orderEntries(physioOrderItems(order, itemRequests)).map((entry) => ({
      key: entry.item.code,
      label: entryLabel(entry),
    })),
  orderTime: physioOrderTime,
  summarizeOrder: summarizePhysioOrder,
  taskStatus: physioTaskStatus,
  taskStatusDisplay: physioTaskStatusDisplay,
};

export function PhysioWorklistPage() {
  return <ExamWorklistPage config={CONFIG} />;
}
