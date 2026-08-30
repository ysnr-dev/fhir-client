import { useMemo } from "react";
import {
  useActiveMealOrders,
  useCreatePrescription,
  useMealOrderDetail,
  usePatientAdmission,
  useUpdateMealOrder,
} from "../api/queries";
import { serviceRequestsOf } from "../fhir/labOrderHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";
import { prescriptionRequester, withOrderWard } from "../fhir/prescriptionHelpers";
import type { ProblemRef } from "../fhir/conditionHelpers";
import {
  buildDoMealOrderForm,
  buildMealOrderBundle,
  buildMealOrderUpdateBundle,
  emptyMealOrderForm,
  parseMealOrderForm,
  type MealOrderFormValues,
} from "../fhir/mealOrderHelpers";
import { useDefaultOrderSetting } from "../hooks/useDefaultOrderSetting";
import { useOrderContext } from "../hooks/useOrderContext";
import { ErrorBanner } from "./ErrorBanner";
import { MealOrderForm } from "./MealOrderForm";

// 食事オーダーの登録・編集 UI。カルテ画面の右ペインから使う。
// 送信は他のオーダーと同じ transaction Bundle の POST なので mutation を共用する。

interface MealOrderCreatePanelProps {
  patientId: string;
  /** DO(内容を流用して新規登録)する元の ServiceRequest id。 */
  sourceSrId?: string;
  /**
   * 開始日の既定。暦(カルテの「食事」タブ)で食事の無い日を押したときに、その日を渡す。
   * 未指定なら当日から。
   */
  defaultStartDate?: string;
  defaultProblem?: ProblemRef;
  onSaved: () => void;
}

export function MealOrderCreatePanel({
  patientId,
  sourceSrId,
  defaultStartDate,
  defaultProblem,
  onSaved,
}: MealOrderCreatePanelProps) {
  const createMealOrder = useCreatePrescription();
  const source = useMealOrderInitialValues(sourceSrId, patientId);
  // 食事は入院患者にだけ出すオーダー。入院病棟もここから取ってオーダーに焼き付け、
  // 入院(Encounter)そのものも結び付ける(退院・外出泊の連動が突き合わせる)。
  const admission = useDefaultOrderSetting(patientId);
  const patientAdmission = usePatientAdmission(patientId);
  const requester = useOrderContext();

  const initialValues = useMemo(() => {
    const base = source.initialValues
      ? buildDoMealOrderForm(source.initialValues)
      : { ...emptyMealOrderForm(), problem: defaultProblem ?? null };
    // 暦から開いたときは押した日から始める(DO でも当日ではなくその日に合わせる)。
    return defaultStartDate ? { ...base, startDate: defaultStartDate } : base;
  }, [source.initialValues, defaultProblem, defaultStartDate]);

  // 食事変更のときに終了させる候補。新しい食事の開始日にまだ続いているものだけ。
  const active = useActiveMealOrders(patientId, initialValues.startDate);

  const waiting = (sourceSrId && !source.ready) || !admission.ready || active.isPending;

  function handleSubmit(values: MealOrderFormValues, closingIds: string[], resumeIds: string[]) {
    const closing = (active.data ?? []).filter((sr) => closingIds.includes(sr.id ?? ""));
    // 終了を決めたオーダーの後に元の食事へ戻すもの(外泊中の食止め など)。
    const resuming = (active.data ?? []).filter((sr) => resumeIds.includes(sr.id ?? ""));
    // 入院病棟を焼き付ける(給食部門の一覧が入院を引き直さずに病棟で束ねられる)。
    const attribution = withOrderWard(requester, "inpatient", admission);

    // 種別(開始 / 変更)は buildMealOrderBundle が「終了させる食事があるか」で決める。
    createMealOrder.mutate(
      buildMealOrderBundle(
        values,
        patientId,
        attribution,
        closing,
        resuming,
        patientAdmission.data?.encounter.id,
      ),
      { onSuccess: onSaved },
    );
  }

  return (
    <>
      <ErrorBanner error={source.error} />
      <ErrorBanner error={active.error} />

      {waiting ? (
        <p>読み込み中...</p>
      ) : admission.setting !== "inpatient" ? (
        // 食事オーダーは在院している患者にだけ出す。外来の患者では登録させない。
        <p>食事オーダーは入院中の患者にだけ登録できます。</p>
      ) : (
        <MealOrderForm
          patientId={patientId}
          initialValues={initialValues}
          activeOrders={active.data ?? []}
          onSubmit={handleSubmit}
          submitting={createMealOrder.isPending}
          submitError={createMealOrder.error}
        />
      )}
    </>
  );
}

interface MealOrderEditPanelProps {
  patientId: string;
  srId: string;
  onSaved: () => void;
}

/**
 * 編集は「そのオーダー自体を直す」だけ。その日から別の食事にしたい(食事変更)ときは、
 * 暦で始まりの日以外を押すと内容を引き継いだ登録が開くので、そちらの担当になる。
 */
export function MealOrderEditPanel({ patientId, srId, onSaved }: MealOrderEditPanelProps) {
  const updateMealOrder = useUpdateMealOrder();
  const { serviceRequest, initialValues, ready, patientMismatch, error } = useMealOrderInitialValues(
    srId,
    patientId,
  );

  function handleSubmit(values: MealOrderFormValues) {
    // 別患者のオーダーを更新すると subject が URL の患者に書き換わってしまうので防ぐ。
    if (!serviceRequest || patientMismatch) return;

    // 依頼科・依頼医師・病棟・種別・入院との結びつきは登録時のものを引き継ぐ。
    updateMealOrder.mutate(
      buildMealOrderUpdateBundle(
        values,
        patientId,
        srId,
        prescriptionRequester(serviceRequest),
        serviceRequest,
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
          <MealOrderForm
            patientId={patientId}
            initialValues={initialValues}
            onSubmit={handleSubmit}
            submitting={updateMealOrder.isPending}
            submitError={updateMealOrder.error}
            submitLabel="更新"
          />
        )
      )}
    </>
  );
}

// 保存済みの食事オーダーをフォームの初期値に復元する。編集と DO の双方から使う。
// 明細を持たないので、他のオーダーと違いヘッダ 1 件だけを見ればよい。
function useMealOrderInitialValues(srId: string | undefined, patientId?: string) {
  const detail = useMealOrderDetail(srId);

  const serviceRequest = useMemo(
    () => serviceRequestsOf(detail.data?.data).find((request) => request.id === srId),
    [detail.data, srId],
  );

  const patientMismatch = isPatientMismatch(patientId, serviceRequest?.subject);

  const initialValues = useMemo(
    () => (serviceRequest ? parseMealOrderForm(serviceRequest) : undefined),
    [serviceRequest],
  );

  return {
    serviceRequest,
    initialValues: patientMismatch ? undefined : initialValues,
    ready: !detail.isLoading,
    patientMismatch,
    error:
      detail.error ??
      (patientMismatch ? new Error("指定された食事オーダーは別の患者のものです。") : undefined),
  };
}
