import { useMemo } from "react";
import { useTeamRequestDetail } from "../api/queries";
import { serviceRequestsOf } from "../fhir/labOrderHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";
import { parseTeamRequestForm } from "../fhir/teamRequestHelpers";
import { teamRequestTasksByOrderId } from "../fhir/teamRequestTaskHelpers";
import { useEditSnapshot } from "./useEditSnapshot";

// 保存済みのチーム依頼をフォームの初期値に復元する。編集と DO の双方から使う(他科依頼と同じ)。
export function useTeamRequestInitialValues(srId: string | undefined, patientId?: string) {
  const detail = useEditSnapshot(useTeamRequestDetail(srId), srId);

  const serviceRequest = useMemo(
    () => serviceRequestsOf(detail.data?.data).find((request) => request.id === srId),
    [detail.data, srId],
  );
  // 進捗 Task(チームあての通知)。編集で依頼先・依頼目的・希望日を写し直すのに使う。
  const task = useMemo(() => {
    const tasks = (detail.data?.data.entry ?? [])
      .map((entry) => entry.resource)
      .filter((resource): resource is fhir4.Task => resource?.resourceType === "Task");
    return srId ? teamRequestTasksByOrderId(tasks).get(srId) : undefined;
  }, [detail.data, srId]);
  const patientMismatch = isPatientMismatch(patientId, serviceRequest?.subject);
  const initialValues = useMemo(() => (serviceRequest ? parseTeamRequestForm(serviceRequest) : undefined), [serviceRequest]);

  return {
    serviceRequest,
    task,
    initialValues: patientMismatch ? undefined : initialValues,
    ready: !detail.isLoading,
    patientMismatch,
    error: detail.error ?? (patientMismatch ? new Error("指定されたチーム依頼は別の患者のものです。") : undefined),
  };
}
