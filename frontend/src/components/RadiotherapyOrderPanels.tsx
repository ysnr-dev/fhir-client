import { useMemo } from "react";
import {
  useCreatePrescription,
  usePatientRadiotherapyOrders,
  useUpdateRadiotherapyOrder,
} from "../api/queries";
import type { ProblemRef } from "../fhir/conditionHelpers";
import { prescriptionRequester, withOrderWard } from "../fhir/prescriptionHelpers";
import {
  buildDoRadiotherapyOrderForm,
  buildRadiotherapyOrderBundle,
  buildRadiotherapyOrderUpdateBundle,
  emptyRadiotherapyOrderForm,
  summarizeRadiotherapyOrder,
  type RadiotherapyOrderFormValues,
} from "../fhir/radiotherapyOrderHelpers";
import { useDefaultOrderSetting } from "../hooks/useDefaultOrderSetting";
import { useOrderContext } from "../hooks/useOrderContext";
import { useRadiotherapyOrderInitialValues } from "../hooks/useRadiotherapyOrderInitialValues";
import { ErrorBanner } from "./ErrorBanner";
import { RadiotherapyOrderForm } from "./RadiotherapyOrderForm";

// 放射線治療(治療処方)の登録・編集 UI。カルテ画面の右ペインから使う。
// 登録は他オーダーと同じ transaction Bundle の POST なので mutation を共用する。

interface RadiotherapyOrderCreatePanelProps {
  patientId: string;
  /** DO(内容を流用して新規登録)する元の ServiceRequest id。 */
  sourceSrId?: string;
  defaultProblem?: ProblemRef;
  onSaved: () => void;
}

export function RadiotherapyOrderCreatePanel({
  patientId,
  sourceSrId,
  defaultProblem,
  onSaved,
}: RadiotherapyOrderCreatePanelProps) {
  const createOrder = useCreatePrescription();
  const source = useRadiotherapyOrderInitialValues(sourceSrId, patientId);
  const defaultSetting = useDefaultOrderSetting(patientId);
  // コース番号の既定値は、この患者の最大のコース番号 + 1。
  const courses = usePatientRadiotherapyOrders(patientId);
  const waiting =
    (sourceSrId && !source.ready) || !defaultSetting.ready || courses.isLoading;
  const requester = useOrderContext();

  const initialValues = useMemo(() => {
    const last = Math.max(
      0,
      ...(courses.data ?? []).map((sr) => summarizeRadiotherapyOrder(sr).courseNumber),
    );
    const base = source.initialValues
      ? buildDoRadiotherapyOrderForm(source.initialValues, defaultSetting.setting)
      : { ...emptyRadiotherapyOrderForm(defaultSetting.setting), problem: defaultProblem ?? null };
    return { ...base, courseNumber: String(last + 1) };
  }, [source.initialValues, defaultProblem, defaultSetting.setting, courses.data]);

  function handleSubmit(values: RadiotherapyOrderFormValues) {
    const attribution = withOrderWard(requester, values.setting, defaultSetting);
    createOrder.mutate(buildRadiotherapyOrderBundle(values, patientId, attribution), {
      onSuccess: onSaved,
    });
  }

  return (
    <>
      <ErrorBanner error={source.error} />

      {waiting ? (
        <p>読み込み中...</p>
      ) : (
        <RadiotherapyOrderForm
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

interface RadiotherapyOrderEditPanelProps {
  patientId: string;
  srId: string;
  onSaved: () => void;
}

export function RadiotherapyOrderEditPanel({
  patientId,
  srId,
  onSaved,
}: RadiotherapyOrderEditPanelProps) {
  const updateOrder = useUpdateRadiotherapyOrder();
  const { serviceRequest, taskStatus, initialValues, ready, patientMismatch, error } =
    useRadiotherapyOrderInitialValues(srId, patientId);

  function handleSubmit(values: RadiotherapyOrderFormValues) {
    // 別患者のオーダーを更新すると subject が URL の患者に書き換わってしまうので防ぐ。
    if (!serviceRequest || patientMismatch) return;

    updateOrder.mutate(
      buildRadiotherapyOrderUpdateBundle(
        values,
        patientId,
        serviceRequest,
        prescriptionRequester(serviceRequest),
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
          <RadiotherapyOrderForm
            patientId={patientId}
            initialValues={initialValues}
            onSubmit={handleSubmit}
            submitting={updateOrder.isPending}
            submitError={updateOrder.error}
            submitLabel="更新"
            editingSrId={srId}
            lockStructure={taskStatus === "in-progress" || taskStatus === "completed"}
          />
        )
      )}
    </>
  );
}
