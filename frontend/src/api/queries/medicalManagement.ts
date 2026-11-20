import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ORDER_TYPE_SYSTEM } from "../../fhir/orderHeader";
import {
  buildMedicalManagementOrderDeleteBundle,
  MEDICAL_MANAGEMENT_ORDER_TYPE,
  medicalManagementProceduresOf,
} from "../../fhir/medicalManagementOrderHelpers";
import { documentTemplateTypeSearch, latestDocumentDates } from "../../fhir/managementFeeDocumentHelpers";
import { postBundle, searchResource } from "../fhirClient";
import { makeOrderDetailHook, ORDER_PERFORM_REVINCLUDES, resourcesOfType, searchAllPages } from "./core";
import { invalidateOrderDependents, postOrderDeleteBundle } from "./orderDelete";
import { invalidateProvenance, useWithOrderProvenance } from "./provenance";

// ---- 指導・管理料オーダー ----
//
// 登録と同時に実施済にする種別(docs/medical-management-order-design.md)。ヘッダと実施記録
// (項目ごとのハブ + 加算)を 1 つの transaction で書き、編集・削除も実施記録ごと行う。

export const useMedicalManagementOrderDetail = makeOrderDetailHook<fhir4.Resource>(
  "medical-management-order",
  ORDER_PERFORM_REVINCLUDES,
);

function invalidateMedicalManagement(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
  queryClient.invalidateQueries({ queryKey: ["Procedure", "search", "medical-management"] });
}

export function useUpdateMedicalManagementOrder() {
  const queryClient = useQueryClient();
  const withProvenance = useWithOrderProvenance();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(withProvenance(bundle)),
    onSuccess: () => {
      invalidateMedicalManagement(queryClient);
      invalidateProvenance(queryClient);
    },
  });
}

/** オーダーを実施記録ごと消す。useDeleteMedicalManagementOrder の本体。 */
export const deleteMedicalManagementOrderRequest = async (srId: string) => {
  const params = new URLSearchParams({ _id: srId });
  params.append("_revinclude", "Procedure:based-on");
  const { data } = await searchResource("ServiceRequest", params);
  const procedures = medicalManagementProceduresOf(resourcesOfType<fhir4.Procedure>(data, "Procedure"), srId);
  return postOrderDeleteBundle(buildMedicalManagementOrderDeleteBundle(srId, procedures));
};

export function useDeleteMedicalManagementOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteMedicalManagementOrderRequest,
    onSuccess: () => {
      invalidateMedicalManagement(queryClient);
      invalidateOrderDependents(queryClient);
    },
  });
}

const HISTORY_PAGE = 500;

/**
 * その患者の指導・管理料の実施記録(新しい順)。フォームの前回算定日・当月の回数に使う。
 * 項目ごとに引くと開くたびに項目数ぶんの往復になるので、1 本で引いてコードごとに数える。
 * 1 ページに収まらない古い記録は前回算定日に効かないので、上限で切って truncated を返す。
 */
export function usePatientMedicalManagementProcedures(patientId: string | undefined) {
  return useQuery({
    queryKey: ["Procedure", "search", "medical-management", patientId],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      params.set("category", `${ORDER_TYPE_SYSTEM}|${MEDICAL_MANAGEMENT_ORDER_TYPE.code}`);
      params.set("status", "completed");
      params.set("_sort", "-date");
      const { matches, truncated } = await searchAllPages<fhir4.Procedure>("Procedure", params, {
        page: HISTORY_PAGE,
        maxPages: 1,
      });
      return { procedures: matches, truncated };
    },
    enabled: Boolean(patientId),
  });
}

const REQUIRED_DOCUMENT_PAGE = 200;

/**
 * 算定の要件になる文書の、テンプレートごとの最後の診療日。文書の有無の判定に使うので、
 * 上限で欠けた結果は使わない(complete)。
 */
export function usePatientRequiredDocuments(patientId: string | undefined, templateCodes: string[]) {
  const codes = [...new Set(templateCodes)].sort();
  return useQuery({
    queryKey: ["DocumentReference", "search", "required-documents", patientId, codes],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      params.set("type", documentTemplateTypeSearch(codes));
      params.set("_sort", "-date");
      params.set("_elements", "type,date");
      const { matches } = await searchAllPages<fhir4.DocumentReference>("DocumentReference", params, {
        page: REQUIRED_DOCUMENT_PAGE,
        maxPages: 5,
        complete: true,
      });
      return latestDocumentDates(matches);
    },
    enabled: Boolean(patientId) && codes.length > 0,
  });
}
