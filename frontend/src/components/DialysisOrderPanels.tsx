import { useMemo } from "react";
import { useCreatePrescription, useUpdateDialysisOrder } from "../api/queries";
import type { ProblemRef } from "../fhir/conditionHelpers";
import { orderRequester, withOrderWard } from "../fhir/orderHeader";
import {
  buildDoDialysisOrderForm,
  buildDialysisOrderBundle,
  buildDialysisOrderUpdateBundle,
  emptyDialysisOrderForm,
  type DialysisOrderFormValues,
} from "../fhir/dialysisOrderHelpers";
import { useDefaultOrderSetting } from "../hooks/useDefaultOrderSetting";
import { useOrderContext } from "../hooks/useOrderContext";
import { useDialysisOrderInitialValues } from "../hooks/useDialysisOrderInitialValues";
import { ErrorBanner } from "./ErrorBanner";
import { DialysisOrderForm } from "./DialysisOrderForm";

// 透析オーダーの登録・編集 UI。カルテ画面の右ペインから使う。
// 登録は他オーダーと同じ transaction Bundle の POST なので mutation を共用する。
// 更新だけ専用の mutation を使うのは、開始日が動くとカードの載る日も変わるため
// (食事の useUpdateMealOrder と同じ理由)。

interface DialysisOrderCreatePanelProps {
  patientId: string;
  /** DO(内容を流用して新規登録)する元の ServiceRequest id。 */
  sourceSrId?: string;
  defaultProblem?: ProblemRef;
  onSaved: () => void;
}

export function DialysisOrderCreatePanel({
  patientId,
  sourceSrId,
  defaultProblem,
  onSaved,
}: DialysisOrderCreatePanelProps) {
  const createDialysisOrder = useCreatePrescription();
  const source = useDialysisOrderInitialValues(sourceSrId, patientId);
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
        ? buildDoDialysisOrderForm(source.initialValues, defaultSetting.setting)
        : {
            ...emptyDialysisOrderForm(defaultSetting.setting),
            problem: defaultProblem ?? null,
          },
    [source.initialValues, defaultProblem, defaultSetting.setting],
  );

  function handleSubmit(values: DialysisOrderFormValues) {
    // 新規オーダーには登録時点の入院病棟も焼き付ける(部門の一覧が入院を引き直さずに済む)。
    const attribution = withOrderWard(requester, values.setting, defaultSetting);
    createDialysisOrder.mutate(buildDialysisOrderBundle(values, patientId, attribution), {
      onSuccess: onSaved,
    });
  }

  return (
    <>
      <ErrorBanner error={source.error} />

      {waiting ? (
        <p>読み込み中...</p>
      ) : (
        <DialysisOrderForm
          patientId={patientId}
          initialValues={initialValues}
          onSubmit={handleSubmit}
          submitting={createDialysisOrder.isPending}
          submitError={createDialysisOrder.error}
        />
      )}
    </>
  );
}

interface DialysisOrderEditPanelProps {
  patientId: string;
  srId: string;
  onSaved: () => void;
}

export function DialysisOrderEditPanel({ patientId, srId, onSaved }: DialysisOrderEditPanelProps) {
  const updateDialysisOrder = useUpdateDialysisOrder();
  const { serviceRequest, initialValues, ready, patientMismatch, error } =
    useDialysisOrderInitialValues(srId, patientId);

  function handleSubmit(values: DialysisOrderFormValues) {
    // 別患者のオーダーを更新すると subject が URL の患者に書き換わってしまうので防ぐ。
    if (!serviceRequest || patientMismatch) return;

    // 依頼科・依頼医師・病棟は登録時のものを引き継ぐ(他のオーダーの編集と同じ)。
    updateDialysisOrder.mutate(
      buildDialysisOrderUpdateBundle(
        values,
        patientId,
        serviceRequest,
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
          <DialysisOrderForm
            patientId={patientId}
            initialValues={initialValues}
            onSubmit={handleSubmit}
            submitting={updateDialysisOrder.isPending}
            submitError={updateDialysisOrder.error}
            submitLabel="更新"
          />
        )
      )}
    </>
  );
}
