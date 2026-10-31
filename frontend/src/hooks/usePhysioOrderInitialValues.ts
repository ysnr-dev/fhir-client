import { usePhysioOrderDetail } from "../api/queries";
import {
  parsePhysioOrderForm,
  physioOrderItemRequests,
  physioOrderResponseIds,
} from "../fhir/physioOrderHelpers";
import { makeExamOrderInitialValuesHook } from "./useExamOrderInitialValues";

// 保存済みの生理検査オーダーをフォームの初期値に復元する。編集と DO の双方から使う。
export const usePhysioOrderInitialValues = makeExamOrderInitialValuesHook({
  label: "生理検査",
  useDetail: usePhysioOrderDetail,
  itemRequestsOf: physioOrderItemRequests,
  responseIdsOf: physioOrderResponseIds,
  parseForm: parsePhysioOrderForm,
});
