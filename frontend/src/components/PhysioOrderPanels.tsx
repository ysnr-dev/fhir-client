import { useUpdatePhysioOrder } from "../api/queries";
import {
  buildDoPhysioOrderForm,
  buildPhysioOrderBundle,
  buildPhysioOrderUpdateBundle,
  emptyPhysioOrderForm,
} from "../fhir/physioOrderHelpers";
import { buildPhysioOrderWithPerformBundle } from "../fhir/physioResultHelpers";
import { usePhysioOrderInitialValues } from "../hooks/usePhysioOrderInitialValues";
import { createExamOrderPanels } from "./ExamOrderPanels";
import { PhysioOrderForm } from "./PhysioOrderForm";

// 生理検査オーダーの登録・編集 UI。流れは ExamOrderPanels を参照。

const panels = createExamOrderPanels({
  worklistKey: "physio-worklist",
  useInitialValues: usePhysioOrderInitialValues,
  useUpdateOrder: useUpdatePhysioOrder,
  emptyForm: emptyPhysioOrderForm,
  buildDoForm: buildDoPhysioOrderForm,
  buildOrderBundle: buildPhysioOrderBundle,
  buildOrderWithPerformBundle: buildPhysioOrderWithPerformBundle,
  buildOrderUpdateBundle: buildPhysioOrderUpdateBundle,
  Form: PhysioOrderForm,
});

export const PhysioOrderCreatePanel = panels.CreatePanel;
export const PhysioOrderEditPanel = panels.EditPanel;
