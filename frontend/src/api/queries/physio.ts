import { EXAM_REPORT_CONFIGS } from "../../fhir/examReportHelpers";
import {
  buildPhysioOrderDeleteBundle,
  isPhysioServiceRequest,
  PHYSIO_ORDER_TYPE,
  physioOrderItemRequests,
  physioOrderResponseIds,
  physioOrderTime,
} from "../../fhir/physioOrderHelpers";
import { buildPhysioPerformDeleteEntries } from "../../fhir/physioResultHelpers";
import { buildPhysioTaskUpdate, physioTasksByOrderId, physioTaskStatus } from "../../fhir/physioTaskHelpers";
import { createExamOrderQueries } from "./examOrder";
import type { ExamWorklistRow } from "./worklist";

// ---- 生理検査オーダー ----
//
// 検索・更新・削除の流れは examOrder.ts を参照。

/** 生理検査一覧の 1 行。型は worklist.ts のものを使う。 */
export type PhysioWorklistRow = ExamWorklistRow;

const queries = createExamOrderQueries({
  dept: "physio",
  orderType: PHYSIO_ORDER_TYPE,
  reportConfig: EXAM_REPORT_CONFIGS.physio,
  isServiceRequest: isPhysioServiceRequest,
  itemRequestsOf: physioOrderItemRequests,
  responseIdsOf: physioOrderResponseIds,
  orderTimeOf: physioOrderTime,
  buildDeleteBundle: buildPhysioOrderDeleteBundle,
  buildPerformDeleteEntries: buildPhysioPerformDeleteEntries,
  buildTaskUpdate: buildPhysioTaskUpdate,
  tasksByOrderId: physioTasksByOrderId,
  taskStatus: physioTaskStatus,
});

export const usePhysioOrderDetail = queries.useOrderDetail;
export const usePhysioPerformDetail = queries.usePerformDetail;
export const usePhysioWorklist = queries.useWorklist;
export const useUpdatePhysioTaskStatus = queries.useUpdateTaskStatus;
export const useRegisterPhysioPerform = queries.useRegisterPerform;
export const useUpdatePhysioOrder = queries.useUpdateOrder;
export const deletePhysioOrderRequest = queries.deleteOrderRequest;
export const useDeletePhysioOrder = queries.useDeleteOrder;
