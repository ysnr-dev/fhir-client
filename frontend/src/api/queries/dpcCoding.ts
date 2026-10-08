import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DPC_CODING_QUESTIONNAIRE,
  parseDpcCodingResponse,
  sortDpcDecisions,
} from "../../fhir/dpcCodingRecord";
import { DPC_FORM1_QUESTIONNAIRE } from "../../fhir/dpcForm1Helpers";
import { ADMISSION_CLASS_CODE, DISCHARGED_STATUS } from "../../fhir/encounterHelpers";
import { addDays, addMonths, localDay } from "../../lib/dates";
import { transactionBundle } from "../../fhir/shared";
import { resourceFromBundleResponse } from "../../fhir/schemaImage";
import { postBundle, searchResource, updateResource } from "../fhirClient";
import { resourcesOfType, searchAllPages } from "./core";

// ---- DPC 診断群分類の決定(DPC 歴) ----

const DECISION_KEY = ["QuestionnaireResponse", "search", "dpc-coding"] as const;

/** 入院 1 件の決定の記録(取消も含めて新しい順)。 */
export function useDpcCodingDecisions(encounterId: string | undefined) {
  return useQuery({
    queryKey: [...DECISION_KEY, encounterId],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("questionnaire", DPC_CODING_QUESTIONNAIRE);
      params.set("encounter", `Encounter/${encounterId}`);
      params.set("_count", "100");
      const { data: bundle } = await searchResource<fhir4.QuestionnaireResponse>("QuestionnaireResponse", params);
      return sortDpcDecisions(
        resourcesOfType<fhir4.QuestionnaireResponse>(bundle, "QuestionnaireResponse").map(parseDpcCodingResponse),
      );
    },
    enabled: Boolean(encounterId),
  });
}

export function useSaveDpcCodingDecision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (response: fhir4.QuestionnaireResponse) => {
      const { data: bundle } = await postBundle(
        transactionBundle([
          {
            fullUrl: `urn:uuid:${crypto.randomUUID()}`,
            resource: response,
            request: { method: "POST", url: "QuestionnaireResponse" },
          },
        ]),
      );
      const saved = resourceFromBundleResponse<fhir4.QuestionnaireResponse>(bundle);
      if (!saved.resource) throw new Error("保存結果を取得できませんでした。");
      return saved.resource;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: DECISION_KEY }),
  });
}

/** 決定の取消(entered-in-error)。読んだ版のまま書き換えるので If-Match が付く。 */
export function useCancelDpcCodingDecision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (response: fhir4.QuestionnaireResponse) =>
      updateResource<fhir4.QuestionnaireResponse>(
        { ...response, status: "entered-in-error" },
        response.meta?.versionId ? `W/"${response.meta.versionId}"` : "",
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: DECISION_KEY }),
  });
}

/**
 * 入院ごとの様式1 と決定の記録。DPC 患者一覧で、表示中の入院の分だけをまとめて引く
 * (入院の id をカンマで OR にして 50 件ずつ)。
 */
export function useDpcRecordsForEncounters(encounterIds: string[]) {
  const ids = [...new Set(encounterIds)].sort();
  return useQuery({
    queryKey: ["QuestionnaireResponse", "search", "dpc-records", ids],
    queryFn: async () => {
      const responses: fhir4.QuestionnaireResponse[] = [];
      let truncated = false;
      for (let i = 0; i < ids.length; i += 50) {
        const params = new URLSearchParams();
        params.set("questionnaire", `${DPC_FORM1_QUESTIONNAIRE},${DPC_CODING_QUESTIONNAIRE}`);
        params.set("encounter", ids.slice(i, i + 50).map((id) => `Encounter/${id}`).join(","));
        const page = await searchAllPages<fhir4.QuestionnaireResponse>("QuestionnaireResponse", params, {
          page: 200,
          maxPages: 5,
        });
        responses.push(...page.matches);
        truncated ||= page.truncated;
      }
      return { responses, truncated };
    },
    enabled: ids.length > 0,
  });
}

/** 退院月(YYYY-MM)に退院した入院と患者。 */
export function useDischargedAdmissions(month: string) {
  return useQuery({
    queryKey: ["Encounter", "discharged-month", month],
    queryFn: async () => {
      const first = `${month}-01`;
      const last = addDays(addMonths(first, 1), -1);
      const params = new URLSearchParams();
      params.set("class", ADMISSION_CLASS_CODE);
      params.set("status", DISCHARGED_STATUS);
      // 期間が月と重なる入院を引き、退院日が月の中にあるものだけを残す。
      params.append("date", `ge${first}`);
      params.append("date", `le${last}`);
      params.set("_include", "Encounter:subject");
      const page = await searchAllPages<fhir4.Encounter>("Encounter", params, { page: 200, maxPages: 5 });
      const patientsById = new Map<string, fhir4.Patient>();
      for (const bundle of page.bundles) {
        for (const patient of resourcesOfType<fhir4.Patient>(bundle, "Patient")) {
          if (patient.id) patientsById.set(patient.id, patient);
        }
      }
      const encounters = page.matches.filter((e) => localDay(e.period?.end).startsWith(month));
      return { encounters, patientsById, truncated: page.truncated };
    },
    enabled: /^\d{4}-\d{2}$/.test(month),
  });
}
