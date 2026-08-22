import { useMemo } from "react";
import { useCreatePrescription, useUpdatePrescription } from "../api/queries";
import type { ProblemRef } from "../fhir/conditionHelpers";
import {
  buildDoLabOrderForm,
  buildLabOrderBundle,
  buildLabOrderUpdateBundle,
  emptyLabOrderForm,
  type LabOrderFormValues,
} from "../fhir/labOrderHelpers";
import { prescriptionRequester } from "../fhir/prescriptionHelpers";
import { useLabOrderInitialValues } from "../hooks/useLabOrderInitialValues";
import { useDefaultOrderSetting } from "../hooks/useDefaultOrderSetting";
import { useOrderContext } from "../hooks/useOrderContext";
import { ErrorBanner } from "./ErrorBanner";
import { LabOrderForm } from "./LabOrderForm";

// 検体検査オーダーの登録・編集 UI。カルテ画面の右ペインから使う。
// 送信は処方・注射と同じ transaction Bundle の POST なので mutation を共用する
// (無効化キーも ServiceRequest 検索で共通)。

interface LabOrderCreatePanelProps {
  patientId: string;
  /** DO(内容を流用して新規登録)する元の ServiceRequest id。 */
  sourceSrId?: string;
  defaultProblem?: ProblemRef;
  onSaved: () => void;
}

export function LabOrderCreatePanel({
  patientId,
  sourceSrId,
  defaultProblem,
  onSaved,
}: LabOrderCreatePanelProps) {
  const createLabOrder = useCreatePrescription();
  const source = useLabOrderInitialValues(sourceSrId, patientId);
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
        ? buildDoLabOrderForm(source.initialValues, defaultSetting.setting)
        : emptyLabOrderForm(defaultProblem ?? null, defaultSetting.setting),
    [source.initialValues, defaultProblem, defaultSetting.setting],
  );

  function handleSubmit(values: LabOrderFormValues) {
    createLabOrder.mutate(buildLabOrderBundle(values, patientId, requester), {
      onSuccess: onSaved,
    });
  }

  return (
    <>
      <ErrorBanner error={source.error} />

      {waiting ? (
        <p>読み込み中...</p>
      ) : (
        <LabOrderForm
          patientId={patientId}
          initialValues={initialValues}
          onSubmit={handleSubmit}
          submitting={createLabOrder.isPending}
          submitError={createLabOrder.error}
        />
      )}
    </>
  );
}

interface LabOrderEditPanelProps {
  patientId: string;
  srId: string;
  onSaved: () => void;
}

export function LabOrderEditPanel({ patientId, srId, onSaved }: LabOrderEditPanelProps) {
  const updateLabOrder = useUpdatePrescription();
  const { serviceRequest, itemIds, initialValues, ready, patientMismatch, error } =
    useLabOrderInitialValues(srId, patientId);

  function handleSubmit(values: LabOrderFormValues) {
    // 別患者のオーダーを更新すると subject が URL の患者に書き換わってしまうので防ぐ。
    if (!serviceRequest || patientMismatch) return;
    // 依頼科・依頼医師は登録時のものを引き継ぐ(処方・注射の編集と同じ考え方)。
    // 外した検査項目は itemIds との差分で DELETE される。
    updateLabOrder.mutate(
      buildLabOrderUpdateBundle(
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
          <LabOrderForm
            patientId={patientId}
            initialValues={initialValues}
            onSubmit={handleSubmit}
            submitting={updateLabOrder.isPending}
            submitError={updateLabOrder.error}
            submitLabel="更新"
          />
        )
      )}
    </>
  );
}
