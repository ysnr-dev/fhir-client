import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { postBundle, searchResource } from "../fhirClient";
import {
  buildOralExamObservations,
  oralExamDeleteBundle,
  oralExamKindOf,
  oralExamSaveBundle,
  ORAL_EXAM_CODE_SYSTEM,
  ORAL_EXAM_SNAPSHOT_SYSTEM,
  parseOralExamSnapshot,
  summarizeOralExamHeader,
  type OralExamCodeBook,
  type OralExamSnapshot,
} from "../../fhir/oralExamHelpers";
import { hasRelation, resourcesOfType } from "./core";

// ---- 口腔診査情報(Observation。fhir/oralExamHelpers.ts) ----

/** 1 回の診査の Observation の上限。歯 52 本に併存グループ・現在歯の内容が付いても収まる。 */
const SNAPSHOT_COUNT = 500;

/** 患者の診査の一覧(見出しの Observation、新しい順)。 */
export function useOralExamSnapshots(patientId: string | undefined) {
  const query = useQuery({
    queryKey: ["Observation", "search", "oral-exam", patientId],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("subject", `Patient/${patientId}`);
      params.set("code", `${ORAL_EXAM_CODE_SYSTEM}|snapshot`);
      params.set("_sort", "-date");
      params.set("_count", "100");
      const { data } = await searchResource<fhir4.Observation>("Observation", params);
      return resourcesOfType<fhir4.Observation>(data, "Observation").map((header) => ({
        header,
        summary: summarizeOralExamHeader(header),
      }));
    },
    enabled: Boolean(patientId),
  });
  return { ...query, snapshots: query.data ?? [] };
}

export interface LoadedOralExamSnapshot {
  snapshot: OralExamSnapshot;
  header: fhir4.Observation;
  /** 見出し以外(作り直しで消すもの)。 */
  childIds: string[];
  truncated: boolean;
}

async function fetchOralExamSnapshot(snapshotId: string): Promise<LoadedOralExamSnapshot | null> {
  const params = new URLSearchParams();
  params.set("identifier", `${ORAL_EXAM_SNAPSHOT_SYSTEM}|${snapshotId}`);
  params.set("_count", String(SNAPSHOT_COUNT));
  const { data } = await searchResource<fhir4.Observation>("Observation", params);
  const observations = resourcesOfType<fhir4.Observation>(data, "Observation");
  const snapshot = parseOralExamSnapshot(observations);
  const header = observations.find((o) => oralExamKindOf(o) === "snapshot");
  if (!snapshot || !header) return null;
  return {
    snapshot,
    header,
    childIds: observations.filter((o) => o !== header && o.id).map((o) => o.id as string),
    truncated: hasRelation(data, "next"),
  };
}

/** 1 回の診査。identifier で束ねてあるので 1 回の検索で全部そろう。 */
export function useOralExamSnapshot(snapshotId: string | undefined) {
  return useQuery({
    queryKey: ["Observation", "search", "oral-exam-snapshot", snapshotId],
    queryFn: () => fetchOralExamSnapshot(snapshotId ?? ""),
    enabled: Boolean(snapshotId),
  });
}

export function useSaveOralExam() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      snapshot,
      patientId,
      book,
      loaded,
    }: {
      snapshot: OralExamSnapshot;
      patientId: string;
      book: OralExamCodeBook | undefined;
      loaded?: { header: fhir4.Observation; childIds: string[] };
    }) => {
      const { header, children } = buildOralExamObservations(snapshot, patientId, book);
      return postBundle(oralExamSaveBundle(header, children, loaded));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Observation", "search"] });
    },
  });
}

/** 1 回の診査を消す。束ねた Observation を引き直して全部消す。 */
export function useDeleteOralExam() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (snapshotId: string) => {
      const params = new URLSearchParams();
      params.set("identifier", `${ORAL_EXAM_SNAPSHOT_SYSTEM}|${snapshotId}`);
      params.set("_count", String(SNAPSHOT_COUNT));
      const { data } = await searchResource<fhir4.Observation>("Observation", params);
      const ids = resourcesOfType<fhir4.Observation>(data, "Observation")
        .map((o) => o.id ?? "")
        .filter(Boolean);
      return postBundle(oralExamDeleteBundle(ids));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Observation", "search"] });
    },
  });
}
