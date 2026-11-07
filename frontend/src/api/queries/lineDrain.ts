import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LINE_DRAIN_CATEGORY,
  LINE_DRAIN_CATEGORY_SYSTEM,
  parseLineDrain,
  type LineDrainRecord,
} from "../../fhir/lineDrainHelpers";
import { postBundle, readResource, searchResource } from "../fhirClient";
import { resourcesOfType } from "./core";
import { searchExtractRecords } from "./extractRecords";
import { useOrderEnterer } from "./provenance";

// ---- 留置物(ライン・ドレーン・カテーテル)の台帳(docs/line-drain-design.md) ----

const CATEGORY = `${LINE_DRAIN_CATEGORY_SYSTEM}|${LINE_DRAIN_CATEGORY.code}`;

function parseRecords(resources: fhir4.Resource[]): LineDrainRecord[] {
  const observations = resources.filter((r): r is fhir4.Observation => r.resourceType === "Observation");
  return resources
    .filter((r): r is fhir4.Procedure => r.resourceType === "Procedure")
    .map((p) => parseLineDrain(p, observations))
    .filter((r): r is LineDrainRecord => r !== null);
}

/**
 * 患者の留置台帳(誤登録を除く全件)と刺入部観察。1 患者で有限なので留置中への絞り込みは画面側。
 * 観察は `_revinclude=Observation:part-of` で同じ応答に添う。
 */
export function usePatientLineDrains(patientId: string | undefined) {
  return useQuery({
    queryKey: ["Procedure", "search", patientId, "line-drain"],
    queryFn: async (): Promise<LineDrainRecord[]> => {
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      params.set("category", CATEGORY);
      params.set("status:not", "entered-in-error");
      params.append("_revinclude", "Observation:part-of");
      params.set("_sort", "-date");
      params.set("_count", "500");
      const { data } = await searchResource<fhir4.Procedure>("Procedure", params, { strict: true });
      return parseRecords((data.entry ?? []).flatMap((e) => (e.resource ? [e.resource] : [])));
    },
    enabled: Boolean(patientId),
  });
}

/** 経過表の表示範囲と重なる留置(観察は要らない)。 */
export function usePatientLineDrainsInRange(patientId: string | undefined, from: string, to: string) {
  return useQuery({
    queryKey: ["Procedure", "search", patientId, "line-drain", "range", from, to],
    queryFn: async (): Promise<LineDrainRecord[]> => {
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      params.set("category", CATEGORY);
      params.set("status:not", "entered-in-error");
      params.append("date", `ge${from}`);
      params.append("date", `le${to}`);
      params.set("_count", "500");
      const { data } = await searchResource<fhir4.Procedure>("Procedure", params, { strict: true });
      return parseRecords(resourcesOfType<fhir4.Procedure>(data, "Procedure"));
    },
    enabled: Boolean(patientId && from && to),
    placeholderData: keepPreviousData,
  });
}

/** 編集フォームが読む留置の Procedure(版を持つ)。 */
export function useLineDrainProcedure(procedureId: string | undefined) {
  return useQuery({
    queryKey: ["Procedure", procedureId, "line-drain"],
    queryFn: async () => {
      const { data } = await readResource<fhir4.Procedure>("Procedure", procedureId as string);
      return parseLineDrain(data, []);
    },
    enabled: Boolean(procedureId),
  });
}

/** 編集フォームが読む管の実体。 */
export function useLineDrainDevice(deviceId: string | undefined) {
  return useQuery({
    queryKey: ["Device", deviceId],
    queryFn: async () => (await readResource<fhir4.Device>("Device", deviceId as string)).data,
    enabled: Boolean(deviceId),
  });
}

export interface WardLineDrains {
  records: LineDrainRecord[];
  patients: Map<string, fhir4.Patient>;
  truncated: boolean;
}

/**
 * 病棟横断の留置(患者 100 人ずつ subject= に並べて読む)。留置中だけ、または期間と重なるもの。
 * 期間はデバイス日数の分母なので、読み切れなかったら truncated を立てて表を出さない(呼ぶ側)。
 */
export function useWardLineDrains(
  patientIds: string[],
  scope: { inProgressOnly: true } | { from: string; to: string },
) {
  const ids = [...new Set(patientIds.filter(Boolean))].sort();
  const scopeKey = "inProgressOnly" in scope ? "in-progress" : `${scope.from}..${scope.to}`;
  return useQuery({
    queryKey: ["Procedure", "search", "line-drain", "ward", scopeKey, ids.join(",")],
    queryFn: async (): Promise<WardLineDrains> => {
      if (ids.length === 0) return { records: [], patients: new Map(), truncated: false };
      const params = new URLSearchParams();
      params.set("category", CATEGORY);
      // 留置中の一覧は最終観察も出すので、観察を _revinclude で添える(期間の集計には要らない)。
      if ("inProgressOnly" in scope) {
        params.set("status", "in-progress");
        params.append("_revinclude", "Observation:part-of");
      } else {
        params.set("status:not", "entered-in-error");
        params.append("date", `ge${scope.from}`);
        params.append("date", `le${scope.to}`);
      }
      params.set("_sort", "-date");
      const { matches, patients, included, truncated } = await searchExtractRecords<fhir4.Procedure>(
        "Procedure",
        params,
        ids,
        new AbortController().signal,
      );
      return { records: parseRecords([...matches, ...included]), patients, truncated };
    },
    placeholderData: keepPreviousData,
  });
}

function invalidateLineDrains(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["Procedure", "search"] });
  queryClient.invalidateQueries({ queryKey: ["Observation", "search"] });
  queryClient.invalidateQueries({ queryKey: ["Device"] });
}

/** 登録・編集の transaction を送る(ビルダーが組んだ Bundle。編集は版が ifMatch に付いている)。 */
export function useSaveLineDrain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => invalidateLineDrains(queryClient),
  });
}

/** 抜去・抜去取消・誤登録。読んだ Procedure を書き換えたものを 1 件 PUT する(版は postBundle が添える)。 */
export function useUpdateLineDrainProcedure() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (procedure: fhir4.Procedure) =>
      postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: [
          {
            fullUrl: `Procedure/${procedure.id}`,
            resource: procedure,
            request: { method: "PUT", url: `Procedure/${procedure.id}` },
          },
        ],
      }),
    onSuccess: () => invalidateLineDrains(queryClient),
  });
}

/**
 * 刺入部観察の登録(id があれば PUT)。観察者が入っていなければログイン中の医療従事者を入れる
 * (有害事象と同じ扱い。管理者ログインでは入れない)。
 */
export function useSaveLineDrainSiteObservation() {
  const queryClient = useQueryClient();
  const enterer = useOrderEnterer();
  return useMutation({
    mutationFn: (input: fhir4.Observation) => {
      const observation: fhir4.Observation =
        input.performer?.length || !enterer
          ? input
          : {
              ...input,
              performer: [
                { reference: `Practitioner/${enterer.practitionerId}`, display: enterer.display || undefined },
              ],
            };
      return postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: [
          {
            ...(observation.id ? { fullUrl: `Observation/${observation.id}` } : { fullUrl: `urn:uuid:${crypto.randomUUID()}` }),
            resource: observation,
            request: observation.id
              ? { method: "PUT", url: `Observation/${observation.id}` }
              : { method: "POST", url: "Observation" },
          },
        ],
      });
    },
    onSuccess: () => invalidateLineDrains(queryClient),
  });
}

export function useDeleteLineDrainSiteObservation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: [{ request: { method: "DELETE", url: `Observation/${id}` } }],
      }),
    onSuccess: () => invalidateLineDrains(queryClient),
  });
}
