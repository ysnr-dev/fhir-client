import { useMemo } from "react";
import { useCreatePrescription, useUpdateConsultOrder } from "../api/queries";
import type { ProblemRef } from "../fhir/conditionHelpers";
import {
  buildConsultOrderBundle,
  buildConsultOrderUpdateBundle,
  buildDoConsultOrderForm,
  emptyConsultOrderForm,
  type ConsultOrderFormValues,
} from "../fhir/consultOrderHelpers";
import { prescriptionRequester, withOrderWard } from "../fhir/prescriptionHelpers";
import { useConsultOrderInitialValues } from "../hooks/useConsultOrderInitialValues";
import { useDefaultOrderSetting } from "../hooks/useDefaultOrderSetting";
import { useOrderContext } from "../hooks/useOrderContext";
import { ConsultOrderForm } from "./ConsultOrderForm";
import { ErrorBanner } from "./ErrorBanner";

// 他科依頼の登録・編集 UI。カルテ画面の右ペインから使う。
// 登録は他オーダーと同じ transaction Bundle の POST なので mutation を共用する。
// 更新だけ専用の mutation を使うのは、希望日が動くとカードの載る日も変わるため
// (リハビリの useUpdateRehabOrder と同じ理由)。

interface ConsultOrderCreatePanelProps {
  patientId: string;
  /** DO(内容を流用して新規登録)する元の ServiceRequest id。 */
  sourceSrId?: string;
  defaultProblem?: ProblemRef;
  onSaved: () => void;
}

export function ConsultOrderCreatePanel({
  patientId,
  sourceSrId,
  defaultProblem,
  onSaved,
}: ConsultOrderCreatePanelProps) {
  const createConsultOrder = useCreatePrescription();
  const source = useConsultOrderInitialValues(sourceSrId, patientId);
  // 入外区分の初期値は入院中なら「入院」。DO でも DO 元ではなくいまの状態に合わせる。
  const defaultSetting = useDefaultOrderSetting(patientId);
  const waiting = (sourceSrId && !source.ready) || !defaultSetting.ready;
  // DO も新しいオーダーなので、依頼元は DO 元ではなくヘッダーで選択中のものを使う。
  const requester = useOrderContext();

  const initialValues = useMemo(
    () =>
      source.initialValues
        ? buildDoConsultOrderForm(source.initialValues, defaultSetting.setting)
        : {
            ...emptyConsultOrderForm(defaultSetting.setting),
            problem: defaultProblem ?? null,
          },
    [source.initialValues, defaultProblem, defaultSetting.setting],
  );

  function handleSubmit(values: ConsultOrderFormValues) {
    const attribution = withOrderWard(requester, values.setting, defaultSetting);
    createConsultOrder.mutate(buildConsultOrderBundle(values, patientId, attribution), {
      onSuccess: onSaved,
    });
  }

  return (
    <>
      <ErrorBanner error={source.error} />

      {waiting ? (
        <p>読み込み中...</p>
      ) : (
        <ConsultOrderForm
          patientId={patientId}
          initialValues={initialValues}
          onSubmit={handleSubmit}
          submitting={createConsultOrder.isPending}
          submitError={createConsultOrder.error}
        />
      )}
    </>
  );
}

interface ConsultOrderEditPanelProps {
  patientId: string;
  srId: string;
  onSaved: () => void;
}

export function ConsultOrderEditPanel({ patientId, srId, onSaved }: ConsultOrderEditPanelProps) {
  const updateConsultOrder = useUpdateConsultOrder();
  const { serviceRequest, initialValues, ready, patientMismatch, error } =
    useConsultOrderInitialValues(srId, patientId);

  function handleSubmit(values: ConsultOrderFormValues) {
    // 別患者のオーダーを更新すると subject が URL の患者に書き換わってしまうので防ぐ。
    if (!serviceRequest || patientMismatch) return;

    // 依頼科・依頼医師・病棟は登録時のものを引き継ぐ(他のオーダーの編集と同じ)。
    // 進捗(status)と回答への参照はフォームの管理外なので、組み立て側が既存の
    // ServiceRequest から引き継ぐ(buildConsultOrderUpdateBundle)。
    updateConsultOrder.mutate(
      buildConsultOrderUpdateBundle(
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
          <ConsultOrderForm
            patientId={patientId}
            initialValues={initialValues}
            onSubmit={handleSubmit}
            submitting={updateConsultOrder.isPending}
            submitError={updateConsultOrder.error}
            submitLabel="更新"
          />
        )
      )}
    </>
  );
}
