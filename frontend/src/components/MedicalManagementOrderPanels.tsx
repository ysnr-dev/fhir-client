import { useMemo } from "react";
import { useCreatePrescription, useUpdateMedicalManagementOrder } from "../api/queries";
import type { ProblemRef } from "../fhir/conditionHelpers";
import { orderRequester, withOrderWard } from "../fhir/orderHeader";
import {
  buildDoMedicalManagementOrderForm,
  buildMedicalManagementOrderBundle,
  buildMedicalManagementOrderUpdateBundle,
  emptyMedicalManagementOrderForm,
  type MedicalManagementOrderFormValues,
} from "../fhir/medicalManagementOrderHelpers";
import { useDefaultOrderSetting } from "../hooks/useDefaultOrderSetting";
import { useOrderContext } from "../hooks/useOrderContext";
import { useMedicalManagementOrderInitialValues } from "../hooks/useMedicalManagementOrderInitialValues";
import { ErrorBanner } from "./ErrorBanner";
import { MedicalManagementOrderForm } from "./MedicalManagementOrderForm";

// 指導・管理料オーダーの登録・編集 UI。カルテ画面の右ペインから使う。
// 登録は他オーダーと同じ transaction Bundle の POST なので mutation を共用する。

interface MedicalManagementOrderCreatePanelProps {
  patientId: string;
  /** DO(内容を流用して新規登録)する元の ServiceRequest id。 */
  sourceSrId?: string;
  defaultProblem?: ProblemRef;
  onSaved: () => void;
}

export function MedicalManagementOrderCreatePanel({
  patientId,
  sourceSrId,
  defaultProblem,
  onSaved,
}: MedicalManagementOrderCreatePanelProps) {
  const createOrder = useCreatePrescription();
  const source = useMedicalManagementOrderInitialValues(sourceSrId, patientId);
  const defaultSetting = useDefaultOrderSetting(patientId);
  const waiting = (sourceSrId && !source.ready) || !defaultSetting.ready;
  const requester = useOrderContext();

  const initialValues = useMemo(
    () =>
      source.initialValues
        ? buildDoMedicalManagementOrderForm(source.initialValues, defaultSetting.setting)
        : { ...emptyMedicalManagementOrderForm(defaultSetting.setting), problem: defaultProblem ?? null },
    [source.initialValues, defaultProblem, defaultSetting.setting],
  );

  function handleSubmit(values: MedicalManagementOrderFormValues) {
    const attribution = withOrderWard(requester, values.setting, defaultSetting);
    createOrder.mutate(buildMedicalManagementOrderBundle(values, patientId, attribution), {
      onSuccess: onSaved,
    });
  }

  return (
    <>
      <ErrorBanner error={source.error} />

      {waiting ? (
        <p>読み込み中...</p>
      ) : (
        <MedicalManagementOrderForm
          patientId={patientId}
          initialValues={initialValues}
          onSubmit={handleSubmit}
          submitting={createOrder.isPending}
          submitError={createOrder.error}
        />
      )}
    </>
  );
}

interface MedicalManagementOrderEditPanelProps {
  patientId: string;
  srId: string;
  onSaved: () => void;
}

export function MedicalManagementOrderEditPanel({ patientId, srId, onSaved }: MedicalManagementOrderEditPanelProps) {
  const updateOrder = useUpdateMedicalManagementOrder();
  const { serviceRequest, procedures, initialValues, ready, patientMismatch, error } =
    useMedicalManagementOrderInitialValues(srId, patientId);

  function handleSubmit(values: MedicalManagementOrderFormValues) {
    if (!serviceRequest || patientMismatch) return;

    // 依頼科・指示医師・病棟は登録時のものを引き継ぐ(他のオーダーの編集と同じ)。
    updateOrder.mutate(
      buildMedicalManagementOrderUpdateBundle(
        values,
        patientId,
        serviceRequest,
        procedures,
        orderRequester(serviceRequest),
      ),
      { onSuccess: onSaved },
    );
  }

  return (
    <>
      <ErrorBanner error={error} />

      {!ready ? (
        <p>読み込み中...</p>
      ) : (
        serviceRequest &&
        initialValues && (
          <MedicalManagementOrderForm
            patientId={patientId}
            initialValues={initialValues}
            editingOrderId={srId}
            onSubmit={handleSubmit}
            submitting={updateOrder.isPending}
            submitError={updateOrder.error}
            submitLabel="更新"
          />
        )
      )}
    </>
  );
}
