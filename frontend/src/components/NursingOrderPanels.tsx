import { useMemo } from "react";
import {
  useCreatePrescription,
  useNursingOrderDetail,
  usePatientAdmission,
  useUpdateNursingOrder,
} from "../api/queries";
import type { ProblemRef } from "../fhir/conditionHelpers";
import {
  buildNursingOrderBundle,
  buildNursingOrderUpdateBundle,
  emptyNursingOrderForm,
  parseNursingOrderForm,
  type NursingOrderFormValues,
} from "../fhir/nursingOrderHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";
import { prescriptionRequester, withOrderWard } from "../fhir/prescriptionHelpers";
import { useDefaultOrderSetting } from "../hooks/useDefaultOrderSetting";
import { useOrderContext } from "../hooks/useOrderContext";
import { ErrorBanner } from "./ErrorBanner";
import { NursingOrderForm } from "./NursingOrderForm";

// 看護指示の登録・編集 UI。カルテ画面の右ペインから使う。

interface NursingOrderCreatePanelProps {
  patientId: string;
  defaultProblem?: ProblemRef;
  onSaved: () => void;
}

export function NursingOrderCreatePanel({
  patientId,
  defaultProblem,
  onSaved,
}: NursingOrderCreatePanelProps) {
  const create = useCreatePrescription();
  // 看護指示は入院患者にだけ出す。入院病棟と入院 Encounter をここから取る。
  const admission = useDefaultOrderSetting(patientId);
  const patientAdmission = usePatientAdmission(patientId);
  const requester = useOrderContext();

  const initialValues = useMemo(
    () => ({ ...emptyNursingOrderForm(), problem: defaultProblem ?? null }),
    [defaultProblem],
  );

  function handleSubmit(values: NursingOrderFormValues) {
    const attribution = withOrderWard(requester, "inpatient", admission);
    const encounterId = patientAdmission.data?.encounter.id;
    create.mutate(buildNursingOrderBundle(values, patientId, attribution, encounterId), {
      onSuccess: onSaved,
    });
  }

  return (
    <>
      <ErrorBanner error={patientAdmission.error} />
      {!admission.ready ? (
        <p>読み込み中...</p>
      ) : admission.setting !== "inpatient" ? (
        <p>看護指示は入院中の患者にだけ登録できます。</p>
      ) : (
        <NursingOrderForm
          patientId={patientId}
          initialValues={initialValues}
          onSubmit={handleSubmit}
          submitting={create.isPending}
          submitError={create.error}
        />
      )}
    </>
  );
}

interface NursingOrderEditPanelProps {
  patientId: string;
  srId: string;
  onSaved: () => void;
}

/** 編集は指示 1 行を直すだけ。束ね(requisition)と発行日は元のまま。 */
export function NursingOrderEditPanel({ patientId, srId, onSaved }: NursingOrderEditPanelProps) {
  const update = useUpdateNursingOrder();
  const detail = useNursingOrderDetail(srId);
  const order = detail.data?.order;
  const patientMismatch = isPatientMismatch(patientId, order?.subject);

  const initialValues = useMemo(
    () => (order && !patientMismatch ? parseNursingOrderForm(order) : undefined),
    [order, patientMismatch],
  );

  function handleSubmit(values: NursingOrderFormValues) {
    if (!order || patientMismatch) return;
    update.mutate(
      buildNursingOrderUpdateBundle(
        values.lines[0],
        values.problem,
        patientId,
        order,
        prescriptionRequester(order),
      ),
      { onSuccess: onSaved },
    );
  }

  return (
    <>
      <ErrorBanner
        error={
          detail.error ??
          (patientMismatch ? new Error("指定された看護指示は別の患者のものです。") : undefined)
        }
      />
      {detail.isLoading ? (
        <p>読み込み中...</p>
      ) : (
        initialValues && (
          <NursingOrderForm
            patientId={patientId}
            initialValues={initialValues}
            singleLine
            onSubmit={handleSubmit}
            submitting={update.isPending}
            submitError={update.error}
            submitLabel="更新"
          />
        )
      )}
    </>
  );
}
