import { useEndoscopyOrderDetail } from "../api/queries";
import {
  parseEndoscopyOrderForm,
  endoscopyOrderItemRequests,
  endoscopyOrderResponseIds,
} from "../fhir/endoscopyOrderHelpers";
import { makeExamOrderInitialValuesHook } from "./useExamOrderInitialValues";

// 保存済みの内視鏡オーダーをフォームの初期値に復元する。編集と DO の双方から使う。
export const useEndoscopyOrderInitialValues = makeExamOrderInitialValuesHook({
  label: "内視鏡",
  useDetail: useEndoscopyOrderDetail,
  itemRequestsOf: endoscopyOrderItemRequests,
  responseIdsOf: endoscopyOrderResponseIds,
  parseForm: parseEndoscopyOrderForm,
});
