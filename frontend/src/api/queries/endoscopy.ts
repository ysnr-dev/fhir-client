import { EXAM_REPORT_CONFIGS } from "../../fhir/examReportHelpers";
import {
  buildEndoscopyOrderDeleteBundle,
  isEndoscopyServiceRequest,
  ENDOSCOPY_ORDER_TYPE,
  endoscopyOrderItemRequests,
  endoscopyOrderResponseIds,
  endoscopyOrderTime,
} from "../../fhir/endoscopyOrderHelpers";
import { buildEndoscopyPerformDeleteEntries } from "../../fhir/endoscopyResultHelpers";
import { buildEndoscopyTaskUpdate, endoscopyTasksByOrderId, endoscopyTaskStatus } from "../../fhir/endoscopyTaskHelpers";
import { createExamOrderQueries } from "./examOrder";
import type { ExamWorklistRow } from "./worklist";

// ---- 内視鏡オーダー ----
//
// 検索・更新・削除の流れは examOrder.ts を参照。

/** 内視鏡一覧の 1 行。型は worklist.ts のものを使う。 */
export type EndoscopyWorklistRow = ExamWorklistRow;

const queries = createExamOrderQueries({
  dept: "endoscopy",
  orderType: ENDOSCOPY_ORDER_TYPE,
  reportConfig: EXAM_REPORT_CONFIGS.endoscopy,
  isServiceRequest: isEndoscopyServiceRequest,
  itemRequestsOf: endoscopyOrderItemRequests,
  responseIdsOf: endoscopyOrderResponseIds,
  orderTimeOf: endoscopyOrderTime,
  buildDeleteBundle: buildEndoscopyOrderDeleteBundle,
  buildPerformDeleteEntries: buildEndoscopyPerformDeleteEntries,
  buildTaskUpdate: buildEndoscopyTaskUpdate,
  tasksByOrderId: endoscopyTasksByOrderId,
  taskStatus: endoscopyTaskStatus,
});

export const useEndoscopyOrderDetail = queries.useOrderDetail;
export const useEndoscopyPerformDetail = queries.usePerformDetail;
export const useEndoscopyWorklist = queries.useWorklist;
export const useUpdateEndoscopyTaskStatus = queries.useUpdateTaskStatus;
export const useRegisterEndoscopyPerform = queries.useRegisterPerform;
export const useUpdateEndoscopyOrder = queries.useUpdateOrder;
export const deleteEndoscopyOrderRequest = queries.deleteOrderRequest;
export const useDeleteEndoscopyOrder = queries.useDeleteOrder;
