import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  NURSING_NOTE_CATEGORY_SEARCH,
  NURSING_SUMMARY_TYPE_SEARCH,
  narrativePlainText,
} from "../../fhir/clinicalNoteHelpers";
import { excludeNursingProblems } from "../../fhir/conditionHelpers";
import type { NursingRecordSource, NursingSummarySources } from "../../fhir/nursingSummaryHelpers";
import {
  NURSING_SUMMARY_RETURNED_TASK_CODE,
  buildCompletedReturnedEntries,
} from "../../fhir/nursingSummaryTaskHelpers";
import { LOINC_SYSTEM, transactionBundle, withVersionLock } from "../../fhir/shared";
import { TASK_CODE_SYSTEM } from "../../fhir/taskHelpers";
import { today } from "../../lib/dates";
import { postBundle, readResource, searchResource, type FhirResult } from "../fhirClient";
import { NOTIFICATION_TASK_KEY, resourcesOfType, searchAllPages, type Truncatable } from "./core";
import { fetchEncounterWard } from "./encounter";
import { saveClinicalNote } from "./micro";
import { fetchNursingCarePlans } from "./nursingCarePlan";
import { useOrderEnterer } from "./provenance";

// 看護サマリ(docs/nursing-care-plan-design.md)。作成の材料集め・保存・病棟単位の承認一覧。

const NURSING_SUMMARY_KEY = ["Composition", "search", "nursing-summary"];

function recordOf(composition: fhir4.Composition): NursingRecordSource {
  return {
    id: composition.id ?? "",
    date: composition.date ?? "",
    author: composition.author?.[0]?.display ?? "",
    title: composition.title ?? "",
    text: (composition.section ?? [])
      .filter((s) => s.text?.div)
      .map((s) => narrativePlainText(s.text?.div))
      .filter(Boolean)
      .join("\n"),
  };
}

/**
 * 看護サマリの下書きの材料。病名・アレルギー・看護計画と、入院期間の看護記録(看護職が書いた
 * 経過記録)を集める。看護記録は期間を絞って選ぶので、入院期間ぶんを引いておく。
 */
export function useNursingSummarySources(patientId: string, encounter: fhir4.Encounter | undefined) {
  const encounterId = encounter?.id;
  return useQuery({
    queryKey: ["nursing-summary", "sources", patientId, encounterId, encounter?.period?.end ?? ""],
    queryFn: async (): Promise<NursingSummarySources> => {
      const start = encounter?.period?.start?.slice(0, 10) ?? "";
      const end = encounter?.period?.end?.slice(0, 10) ?? today();

      const conditionParams = new URLSearchParams();
      conditionParams.set("patient", `Patient/${patientId}`);
      conditionParams.set("_count", "500");
      conditionParams.set("_sort", "-onset-date");
      excludeNursingProblems(conditionParams);

      const allergyParams = new URLSearchParams();
      allergyParams.set("patient", `Patient/${patientId}`);
      allergyParams.set("_count", "100");

      const recordParams = new URLSearchParams();
      recordParams.set("subject", `Patient/${patientId}`);
      recordParams.set("type", `${LOINC_SYSTEM}|11506-3`);
      recordParams.set("category", NURSING_NOTE_CATEGORY_SEARCH);
      if (start) recordParams.append("date", `ge${start}`);
      recordParams.append("date", `le${end}`);
      recordParams.set("_sort", "date");

      const summaryParams = new URLSearchParams();
      summaryParams.set("encounter", `Encounter/${encounterId}`);
      summaryParams.set("type", NURSING_SUMMARY_TYPE_SEARCH);
      summaryParams.set("_count", "50");

      const [patient, conditions, allergies, plans, records, summaries, ward] = await Promise.all([
        readResource<fhir4.Patient>("Patient", patientId),
        searchResource<fhir4.Condition>("Condition", conditionParams),
        searchResource<fhir4.AllergyIntolerance>("AllergyIntolerance", allergyParams),
        fetchNursingCarePlans(patientId),
        searchAllPages<fhir4.Composition>("Composition", recordParams, { page: 200, maxPages: 3 }),
        searchResource<fhir4.Composition>("Composition", summaryParams),
        fetchEncounterWard(encounter as fhir4.Encounter),
      ]);
      return {
        encounter: encounter as fhir4.Encounter,
        ward: { wardId: ward.wardId, wardName: ward.wardName },
        patient: patient.data,
        conditions: resourcesOfType<fhir4.Condition>(conditions.data, "Condition"),
        allergies: resourcesOfType<fhir4.AllergyIntolerance>(allergies.data, "AllergyIntolerance"),
        nursingProblems: plans.items,
        nursingRecords: records.matches.filter((c) => c.status !== "entered-in-error").map(recordOf),
        summaries: resourcesOfType<fhir4.Composition>(summaries.data, "Composition"),
      };
    },
    enabled: Boolean(patientId) && Boolean(encounterId),
  });
}

/** その入院の看護サマリ(新しい順)。 */
export function useNursingSummariesFor(encounterId: string | undefined) {
  return useQuery({
    queryKey: [...NURSING_SUMMARY_KEY, "encounter", encounterId],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("encounter", `Encounter/${encounterId}`);
      params.set("type", NURSING_SUMMARY_TYPE_SEARCH);
      params.set("_sort", "-date");
      params.set("_count", "50");
      const { data } = await searchResource<fhir4.Composition>("Composition", params);
      return resourcesOfType<fhir4.Composition>(data, "Composition");
    },
    enabled: Boolean(encounterId),
  });
}

/** 看護サマリへの未対応の差戻し(通知 Task)。 */
export async function fetchReturnedTasks(compositionIds: string[]): Promise<fhir4.Task[]> {
  if (compositionIds.length === 0) return [];
  const params = new URLSearchParams();
  params.set("code", `${TASK_CODE_SYSTEM}|${NURSING_SUMMARY_RETURNED_TASK_CODE.code}`);
  params.set("status", "requested");
  params.set("focus", compositionIds.map((id) => `Composition/${id}`).join(","));
  params.set("_count", "500");
  const { data } = await searchResource<fhir4.Task>("Task", params);
  return resourcesOfType<fhir4.Task>(data, "Task");
}

export function useReturnedTasks(compositionIds: string[]) {
  const sorted = [...compositionIds].filter(Boolean).sort();
  return useQuery({
    queryKey: [...NOTIFICATION_TASK_KEY, "nursing-summary-returned", sorted],
    queryFn: () => fetchReturnedTasks(sorted),
    enabled: sorted.length > 0,
  });
}

function invalidateNursingSummaries(queryClient: ReturnType<typeof useQueryClient>, id?: string) {
  queryClient.invalidateQueries({ queryKey: ["Composition", "search"] });
  if (id) queryClient.invalidateQueries({ queryKey: ["Composition", id] });
  queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse"] });
  queryClient.invalidateQueries({ queryKey: NOTIFICATION_TASK_KEY });
  queryClient.invalidateQueries({ queryKey: ["Task"] });
}

/** 看護サマリの保存。確定し直したときは未対応の差戻しを同じ transaction で閉じる。 */
export function useSaveNursingSummary() {
  const queryClient = useQueryClient();
  const enterer = useOrderEnterer();
  return useMutation({
    mutationFn: async ({
      composition,
      entries,
      etag,
      returnedTasks,
    }: {
      composition: fhir4.Composition;
      entries: fhir4.BundleEntry[];
      etag?: string;
      returnedTasks: fhir4.Task[];
    }) => {
      const closing =
        composition.status !== "preliminary" && enterer ? buildCompletedReturnedEntries(returnedTasks, enterer) : [];
      return saveClinicalNote(composition, [...entries, ...closing], etag);
    },
    onSuccess: (result: FhirResult<fhir4.Composition>) => invalidateNursingSummaries(queryClient, result.data.id),
  });
}

export interface WardNursingSummaries {
  summaries: fhir4.Composition[];
  patients: Map<string, fhir4.Patient>;
  returnedTasks: fhir4.Task[];
}

/** 病棟の看護サマリ(作成日が期間内)。患者を _include で添え、未対応の差戻しも引く。 */
export function useWardNursingSummaries(wardId: string, from: string, to: string) {
  return useQuery({
    queryKey: [...NURSING_SUMMARY_KEY, "ward", wardId, from, to],
    queryFn: async (): Promise<Truncatable<WardNursingSummaries>> => {
      const params = new URLSearchParams();
      params.set("type", NURSING_SUMMARY_TYPE_SEARCH);
      params.set("ward", `Location/${wardId}`);
      if (from) params.append("date", `ge${from}`);
      if (to) params.append("date", `le${to}`);
      params.set("_sort", "-date");
      params.append("_include", "Composition:subject");
      const result = await searchAllPages<fhir4.Composition>("Composition", params, { page: 200, maxPages: 3 });
      const patients = new Map(
        result.bundles
          .flatMap((b) => resourcesOfType<fhir4.Patient>(b, "Patient"))
          .map((p) => [p.id ?? "", p] as const),
      );
      const returnedTasks = await fetchReturnedTasks(result.matches.map((c) => c.id ?? ""));
      return { value: { summaries: result.matches, patients, returnedTasks }, truncated: result.truncated };
    },
    enabled: Boolean(wardId),
  });
}

/** 承認・却下。Composition の PUT(読んだ版を添える)と、却下なら差戻しの通知を 1 transaction で書く。 */
export function useReviewNursingSummary() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      original,
      next,
      extraEntries = [],
    }: {
      original: fhir4.Composition;
      next: fhir4.Composition;
      extraEntries?: fhir4.BundleEntry[];
    }) =>
      postBundle(
        withVersionLock(
          transactionBundle([
            { resource: next, request: { method: "PUT", url: `Composition/${original.id}` } },
            ...extraEntries,
          ]),
          original,
        ),
      ),
    onSuccess: () => invalidateNursingSummaries(queryClient),
  });
}
