import { useMemo } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { FhirResult } from "../api/fhirClient";
import { serviceRequestsOf } from "../fhir/labOrderHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";
import { useEditSnapshot } from "./useEditSnapshot";

// 保存済みの検査系オーダー(放射線・生理・内視鏡)をフォームの初期値に復元する hook を作る。
// 編集と DO の双方から使う。明細も ServiceRequest なので、ヘッダと一緒に取得した明細から項目を組み立てる。
// 部門の違いは詳細の hook・明細の選び方・回答 id の集め方・フォーム値への変換だけ。

export interface ExamOrderInitialValuesConfig<V> {
  /** 「生理検査」など。別患者のオーダーを開いたときのメッセージに使う。 */
  label: string;
  useDetail: (srId: string | undefined) => UseQueryResult<FhirResult<fhir4.Bundle>>;
  itemRequestsOf: (requests: fhir4.ServiceRequest[], srId: string) => fhir4.ServiceRequest[];
  responseIdsOf: (itemRequests: fhir4.ServiceRequest[]) => string[];
  parseForm: (serviceRequest: fhir4.ServiceRequest, itemRequests: fhir4.ServiceRequest[]) => V;
}

export function makeExamOrderInitialValuesHook<V>(config: ExamOrderInitialValuesConfig<V>) {
  return function useExamOrderInitialValues(srId: string | undefined, patientId?: string) {
    const detail = useEditSnapshot(config.useDetail(srId), srId);

    const { serviceRequest, itemRequests } = useMemo(() => {
      const requests = serviceRequestsOf(detail.data?.data);
      return {
        serviceRequest: requests.find((request) => request.id === srId),
        itemRequests: srId ? config.itemRequestsOf(requests, srId) : [],
      };
    }, [detail.data, srId]);

    const initialValues = useMemo(
      () => (serviceRequest ? config.parseForm(serviceRequest, itemRequests) : undefined),
      [itemRequests, serviceRequest],
    );

    const patientMismatch = isPatientMismatch(patientId, serviceRequest?.subject);

    return {
      serviceRequest,
      /** 更新時に、外された明細を消すために渡す元の明細 id。 */
      itemIds: itemRequests.map((request) => request.id).filter((id): id is string => Boolean(id)),
      /** 同じく、参照が外れたテンプレート回答を消すために渡す元の回答 id。 */
      responseIds: config.responseIdsOf(itemRequests),
      initialValues: patientMismatch ? undefined : initialValues,
      ready: !detail.isLoading,
      patientMismatch,
      error:
        detail.error ??
        (patientMismatch ? new Error(`指定された${config.label}は別の患者のものです。`) : undefined),
    };
  };
}
