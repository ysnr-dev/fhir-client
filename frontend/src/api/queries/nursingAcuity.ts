import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NURSING_ACUITY_FORMS, NURSING_ACUITY_SYSTEM } from "../../fhir/nursingAcuityHelpers";
import { ORDER_TYPE_SYSTEM } from "../../fhir/orderHeader";
import { addDays } from "../../lib/dates";
import { postBundle } from "../fhirClient";
import { resourcesOfType, searchAllPages } from "./core";

// ---- 重症度、医療・看護必要度(docs/nursing-acuity-design.md) ----

const ACUITY_KEY = ["Observation", "nursing-acuity"];
// 1 回の検索に載せる患者数(1 か月 × 40 人 = 1,240 件が _count 500 × 4 ページに収まる幅)。
const PATIENT_CHUNK = 40;

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

/** 患者の期間 [from, to] の評価(どの版の評価票でも)。 */
export function useAcuityObservations(patientIds: string[], from: string, to: string) {
  const ids = [...new Set(patientIds.filter(Boolean))].sort();
  return useQuery({
    queryKey: [...ACUITY_KEY, ids.join(","), from, to],
    queryFn: async () => {
      const results = await Promise.all(
        chunks(ids, PATIENT_CHUNK).map((chunk) => {
          const params = new URLSearchParams();
          params.set("code", NURSING_ACUITY_FORMS.map((form) => `${NURSING_ACUITY_SYSTEM}|${form.code}`).join(","));
          params.set("patient", chunk.map((id) => `Patient/${id}`).join(","));
          params.append("date", `ge${from}`);
          params.append("date", `le${to}`);
          return searchAllPages<fhir4.Observation>("Observation", params, { page: 500, maxPages: 4 });
        }),
      );
      return {
        observations: results.flatMap((result) => result.matches),
        truncated: results.some((result) => result.truncated),
      };
    },
    enabled: ids.length > 0 && Boolean(from) && Boolean(to),
    placeholderData: keepPreviousData,
  });
}

/**
 * 評価の初期値に使う実施記録。その日までの手術(C の日数の目安)を含めて 11 日ぶん引き、
 * 注射は施用した薬剤(MedicationAdministration)も添えてもらう。
 */
export function useAcuityRecords(patientId: string | undefined, date: string) {
  return useQuery({
    queryKey: ["Procedure", "nursing-acuity-records", patientId ?? "", date],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      params.set(
        "category",
        ["injection", "transfusion", "radiotherapy", "surgery"].map((code) => `${ORDER_TYPE_SYSTEM}|${code}`).join(","),
      );
      params.append("date", `ge${addDays(date, -10)}`);
      params.append("date", `le${date}`);
      params.set("_revinclude", "MedicationAdministration:part-of");
      const { matches, bundles } = await searchAllPages<fhir4.Procedure>("Procedure", params, {
        page: 500,
        maxPages: 2,
      });
      return {
        procedures: matches,
        administrations: bundles.flatMap((bundle) =>
          resourcesOfType<fhir4.MedicationAdministration>(bundle, "MedicationAdministration"),
        ),
      };
    },
    enabled: Boolean(patientId) && Boolean(date),
  });
}

function acuityEntry(observation: fhir4.Observation): fhir4.BundleEntry {
  return observation.id
    ? {
        fullUrl: `Observation/${observation.id}`,
        resource: observation,
        request: { method: "PUT", url: `Observation/${observation.id}` },
      }
    : {
        fullUrl: `urn:uuid:${crypto.randomUUID()}`,
        resource: observation,
        request: { method: "POST", url: "Observation" },
      };
}

/**
 * 評価の登録・更新(1 件でも、一括入力の複数件でも 1 つの transaction)。既存(id あり)は版を添えて
 * PUT する(postBundle が meta.versionId を If-Match にする)。
 */
export function useSaveAcuity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (observations: fhir4.Observation | fhir4.Observation[]) =>
      postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: (Array.isArray(observations) ? observations : [observations]).map(acuityEntry),
      }),
    retry: false,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ACUITY_KEY }),
  });
}

/** 一括入力の初期値に使う、病棟の患者ぶんの実施記録(useAcuityRecords を患者をまとめて引く形)。 */
export function useAcuityRecordsForPatients(patientIds: string[], date: string) {
  const ids = [...new Set(patientIds.filter(Boolean))].sort();
  return useQuery({
    queryKey: ["Procedure", "nursing-acuity-records-ward", ids.join(","), date],
    queryFn: async () => {
      const results = await Promise.all(
        chunks(ids, PATIENT_CHUNK).map((chunk) => {
          const params = new URLSearchParams();
          params.set("patient", chunk.map((id) => `Patient/${id}`).join(","));
          params.set(
            "category",
            ["injection", "transfusion", "radiotherapy", "surgery"].map((code) => `${ORDER_TYPE_SYSTEM}|${code}`).join(","),
          );
          params.append("date", `ge${addDays(date, -10)}`);
          params.append("date", `le${date}`);
          params.set("_revinclude", "MedicationAdministration:part-of");
          return searchAllPages<fhir4.Procedure>("Procedure", params, { page: 500, maxPages: 4 });
        }),
      );
      const procedures = results.flatMap((result) => result.matches);
      const administrations = results.flatMap((result) =>
        result.bundles.flatMap((bundle) =>
          resourcesOfType<fhir4.MedicationAdministration>(bundle, "MedicationAdministration"),
        ),
      );
      return { procedures, administrations, truncated: results.some((result) => result.truncated) };
    },
    enabled: ids.length > 0 && Boolean(date),
  });
}
