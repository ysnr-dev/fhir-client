import { useMemo } from "react";
import { useCreatePrescription, useUpdatePrescription } from "../api/queries";
import type { ProblemRef } from "../fhir/conditionHelpers";
import { prescriptionRequester } from "../fhir/prescriptionHelpers";
import {
  buildDoRadOrderForm,
  buildRadOrderBundle,
  buildRadOrderUpdateBundle,
  emptyRadOrderForm,
  type RadOrderFormValues,
} from "../fhir/radOrderHelpers";
import { useOrderContext } from "../hooks/useOrderContext";
import { useRadOrderInitialValues } from "../hooks/useRadOrderInitialValues";
import { ErrorBanner } from "./ErrorBanner";
import { RadOrderForm } from "./RadOrderForm";

// 放射線検査オーダーの登録・編集 UI。カルテ画面の右ペインから使う。
// 送信は処方・注射・検体検査と同じ transaction Bundle の POST なので mutation を
// 共用する(無効化キーも ServiceRequest 検索で共通)。

interface RadOrderCreatePanelProps {
  patientId: string;
  /** DO(内容を流用して新規登録)する元の ServiceRequest id。 */
  sourceSrId?: string;
  defaultProblem?: ProblemRef;
  onSaved: () => void;
}

export function RadOrderCreatePanel({
  patientId,
  sourceSrId,
  defaultProblem,
  onSaved,
}: RadOrderCreatePanelProps) {
  const createRadOrder = useCreatePrescription();
  const source = useRadOrderInitialValues(sourceSrId, patientId);
  // DO も新しいオーダーなので、依頼元は DO 元ではなくヘッダーで選択中のものを使う。
  const requester = useOrderContext();

  const initialValues = useMemo(
    () =>
      source.initialValues
        ? buildDoRadOrderForm(source.initialValues)
        : emptyRadOrderForm(defaultProblem ?? null),
    [source.initialValues, defaultProblem],
  );

  function handleSubmit(values: RadOrderFormValues) {
    createRadOrder.mutate(buildRadOrderBundle(values, patientId, requester), {
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
        <RadOrderForm
          patientId={patientId}
          initialValues={initialValues}
          onSubmit={handleSubmit}
          submitting={createRadOrder.isPending}
          submitError={createRadOrder.error}
        />
      )}
    </>
  );
}

interface RadOrderEditPanelProps {
  patientId: string;
  srId: string;
  onSaved: () => void;
}

export function RadOrderEditPanel({ patientId, srId, onSaved }: RadOrderEditPanelProps) {
  const updateRadOrder = useUpdatePrescription();
  const { serviceRequest, itemIds, responseIds, initialValues, ready, patientMismatch, error } =
    useRadOrderInitialValues(srId, patientId);

  function handleSubmit(values: RadOrderFormValues) {
    // 別患者のオーダーを更新すると subject が URL の患者に書き換わってしまうので防ぐ。
    if (!serviceRequest || patientMismatch) return;
    // 依頼科・依頼医師は登録時のものを引き継ぐ(処方・注射・検体検査の編集と同じ)。
    // 外した撮影項目・参照が外れたテンプレート回答は、元の id との差分で DELETE される。
    updateRadOrder.mutate(
      buildRadOrderUpdateBundle(
        values,
        patientId,
        srId,
        itemIds,
        responseIds,
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
          <RadOrderForm
            patientId={patientId}
            initialValues={initialValues}
            onSubmit={handleSubmit}
            submitting={updateRadOrder.isPending}
            submitError={updateRadOrder.error}
            submitLabel="更新"
          />
        )
      )}
    </>
  );
}
