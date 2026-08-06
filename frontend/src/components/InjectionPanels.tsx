import { useMemo } from "react";
import { useCreatePrescription, useUpdatePrescription } from "../api/queries";
import { ErrorBanner } from "./ErrorBanner";
import { InjectionForm } from "./InjectionForm";
import type { ProblemRef } from "../fhir/conditionHelpers";
import {
  buildDoInjectionForm,
  buildInjectionBundle,
  buildInjectionUpdateBundle,
  emptyInjectionForm,
  type InjectionFormValues,
} from "../fhir/injectionHelpers";
import { prescriptionRequester } from "../fhir/prescriptionHelpers";
import { useOrderContext } from "../hooks/useOrderContext";
import { useInjectionInitialValues } from "../hooks/useInjectionInitialValues";

// 注射オーダーの登録・編集 UI。カルテ画面の右ペインから使う。
// 送信は処方と同じ transaction Bundle の POST なので mutation(useCreatePrescription /
// useUpdatePrescription)を共用する(無効化キーも ServiceRequest 検索で共通)。

interface InjectionCreatePanelProps {
  patientId: string;
  /** DO(内容を流用して新規登録)する元の ServiceRequest id。 */
  sourceSrId?: string;
  defaultProblem?: ProblemRef;
  onSaved: () => void;
}

export function InjectionCreatePanel({
  patientId,
  sourceSrId,
  defaultProblem,
  onSaved,
}: InjectionCreatePanelProps) {
  const createInjection = useCreatePrescription();
  const source = useInjectionInitialValues(sourceSrId, patientId);
  // DO も新しいオーダーなので、依頼元は DO 元ではなくヘッダーで選択中のものを使う。
  const requester = useOrderContext();

  const initialValues = useMemo(
    () =>
      source.initialValues
        ? buildDoInjectionForm(source.initialValues)
        : emptyInjectionForm(defaultProblem ?? null),
    [source.initialValues, defaultProblem],
  );

  function handleSubmit(values: InjectionFormValues) {
    createInjection.mutate(buildInjectionBundle(values, patientId, requester), {
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
        <InjectionForm
          patientId={patientId}
          initialValues={initialValues}
          onSubmit={handleSubmit}
          submitting={createInjection.isPending}
          submitError={createInjection.error}
        />
      )}
    </>
  );
}

interface InjectionEditPanelProps {
  patientId: string;
  srId: string;
  onSaved: () => void;
}

export function InjectionEditPanel({ patientId, srId, onSaved }: InjectionEditPanelProps) {
  const updateInjection = useUpdatePrescription();

  const {
    serviceRequest: sr,
    medicationRequests: mrs,
    initialValues,
    ready,
    patientMismatch,
    error,
  } = useInjectionInitialValues(srId, patientId);

  function handleSubmit(values: InjectionFormValues) {
    // 別患者の注射を更新すると subject が URL の患者に書き換わってしまうので防ぐ。
    if (!sr || patientMismatch) return;
    // 依頼科・依頼医師は登録時のものを引き継ぐ(処方の編集と同じ考え方)。
    const originalIds = mrs.map((mr) => mr.id).filter((id): id is string => Boolean(id));
    updateInjection.mutate(
      buildInjectionUpdateBundle(values, patientId, srId, originalIds, prescriptionRequester(sr)),
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
          <InjectionForm
            patientId={patientId}
            initialValues={initialValues}
            onSubmit={handleSubmit}
            submitting={updateInjection.isPending}
            submitError={updateInjection.error}
            submitLabel="更新"
          />
        )
      )}
    </>
  );
}
