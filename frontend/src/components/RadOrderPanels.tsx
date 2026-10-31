import { useUpdateRadOrder } from "../api/queries";
import {
  buildDoRadOrderForm,
  buildRadOrderBundle,
  buildRadOrderUpdateBundle,
  emptyRadOrderForm,
} from "../fhir/radOrderHelpers";
import { buildRadOrderWithPerformBundle } from "../fhir/radResultHelpers";
import { useRadOrderInitialValues } from "../hooks/useRadOrderInitialValues";
import { createExamOrderPanels } from "./ExamOrderPanels";
import { RadOrderForm } from "./RadOrderForm";

// 放射線検査オーダーの登録・編集 UI。流れは ExamOrderPanels を参照。

const panels = createExamOrderPanels({
  worklistKey: "rad-worklist",
  useInitialValues: useRadOrderInitialValues,
  useUpdateOrder: useUpdateRadOrder,
  emptyForm: emptyRadOrderForm,
  buildDoForm: buildDoRadOrderForm,
  buildOrderBundle: buildRadOrderBundle,
  buildOrderWithPerformBundle: buildRadOrderWithPerformBundle,
  buildOrderUpdateBundle: buildRadOrderUpdateBundle,
  Form: RadOrderForm,
});

export const RadOrderCreatePanel = panels.CreatePanel;
export const RadOrderEditPanel = panels.EditPanel;
