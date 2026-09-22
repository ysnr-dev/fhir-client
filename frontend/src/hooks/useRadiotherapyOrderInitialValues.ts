import { useMemo } from "react";
import { useRadiotherapyOrderDetail } from "../api/queries";
import { serviceRequestsOf } from "../fhir/labOrderHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";
import { parseRadiotherapyOrderForm } from "../fhir/radiotherapyOrderHelpers";
import { radiotherapyFractionsByOrderId } from "../fhir/radiotherapyResultHelpers";
import { radiotherapyCourseSummariesByOrderId } from "../fhir/radiotherapySummaryHelpers";
import { radiotherapyTaskStatus, radiotherapyTasksByOrderId } from "../fhir/radiotherapyTaskHelpers";

// 保存済みの放射線治療オーダーをフォームの初期値に復元する。編集と DO の双方から使う。
export function useRadiotherapyOrderInitialValues(srId: string | undefined, patientId?: string) {
  const detail = useRadiotherapyOrderDetail(srId);

  const serviceRequest = useMemo(
    () => serviceRequestsOf(detail.data?.data).find((request) => request.id === srId),
    [detail.data, srId],
  );

  const taskStatus = useMemo(() => {
    const tasks = (detail.data?.data.entry ?? [])
      .map((e) => e.resource)
      .filter((r): r is fhir4.Task => r?.resourceType === "Task");
    return radiotherapyTaskStatus(radiotherapyTasksByOrderId(tasks).get(srId ?? ""));
  }, [detail.data, srId]);

  // 照射記録と治療終了サマリーは同じ検索に _revinclude で届く(詳細の表示と、次の回の既定値)。
  const procedures = useMemo(
    () =>
      (detail.data?.data.entry ?? [])
        .map((entry) => entry.resource)
        .filter((resource): resource is fhir4.Procedure => resource?.resourceType === "Procedure"),
    [detail.data],
  );
  const fractions = useMemo(
    () => radiotherapyFractionsByOrderId(procedures).get(srId ?? "") ?? [],
    [procedures, srId],
  );
  const courseSummary = useMemo(
    () => radiotherapyCourseSummariesByOrderId(procedures).get(srId ?? ""),
    [procedures, srId],
  );

  const patientMismatch = isPatientMismatch(patientId, serviceRequest?.subject);

  const initialValues = useMemo(
    () => (serviceRequest ? parseRadiotherapyOrderForm(serviceRequest) : undefined),
    [serviceRequest],
  );

  return {
    serviceRequest,
    taskStatus,
    fractions,
    courseSummary,
    initialValues: patientMismatch ? undefined : initialValues,
    ready: !detail.isLoading,
    patientMismatch,
    error:
      detail.error ??
      (patientMismatch
        ? new Error("指定された放射線治療オーダーは別の患者のものです。")
        : undefined),
  };
}
