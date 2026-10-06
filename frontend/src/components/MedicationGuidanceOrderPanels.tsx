import { useMemo } from "react";
import { useCreatePrescription, useUpdateMedicationGuidanceOrder } from "../api/queries";
import type { ProblemRef } from "../fhir/conditionHelpers";
import { orderRequester, withOrderWard } from "../fhir/orderHeader";
import {
  buildDoMedicationGuidanceOrderForm,
  buildMedicationGuidanceOrderBundle,
  buildMedicationGuidanceOrderUpdateBundle,
  emptyMedicationGuidanceOrderForm,
  type MedicationGuidanceOrderFormValues,
} from "../fhir/medicationGuidanceOrderHelpers";
import { useDefaultOrderSetting } from "../hooks/useDefaultOrderSetting";
import { useMedicationGuidanceOrderInitialValues } from "../hooks/useMedicationGuidanceOrderInitialValues";
import { useOrderContext } from "../hooks/useOrderContext";
import { ErrorBanner } from "./ErrorBanner";
import { MedicationGuidanceOrderForm } from "./MedicationGuidanceOrderForm";

// 服薬指導オーダーの登録・編集 UI。カルテ画面の右ペインから使う(栄養指導と同じ作り)。

interface CreatePanelProps {
  patientId: string;
  /** DO(内容を流用して新規登録)する元の ServiceRequest id。 */
  sourceSrId?: string;
  defaultProblem?: ProblemRef;
  onSaved: () => void;
}

export function MedicationGuidanceOrderCreatePanel({ patientId, sourceSrId, defaultProblem, onSaved }: CreatePanelProps) {
  const createOrder = useCreatePrescription();
  const source = useMedicationGuidanceOrderInitialValues(sourceSrId, patientId);
  // 入外区分の初期値は入院中なら「入院」。DO でも DO 元ではなくいまの状態に合わせる。
  const defaultSetting = useDefaultOrderSetting(patientId);
  const waiting = (sourceSrId && !source.ready) || !defaultSetting.ready;
  // DO も新しいオーダーなので、依頼元はヘッダーで選択中のものを使う。
  const requester = useOrderContext();

  const initialValues = useMemo(
    () =>
      source.initialValues
        ? buildDoMedicationGuidanceOrderForm(source.initialValues, defaultSetting.setting)
        : { ...emptyMedicationGuidanceOrderForm(defaultSetting.setting), problem: defaultProblem ?? null },
    [source.initialValues, defaultProblem, defaultSetting.setting],
  );

  function handleSubmit(values: MedicationGuidanceOrderFormValues) {
    // 新規オーダーには登録時点の入院病棟も焼き付ける(部門の一覧が入院を引き直さずに済む)。
    const attribution = withOrderWard(requester, values.setting, defaultSetting);
    createOrder.mutate(buildMedicationGuidanceOrderBundle(values, patientId, attribution), { onSuccess: onSaved });
  }

  return (
    <>
      <ErrorBanner error={source.error} />
      {waiting ? (
        <p>読み込み中...</p>
      ) : (
        <MedicationGuidanceOrderForm
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

interface EditPanelProps {
  patientId: string;
  srId: string;
  onSaved: () => void;
}

export function MedicationGuidanceOrderEditPanel({ patientId, srId, onSaved }: EditPanelProps) {
  const updateOrder = useUpdateMedicationGuidanceOrder();
  const { serviceRequest, initialValues, ready, patientMismatch, error } = useMedicationGuidanceOrderInitialValues(
    srId,
    patientId,
  );

  function handleSubmit(values: MedicationGuidanceOrderFormValues) {
    if (!serviceRequest || patientMismatch) return;
    // 依頼科・依頼医師・病棟は登録時のものを引き継ぐ(他のオーダーの編集と同じ)。
    updateOrder.mutate(
      buildMedicationGuidanceOrderUpdateBundle(values, patientId, serviceRequest, orderRequester(serviceRequest)),
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
          <MedicationGuidanceOrderForm
            patientId={patientId}
            initialValues={initialValues}
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
