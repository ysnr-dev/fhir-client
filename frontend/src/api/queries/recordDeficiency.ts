import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { splitNotificationBundle } from "../../fhir/notificationHelpers";
import { parseDepartmentRoles, practitionerIdOfRole } from "../../fhir/practitionerRoleHelpers";
import { practitionerDisplayName } from "../../fhir/practitionerHelpers";
import {
  type DeficiencyItem,
  DRAFT_NOTE_ELEMENTS,
  DRAFT_NOTE_TYPE_SEARCH,
  draftNoteDeficiencyItem,
  NO_OWNER,
  RECORD_DEFICIENCY_CODES,
  RECORD_DEFICIENCY_ELEMENTS,
  returnedNoteIdOf,
  taskDeficiencyItem,
} from "../../fhir/recordDeficiencyHelpers";
import { NOTE_RETURNED_TASK_CODE } from "../../fhir/countersignHelpers";
import { TASK_CODE_SYSTEM } from "../../fhir/taskHelpers";
import { searchResource } from "../fhirClient";
import { NOTIFICATION_TASK_KEY, resourcesOfType, searchAllPages } from "./core";

// 未完了記録一覧(docs/features/notifications.md「未完了記録一覧」)。上流に「担当者ごとの件数」を返す検索が無いので、
// 未対応の Task と下書きの診療記録を集計に要る要素だけで全件読んで画面で数える(合計に使うので欠けたら失敗にする)。

/** 全件読む上限(500 件 × 20 ページ)。超えたら SearchLimitError。 */
const MAX_PAGES = 20;

/**
 * 数える 1 件ずつ(未対応の Task と下書きの診療記録)。ownerId を渡すとその人あて・その人が記載者のものだけ。
 * 通知の書き込みで読み直すよう Task は通知と同じキーの下に、診療記録は Composition の検索のキーの下に置く。
 */
export function useRecordDeficiencyItems(ownerId?: string | null, enabled = true) {
  const tasks = useQuery({
    queryKey: [...NOTIFICATION_TASK_KEY, "record-deficiency", ownerId ?? "all"],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("code", RECORD_DEFICIENCY_CODES);
      params.set("status", "requested");
      if (ownerId) params.set("owner", `Practitioner/${ownerId}`);
      params.set("_elements", RECORD_DEFICIENCY_ELEMENTS);
      const { matches } = await searchAllPages<fhir4.Task>("Task", params, {
        page: 500,
        maxPages: MAX_PAGES,
        complete: true,
      });
      return matches.map(taskDeficiencyItem).filter((item): item is DeficiencyItem => item !== null);
    },
    enabled,
    staleTime: 60_000,
  });
  const drafts = useQuery({
    queryKey: ["Composition", "search", "record-deficiency", ownerId ?? "all"],
    queryFn: async () => {
      const { matches } = await searchAllPages<fhir4.Composition>("Composition", draftNoteParams(ownerId), {
        page: 500,
        maxPages: MAX_PAGES,
        complete: true,
      });
      return matches.map(draftNoteDeficiencyItem);
    },
    enabled,
    staleTime: 60_000,
  });
  const items = useMemo(
    () => (tasks.data && drafts.data ? [...drafts.data, ...tasks.data] : undefined),
    [tasks.data, drafts.data],
  );
  return { items, isPending: tasks.isPending || drafts.isPending, error: tasks.error ?? drafts.error };
}

/** 下書きの診療記録の検索条件。記載者は author(0..* の参照、jsonb で一致)。 */
function draftNoteParams(ownerId: string | null | undefined, elements = true): URLSearchParams {
  const params = new URLSearchParams();
  params.set("status", "preliminary");
  params.set("type", DRAFT_NOTE_TYPE_SEARCH);
  if (ownerId) params.set("author", `Practitioner/${ownerId}`);
  if (elements) params.set("_elements", DRAFT_NOTE_ELEMENTS);
  return params;
}

export interface DeficiencyOwner {
  name: string;
  /** 所属科(既定科が先頭)。 */
  departments: { organizationId: string; name: string }[];
}

/**
 * 担当者の氏名と所属科。所属ロールを医療従事者 id の OR で引き、本体を _include で添えてもらう。
 * URL が長くなりすぎないよう 50 人ずつに分ける。
 */
export function useDeficiencyOwners(ownerIds: readonly string[]) {
  const ids = [...new Set(ownerIds.filter((id) => id !== NO_OWNER))].sort();
  return useQuery({
    queryKey: ["PractitionerRole", "search", "deficiency-owners", ids.join(",")],
    queryFn: async () => {
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
      const bundles = await Promise.all(
        chunks.map((chunk) => {
          const params = new URLSearchParams();
          params.set("practitioner", chunk.map((id) => `Practitioner/${id}`).join(","));
          params.set("_include", "PractitionerRole:practitioner");
          params.set("_count", "500");
          return searchResource<fhir4.Resource>("PractitionerRole", params).then((result) => result.data);
        }),
      );
      const roles = bundles.flatMap((bundle) => resourcesOfType<fhir4.PractitionerRole>(bundle, "PractitionerRole"));
      const practitioners = bundles.flatMap((bundle) => resourcesOfType<fhir4.Practitioner>(bundle, "Practitioner"));
      const owners = new Map<string, DeficiencyOwner>();
      for (const id of ids) {
        const practitioner = practitioners.find((p) => p.id === id);
        const own = roles.filter((role) => practitionerIdOfRole(role) === id);
        owners.set(id, {
          name: practitioner ? practitionerDisplayName(practitioner) : "",
          departments: parseDepartmentRoles(own).map(({ organizationId, name }) => ({ organizationId, name })),
        });
      }
      return owners;
    },
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
  });
}

/**
 * 1 セルぶん(担当者 × 種別)の未対応の Task と患者。表のセルを押したときだけ引く。
 * 宛先なしは owner:missing で引く。古い順(滞留の長いものから)。
 */
export function useDeficiencyCellTasks(code: string | null, ownerId: string) {
  return useQuery({
    queryKey: [...NOTIFICATION_TASK_KEY, "record-deficiency", "cell", code, ownerId],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("code", `${TASK_CODE_SYSTEM}|${code}`);
      params.set("status", "requested");
      if (ownerId === NO_OWNER) params.set("owner:missing", "true");
      else params.set("owner", `Practitioner/${ownerId}`);
      params.set("_include", "Task:subject");
      params.set("_sort", "authored-on");
      params.set("_count", "200");
      const { data } = await searchResource<fhir4.Resource>("Task", params);
      return { ...splitNotificationBundle(data), hasMore: (data.link ?? []).some((link) => link.relation === "next") };
    },
    enabled: Boolean(code),
  });
}

/**
 * 下書きの診療記録の一覧(1 人ぶん)。表のセルを押したときだけ引く。記載者の無い記録は author:missing で引く。
 * 古い順(滞留の長いものから)。差戻し中の記録は「カルテ差戻し」で数えるので、未対応の差戻しの Task が指す記録は除く。
 */
export function useDeficiencyDraftNotes(ownerId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["Composition", "search", "record-deficiency", "cell", ownerId],
    queryFn: async () => {
      const params = draftNoteParams(ownerId === NO_OWNER ? null : ownerId, false);
      if (ownerId === NO_OWNER) params.set("author:missing", "true");
      params.set("_include", "Composition:subject");
      params.set("_sort", "date");
      params.set("_count", "200");
      const returnedParams = new URLSearchParams();
      returnedParams.set("code", `${TASK_CODE_SYSTEM}|${NOTE_RETURNED_TASK_CODE.code}`);
      returnedParams.set("status", "requested");
      if (ownerId !== NO_OWNER) returnedParams.set("owner", `Practitioner/${ownerId}`);
      returnedParams.set("_elements", "focus");
      returnedParams.set("_count", "500");
      const [{ data }, returnedResult] = await Promise.all([
        searchResource<fhir4.Resource>("Composition", params),
        searchResource<fhir4.Task>("Task", returnedParams),
      ]);
      const returned = new Set(
        resourcesOfType<fhir4.Task>(returnedResult.data, "Task").map(returnedNoteIdOf).filter(Boolean),
      );
      const patients = new Map(
        resourcesOfType<fhir4.Patient>(data, "Patient").map((patient) => [patient.id ?? "", patient]),
      );
      return {
        notes: resourcesOfType<fhir4.Composition>(data, "Composition").filter((note) => !returned.has(note.id ?? "")),
        patients,
        hasMore: (data.link ?? []).some((link) => link.relation === "next"),
      };
    },
    enabled,
  });
}

