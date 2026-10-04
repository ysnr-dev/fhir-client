import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createResource,
  deleteResource,
  type FhirResult,
  postBundle,
  readResource,
  searchResource,
  updateResource,
} from "../fhirClient";
import { fetchFacilitySettings } from "../facilityClient";
import { hasRelation, resourcesOfType } from "./core";

// --- 自院 --------------------------------------------------------------------
//
// 本アプリはマルチテナントではなく、診療科・診察室・スタッフは自院のものしか
// 登録しない。他院の医療機関・医師は診療情報提供書の宛先候補として登録するので、
// 「どれが自院か」は backend の単一行設定(管理 > 施設設定)が持つ。
//
// 未設定でも画面は動く(所属を選ばせる UI になる)。呼び出し側は
// isUnset を見て「自院固定にするか、選ばせるか」を切り替える。

export function useFacilitySettings() {
  return useQuery({
    queryKey: ["facility", "settings"],
    queryFn: fetchFacilitySettings,
    // ほぼ変わらない設定なので、画面遷移のたびに引き直さない。
    staleTime: 5 * 60 * 1000,
  });
}

export function useSelfOrganization() {
  const settings = useFacilitySettings();
  const selfOrganizationId = settings.data?.self_organization_id ?? null;
  const organization = useOrganization(selfOrganizationId || undefined);

  return {
    selfOrganizationId,
    organization: organization.data?.data,
    /** 自院が設定されていない(初期セットアップ前)。 */
    isUnset: settings.isSuccess && !selfOrganizationId,
    // 未設定で disabled になったクエリの isPending は true のままなので、
    // 「自院が無い環境」で待ち続けないよう isLoading を見る。
    isLoading: settings.isLoading || organization.isLoading,
  };
}

export interface OrganizationSearchParams {
  name?: string;
  identifier?: string;
}

const ORGANIZATION_COUNT = 20;

/**
 * 医療機関(施設)の検索。excludeId を渡すとその 1 件を上流側で除く(連携先の一覧が
 * 自院を外すのに使う)。取得後に画面側で間引くと total とページ内件数がずれるため、
 * 除外もサーバーに任せる。
 */
export function useOrganizationSearch(
  search: OrganizationSearchParams,
  offset: number,
  excludeId?: string | null,
) {
  const params = new URLSearchParams();
  if (search.name) params.set("name", search.name);
  if (search.identifier) params.set("identifier", search.identifier);
  // 診療科(partOf あり)は診療科一覧の担当なので、医療機関一覧からは除く。
  params.set("partof:missing", "true");
  if (excludeId) params.set("_id:not", excludeId);
  params.set("_count", String(ORGANIZATION_COUNT));
  params.set("_offset", String(offset));

  const query = useQuery({
    queryKey: ["Organization", "search", search, offset, excludeId ?? ""],
    queryFn: () => searchResource<fhir4.Organization>("Organization", params),
    placeholderData: keepPreviousData,
  });

  return {
    ...query,
    bundle: query.data?.data,
    total: query.data?.data.total ?? 0,
    count: ORGANIZATION_COUNT,
    hasPrevious: hasRelation(query.data?.data, "previous"),
    hasNext: hasRelation(query.data?.data, "next"),
  };
}

// 選択肢用に医療機関をまとめて取得する(上流の _count 上限 500 まで。
// それ以上の施設数は運用上想定しない)。
export function useOrganizationOptions() {
  const params = new URLSearchParams();
  params.set("partof:missing", "true");
  params.set("_count", "500");
  params.set("_sort", "name");

  const query = useQuery({
    queryKey: ["Organization", "search", "options"],
    queryFn: () => searchResource<fhir4.Organization>("Organization", params),
  });

  return {
    ...query,
    organizations:
      resourcesOfType<fhir4.Organization>(query.data?.data, "Organization"),
  };
}

export function useOrganization(id: string | undefined) {
  return useQuery({
    queryKey: ["Organization", id],
    queryFn: () => readResource<fhir4.Organization>("Organization", id as string),
    enabled: Boolean(id),
  });
}

export function useCreateOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (organization: fhir4.Organization) => createResource(organization),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Organization", "search"] });
    },
  });
}

export function useUpdateOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ organization, etag }: { organization: fhir4.Organization; etag: string }) =>
      updateResource(organization, etag),
    onSuccess: (result: FhirResult<fhir4.Organization>) => {
      queryClient.invalidateQueries({ queryKey: ["Organization", "search"] });
      queryClient.invalidateQueries({ queryKey: ["Organization", result.data.id] });
    },
  });
}

export function useDeleteOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteResource("Organization", id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Organization", "search"] });
    },
  });
}

// 診療科は Organization / partOf ありで表現する。読み書きは Organization 用の
// フック(useOrganization / useCreateOrganization など)をそのまま使い、
// ここには一覧検索と一括登録だけを置く。
export interface DepartmentSearchParams {
  name?: string;
  /** 所属医療機関の Organization.id。未指定なら全医療機関の診療科。 */
  partOfId?: string;
}

export const DEPARTMENT_COUNT = 20;

function departmentSearchParams(search: DepartmentSearchParams): URLSearchParams {
  const params = new URLSearchParams();
  if (search.name) params.set("name", search.name);
  if (search.partOfId) params.set("partof", `Organization/${search.partOfId}`);
  // 所属医療機関の指定がなければ「親を持つ Organization」= 診療科すべて。
  // type=dept でも引けるが、診療科を診療科たらしめているのは「所属医療機関を持つ」
  // 方(フォームが必須にしているのはこちら)なので、判別は partOf で行う。
  else params.set("partof:missing", "false");
  // 診療科コードの昇順。コード未設定の科は末尾に回り(上流は NULL を後ろに置く)、
  // その中では名称順になる = sortDepartmentsByCode と同じ並び。
  params.set("_sort", "identifier,name");
  return params;
}

// 条件に合う診療科を全件集める。上流の _count 上限は 500 なので、次ページが
// 尽きるまで _offset を進めて読み切る。セレクトの選択肢と一括登録の重複判定は
// 全件が要るのでこちらを使う(一覧画面は useDepartmentPage)。
async function fetchAllDepartments(search: DepartmentSearchParams): Promise<fhir4.Organization[]> {
  const PAGE = 500;
  const departments: fhir4.Organization[] = [];

  for (let offset = 0; ; offset += PAGE) {
    const params = departmentSearchParams(search);
    params.set("_count", String(PAGE));
    params.set("_offset", String(offset));
    const { data: bundle } = await searchResource<fhir4.Organization>("Organization", params);
    const page =
      resourcesOfType<fhir4.Organization>(bundle, "Organization");
    departments.push(...page);
    if (page.length < PAGE) return departments;
  }
}

// 選択肢用。診療科コードの昇順(コード未設定は末尾)は上流が返すので、
// ここでは並べ替えない。
export function useDepartmentList(search: DepartmentSearchParams) {
  const query = useQuery({
    queryKey: ["Organization", "search", "department", "list", search],
    queryFn: () => fetchAllDepartments(search),
    placeholderData: keepPreviousData,
  });

  return {
    ...query,
    departments: query.data ?? [],
    total: query.data?.length ?? 0,
    count: DEPARTMENT_COUNT,
  };
}

// 一覧画面用。並べ替えもページングも上流に任せる(上流は診療科コード順の _sort に
// 対応している)。
export function useDepartmentPage(search: DepartmentSearchParams, offset: number) {
  const params = departmentSearchParams(search);
  params.set("_count", String(DEPARTMENT_COUNT));
  params.set("_offset", String(offset));

  const query = useQuery({
    queryKey: ["Organization", "search", "department", "page", search, offset],
    queryFn: () => searchResource<fhir4.Organization>("Organization", params),
    placeholderData: keepPreviousData,
  });

  return {
    ...query,
    departments:
      resourcesOfType<fhir4.Organization>(query.data?.data, "Organization"),
    total: query.data?.data.total ?? 0,
    count: DEPARTMENT_COUNT,
    hasPrevious: hasRelation(query.data?.data, "previous"),
    hasNext: hasRelation(query.data?.data, "next"),
  };
}

// 自院の診療科。予約枠・外来一覧・部門ワークリストのように「自院の科を選ぶ」
// 画面はこちらを使う。自院未設定の環境では全医療機関の診療科を返す。
export function useSelfDepartments(name?: string) {
  const { selfOrganizationId } = useSelfOrganization();
  return useDepartmentList({ name, partOfId: selfOrganizationId || undefined });
}

export function useDepartmentsOf(partOfId: string | undefined) {
  return useQuery({
    queryKey: ["Organization", "search", "department", "all", partOfId],
    queryFn: () => fetchAllDepartments({ partOfId }),
    enabled: Boolean(partOfId),
  });
}

export function useSeedDepartments() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Organization", "search"] });
    },
  });
}
