import { useMemo } from "react";
import { useCreatePrescription, useUpdatePrescription } from "../api/queries";
import type { ProblemRef } from "../fhir/conditionHelpers";
import {
  buildDoMicroOrderForm,
  buildMicroOrderBundle,
  buildMicroOrderUpdateBundle,
  emptyMicroOrderForm,
  type MicroOrderFormValues,
} from "../fhir/microOrderHelpers";
import { prescriptionRequester } from "../fhir/prescriptionHelpers";
import { useMicroOrderInitialValues } from "../hooks/useMicroOrderInitialValues";
import { useOrderContext } from "../hooks/useOrderContext";
import { ErrorBanner } from "./ErrorBanner";
import { MicroOrderForm } from "./MicroOrderForm";

// 細菌検査オーダーの登録・編集 UI。カルテ画面の右ペインから使う。
// 送信は他オーダーと同じ transaction Bundle の POST なので mutation を共用する。

interface MicroOrderCreatePanelProps {
  patientId: string;
  /** DO(内容を流用して新規登録)する元の ServiceRequest id。 */
  sourceSrId?: string;
  defaultProblem?: ProblemRef;
  onSaved: () => void;
}

export function MicroOrderCreatePanel({
  patientId,
  sourceSrId,
  defaultProblem,
  onSaved,
}: MicroOrderCreatePanelProps) {
  const createMicroOrder = useCreatePrescription();
  const source = useMicroOrderInitialValues(sourceSrId, patientId);
  // DO も新しいオーダーなので、依頼元は DO 元ではなくヘッダーで選択中のものを使う。
  const requester = useOrderContext();

  const initialValues = useMemo(
    () =>
      source.initialValues
        ? buildDoMicroOrderForm(source.initialValues)
        : emptyMicroOrderForm(defaultProblem ?? null),
    [source.initialValues, defaultProblem],
  );

  function handleSubmit(values: MicroOrderFormValues) {
    createMicroOrder.mutate(buildMicroOrderBundle(values, patientId, requester), {
      onSuccess: onSaved,
    });
  }

  return (
    <>
      <ErrorBanner error={source.error} />

      {/* DO 元の読み込み完了を待ってからフォームを描画する(初期値は初回描画時のみ反映される)。 */}
      {sourceSrId && !source.ready ? (
        <p>読み込み中...</p>
      ) : (
        <MicroOrderForm
          patientId={patientId}
          initialValues={initialValues}
          onSubmit={handleSubmit}
          submitting={createMicroOrder.isPending}
          submitError={createMicroOrder.error}
        />
      )}
    </>
  );
}

interface MicroOrderEditPanelProps {
  patientId: string;
  srId: string;
  onSaved: () => void;
}

export function MicroOrderEditPanel({ patientId, srId, onSaved }: MicroOrderEditPanelProps) {
  const updateMicroOrder = useUpdatePrescription();
  const { serviceRequest, itemIds, initialValues, ready, patientMismatch, error } =
    useMicroOrderInitialValues(srId, patientId);

  function handleSubmit(values: MicroOrderFormValues) {
    // 別患者のオーダーを更新すると subject が URL の患者に書き換わってしまうので防ぐ。
    if (!serviceRequest || patientMismatch) return;
    // 依頼科・依頼医師は登録時のものを引き継ぐ(他オーダーの編集と同じ)。
    // 外した明細は、元の id との差分で DELETE される。
    updateMicroOrder.mutate(
      buildMicroOrderUpdateBundle(
        values,
        patientId,
        srId,
        itemIds,
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
          <MicroOrderForm
            patientId={patientId}
            initialValues={initialValues}
            onSubmit={handleSubmit}
            submitting={updateMicroOrder.isPending}
            submitError={updateMicroOrder.error}
            submitLabel="更新"
          />
        )
      )}
    </>
  );
}
