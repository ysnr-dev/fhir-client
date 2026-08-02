import { useMemo } from "react";
import { useCreatePrescription, useUpdatePrescription } from "../api/queries";
import { ErrorBanner } from "./ErrorBanner";
import { PrescriptionForm } from "./PrescriptionForm";
import {
  buildDoPrescriptionForm,
  buildPrescriptionBundle,
  buildPrescriptionUpdateBundle,
  type PrescriptionFormValues,
} from "../fhir/prescriptionHelpers";
import { usePrescriptionInitialValues } from "../hooks/usePrescriptionInitialValues";

// 処方の登録・編集 UI。ページとカルテ画面の右ペインの双方から使う。

interface PrescriptionCreatePanelProps {
  patientId: string;
  /** DO(内容を流用して新規登録)する元の ServiceRequest id。 */
  sourceSrId?: string;
  onSaved: () => void;
}

export function PrescriptionCreatePanel({
  patientId,
  sourceSrId,
  onSaved,
}: PrescriptionCreatePanelProps) {
  const createPrescription = useCreatePrescription();
  const source = usePrescriptionInitialValues(sourceSrId, patientId);

  const initialValues = useMemo(
    () => (source.initialValues ? buildDoPrescriptionForm(source.initialValues) : undefined),
    [source.initialValues],
  );

  function handleSubmit(values: PrescriptionFormValues) {
    createPrescription.mutate(buildPrescriptionBundle(values, patientId), { onSuccess: onSaved });
  }

  return (
    <>
      <ErrorBanner error={source.error} />

      {/* DO 元の読み込み完了を待ってからフォームを描画する(初期値は初回描画時のみ反映される)。 */}
      {sourceSrId && !source.ready ? (
        <p>読み込み中...</p>
      ) : (
        <PrescriptionForm
          initialValues={initialValues}
          onSubmit={handleSubmit}
          submitting={createPrescription.isPending}
          submitError={createPrescription.error}
        />
      )}
    </>
  );
}

interface PrescriptionEditPanelProps {
  patientId: string;
  srId: string;
  onSaved: () => void;
}

export function PrescriptionEditPanel({ patientId, srId, onSaved }: PrescriptionEditPanelProps) {
  const updatePrescription = useUpdatePrescription();

  const {
    serviceRequest: sr,
    medicationRequests: mrs,
    initialValues,
    ready,
    patientMismatch,
    error,
  } = usePrescriptionInitialValues(srId, patientId);

  function handleSubmit(values: PrescriptionFormValues) {
    // 別患者の処方を更新すると subject が URL の患者に書き換わり、処方が付け替わってしまう。
    if (!sr || patientMismatch) return;
    const originalIds = mrs.map((mr) => mr.id).filter((id): id is string => Boolean(id));
    updatePrescription.mutate(buildPrescriptionUpdateBundle(values, patientId, srId, originalIds), {
      onSuccess: onSaved,
    });
  }

  return (
    <>
      <ErrorBanner error={error} />

      {!ready ? (
        <p>読み込み中...</p>
      ) : (
        sr &&
        initialValues && (
          <PrescriptionForm
            initialValues={initialValues}
            onSubmit={handleSubmit}
            submitting={updatePrescription.isPending}
            submitError={updatePrescription.error}
            submitLabel="更新"
          />
        )
      )}
    </>
  );
}
