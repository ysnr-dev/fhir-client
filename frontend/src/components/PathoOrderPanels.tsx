import { useMemo } from "react";
import { useCreatePrescription, useUpdatePrescription } from "../api/queries";
import type { ProblemRef } from "../fhir/conditionHelpers";
import {
  buildDoPathoOrderForm,
  buildPathoOrderBundle,
  buildPathoOrderUpdateBundle,
  emptyPathoOrderForm,
  type PathoOrderFormValues,
} from "../fhir/pathoOrderHelpers";
import { prescriptionRequester, withOrderWard } from "../fhir/prescriptionHelpers";
import { usePathoOrderInitialValues } from "../hooks/usePathoOrderInitialValues";
import { useDefaultOrderSetting } from "../hooks/useDefaultOrderSetting";
import { useOrderContext } from "../hooks/useOrderContext";
import { ErrorBanner } from "./ErrorBanner";
import { PathoOrderForm } from "./PathoOrderForm";

// 病理検査オーダーの登録・編集 UI。カルテ画面の右ペインから使う。
// 送信は他オーダーと同じ transaction Bundle の POST なので mutation を共用する。

interface PathoOrderCreatePanelProps {
  patientId: string;
  /** DO(内容を流用して新規登録)する元の ServiceRequest id。 */
  sourceSrId?: string;
  defaultProblem?: ProblemRef;
  onSaved: () => void;
}

export function PathoOrderCreatePanel({
  patientId,
  sourceSrId,
  defaultProblem,
  onSaved,
}: PathoOrderCreatePanelProps) {
  const createPathoOrder = useCreatePrescription();
  const source = usePathoOrderInitialValues(sourceSrId, patientId);
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
        ? buildDoPathoOrderForm(source.initialValues, defaultSetting.setting)
        : emptyPathoOrderForm(defaultProblem ?? null, defaultSetting.setting),
    [source.initialValues, defaultProblem, defaultSetting.setting],
  );

  function handleSubmit(values: PathoOrderFormValues) {
    // 新規オーダーには登録時点の入院病棟も焼き付ける(部門の一覧が入院を引き直さずに済む)。
    const attribution = withOrderWard(requester, values.setting, defaultSetting);
    createPathoOrder.mutate(buildPathoOrderBundle(values, patientId, attribution), {
      onSuccess: onSaved,
    });
  }

  return (
    <>
      <ErrorBanner error={source.error} />

      {waiting ? (
        <p>読み込み中...</p>
      ) : (
        <PathoOrderForm
          patientId={patientId}
          initialValues={initialValues}
          onSubmit={handleSubmit}
          submitting={createPathoOrder.isPending}
          submitError={createPathoOrder.error}
        />
      )}
    </>
  );
}

interface PathoOrderEditPanelProps {
  patientId: string;
  srId: string;
  onSaved: () => void;
}

export function PathoOrderEditPanel({ patientId, srId, onSaved }: PathoOrderEditPanelProps) {
  const updatePathoOrder = useUpdatePrescription();
  const { serviceRequest, itemIds, responseIds, initialValues, ready, patientMismatch, error } =
    usePathoOrderInitialValues(srId, patientId);

  function handleSubmit(values: PathoOrderFormValues) {
    // 別患者のオーダーを更新すると subject が URL の患者に書き換わってしまうので防ぐ。
    if (!serviceRequest || patientMismatch) return;
    // 依頼科・依頼医師は登録時のものを引き継ぐ(他オーダーの編集と同じ)。
    // 外した検体は、元の id との差分で DELETE される。
    updatePathoOrder.mutate(
      buildPathoOrderUpdateBundle(
        values,
        patientId,
        serviceRequest,
        itemIds,
        prescriptionRequester(serviceRequest),
        responseIds,
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
          <PathoOrderForm
            patientId={patientId}
            initialValues={initialValues}
            onSubmit={handleSubmit}
            submitting={updatePathoOrder.isPending}
            submitError={updatePathoOrder.error}
            submitLabel="更新"
          />
        )
      )}
    </>
  );
}
