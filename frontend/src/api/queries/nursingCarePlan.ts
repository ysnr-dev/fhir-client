import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  NURSING_CARE_CATEGORY_TOKEN,
  assembleNursingProblems,
  type NursingProblemView,
} from "../../fhir/nursingCarePlanHelpers";
import { NURSING_ORDER_TYPE } from "../../fhir/nursingOrderHelpers";
import { ORDER_TYPE_SYSTEM } from "../../fhir/orderHeader";
import { postBundle } from "../fhirClient";
import { searchAllPages, type PagedItems } from "./core";
import { invalidateNursing } from "./nursing";
import { invalidateProvenance, useWithOrderProvenance } from "./provenance";

// 看護計画(docs/nursing-care-plan-design.md)。患者の看護問題・目標・計画・評価と、
// 計画から展開した看護指示をまとめて読む。

export const NURSING_CARE_PLAN_KEY = ["CarePlan", "nursing"];

function includedOfType<T extends fhir4.Resource>(bundles: fhir4.Bundle[], type: T["resourceType"]): T[] {
  return bundles.flatMap((bundle) =>
    (bundle.entry ?? [])
      .map((entry) => entry.resource)
      .filter((resource): resource is T => resource?.resourceType === type),
  );
}

/**
 * 患者の看護計画すべて(解決済みを含む)。計画に目標と看護問題を _include で添え、評価と
 * 展開した看護指示を続けて引く。指示は解決時に閉じる対象にもなるので欠けたら失敗にする。
 */
export function useNursingCarePlans(patientId: string | undefined) {
  return useQuery({
    queryKey: [...NURSING_CARE_PLAN_KEY, patientId],
    queryFn: () => fetchNursingCarePlans(patientId as string),
    enabled: Boolean(patientId),
  });
}

export async function fetchNursingCarePlans(patientId: string): Promise<PagedItems<NursingProblemView>> {
  const planParams = new URLSearchParams();
  planParams.set("patient", `Patient/${patientId}`);
  planParams.set("category", NURSING_CARE_CATEGORY_TOKEN);
  planParams.append("_include", "CarePlan:goal");
  planParams.append("_include", "CarePlan:condition");
  const evaluationParams = new URLSearchParams();
  evaluationParams.set("patient", `Patient/${patientId}`);
  evaluationParams.set("category", NURSING_CARE_CATEGORY_TOKEN);
  const [plans, evaluations] = await Promise.all([
    searchAllPages<fhir4.CarePlan>("CarePlan", planParams, { page: 200, maxPages: 3 }),
    searchAllPages<fhir4.Observation>("Observation", evaluationParams, { page: 500, maxPages: 4 }),
  ]);
  const conditions = includedOfType<fhir4.Condition>(plans.bundles, "Condition");

  let orders: fhir4.ServiceRequest[] = [];
  if (conditions.length > 0) {
    const orderParams = new URLSearchParams();
    orderParams.set("patient", `Patient/${patientId}`);
    orderParams.set("category", `${ORDER_TYPE_SYSTEM}|${NURSING_ORDER_TYPE.code}`);
    orderParams.set("reason-reference", conditions.map((c) => `Condition/${c.id}`).join(","));
    const result = await searchAllPages<fhir4.ServiceRequest>("ServiceRequest", orderParams, {
      page: 500,
      maxPages: 4,
      complete: true,
    });
    orders = result.matches;
  }

  return {
    items: assembleNursingProblems(
      plans.matches,
      conditions,
      includedOfType<fhir4.Goal>(plans.bundles, "Goal"),
      evaluations.matches,
      orders,
    ),
    truncated: plans.truncated || evaluations.truncated,
  };
}

function invalidateNursingCarePlans(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: NURSING_CARE_PLAN_KEY });
}

/** 看護問題の立案・更新、優先度の入れ替え。 */
export function useSaveNursingProblem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => invalidateNursingCarePlans(queryClient),
  });
}

/** 評価・取消。解決・取消では展開した看護指示も閉じるので、指示の来歴も残す。 */
export function useCloseNursingProblem() {
  const queryClient = useQueryClient();
  const withProvenance = useWithOrderProvenance();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(withProvenance(bundle)),
    onSuccess: () => {
      invalidateNursingCarePlans(queryClient);
      invalidateNursing(queryClient);
      invalidateProvenance(queryClient);
    },
  });
}
