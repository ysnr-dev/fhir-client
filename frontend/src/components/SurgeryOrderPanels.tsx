import { useMemo } from "react";
import { useCreatePrescription, useUpdateSurgeryOrder } from "../api/queries";
import type { ProblemRef } from "../fhir/conditionHelpers";
import { prescriptionRequester, withOrderWard } from "../fhir/prescriptionHelpers";
import {
  buildDoSurgeryOrderForm,
  buildSurgeryOrderBundle,
  buildSurgeryOrderUpdateBundle,
  emptySurgeryOrderForm,
  type SurgeryOrderFormValues,
} from "../fhir/surgeryOrderHelpers";
import { useOrderContext } from "../hooks/useOrderContext";
import { useSurgeryOrderInitialValues } from "../hooks/useSurgeryOrderInitialValues";
import { useDefaultOrderSetting } from "../hooks/useDefaultOrderSetting";
import { ErrorBanner } from "./ErrorBanner";
import { SurgeryOrderForm } from "./SurgeryOrderForm";

// 手術オーダーの登録・編集 UI。カルテ画面の右ペインから使う。
// 送信は他のオーダーと同じ transaction Bundle の POST なので mutation を共用する
// (無効化キーも ServiceRequest 検索で共通)。

interface SurgeryOrderCreatePanelProps {
  patientId: string;
  /** DO(内容を流用して新規登録)する元の ServiceRequest id。 */
  sourceSrId?: string;
  defaultProblem?: ProblemRef;
  onSaved: () => void;
}

export function SurgeryOrderCreatePanel({
  patientId,
  sourceSrId,
  defaultProblem,
  onSaved,
}: SurgeryOrderCreatePanelProps) {
  const createSurgeryOrder = useCreatePrescription();
  const source = useSurgeryOrderInitialValues(sourceSrId, patientId);
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
        ? buildDoSurgeryOrderForm(source.initialValues, defaultSetting.setting)
        : emptySurgeryOrderForm(defaultProblem ?? null, defaultSetting.setting),
    [source.initialValues, defaultProblem, defaultSetting.setting],
  );

  function handleSubmit(values: SurgeryOrderFormValues) {
    // 新規オーダーには登録時点の入院病棟も焼き付ける(部門の一覧が入院を引き直さずに済む)。
    const attribution = withOrderWard(requester, values.setting, defaultSetting);
    createSurgeryOrder.mutate(buildSurgeryOrderBundle(values, patientId, attribution), {
      onSuccess: onSaved,
    });
  }

  return (
    <>
      <ErrorBanner error={source.error} />

      {waiting ? (
        <p>読み込み中...</p>
      ) : (
        <SurgeryOrderForm
          patientId={patientId}
          initialValues={initialValues}
          onSubmit={handleSubmit}
          submitting={createSurgeryOrder.isPending}
          submitError={createSurgeryOrder.error}
        />
      )}
    </>
  );
}

interface SurgeryOrderEditPanelProps {
  patientId: string;
  srId: string;
  onSaved: () => void;
}

export function SurgeryOrderEditPanel({ patientId, srId, onSaved }: SurgeryOrderEditPanelProps) {
  const updateSurgeryOrder = useUpdateSurgeryOrder();
  const { serviceRequest, itemIds, initialValues, ready, patientMismatch, error } =
    useSurgeryOrderInitialValues(srId, patientId);

  function handleSubmit(values: SurgeryOrderFormValues) {
    // 別患者のオーダーを更新すると subject が URL の患者に書き換わってしまうので防ぐ。
    if (!serviceRequest || patientMismatch) return;

    // 依頼科・依頼医師は登録時のものを引き継ぐ(処方・注射・検体検査の編集と同じ)。
    // 外した術式は、元の id との差分で DELETE される。
    updateSurgeryOrder.mutate(
      buildSurgeryOrderUpdateBundle(
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
          <SurgeryOrderForm
            patientId={patientId}
            initialValues={initialValues}
            onSubmit={handleSubmit}
            submitting={updateSurgeryOrder.isPending}
            submitError={updateSurgeryOrder.error}
            submitLabel="更新"
          />
        )
      )}
    </>
  );
}
