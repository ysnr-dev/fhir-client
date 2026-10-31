import { useUpdateEndoscopyOrder } from "../api/queries";
import {
  buildDoEndoscopyOrderForm,
  buildEndoscopyOrderBundle,
  buildEndoscopyOrderUpdateBundle,
  emptyEndoscopyOrderForm,
} from "../fhir/endoscopyOrderHelpers";
import { buildEndoscopyOrderWithPerformBundle } from "../fhir/endoscopyResultHelpers";
import { useEndoscopyOrderInitialValues } from "../hooks/useEndoscopyOrderInitialValues";
import { createExamOrderPanels } from "./ExamOrderPanels";
import { EndoscopyOrderForm } from "./EndoscopyOrderForm";

// 内視鏡オーダーの登録・編集 UI。流れは ExamOrderPanels を参照。

const panels = createExamOrderPanels({
  worklistKey: "endoscopy-worklist",
  useInitialValues: useEndoscopyOrderInitialValues,
  useUpdateOrder: useUpdateEndoscopyOrder,
  emptyForm: emptyEndoscopyOrderForm,
  buildDoForm: buildDoEndoscopyOrderForm,
  buildOrderBundle: buildEndoscopyOrderBundle,
  buildOrderWithPerformBundle: buildEndoscopyOrderWithPerformBundle,
  buildOrderUpdateBundle: buildEndoscopyOrderUpdateBundle,
  Form: EndoscopyOrderForm,
});

export const EndoscopyOrderCreatePanel = panels.CreatePanel;
export const EndoscopyOrderEditPanel = panels.EditPanel;
