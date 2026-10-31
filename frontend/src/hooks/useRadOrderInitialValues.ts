import { useRadOrderDetail } from "../api/queries";
import {
  parseRadOrderForm,
  radOrderItemRequests,
  radOrderResponseIds,
} from "../fhir/radOrderHelpers";
import { makeExamOrderInitialValuesHook } from "./useExamOrderInitialValues";

// 保存済みの放射線検査オーダーをフォームの初期値に復元する。編集と DO の双方から使う。
export const useRadOrderInitialValues = makeExamOrderInitialValuesHook({
  label: "放射線検査",
  useDetail: useRadOrderDetail,
  itemRequestsOf: radOrderItemRequests,
  responseIdsOf: radOrderResponseIds,
  parseForm: parseRadOrderForm,
});
