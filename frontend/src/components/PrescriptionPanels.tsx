import { useMemo } from "react";
import { useCreatePrescription, useUpdatePrescription } from "../api/queries";
import { ErrorBanner } from "./ErrorBanner";
import { PrescriptionForm } from "./PrescriptionForm";
import type { ProblemRef } from "../fhir/conditionHelpers";
import {
  buildDoPrescriptionForm,
  buildPrescriptionBundle,
  buildPrescriptionUpdateBundle,
  emptyPrescriptionForm,
  prescriptionRequester,
  type PrescriptionFormValues,
} from "../fhir/prescriptionHelpers";
import { useOrderContext } from "../hooks/useOrderContext";
import { usePrescriptionInitialValues } from "../hooks/usePrescriptionInitialValues";
import { useDefaultOrderSetting } from "../hooks/useDefaultOrderSetting";

// 処方の登録・編集 UI。ページとカルテ画面の右ペインの双方から使う。

interface PrescriptionCreatePanelProps {
  patientId: string;
  /** DO(内容を流用して新規登録)する元の ServiceRequest id。 */
  sourceSrId?: string;
  // 開いた時点で対象にしておくプロブレム(カルテ画面でプロブレムを選んでいる場合)。
  // DO では元の処方の対象プロブレムをそのまま引き継ぐので使わない。
  defaultProblem?: ProblemRef;
  onSaved: () => void;
}

export function PrescriptionCreatePanel({
  patientId,
  sourceSrId,
  defaultProblem,
  onSaved,
}: PrescriptionCreatePanelProps) {
  const createPrescription = useCreatePrescription();
  const source = usePrescriptionInitialValues(sourceSrId, patientId);
  // 入外区分の初期値は入院中なら「入院」。DO でも DO 元ではなくいまの状態に合わせる。
  const defaultSetting = useDefaultOrderSetting(patientId);
  // DO 元と入院かどうかの読み込み完了を待ってからフォームを描画する
  // (初期値は初回描画時のみ反映される)。
  const waiting = (sourceSrId && !source.ready) || !defaultSetting.ready;
  // DO も新しいオーダーなので、依頼元は DO 元ではなくヘッダーで選択中のものを使う。
  const requester = useOrderContext();

  const initialValues = useMemo(
    () =>
      source.initialValues
        ? buildDoPrescriptionForm(source.initialValues, defaultSetting.setting)
        : emptyPrescriptionForm(defaultProblem ?? null, defaultSetting.setting),
    [source.initialValues, defaultProblem, defaultSetting.setting],
  );

  function handleSubmit(values: PrescriptionFormValues) {
    createPrescription.mutate(buildPrescriptionBundle(values, patientId, requester), {
      onSuccess: onSaved,
    });
  }

  return (
    <>
      <ErrorBanner error={source.error} />

      {waiting ? (
        <p>読み込み中...</p>
      ) : (
        <PrescriptionForm
          patientId={patientId}
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
    // 依頼科・依頼医師は登録時のものを引き継ぐ(編集した人・その時のヘッダーの選択で
    // 上書きしない)。診療記録の author と同じ考え方。
    const originalIds = mrs.map((mr) => mr.id).filter((id): id is string => Boolean(id));
    updatePrescription.mutate(
      buildPrescriptionUpdateBundle(values, patientId, srId, originalIds, prescriptionRequester(sr)),
      { onSuccess: onSaved },
    );
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
            patientId={patientId}
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
