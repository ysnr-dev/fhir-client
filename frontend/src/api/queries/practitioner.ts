import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { buildPractitionerDeleteBundle } from "../../fhir/practitionerHelpers";
import {
  baseRoleOf,
  DOCTOR_ROLE_CODES,
  isDoctorRoleCode,
  parsePractitionerRole,
  practitionerIdOfRole,
} from "../../fhir/practitionerRoleHelpers";
import { deleteLoginAccount } from "../authClient";
import { postBundle, readResource, searchResource } from "../fhirClient";
import { hasRelation, resourcesOfType, searchAllPages } from "./core";

export interface PractitionerSearchParams {
  name?: string;
  identifier?: string;
}

const PRACTITIONER_COUNT = 20;

export function usePractitionerSearch(
  search: PractitionerSearchParams,
  offset: number,
  enabled = true,
) {
  const params = new URLSearchParams();
  if (search.name) params.set("name", search.name);
  if (search.identifier) params.set("identifier", search.identifier);
  params.set("_count", String(PRACTITIONER_COUNT));
  params.set("_offset", String(offset));
  // 一覧に職種・所属医療機関を出すため、ぶら下がる PractitionerRole も一緒に取る。
  params.set("_revinclude", "PractitionerRole:practitioner");

  const query = useQuery({
    queryKey: ["Practitioner", "search", search, offset],
    queryFn: () => searchResource<fhir4.Resource>("Practitioner", params),
    placeholderData: keepPreviousData,
    enabled,
  });

  return {
    ...query,
    practitioners: resourcesOfType<fhir4.Practitioner>(query.data?.data, "Practitioner"),
    roles: resourcesOfType<fhir4.PractitionerRole>(query.data?.data, "PractitionerRole"),
    total: query.data?.data.total ?? 0,
    count: PRACTITIONER_COUNT,
    hasPrevious: hasRelation(query.data?.data, "previous"),
    hasNext: hasRelation(query.data?.data, "next"),
  };
}

// 編集画面で職種・所属・所属診療科の初期値に使う。所属ロールと診療科ロールの
// 両方が返るので、role には所属ロール(診療科ロールでないもの)だけを入れる。
export function usePractitionerRoles(practitionerId: string | undefined) {
  const params = new URLSearchParams();
  if (practitionerId) params.set("practitioner", `Practitioner/${practitionerId}`);
  params.set("_count", "100");

  const query = useQuery({
    queryKey: ["PractitionerRole", "practitioner", practitionerId],
    queryFn: () => searchResource<fhir4.PractitionerRole>("PractitionerRole", params),
    enabled: Boolean(practitionerId),
  });

  const roles =
    resourcesOfType<fhir4.PractitionerRole>(query.data?.data, "PractitionerRole");

  return { ...query, roles, role: baseRoleOf(roles) };
}

const PRACTITIONER_ROLE_COUNT = 20;

export interface PractitionerRoleFilter {
  organizationId?: string;
  /**
   * 複数の医療機関のいずれかに所属する、で絞る(連携先医師の一覧が「自院以外の
   * すべて」を出すのに使う)。organizationId と併用しない。
   */
  organizationIds?: string[];
  roleCode?: string;
  /** 氏名(漢字・カナ)の部分一致。チェーン検索で上流に渡す。 */
  name?: string;
  /** 医籍登録番号。氏名と同じくチェーン検索で上流に渡す。 */
  identifier?: string;
}

// 職種・所属医療機関・氏名で医療従事者を絞り込む。PractitionerRole を検索し、
// _include で本体の Practitioner も一緒に取得する。氏名は 1 段チェーン検索
// (practitioner.name:contains。上流の name_text 索引はカナを含む全 name 表現)で
// 上流に渡すため、画面側の絞り込みは不要でページングも他の検索と同様に効く。
export function usePractitionerRoleSearch(
  filter: PractitionerRoleFilter,
  offset: number,
  enabled: boolean,
) {
  const params = new URLSearchParams();
  if (filter.organizationId) params.set("organization", `Organization/${filter.organizationId}`);
  else if (filter.organizationIds?.length) {
    params.set("organization", filter.organizationIds.map((id) => `Organization/${id}`).join(","));
  }
  if (filter.roleCode) params.set("role", filter.roleCode);
  if (filter.name) params.set("practitioner.name:contains", filter.name);
  if (filter.identifier) params.set("practitioner.identifier", filter.identifier);
  params.set("_count", String(PRACTITIONER_ROLE_COUNT));
  params.set("_offset", String(offset));
  params.set("_include", "PractitionerRole:practitioner");
  // 一覧に所属診療科も出すため、_include で引いた Practitioner にぶら下がる
  // 残りのロール(診療科ロール)まで辿る。organization で絞ると一致する所属
  // ロールしか返らないので、iterate が無いと診療科の列が空になる。
  params.set("_revinclude:iterate", "PractitionerRole:practitioner");

  const query = useQuery({
    queryKey: ["PractitionerRole", "search", filter, offset],
    queryFn: () => searchResource<fhir4.Resource>("PractitionerRole", params),
    placeholderData: keepPreviousData,
    enabled,
  });

  return {
    ...query,
    practitioners: resourcesOfType<fhir4.Practitioner>(query.data?.data, "Practitioner"),
    roles: resourcesOfType<fhir4.PractitionerRole>(query.data?.data, "PractitionerRole"),
    total: query.data?.data.total ?? 0,
    count: PRACTITIONER_ROLE_COUNT,
    hasPrevious: hasRelation(query.data?.data, "previous"),
    hasNext: hasRelation(query.data?.data, "next"),
  };
}

// 指定した診療科に所属する医療従事者。診療科ロール(organization = 診療科)を引き、
// _include で本体の Practitioner も取る。1 つの科の所属者が 100 人を超える想定は
// ないのでページ送りはしない。
async function fetchDepartmentMembers(departmentId: string): Promise<fhir4.Practitioner[]> {
  const params = new URLSearchParams();
  params.set("organization", `Organization/${departmentId}`);
  params.set("_count", "100");
  params.set("_include", "PractitionerRole:practitioner");

  const { data: bundle } = await searchResource<fhir4.Resource>("PractitionerRole", params);
  return (
    resourcesOfType<fhir4.Practitioner>(bundle, "Practitioner")
  );
}

// 医療機関に医師・歯科医師として所属する医療従事者の id。職種は所属ロールだけが持ち、
// そのロールの organization は医療機関なので、施設と職種で引く。診療科ロールは
// organization が診療科なのでヒットしない。診療科の所属者に限って引くので 1 ページで足りる。
async function fetchFacilityDoctorIds(
  facilityId: string,
  practitionerIds: string[],
): Promise<Set<string>> {
  const params = new URLSearchParams();
  params.set("organization", `Organization/${facilityId}`);
  params.set("practitioner", practitionerIds.map((id) => `Practitioner/${id}`).join(","));
  params.set("role", DOCTOR_ROLE_CODES.join(","));
  params.set("_count", String(Math.min(practitionerIds.length * 2, 500)));
  const { data: bundle } = await searchResource<fhir4.PractitionerRole>("PractitionerRole", params);
  return new Set(
    resourcesOfType<fhir4.PractitionerRole>(bundle, "PractitionerRole")
      .filter((role) => isDoctorRoleCode(parsePractitionerRole(role).roleCode))
      .map(practitionerIdOfRole)
      .filter((id): id is string => Boolean(id)),
  );
}

// 診療科に所属する医師・歯科医師。依頼科 → 依頼医師の階層選択に使う。
// facilityId(所属医療機関)が分からないときは職種で絞れないので所属者をそのまま返す。
export function useDepartmentDoctors(
  departmentId: string | undefined,
  facilityId: string | undefined,
) {
  const members = useQuery({
    queryKey: ["PractitionerRole", "department", "members", departmentId],
    queryFn: () => fetchDepartmentMembers(departmentId as string),
    enabled: Boolean(departmentId),
  });

  const practitioners = members.data ?? [];
  const memberIds = practitioners
    .map((p) => p.id)
    .filter((id): id is string => Boolean(id))
    .sort();
  const doctorIds = useQuery({
    queryKey: ["PractitionerRole", "organization", "doctors", facilityId, memberIds.join(",")],
    queryFn: () => fetchFacilityDoctorIds(facilityId as string, memberIds),
    enabled: Boolean(facilityId) && memberIds.length > 0,
    staleTime: 5 * 60_000,
  });

  const doctors = facilityId
    ? practitioners.filter((p) => p.id && doctorIds.data?.has(p.id))
    : practitioners;

  return {
    doctors,
    isPending:
      members.isPending || (Boolean(facilityId) && memberIds.length > 0 && doctorIds.isPending),
    error: members.error ?? doctorIds.error,
  };
}

export function usePractitioner(id: string | undefined) {
  return useQuery({
    queryKey: ["Practitioner", id],
    queryFn: () => readResource<fhir4.Practitioner>("Practitioner", id as string),
    enabled: Boolean(id),
  });
}

// 医療従事者と職種・所属は 1 つの transaction Bundle でまとめて保存する
// (buildPractitionerSaveBundle 参照)。
export function useCreatePractitioner() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Practitioner", "search"] });
    },
  });
}

export function useUpdatePractitioner() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ bundle }: { bundle: fhir4.Bundle; practitionerId: string }) => postBundle(bundle),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["Practitioner", "search"] });
      queryClient.invalidateQueries({ queryKey: ["Practitioner", variables.practitionerId] });
      queryClient.invalidateQueries({ queryKey: ["PractitionerRole"] });
    },
  });
}

export function useDeletePractitioner() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const result = await postBundle(buildPractitionerDeleteBundle(id));
      // ログインアカウントが残ると削除済みの医療従事者でログインできてしまう。
      // Practitioner 本体の削除が主目的なので、こちらの失敗で全体は失敗させない。
      await deleteLoginAccount(id).catch(() => {});
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Practitioner", "search"] });
      queryClient.invalidateQueries({ queryKey: ["PractitionerRole"] });
    },
  });
}

// 担当医セレクト用。医療従事者は施設あたり数百人の規模なので、全員を読む。
export function usePractitionerOptions() {
  const query = useQuery({
    queryKey: ["Practitioner", "search", "options"],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("_sort", "family");
      const { matches } = await searchAllPages<fhir4.Practitioner>("Practitioner", params, {
        page: 500,
        maxPages: 4,
        complete: true,
      });
      return matches;
    },
  });

  return { ...query, practitioners: query.data ?? [] };
}
