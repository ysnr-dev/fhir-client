import { useMemo } from "react";
import { useCreatePrescription, useUpdateRehabOrder } from "../api/queries";
import type { ProblemRef } from "../fhir/conditionHelpers";
import { prescriptionRequester, withOrderWard } from "../fhir/prescriptionHelpers";
import {
  buildDoRehabOrderForm,
  buildRehabOrderBundle,
  buildRehabOrderUpdateBundle,
  emptyRehabOrderForm,
  type RehabOrderFormValues,
} from "../fhir/rehabOrderHelpers";
import { useDefaultOrderSetting } from "../hooks/useDefaultOrderSetting";
import { useOrderContext } from "../hooks/useOrderContext";
import { useRehabOrderInitialValues } from "../hooks/useRehabOrderInitialValues";
import { ErrorBanner } from "./ErrorBanner";
import { RehabOrderForm } from "./RehabOrderForm";

// リハビリオーダーの登録・編集 UI。カルテ画面の右ペインから使う。
// 登録は他オーダーと同じ transaction Bundle の POST なので mutation を共用する。
// 更新だけ専用の mutation を使うのは、開始日が動くとカードの載る日も変わるため
// (食事の useUpdateMealOrder と同じ理由)。

interface RehabOrderCreatePanelProps {
  patientId: string;
  /** DO(内容を流用して新規登録)する元の ServiceRequest id。 */
  sourceSrId?: string;
  defaultProblem?: ProblemRef;
  onSaved: () => void;
}

export function RehabOrderCreatePanel({
  patientId,
  sourceSrId,
  defaultProblem,
  onSaved,
}: RehabOrderCreatePanelProps) {
  const createRehabOrder = useCreatePrescription();
  const source = useRehabOrderInitialValues(sourceSrId, patientId);
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
        ? buildDoRehabOrderForm(source.initialValues, defaultSetting.setting)
        : {
            ...emptyRehabOrderForm(defaultSetting.setting),
            problem: defaultProblem ?? null,
          },
    [source.initialValues, defaultProblem, defaultSetting.setting],
  );

  function handleSubmit(values: RehabOrderFormValues) {
    // 新規オーダーには登録時点の入院病棟も焼き付ける(部門の一覧が入院を引き直さずに済む)。
    const attribution = withOrderWard(requester, values.setting, defaultSetting);
    createRehabOrder.mutate(buildRehabOrderBundle(values, patientId, attribution), {
      onSuccess: onSaved,
    });
  }

  return (
    <>
      <ErrorBanner error={source.error} />

      {waiting ? (
        <p>読み込み中...</p>
      ) : (
        <RehabOrderForm
          patientId={patientId}
          initialValues={initialValues}
          onSubmit={handleSubmit}
          submitting={createRehabOrder.isPending}
          submitError={createRehabOrder.error}
        />
      )}
    </>
  );
}

interface RehabOrderEditPanelProps {
  patientId: string;
  srId: string;
  onSaved: () => void;
}

export function RehabOrderEditPanel({ patientId, srId, onSaved }: RehabOrderEditPanelProps) {
  const updateRehabOrder = useUpdateRehabOrder();
  const { serviceRequest, initialValues, ready, patientMismatch, error } =
    useRehabOrderInitialValues(srId, patientId);

  function handleSubmit(values: RehabOrderFormValues) {
    // 別患者のオーダーを更新すると subject が URL の患者に書き換わってしまうので防ぐ。
    if (!serviceRequest || patientMismatch) return;

    // 依頼科・依頼医師・病棟は登録時のものを引き継ぐ(他のオーダーの編集と同じ)。
    updateRehabOrder.mutate(
      buildRehabOrderUpdateBundle(
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
          <RehabOrderForm
            patientId={patientId}
            initialValues={initialValues}
            onSubmit={handleSubmit}
            submitting={updateRehabOrder.isPending}
            submitError={updateRehabOrder.error}
            submitLabel="更新"
          />
        )
      )}
    </>
  );
}
