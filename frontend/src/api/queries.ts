import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { buildClinicalNoteDeleteBundle } from "../fhir/clinicalNoteHelpers";
import { sortDepartmentsByCode } from "../fhir/departmentHelpers";
import {
  buildLabResultDeleteBundle,
  observationIdsFromReport,
  specimenIdsFromReport,
} from "../fhir/labResultHelpers";
import { isInjectionServiceRequest } from "../fhir/injectionHelpers";
import {
  buildLabOrderDeleteBundle,
  isOrderItemRequest,
  isLabServiceRequest,
  labOrderItemRequests,
  labOrderItems,
  labOrderLabel,
  serviceRequestsOf,
} from "../fhir/labOrderHelpers";
import {
  buildMicroOrderDeleteBundle,
  isMicroServiceRequest,
  microOrderItemRequests,
  microOrderLabel,
} from "../fhir/microOrderHelpers";
import { buildMicroResultDeleteBundle } from "../fhir/microResultHelpers";
import {
  ORDER_TYPE_SYSTEM,
  buildPrescriptionDeleteBundle,
  splitPrescriptionDetailBundle,
} from "../fhir/prescriptionHelpers";
import {
  RAD_ORDER_TYPE,
  buildRadOrderDeleteBundle,
  isRadServiceRequest,
  radOrderItemRequests,
  radOrderResponseIds,
  radOrderTime,
} from "../fhir/radOrderHelpers";
import { buildRadPerformDeleteEntries } from "../fhir/radResultHelpers";
import {
  buildRadTaskUpdate,
  radTaskStatus,
  radTasksByOrderId,
  type RadTaskStatus,
} from "../fhir/radTaskHelpers";
import { buildPractitionerDeleteBundle } from "../fhir/practitionerHelpers";
import {
  baseRoleOf,
  isDoctorRoleCode,
  parsePractitionerRole,
  practitionerIdOfRole,
} from "../fhir/practitionerRoleHelpers";
import { deleteLoginAccount } from "./authClient";
import { buildQuestionnaire, collectPendingImageEntries } from "../fhir/questionnaireHelpers";
import { questionnaireCanonical } from "../fhir/questionnaireResponseHelpers";
import {
  buildQuestionnaireExport,
  buildTransferExport,
  downloadQuestionnaireExport,
  parseTransferImport,
} from "../fhir/questionnaireTransfer";
import {
  generatedObservationRefs,
  observationExtractEnabled,
  responseDeleteBundle,
  responseSaveBundle,
} from "../fhir/observationExtract";
import { resourceFromBundleResponse, resourceWithImagesBundle } from "../fhir/schemaImage";
import {
  createReportLayout,
  fetchReportLayout,
  fetchReportLayouts,
  updateReportLayout,
} from "./adminClient";
import {
  createResource,
  deleteResource,
  fetchBinaryImage,
  postBundle,
  readResource,
  searchResource,
  updateResource,
  type FhirResult,
} from "./fhirClient";

// シェーマ画像を伴う保存は、画像 Binary と本体を 1 つの transaction Bundle で
// atomic に書く(片方だけ保存されて孤児 Binary が残ることを防ぐ)。画像がない
// 保存は従来どおり単体リソースの POST / PUT。戻り値は両者で同じ形に揃える。
async function saveWithImages<T extends fhir4.Resource & { id?: string }>(
  resource: T,
  imageEntries: fhir4.BundleEntry[] | undefined,
  etag?: string,
): Promise<FhirResult<T>> {
  if (!imageEntries?.length) {
    return etag ? updateResource(resource, etag) : createResource(resource);
  }

  const { data: bundle } = await postBundle(resourceWithImagesBundle(resource, imageEntries, etag));
  const saved = resourceFromBundleResponse<T>(bundle);
  if (!saved.resource) throw new Error("保存結果を取得できませんでした。");
  return { data: saved.resource, etag: saved.etag };
}

export interface PatientSearchParams {
  name?: string;
  gender?: string;
  birthDateFrom?: string;
  birthDateTo?: string;
  identifier?: string;
}

const PATIENT_COUNT = 20;

function buildSearchParams(search: PatientSearchParams, offset: number): URLSearchParams {
  const params = new URLSearchParams();
  if (search.name) params.set("name", search.name);
  if (search.gender) params.set("gender", search.gender);
  if (search.identifier) params.set("identifier", search.identifier);
  if (search.birthDateFrom) params.append("birthdate", `ge${search.birthDateFrom}`);
  if (search.birthDateTo) params.append("birthdate", `le${search.birthDateTo}`);
  params.set("_count", String(PATIENT_COUNT));
  params.set("_offset", String(offset));
  return params;
}

function hasRelation<T extends fhir4.Resource>(
  bundle: fhir4.Bundle<T> | undefined,
  relation: string,
): boolean {
  return Boolean(bundle?.link?.some((l) => l.relation === relation));
}

export function usePatientSearch(search: PatientSearchParams, offset: number) {
  const query = useQuery({
    queryKey: ["Patient", "search", search, offset],
    queryFn: () => searchResource<fhir4.Patient>("Patient", buildSearchParams(search, offset)),
    placeholderData: keepPreviousData,
  });

  return {
    ...query,
    bundle: query.data?.data,
    total: query.data?.data.total ?? 0,
    count: PATIENT_COUNT,
    hasPrevious: hasRelation(query.data?.data, "previous"),
    hasNext: hasRelation(query.data?.data, "next"),
  };
}

export function usePatient(id: string | undefined) {
  return useQuery({
    queryKey: ["Patient", id],
    queryFn: () => readResource<fhir4.Patient>("Patient", id as string),
    enabled: Boolean(id),
  });
}

export function useCreatePatient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patient: fhir4.Patient) => createResource(patient),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Patient", "search"] });
    },
  });
}

export function useUpdatePatient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ patient, etag }: { patient: fhir4.Patient; etag: string }) =>
      updateResource(patient, etag),
    onSuccess: (result: FhirResult<fhir4.Patient>) => {
      queryClient.invalidateQueries({ queryKey: ["Patient", "search"] });
      queryClient.invalidateQueries({ queryKey: ["Patient", result.data.id] });
    },
  });
}

export function useDeletePatient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteResource("Patient", id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Patient", "search"] });
    },
  });
}

export interface OrganizationSearchParams {
  name?: string;
  identifier?: string;
}

const ORGANIZATION_COUNT = 20;

export function useOrganizationSearch(search: OrganizationSearchParams, offset: number) {
  const params = new URLSearchParams();
  if (search.name) params.set("name", search.name);
  if (search.identifier) params.set("identifier", search.identifier);
  // 診療科(partOf あり)は診療科一覧の担当なので、医療機関一覧からは除く。
  params.set("partof:missing", "true");
  params.set("_count", String(ORGANIZATION_COUNT));
  params.set("_offset", String(offset));

  const query = useQuery({
    queryKey: ["Organization", "search", search, offset],
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

// 選択肢用に医療機関をまとめて取得する(上流の _count 上限 100 まで。
// それ以上の施設数は運用上想定しない)。
export function useOrganizationOptions() {
  const params = new URLSearchParams();
  params.set("partof:missing", "true");
  params.set("_count", "100");
  params.set("_sort", "name");

  const query = useQuery({
    queryKey: ["Organization", "search", "options"],
    queryFn: () => searchResource<fhir4.Organization>("Organization", params),
  });

  return {
    ...query,
    organizations:
      query.data?.data.entry
        ?.map((e) => e.resource)
        .filter((r): r is fhir4.Organization => Boolean(r)) ?? [],
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
  else params.set("partof:missing", "false");
  // 全ページを読み切る間に順序がぶれないよう並び順を固定する。
  params.set("_sort", "name");
  return params;
}

// 条件に合う診療科を全件集める。上流の _count 上限は 100 なので、次ページが
// 尽きるまで _offset を進めて読み切る。
//
// 全件取ってから並べ替えるのは、上流が _sort=identifier を無視する(指定しても
// 既定順のまま返す)ため。診療科コード昇順はページ送りをまたいで一貫させたいので、
// 並べ替えとページングは呼び出し側で行う。1 施設あたり数百件を超えない前提。
async function fetchAllDepartments(search: DepartmentSearchParams): Promise<fhir4.Organization[]> {
  const PAGE = 100;
  const departments: fhir4.Organization[] = [];

  for (let offset = 0; ; offset += PAGE) {
    const params = departmentSearchParams(search);
    params.set("_count", String(PAGE));
    params.set("_offset", String(offset));
    const { data: bundle } = await searchResource<fhir4.Organization>("Organization", params);
    const page =
      bundle.entry?.map((e) => e.resource).filter((r): r is fhir4.Organization => Boolean(r)) ?? [];
    departments.push(...page);
    if (page.length < PAGE) return departments;
  }
}

// 一覧用。診療科コードの昇順(コード未設定は末尾)に並べた全件を返す。
export function useDepartmentList(search: DepartmentSearchParams) {
  const query = useQuery({
    queryKey: ["Organization", "search", "department", "list", search],
    queryFn: () => fetchAllDepartments(search),
    placeholderData: keepPreviousData,
  });

  return {
    ...query,
    departments: sortDepartmentsByCode(query.data ?? []),
    total: query.data?.length ?? 0,
    count: DEPARTMENT_COUNT,
  };
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

  const entries = query.data?.data.entry ?? [];

  return {
    ...query,
    practitioners: entries
      .map((e) => e.resource)
      .filter((r): r is fhir4.Practitioner => r?.resourceType === "Practitioner"),
    roles: entries
      .map((e) => e.resource)
      .filter((r): r is fhir4.PractitionerRole => r?.resourceType === "PractitionerRole"),
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
    query.data?.data.entry
      ?.map((e) => e.resource)
      .filter((r): r is fhir4.PractitionerRole => Boolean(r)) ?? [];

  return { ...query, roles, role: baseRoleOf(roles) };
}

const PRACTITIONER_ROLE_COUNT = 20;

export interface PractitionerRoleFilter {
  organizationId?: string;
  roleCode?: string;
  /** 氏名(漢字・カナ)の部分一致。チェーン検索で上流に渡す。 */
  name?: string;
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
  if (filter.roleCode) params.set("role", filter.roleCode);
  if (filter.name) params.set("practitioner.name:contains", filter.name);
  params.set("_count", String(PRACTITIONER_ROLE_COUNT));
  params.set("_offset", String(offset));
  params.set("_include", "PractitionerRole:practitioner");

  const query = useQuery({
    queryKey: ["PractitionerRole", "search", filter, offset],
    queryFn: () => searchResource<fhir4.Resource>("PractitionerRole", params),
    placeholderData: keepPreviousData,
    enabled,
  });

  const entries = query.data?.data.entry ?? [];
  const practitioners = entries
    .map((e) => e.resource)
    .filter((r): r is fhir4.Practitioner => r?.resourceType === "Practitioner");

  return {
    ...query,
    practitioners,
    roles: entries
      .map((e) => e.resource)
      .filter((r): r is fhir4.PractitionerRole => r?.resourceType === "PractitionerRole"),
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
    bundle.entry
      ?.map((e) => e.resource)
      .filter((r): r is fhir4.Practitioner => r?.resourceType === "Practitioner") ?? []
  );
}

// 医療機関に所属する医療従事者の職種(Practitioner.id → 職種コード)。職種は所属
// ロールだけが持ち、そのロールの organization は医療機関なので、施設で引けば
// 「誰が医師か」が一度に分かる。診療科ロールは organization が診療科なのでヒットしない。
async function fetchFacilityRoleCodes(facilityId: string): Promise<Record<string, string>> {
  const PAGE = 100;
  const codes: Record<string, string> = {};

  for (let offset = 0; ; offset += PAGE) {
    const params = new URLSearchParams();
    params.set("organization", `Organization/${facilityId}`);
    params.set("_count", String(PAGE));
    params.set("_offset", String(offset));
    const { data: bundle } = await searchResource<fhir4.PractitionerRole>(
      "PractitionerRole",
      params,
    );
    const page =
      bundle.entry?.map((e) => e.resource).filter((r): r is fhir4.PractitionerRole => Boolean(r)) ??
      [];
    for (const role of page) {
      const id = practitionerIdOfRole(role);
      const code = parsePractitionerRole(role).roleCode;
      if (id && code) codes[id] = code;
    }
    if (page.length < PAGE) return codes;
  }
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

  const roleCodes = useQuery({
    queryKey: ["PractitionerRole", "organization", "role-codes", facilityId],
    queryFn: () => fetchFacilityRoleCodes(facilityId as string),
    enabled: Boolean(departmentId && facilityId),
    staleTime: 5 * 60_000,
  });

  const practitioners = members.data ?? [];
  const doctors = facilityId
    ? practitioners.filter((p) => p.id && isDoctorRoleCode(roleCodes.data?.[p.id]))
    : practitioners;

  return {
    doctors,
    isPending: members.isPending || (Boolean(facilityId) && roleCodes.isPending),
    error: members.error ?? roleCodes.error,
  };
}

async function fetchPractitionerRoleIds(practitionerId: string): Promise<string[]> {
  const params = new URLSearchParams();
  params.set("practitioner", `Practitioner/${practitionerId}`);
  params.set("_elements", "id");
  const { data: bundle } = await searchResource<fhir4.PractitionerRole>("PractitionerRole", params);
  return (
    bundle.entry?.map((e) => e.resource?.id).filter((id): id is string => Boolean(id)) ?? []
  );
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
      const result = await postBundle(
        buildPractitionerDeleteBundle(id, await fetchPractitionerRoleIds(id)),
      );
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


export function usePrescriptionDetail(srId: string | undefined) {
  const params = new URLSearchParams();
  if (srId) params.set("_id", srId);
  params.set("_revinclude", "MedicationRequest:based-on");

  return useQuery({
    queryKey: ["ServiceRequest", "detail", srId],
    queryFn: () => searchResource<fhir4.Resource>("ServiceRequest", params),
    enabled: Boolean(srId),
  });
}

// 検体検査オーダー。明細も ServiceRequest なので、ヘッダと一緒に
// パネルの構成項目(2 段目)まで 1 リクエストで受け取る。
export function useLabOrderDetail(srId: string | undefined) {
  const params = new URLSearchParams();
  if (srId) params.set("_id", srId);
  params.set("_revinclude:iterate", "ServiceRequest:based-on");

  return useQuery({
    queryKey: ["ServiceRequest", "detail", "lab-order", srId],
    queryFn: () => searchResource<fhir4.ServiceRequest>("ServiceRequest", params),
    enabled: Boolean(srId),
  });
}

// 細菌検査オーダーもヘッダ・検体グループ・検査項目が別リソースなので、
// 検体検査と同じ形で 1 リクエストにまとめて取る。
export function useMicroOrderDetail(srId: string | undefined) {
  const params = new URLSearchParams();
  if (srId) params.set("_id", srId);
  params.set("_revinclude:iterate", "ServiceRequest:based-on");

  return useQuery({
    queryKey: ["ServiceRequest", "detail", "micro-order", srId],
    queryFn: () => searchResource<fhir4.ServiceRequest>("ServiceRequest", params),
    enabled: Boolean(srId),
  });
}

// 放射線オーダーもヘッダと明細が別リソースなので、検体検査と同じ形で 1 リクエストに
// まとめて取る(明細は _revinclude:iterate で添えてもらう)。
export function useRadOrderDetail(srId: string | undefined) {
  const params = new URLSearchParams();
  if (srId) params.set("_id", srId);
  params.set("_revinclude:iterate", "ServiceRequest:based-on");

  return useQuery({
    queryKey: ["ServiceRequest", "detail", "rad-order", srId],
    queryFn: () => searchResource<fhir4.ServiceRequest>("ServiceRequest", params),
    enabled: Boolean(srId),
  });
}

// ---- 放射線検査一覧(部門ワークリスト) ----
//
// 撮影日で 1 日ぶんの放射線検査オーダーを読み、モダリティ・入外区分・診療科・
// ステータスでの絞り込みは画面側で行う。上流の ServiceRequest が検索できるのは
// category と authoredon までで、モダリティは明細に、診療科は拡張に、進捗は別リソース
// (Task)にあるため。1 日ぶんなら数十件なので、全件読んでから絞る方が、ページごとに
// 絞り込み結果が変わる作りより扱いやすい。
//
// 撮影日は ServiceRequest.authoredOn で引く。オーダー画面の「撮影日」がそのまま
// authoredOn と occurrenceDateTime の両方に入るため(radOrderHelpers を参照)。
// 撮影日をオーダー日と別に持たせるなら、上流に occurrence の検索パラメータが要る。

const RAD_WORKLIST_PAGE = 100;
// 1 日の放射線検査がこの件数を超えることは想定していない。超えた場合は読むのをやめ、
// 画面に「一部のみ」と出す(黙って切り捨てると全件見えているように見えるため)。
const RAD_WORKLIST_MAX_PAGES = 5;

/** 放射線検査一覧の 1 行。オーダー(ヘッダ)1 件ぶん。 */
export interface RadWorklistRow {
  order: fhir4.ServiceRequest;
  /** 撮影項目(明細)。セットの構成項目まで含む平坦な一覧。 */
  itemRequests: fhir4.ServiceRequest[];
  patient?: fhir4.Patient;
  /** 進捗。部門がまだ触っていないオーダーには無い(= 依頼済)。 */
  task?: fhir4.Task;
}

export interface RadWorklistResult {
  rows: RadWorklistRow[];
  /** 上限まで読んでも読み切れなかった。 */
  truncated: boolean;
}

async function fetchRadWorklist(date: string): Promise<RadWorklistResult> {
  const orders: fhir4.ServiceRequest[] = [];
  const items: fhir4.ServiceRequest[] = [];
  const tasks: fhir4.Task[] = [];
  const patientsById = new Map<string, fhir4.Patient>();
  let truncated = false;

  for (let page = 0; page < RAD_WORKLIST_MAX_PAGES; page += 1) {
    const params = new URLSearchParams();
    params.set("category", `${ORDER_TYPE_SYSTEM}|${RAD_ORDER_TYPE.code}`);
    params.set("authoredon", date);
    // 明細はオーダーそのものではないので、ヒットさせるのはヘッダだけにする。
    params.set("based-on:missing", "true");
    params.set("_count", String(RAD_WORKLIST_PAGE));
    params.set("_offset", String(page * RAD_WORKLIST_PAGE));
    // 撮影項目・患者・進捗を 1 リクエストで揃える。
    params.set("_revinclude:iterate", "ServiceRequest:based-on");
    params.set("_revinclude", "Task:focus");
    params.set("_include", "ServiceRequest:subject");

    const { data: bundle } = await searchResource<fhir4.Resource>("ServiceRequest", params);

    let matched = 0;
    for (const entry of bundle.entry ?? []) {
      const resource = entry.resource;
      if (!resource) continue;
      if (resource.resourceType === "Patient") {
        if (resource.id) patientsById.set(resource.id, resource as fhir4.Patient);
      } else if (resource.resourceType === "Task") {
        tasks.push(resource as fhir4.Task);
      } else if (resource.resourceType === "ServiceRequest") {
        const request = resource as fhir4.ServiceRequest;
        // 検索にヒットしたヘッダと、添えられた明細を分ける。
        if (isRadServiceRequest(request) && !request.basedOn?.length) {
          orders.push(request);
          matched += 1;
        } else {
          items.push(request);
        }
      }
    }

    if (matched < RAD_WORKLIST_PAGE) break;
    if (page === RAD_WORKLIST_MAX_PAGES - 1) truncated = true;
  }

  const taskByOrderId = radTasksByOrderId(tasks);

  const rows = orders.map((order) => ({
    order,
    itemRequests: radOrderItemRequests(items, order.id ?? ""),
    patient: patientsById.get(order.subject?.reference?.split("/").pop() ?? ""),
    task: taskByOrderId.get(order.id ?? ""),
  }));

  // 撮影時刻の早い順。時刻を指定していないオーダー(撮影日だけ)は後ろにまとめる。
  rows.sort((a, b) => radWorklistSortKey(a).localeCompare(radWorklistSortKey(b)));

  return { rows, truncated };
}

function radWorklistSortKey(row: RadWorklistRow): string {
  const time = radOrderTime(row.order);
  return time || "99:99";
}

/** 撮影日 1 日ぶんの放射線検査オーダー。日付が未選択の間は読みに行かない。 */
export function useRadWorklist(date: string) {
  return useQuery({
    queryKey: RAD_WORKLIST_KEY(date),
    queryFn: () => fetchRadWorklist(date),
    enabled: Boolean(date),
    placeholderData: keepPreviousData,
  });
}

const RAD_WORKLIST_KEY = (date: string) => ["ServiceRequest", "rad-worklist", date];

/**
 * 実施の取消で片付ける実施記録。オーダーにぶら下がる Procedure と、その子の
 * 造影剤(MedicationAdministration)・被曝線量(Observation)を 1 リクエストで集める。
 *
 * 一覧が持っている行の情報からではなく、その場で引き直す。取消は稀な操作で、
 * 一覧を開いた後に別の端末で登録された実施記録も残さず消したいため。
 */
async function fetchRadPerformResources(orderId: string) {
  const params = new URLSearchParams();
  params.set("based-on", `ServiceRequest/${orderId}`);
  params.set("_count", "100");
  params.append("_revinclude", "MedicationAdministration:part-of");
  params.append("_revinclude", "Observation:part-of");

  const { data: bundle } = await searchResource<fhir4.Resource>("Procedure", params);

  const procedures: fhir4.Procedure[] = [];
  const administrations: fhir4.MedicationAdministration[] = [];
  const observations: fhir4.Observation[] = [];
  for (const entry of bundle.entry ?? []) {
    const resource = entry.resource;
    if (resource?.resourceType === "Procedure") procedures.push(resource as fhir4.Procedure);
    else if (resource?.resourceType === "MedicationAdministration") {
      administrations.push(resource as fhir4.MedicationAdministration);
    } else if (resource?.resourceType === "Observation") {
      observations.push(resource as fhir4.Observation);
    }
  }
  return { procedures, administrations, observations };
}

/**
 * 受付・実施などの進捗を書き込む。Task がまだ無いオーダーでは新しく作る。
 *
 * 単体の PUT ではなく transaction Bundle にするのは、更新に If-Match(ETag)が要る
 * ためで、一覧は検索結果から Task を持っているだけで ETag を持たないため。
 *
 * 実施済から戻す(取消)ときは、実施記録も同じ transaction で消す。進捗だけ戻して
 * 実施記録が残ると、取り消したはずの検査が実施済のまま会計・線量集計・カルテに
 * 現れる(docs/rad-result-design.md §7-6)。
 */
export function useUpdateRadTaskStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      order,
      task,
      status,
    }: {
      order: fhir4.ServiceRequest;
      task: fhir4.Task | undefined;
      status: RadTaskStatus;
    }) => {
      const resource = buildRadTaskUpdate(task, order, status);
      const taskEntry: fhir4.BundleEntry = {
        resource,
        request: resource.id
          ? { method: "PUT", url: `Task/${resource.id}` }
          : { method: "POST", url: "Task" },
      };

      const cancelsPerform = radTaskStatus(task) === "completed" && status !== "completed";
      const performed = cancelsPerform
        ? await fetchRadPerformResources(order.id ?? "")
        : { procedures: [], administrations: [], observations: [] };
      const performEntries = buildRadPerformDeleteEntries(
        performed.procedures,
        performed.administrations,
        performed.observations,
      );

      return postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: [...performEntries, taskEntry],
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "rad-worklist"] });
      // カルテのオーダーカードも進捗と実施情報を出しているので読み直させる。
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
    },
  });
}

/**
 * 放射線検査の実施登録。実施記録(Procedure 一式)と Task の完了を 1 つの
 * transaction で書き込む。Bundle の組み立ては radResultHelpers を参照。
 */
export function useRegisterRadPerform() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "rad-worklist"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
    },
  });
}

// ---- 検査結果に紐付けるオーダー(検体検査・細菌検査)の候補 ----

// 上流 fhir-server の _count 上限 100 を 1 ページとして順に辿る。
const LAB_ORDER_CANDIDATE_PAGE = 100;
// オーダーが極端に多い患者での暴走防止。
const LAB_ORDER_CANDIDATE_MAX_PAGES = 5;
// プルダウンに並べる未紐付けオーダーの上限。これだけ集まったら読むのをやめる。
const LAB_ORDER_CANDIDATE_LIMIT = 50;

/** 検査結果の登録画面で選ばせるオーダー 1 件。 */
export interface LabOrderCandidate {
  id: string;
  /** 「2026-08-09 末梢血液一般検査・CRP」のような選択肢の表示。 */
  label: string;
  /** すでに紐付いている検査結果の id。空なら結果がまだ登録されていない。 */
  reportId: string;
}

// 患者のオーダー(ヘッダ)を新しい順に集める。処方・注射など他種のヘッダも同じ
// 検索で返るのでクライアント側で振り分ける(上流の ServiceRequest には category
// 検索パラメータが無いため)。振り分けとラベルの組み立てだけがオーダー種別ごとに
// 異なるので、そこを差し替えられるようにしている。
//
// 明細は選択肢のラベルに使うので `_revinclude:iterate=ServiceRequest:based-on` で、
// 「結果が既に登録されているか」は `_revinclude=DiagnosticReport:based-on` で
// 同じ応答に添えてもらう。
async function fetchOrderCandidates(
  patientId: string,
  isTargetHeader: (sr: fhir4.ServiceRequest) => boolean,
  buildLabel: (header: fhir4.ServiceRequest, itemRequests: fhir4.ServiceRequest[]) => string,
): Promise<LabOrderCandidate[]> {
  const candidates: LabOrderCandidate[] = [];

  for (let page = 0; page < LAB_ORDER_CANDIDATE_MAX_PAGES; page += 1) {
    const params = new URLSearchParams();
    params.set("patient", `Patient/${patientId}`);
    // 明細(基づく先を持つ ServiceRequest)はオーダーそのものではないので除く。
    params.set("based-on:missing", "true");
    params.set("_count", String(LAB_ORDER_CANDIDATE_PAGE));
    params.set("_offset", String(page * LAB_ORDER_CANDIDATE_PAGE));
    params.set("_sort", "-authoredon");
    params.set("_revinclude:iterate", "ServiceRequest:based-on");
    params.set("_revinclude", "DiagnosticReport:based-on");

    const { data: bundle } = await searchResource<fhir4.Resource>("ServiceRequest", params);

    const serviceRequests = serviceRequestsOf(bundle);
    // オーダー id → そのオーダーを元にした検査結果の id。
    const reportIdByOrderId = new Map<string, string>();
    for (const entry of bundle.entry ?? []) {
      const report = entry.resource;
      if (report?.resourceType !== "DiagnosticReport") continue;
      for (const reference of (report as fhir4.DiagnosticReport).basedOn ?? []) {
        const orderId = reference.reference?.startsWith("ServiceRequest/")
          ? reference.reference.split("/")[1]
          : undefined;
        if (orderId && report.id) reportIdByOrderId.set(orderId, report.id);
      }
    }

    // ヘッダ(= 検索にヒットした分)だけを数える。明細と検査結果も混ざって返るため。
    const headers = serviceRequests.filter((sr) => !isOrderItemRequest(sr));
    for (const header of headers) {
      if (!header.id || !isTargetHeader(header)) continue;
      candidates.push({
        id: header.id,
        label: buildLabel(header, labOrderItemRequests(serviceRequests, header.id)),
        reportId: reportIdByOrderId.get(header.id) ?? "",
      });
    }

    if (headers.length < LAB_ORDER_CANDIDATE_PAGE) break;
    if (candidates.filter((c) => !c.reportId).length >= LAB_ORDER_CANDIDATE_LIMIT) break;
  }

  return candidates;
}

function fetchLabOrderCandidates(patientId: string): Promise<LabOrderCandidate[]> {
  return fetchOrderCandidates(patientId, isLabServiceRequest, (header, itemRequests) =>
    labOrderLabel(header, labOrderItems(header, itemRequests)),
  );
}

function fetchMicroOrderCandidates(patientId: string): Promise<LabOrderCandidate[]> {
  return fetchOrderCandidates(patientId, isMicroServiceRequest, microOrderLabel);
}

// 「すでに結果が登録されているオーダーは出さないが、編集中の結果自身が紐付けている
// オーダーは残す(外して保存し直すつもりがないのに選択が消えてしまわないように
// するため)」を検体検査・細菌検査で共通に行う。
function useOrderCandidatesQuery(
  queryKey: unknown[],
  fetch: (patientId: string) => Promise<LabOrderCandidate[]>,
  patientId: string | undefined,
  currentReportId?: string,
) {
  // 検査結果の登録・更新・削除でも紐付け状況が変わるので、それらの
  // invalidateQueries(["ServiceRequest", "search"]) で無効化されるキーにしている。
  const query = useQuery({
    queryKey,
    queryFn: () => fetch(patientId as string),
    enabled: Boolean(patientId),
    staleTime: 30_000,
  });

  return {
    candidates: (query.data ?? []).filter(
      (candidate) => !candidate.reportId || candidate.reportId === currentReportId,
    ),
    isLoading: query.isLoading,
    error: query.error,
  };
}

/** 検査結果に紐付ける検体検査オーダーの候補。 */
export function useLabOrderCandidates(
  patientId: string | undefined,
  currentReportId?: string,
) {
  return useOrderCandidatesQuery(
    ["ServiceRequest", "search", "lab-order-candidates", patientId],
    fetchLabOrderCandidates,
    patientId,
    currentReportId,
  );
}

/** 細菌検査結果に紐付ける細菌検査オーダーの候補。 */
export function useMicroOrderCandidates(
  patientId: string | undefined,
  currentReportId?: string,
) {
  return useOrderCandidatesQuery(
    ["ServiceRequest", "search", "micro-order-candidates", patientId],
    fetchMicroOrderCandidates,
    patientId,
    currentReportId,
  );
}

export function useCreatePrescription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
    },
  });
}

export function useUpdatePrescription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
    },
  });
}

async function fetchRelatedMedicationRequestIds(srId: string): Promise<string[]> {
  const params = new URLSearchParams();
  params.set("_id", srId);
  params.set("_revinclude", "MedicationRequest:based-on");
  const { data: bundle } = await searchResource<fhir4.Resource>("ServiceRequest", params);
  const { medicationRequests } = splitPrescriptionDetailBundle(bundle);
  return medicationRequests.map((mr) => mr.id).filter((id): id is string => Boolean(id));
}

const LAB_RESULT_COUNT = 20;

export function useLabResultSearch(patientId: string | undefined, offset: number) {
  const params = new URLSearchParams();
  if (patientId) params.set("patient", `Patient/${patientId}`);
  // DiagnosticReport は検査結果機能でのみ使用するが、将来の用途拡張に備えて
  // 検体検査カテゴリ(LAB)で絞り込んでおく。
  params.set("category", "LAB");
  params.set("_count", String(LAB_RESULT_COUNT));
  params.set("_offset", String(offset));
  // 検体採取日(effective)の降順。_sort のキーは検索パラメータ名 date。
  params.set("_sort", "-date");

  const query = useQuery({
    queryKey: ["DiagnosticReport", "search", patientId, offset],
    queryFn: () => searchResource<fhir4.DiagnosticReport>("DiagnosticReport", params),
    placeholderData: keepPreviousData,
    enabled: Boolean(patientId),
  });

  return {
    ...query,
    bundle: query.data?.data,
    total: query.data?.data.total ?? 0,
    count: LAB_RESULT_COUNT,
    hasPrevious: hasRelation(query.data?.data, "previous"),
    hasNext: hasRelation(query.data?.data, "next"),
  };
}

export function useLabResultDetail(reportId: string | undefined) {
  const params = new URLSearchParams();
  if (reportId) params.set("_id", reportId);
  params.append("_include", "DiagnosticReport:result");
  params.append("_include", "DiagnosticReport:specimen");

  return useQuery({
    queryKey: ["DiagnosticReport", "detail", reportId],
    queryFn: () => searchResource<fhir4.Resource>("DiagnosticReport", params),
    enabled: Boolean(reportId),
  });
}

// 上流 fhir-server の _count 上限が 100 のため、それを 1 ページとして順に辿る。
const LAB_RESULT_ORDER_PAGE = 100;
// 患者あたりの検査結果が極端に多い場合の暴走防止（最大 1000 件まで前後移動できる）。
const LAB_RESULT_ORDER_MAX_PAGES = 10;

// 一覧と同じ絞り込み・並び順で DiagnosticReport の id だけを取得する。
// 上流の _sort は同値時に id 昇順で安定するため、一覧の並びとページ境界をまたいでも一致する。
// category は検体検査(LAB)・細菌検査(MB)の別。
async function fetchLabResultOrder(patientId: string, category: string): Promise<string[]> {
  const ids: string[] = [];

  for (let page = 0; page < LAB_RESULT_ORDER_MAX_PAGES; page += 1) {
    const params = new URLSearchParams();
    params.set("patient", `Patient/${patientId}`);
    params.set("category", category);
    params.set("_count", String(LAB_RESULT_ORDER_PAGE));
    params.set("_offset", String(page * LAB_RESULT_ORDER_PAGE));
    params.set("_sort", "-date");
    // 前後移動には id の並びだけあればよいので本文は返させない。
    params.set("_elements", "id");

    const { data: bundle } = await searchResource<fhir4.DiagnosticReport>(
      "DiagnosticReport",
      params,
    );
    const pageIds =
      bundle.entry
        ?.map((entry) => entry.resource?.id)
        .filter((id): id is string => Boolean(id)) ?? [];
    ids.push(...pageIds);

    if (pageIds.length < LAB_RESULT_ORDER_PAGE) break;
  }

  return ids;
}

// 検査結果内容ページの「前へ/次へ」用。一覧に戻らず隣の検査結果へ移動するための id を返す。
function useResultNavigationQuery(
  category: string,
  patientId: string | undefined,
  reportId: string | undefined,
) {
  // 作成・更新・削除時の invalidateQueries(["DiagnosticReport", "search"]) で
  // まとめて無効化されるよう search 配下のキーにしている。
  const query = useQuery({
    queryKey: ["DiagnosticReport", "search", "order", category, patientId],
    queryFn: () => fetchLabResultOrder(patientId as string, category),
    enabled: Boolean(patientId),
    // 前後移動のたびにページが再マウントされるため、連打で毎回引き直さないよう
    // 少しだけ寝かせる。更新・削除時は invalidateQueries 側で無効化される。
    staleTime: 30_000,
  });

  const ids = query.data ?? [];
  const index = reportId ? ids.indexOf(reportId) : -1;

  return {
    previousId: index > 0 ? ids[index - 1] : undefined,
    nextId: index >= 0 && index < ids.length - 1 ? ids[index + 1] : undefined,
    position: index >= 0 ? index + 1 : undefined,
    total: ids.length,
    isLoading: query.isLoading,
  };
}

export function useLabResultNavigation(patientId: string | undefined, reportId: string | undefined) {
  return useResultNavigationQuery("LAB", patientId, reportId);
}

export function useMicroResultNavigation(
  patientId: string | undefined,
  reportId: string | undefined,
) {
  return useResultNavigationQuery("MB", patientId, reportId);
}

// ---- 時系列表示 ----

// 上流 fhir-server の _count 上限 100 を 1 ページとして順に辿る。
const LAB_TIMELINE_PAGE = 100;
// 患者あたりの検査結果が極端に多い場合の暴走防止。
const LAB_TIMELINE_MAX_PAGES = 10;

export interface LabTimelineResources {
  reports: fhir4.DiagnosticReport[];
  observations: fhir4.Observation[];
}

// 時系列表示は「直近 dateCount 回分の検体採取日」を横軸にするため、
// 採取日の降順で DiagnosticReport を Observation ごと(_include)取得する。
// dateCount+1 個目の採取日が現れたら、必要な日数分は揃っているので打ち切る
// (同じ採取日のレポートがページ境界をまたぐ場合があるため +1 まで読む)。
async function fetchLabTimelineResources(
  patientId: string,
  dateCount: number,
): Promise<LabTimelineResources> {
  const reports: fhir4.DiagnosticReport[] = [];
  const observations: fhir4.Observation[] = [];
  const dates = new Set<string>();

  for (let page = 0; page < LAB_TIMELINE_MAX_PAGES; page += 1) {
    const params = new URLSearchParams();
    params.set("patient", `Patient/${patientId}`);
    params.set("category", "LAB");
    params.set("_count", String(LAB_TIMELINE_PAGE));
    params.set("_offset", String(page * LAB_TIMELINE_PAGE));
    params.set("_sort", "-date");
    params.set("_include", "DiagnosticReport:result");

    const { data: bundle } = await searchResource<fhir4.Resource>("DiagnosticReport", params);

    // _include の Observation も entry に混ざって返るため、レポート数は
    // resourceType で数える。
    let pageReports = 0;
    for (const entry of bundle.entry ?? []) {
      const resource = entry.resource;
      if (resource?.resourceType === "DiagnosticReport") {
        pageReports += 1;
        const report = resource as fhir4.DiagnosticReport;
        reports.push(report);
        const date = report.effectiveDateTime?.slice(0, 10);
        if (date) dates.add(date);
      } else if (resource?.resourceType === "Observation") {
        observations.push(resource as fhir4.Observation);
      }
    }

    if (pageReports < LAB_TIMELINE_PAGE) break;
    if (dates.size > dateCount) break;
  }

  return { reports, observations };
}

export function useLabResultTimeline(patientId: string | undefined, dateCount: number) {
  // 作成・更新・削除時の invalidateQueries(["DiagnosticReport", "search"]) で
  // まとめて無効化されるよう search 配下のキーにしている。
  return useQuery({
    queryKey: ["DiagnosticReport", "search", "timeline", patientId, dateCount],
    queryFn: () => fetchLabTimelineResources(patientId as string, dateCount),
    enabled: Boolean(patientId) && dateCount > 0,
    // 表示数変更のたびに画面が空にならないよう前回結果を残す。
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

// 検査結果を保存・削除するとオーダーの紐付け状況が変わるため、
// 検体検査オーダーの候補(["ServiceRequest", "search"] 配下)も無効化する。
export function useCreateLabResult() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
    },
  });
}

export function useUpdateLabResult() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "search"] });
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "detail"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
    },
  });
}

export function useDeleteLabResult() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (reportId: string) => {
      // 削除対象の Observation / Specimen は DiagnosticReport の参照から辿る。
      const { data: report } = await readResource<fhir4.DiagnosticReport>(
        "DiagnosticReport",
        reportId,
      );
      return postBundle(
        buildLabResultDeleteBundle(
          reportId,
          observationIdsFromReport(report),
          specimenIdsFromReport(report),
        ),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
    },
  });
}

// ---- 細菌検査結果 ----

const MICRO_RESULT_COUNT = 20;

export interface MicroResultSearchResources {
  bundle: fhir4.Bundle;
  reports: fhir4.DiagnosticReport[];
  observations: fhir4.Observation[];
}

// 一覧に培養結果・分離菌名も出すため、Observation を _include で添えてもらう。
async function fetchMicroResultPage(
  patientId: string,
  offset: number,
): Promise<MicroResultSearchResources> {
  const params = new URLSearchParams();
  params.set("patient", `Patient/${patientId}`);
  params.set("category", "MB");
  params.set("_count", String(MICRO_RESULT_COUNT));
  params.set("_offset", String(offset));
  // 検体採取日(effective)の降順。_sort のキーは検索パラメータ名 date。
  params.set("_sort", "-date");
  params.set("_include", "DiagnosticReport:result");

  const { data: bundle } = await searchResource<fhir4.Resource>("DiagnosticReport", params);
  const reports: fhir4.DiagnosticReport[] = [];
  const observations: fhir4.Observation[] = [];
  for (const entry of bundle.entry ?? []) {
    const resource = entry.resource;
    // _include の Observation も entry に混ざって返るため resourceType で振り分ける。
    if (resource?.resourceType === "DiagnosticReport") {
      reports.push(resource as fhir4.DiagnosticReport);
    } else if (resource?.resourceType === "Observation") {
      observations.push(resource as fhir4.Observation);
    }
  }
  return { bundle, reports, observations };
}

export function useMicroResultSearch(patientId: string | undefined, offset: number) {
  const query = useQuery({
    queryKey: ["DiagnosticReport", "search", "micro", patientId, offset],
    queryFn: () => fetchMicroResultPage(patientId as string, offset),
    placeholderData: keepPreviousData,
    enabled: Boolean(patientId),
  });

  return {
    ...query,
    resources: query.data,
    total: query.data?.bundle.total ?? 0,
    count: MICRO_RESULT_COUNT,
    hasPrevious: hasRelation(query.data?.bundle, "previous"),
    hasNext: hasRelation(query.data?.bundle, "next"),
  };
}

// 内容表示・編集の取得は検体検査結果と同じ形(_id + result / specimen の _include)。
export function useMicroResultDetail(reportId: string | undefined) {
  return useLabResultDetail(reportId);
}

// 細菌検査結果を保存・削除するとオーダーの紐付け状況が変わるため、
// 細菌検査オーダーの候補(["ServiceRequest", "search"] 配下)も無効化する。
export function useCreateMicroResult() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
    },
  });
}

export function useUpdateMicroResult() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "search"] });
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "detail"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
    },
  });
}

export function useDeleteMicroResult() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (reportId: string) => {
      // 削除対象の Observation / Specimen は DiagnosticReport の参照から辿る。
      const { data: report } = await readResource<fhir4.DiagnosticReport>(
        "DiagnosticReport",
        reportId,
      );
      return postBundle(
        buildMicroResultDeleteBundle(
          reportId,
          observationIdsFromReport(report),
          specimenIdsFromReport(report),
        ),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
    },
  });
}

const CONDITION_COUNT = 20;

export function useConditionSearch(patientId: string | undefined, offset: number) {
  const params = new URLSearchParams();
  if (patientId) params.set("patient", `Patient/${patientId}`);
  params.set("_count", String(CONDITION_COUNT));
  params.set("_offset", String(offset));
  // 開始日の降順(新しい順)。_sort のキーは検索パラメータ名 onset-date。
  params.set("_sort", "-onset-date");

  const query = useQuery({
    queryKey: ["Condition", "search", patientId, offset],
    queryFn: () => searchResource<fhir4.Condition>("Condition", params),
    placeholderData: keepPreviousData,
    enabled: Boolean(patientId),
  });

  return {
    ...query,
    bundle: query.data?.data,
    total: query.data?.data.total ?? 0,
    count: CONDITION_COUNT,
    hasPrevious: hasRelation(query.data?.data, "previous"),
    hasNext: hasRelation(query.data?.data, "next"),
  };
}

export function useCondition(id: string | undefined) {
  return useQuery({
    queryKey: ["Condition", id],
    queryFn: () => readResource<fhir4.Condition>("Condition", id as string),
    enabled: Boolean(id),
  });
}

export function useCreateCondition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (condition: fhir4.Condition) => createResource(condition),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Condition", "search"] });
    },
  });
}

export function useUpdateCondition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ condition, etag }: { condition: fhir4.Condition; etag: string }) =>
      updateResource(condition, etag),
    onSuccess: (result: FhirResult<fhir4.Condition>) => {
      queryClient.invalidateQueries({ queryKey: ["Condition", "search"] });
      queryClient.invalidateQueries({ queryKey: ["Condition", result.data.id] });
    },
  });
}

export function useDeleteCondition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteResource("Condition", id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Condition", "search"] });
    },
  });
}

// プロブレムリストの上限。1 患者の病名は高々数十件の想定なので 1 回の検索で足りる。
const KARTE_CONDITION_COUNT = 100;

// カルテ画面のプロブレムリスト用。プロブレムと保険病名の振り分けは
// splitConditions() でクライアント側が行うため、ここでは患者の病名を全件取得する
// (上流 fhir-server は未知の検索パラメータを黙って無視して全件返すことがあり、
//  category での絞り込みをサーバーに任せられない)。
// クエリキーを ["Condition", "search", ...] 配下に置くことで、病名の登録・更新・
// 削除の invalidate がそのまま効き、プロブレムリストも自動で再取得される。
export function useKarteConditions(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("patient", `Patient/${patientId}`);
  params.set("_count", String(KARTE_CONDITION_COUNT));
  params.set("_sort", "-onset-date");

  const query = useQuery({
    queryKey: ["Condition", "search", "karte", patientId],
    queryFn: () => searchResource<fhir4.Condition>("Condition", params),
    enabled: Boolean(patientId),
  });

  const conditions =
    query.data?.data.entry
      ?.map((e) => e.resource)
      .filter((r): r is fhir4.Condition => r?.resourceType === "Condition") ?? [];

  return { ...query, conditions };
}


export function useClinicalNote(id: string | undefined) {
  return useQuery({
    queryKey: ["Composition", id],
    queryFn: () => readResource<fhir4.Composition>("Composition", id as string),
    enabled: Boolean(id),
  });
}

// entries はテンプレート記載の QuestionnaireResponse(とそのシェーマ画像 Binary)。
// 診療記録本体と同じ transaction Bundle で保存する — 先行 POST すると本体を
// 保存しなかったときに QR だけが孤児として残るため(saveWithImages と同じ設計)。
export function useCreateClinicalNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      composition,
      entries,
    }: {
      composition: fhir4.Composition;
      entries: fhir4.BundleEntry[];
    }) => saveWithImages(composition, entries),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Composition", "search"] });
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse", "search"] });
    },
  });
}

export function useUpdateClinicalNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      composition,
      entries,
      etag,
    }: {
      composition: fhir4.Composition;
      entries: fhir4.BundleEntry[];
      etag: string;
    }) => saveWithImages(composition, entries, etag),
    onSuccess: (result: FhirResult<fhir4.Composition>) => {
      queryClient.invalidateQueries({ queryKey: ["Composition", "search"] });
      queryClient.invalidateQueries({ queryKey: ["Composition", result.data.id] });
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse"] });
    },
  });
}

// 削除はテンプレート回答(QuestionnaireResponse)も道連れにする。参照は一覧の検索
// 結果ではなく単体 read から取る — 一覧は _summary=true を付けており、上流が
// これを解釈すると section(参照拡張)が落ちて QR を取りこぼすため。
export function useDeleteClinicalNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data: composition } = await readResource<fhir4.Composition>("Composition", id);
      const bundle = buildClinicalNoteDeleteBundle(composition);
      if (bundle) {
        await postBundle(bundle);
      } else {
        await deleteResource("Composition", id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Composition", "search"] });
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse"] });
    },
  });
}

const ALLERGY_COUNT = 20;

export function useAllergySearch(patientId: string | undefined, offset: number) {
  const params = new URLSearchParams();
  if (patientId) params.set("patient", `Patient/${patientId}`);
  params.set("_count", String(ALLERGY_COUNT));
  params.set("_offset", String(offset));
  // 記録日の降順(新しい順)。AllergyIntolerance に発症日の検索パラメータは無いため
  // date(= recordedDate)でソートする。
  params.set("_sort", "-date");

  const query = useQuery({
    queryKey: ["AllergyIntolerance", "search", patientId, offset],
    queryFn: () => searchResource<fhir4.AllergyIntolerance>("AllergyIntolerance", params),
    placeholderData: keepPreviousData,
    enabled: Boolean(patientId),
  });

  return {
    ...query,
    bundle: query.data?.data,
    total: query.data?.data.total ?? 0,
    count: ALLERGY_COUNT,
    hasPrevious: hasRelation(query.data?.data, "previous"),
    hasNext: hasRelation(query.data?.data, "next"),
  };
}

export function useAllergy(id: string | undefined) {
  return useQuery({
    queryKey: ["AllergyIntolerance", id],
    queryFn: () => readResource<fhir4.AllergyIntolerance>("AllergyIntolerance", id as string),
    enabled: Boolean(id),
  });
}

export function useCreateAllergy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (allergy: fhir4.AllergyIntolerance) => createResource(allergy),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["AllergyIntolerance", "search"] });
    },
  });
}

export function useUpdateAllergy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ allergy, etag }: { allergy: fhir4.AllergyIntolerance; etag: string }) =>
      updateResource(allergy, etag),
    onSuccess: (result: FhirResult<fhir4.AllergyIntolerance>) => {
      queryClient.invalidateQueries({ queryKey: ["AllergyIntolerance", "search"] });
      queryClient.invalidateQueries({ queryKey: ["AllergyIntolerance", result.data.id] });
    },
  });
}

export function useDeleteAllergy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteResource("AllergyIntolerance", id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["AllergyIntolerance", "search"] });
    },
  });
}

const QUESTIONNAIRE_COUNT = 20;

// canonical (url, version) の一意性は上流の Questionnaire バリデーション + DB 制約が
// 保証する(重複時は 422 / issue code: duplicate。和訳は fhir/outcome.ts)。
export function useQuestionnaireSearch(offset: number) {
  const params = new URLSearchParams();
  params.set("_count", String(QUESTIONNAIRE_COUNT));
  params.set("_offset", String(offset));
  // 更新日時の降順(新しい順)。
  params.set("_sort", "-_lastUpdated");

  const query = useQuery({
    queryKey: ["Questionnaire", "search", offset],
    queryFn: () => searchResource<fhir4.Questionnaire>("Questionnaire", params),
    placeholderData: keepPreviousData,
  });

  return {
    ...query,
    bundle: query.data?.data,
    total: query.data?.data.total ?? 0,
    count: QUESTIONNAIRE_COUNT,
    hasPrevious: hasRelation(query.data?.data, "previous"),
    hasNext: hasRelation(query.data?.data, "next"),
  };
}

export function useQuestionnaire(id: string | undefined) {
  return useQuery({
    queryKey: ["Questionnaire", id],
    queryFn: () => readResource<fhir4.Questionnaire>("Questionnaire", id as string),
    enabled: Boolean(id),
  });
}

export function useCreateQuestionnaire() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      questionnaire,
      imageEntries,
    }: {
      questionnaire: fhir4.Questionnaire;
      imageEntries?: fhir4.BundleEntry[];
    }) => {
      return saveWithImages(questionnaire, imageEntries);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Questionnaire", "search"] });
    },
  });
}

export function useUpdateQuestionnaire() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      questionnaire,
      etag,
      imageEntries,
    }: {
      questionnaire: fhir4.Questionnaire;
      etag: string;
      imageEntries?: fhir4.BundleEntry[];
    }) => {
      return saveWithImages(questionnaire, imageEntries, etag);
    },
    onSuccess: (result: FhirResult<fhir4.Questionnaire>) => {
      queryClient.invalidateQueries({ queryKey: ["Questionnaire", "search"] });
      queryClient.invalidateQueries({ queryKey: ["Questionnaire", result.data.id] });
    },
  });
}

// テンプレートをシェーマ画像埋め込みの単一 JSON ファイルとしてダウンロードする。
// 帳票レイアウト(report_layouts)が登録済みなら .tlf とマッピング定義も同梱する。
// レイアウトの取得に失敗したらエクスポート自体を失敗にする(同梱されるはずの
// レイアウトが黙って欠けたファイルを作らない)。
export function useExportQuestionnaire() {
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await readResource<fhir4.Questionnaire>("Questionnaire", id);
      const exported = await buildQuestionnaireExport(data);

      const canonical = questionnaireCanonical(data);
      const [summary] = await fetchReportLayouts(canonical);
      const layout = summary ? await fetchReportLayout(summary.id) : undefined;
      downloadQuestionnaireExport(
        buildTransferExport(
          exported,
          layout && { name: layout.name, tlf: layout.tlf, mapping: layout.mapping },
        ),
      );
    },
  });
}

export interface ImportQuestionnaireResult {
  result: FhirResult<fhir4.Questionnaire>;
  /** 同梱レイアウトの登録結果(同梱なし・スキップ・失敗は "none")。 */
  layoutStatus: "created" | "updated" | "none";
  /** レイアウト登録の失敗理由(テンプレート本体は保存済み)。 */
  layoutError?: string;
  /** 同梱レイアウトが不正でスキップしたときの警告。 */
  layoutWarning?: string;
}

// エクスポートファイルを取り込んで新しいテンプレートとして保存する。
// 保存は新規作成と同じ経路(画像込み transaction Bundle。canonical 重複は上流が 422 で弾く)。
// 帳票レイアウトが同梱されていれば report_layouts へも登録する。
export function useImportQuestionnaire() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File): Promise<ImportQuestionnaireResult> => {
      const { values, reportLayout, layoutWarning } = parseTransferImport(await file.text());
      const { items, entries } = collectPendingImageEntries(values.items);
      const questionnaire = buildQuestionnaire({ ...values, items });
      const result = await saveWithImages(questionnaire, entries);
      if (!reportLayout) return { result, layoutStatus: "none", layoutWarning };

      // テンプレート本体(上流)が主、レイアウト(backend DB)は従。レイアウト側の
      // 失敗でインポート全体を失敗にせず、手動登録のフォールバックを案内する。
      // canonical の一意性は上流の保存(422/duplicate)が保証するので、保存が通った
      // 時点で同じ canonical のレイアウトは「上流にテンプレートが無い孤児レコード」
      // に限られる → 上書きする。
      try {
        const canonical = questionnaireCanonical(result.data);
        const [existing] = await fetchReportLayouts(canonical);
        const payload = {
          name: reportLayout.name,
          questionnaire_url: result.data.url ?? "",
          questionnaire_version: result.data.version ?? "",
          tlf: reportLayout.tlf,
          mapping: reportLayout.mapping,
        };
        if (existing) {
          await updateReportLayout(existing.id, payload);
          return { result, layoutStatus: "updated" };
        }
        await createReportLayout(payload);
        return { result, layoutStatus: "created" };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { result, layoutStatus: "none", layoutError: message };
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Questionnaire", "search"] });
    },
  });
}

export function useDeleteQuestionnaire() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteResource("Questionnaire", id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Questionnaire", "search"] });
    },
  });
}

// テンプレート選択用に Questionnaire をまとめて取得する。
// 上流 fhir-server の _count 上限 100 を上限とした簡易版(それ以上は運用上想定しない)。
export function useQuestionnaireOptions(options?: { status?: fhir4.Questionnaire["status"] }) {
  const params = new URLSearchParams();
  if (options?.status) params.set("status", options.status);
  params.set("_count", "100");
  params.set("_sort", "-_lastUpdated");

  const query = useQuery({
    queryKey: ["Questionnaire", "search", "options", options?.status ?? ""],
    queryFn: () => searchResource<fhir4.Questionnaire>("Questionnaire", params),
  });

  return {
    ...query,
    questionnaires:
      query.data?.data.entry
        ?.map((e) => e.resource)
        .filter((r): r is fhir4.Questionnaire => Boolean(r)) ?? [],
  };
}

// シェーマ画像(Binary)を dataURL で取得する。本アプリでは Binary は不変
// (差し替えは常に新規作成)なのでキャッシュを無期限に保持する。
export function useBinaryImage(binaryId: string | undefined) {
  return useQuery({
    queryKey: ["Binary", binaryId, "image"],
    queryFn: () => fetchBinaryImage(binaryId as string),
    enabled: Boolean(binaryId),
    staleTime: Infinity,
  });
}

// QuestionnaireResponse.questionnaire(canonical "<url>|<version>")から
// 元テンプレートを引き当てる。url は上流で完全一致検索される。
export function useQuestionnaireByCanonical(canonical: string | undefined) {
  const query = useQuery({
    queryKey: ["Questionnaire", "canonical", canonical],
    queryFn: async () => {
      const [url, version] = (canonical as string).split("|");
      const params = new URLSearchParams();
      params.set("url", url);
      if (version) params.set("version", version);
      const { data: bundle } = await searchResource<fhir4.Questionnaire>("Questionnaire", params);
      return bundle.entry?.map((e) => e.resource).find((r) => r) ?? null;
    },
    enabled: Boolean(canonical),
  });

  return { ...query, questionnaire: query.data ?? undefined };
}


export function useQuestionnaireResponse(id: string | undefined) {
  return useQuery({
    queryKey: ["QuestionnaireResponse", id],
    queryFn: () => readResource<fhir4.QuestionnaireResponse>("QuestionnaireResponse", id as string),
    enabled: Boolean(id),
  });
}

// テンプレート表示用に QuestionnaireResponse と元テンプレートを 1 リクエストで取得する
// (canonical を解決する _include=QuestionnaireResponse:questionnaire)。
// 削除済みは read の 410 と違い空の Bundle になる(response が undefined のまま)。
// 編集画面は If-Match 用の ETag が要るため read(useQuestionnaireResponse)を使い続ける。
export function useQuestionnaireResponseWithQuestionnaire(id: string | undefined) {
  const query = useQuery({
    queryKey: ["QuestionnaireResponse", id, "withQuestionnaire"],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("_id", id as string);
      params.set("_include", "QuestionnaireResponse:questionnaire");
      const { data: bundle } = await searchResource<fhir4.Resource>("QuestionnaireResponse", params);
      const resources = bundle.entry?.map((e) => e.resource) ?? [];
      return {
        response:
          resources.find(
            (r): r is fhir4.QuestionnaireResponse => r?.resourceType === "QuestionnaireResponse",
          ) ?? null,
        questionnaire:
          resources.find((r): r is fhir4.Questionnaire => r?.resourceType === "Questionnaire") ??
          null,
      };
    },
    enabled: Boolean(id),
  });

  return {
    ...query,
    response: query.data?.response ?? undefined,
    questionnaire: query.data?.questionnaire ?? undefined,
  };
}

// 検索結果(新しい順)から最新の「処方」の ServiceRequest とその明細だけを残した Bundle
// を作る。注射オーダーの ServiceRequest と、他のオーダーに属する MedicationRequest を
// 取り除く(splitPrescriptionDetailBundle は basedOn を見ずに全 MR を集めるため)。
function latestPrescriptionBundle(bundle: fhir4.Bundle): fhir4.Bundle {
  const entries = bundle.entry ?? [];
  const sr = entries
    .map((e) => e.resource)
    .find(
      (r): r is fhir4.ServiceRequest =>
        r?.resourceType === "ServiceRequest" && !isInjectionServiceRequest(r as fhir4.ServiceRequest),
    );
  if (!sr) return { ...bundle, entry: [] };

  const kept = entries.filter((entry) => {
    const resource = entry.resource;
    if (resource?.resourceType === "ServiceRequest") return resource.id === sr.id;
    if (resource?.resourceType === "MedicationRequest") {
      return (resource as fhir4.MedicationRequest).basedOn?.some(
        (basedOn) => basedOn.reference === `ServiceRequest/${sr.id}`,
      );
    }
    return false;
  });
  return { ...bundle, entry: kept };
}

// テンプレート回答フォームの初期値式(%conditions / %labResults / %prescriptions)の
// 元データ取得。傷病名はアクティブなもの全件(上流の _count 上限 100 まで)、
// 検査結果・処方は最新 1 件を _sort + _count + _include/_revinclude の 1 リクエスト
// で関連リソースごと取る(この組み合わせは上流の回帰 spec で保証済み)。
export function usePopulateSources(patientId: string | undefined) {
  const conditionParams = new URLSearchParams();
  if (patientId) conditionParams.set("patient", `Patient/${patientId}`);
  // 初期値式が対象にするのはアクティブな傷病名のみ(populateContext 参照)。
  conditionParams.set("clinical-status", "active");
  conditionParams.set("_count", "100");
  conditionParams.set("_sort", "-onset-date");
  const conditions = useQuery({
    queryKey: ["Condition", "populate", patientId],
    queryFn: () => searchResource<fhir4.Condition>("Condition", conditionParams),
    enabled: Boolean(patientId),
  });

  const labParams = new URLSearchParams();
  if (patientId) labParams.set("patient", `Patient/${patientId}`);
  labParams.set("category", "LAB");
  labParams.set("_count", "1");
  labParams.set("_sort", "-date");
  labParams.append("_include", "DiagnosticReport:result");
  labParams.append("_include", "DiagnosticReport:specimen");
  const labDetail = useQuery({
    queryKey: ["DiagnosticReport", "populate", patientId],
    queryFn: () => searchResource<fhir4.Resource>("DiagnosticReport", labParams),
    enabled: Boolean(patientId),
  });

  const rxParams = new URLSearchParams();
  if (patientId) rxParams.set("patient", `Patient/${patientId}`);
  // 注射オーダーも同じ ServiceRequest として保存されるため、_count=1 だと最新が注射の
  // 患者で %prescriptions が注射になってしまう。少し多めに取り、最新の処方だけを残す。
  rxParams.set("_count", "5");
  rxParams.set("_sort", "-authoredon");
  // 検体検査の明細(ServiceRequest)は処方ではないので最初から除く。
  rxParams.set("based-on:missing", "true");
  rxParams.set("_revinclude", "MedicationRequest:based-on");
  const rxDetail = useQuery({
    queryKey: ["ServiceRequest", "populate", patientId],
    queryFn: async () => {
      const result = await searchResource<fhir4.Resource>("ServiceRequest", rxParams);
      return { ...result, data: latestPrescriptionBundle(result.data) };
    },
    enabled: Boolean(patientId),
  });

  const queries = [conditions, labDetail, rxDetail];

  return {
    isLoading: queries.some((q) => q.isPending),
    error: queries.find((q) => q.error)?.error ?? null,
    conditions: (conditions.data?.data.entry ?? [])
      .map((e) => e.resource)
      .filter((r): r is fhir4.Condition => r?.resourceType === "Condition"),
    labDetail: labDetail.data?.data,
    prescriptionDetail: rxDetail.data?.data,
  };
}

// 回答から Observation を生成するテンプレートは、回答・画像・Observation を 1 つの
// transaction で書く。生成しないテンプレートは従来どおりの保存経路のまま
// (無駄に Bundle にしない)。
async function saveResponse(
  questionnaire: fhir4.Questionnaire,
  response: fhir4.QuestionnaireResponse,
  imageEntries?: fhir4.BundleEntry[],
  etag?: string,
  existing?: fhir4.QuestionnaireResponse,
): Promise<FhirResult<fhir4.QuestionnaireResponse>> {
  const extracts = observationExtractEnabled(questionnaire);
  if (!extracts && !generatedObservationRefs(existing).length) {
    return saveWithImages(response, imageEntries, etag);
  }

  const { data: bundle } = await postBundle(
    responseSaveBundle({ questionnaire, response, imageEntries, etag, existing }),
  );
  const saved = resourceFromBundleResponse<fhir4.QuestionnaireResponse>(bundle);
  if (!saved.resource) throw new Error("保存結果を取得できませんでした。");
  return { data: saved.resource, etag: saved.etag };
}

export function useCreateQuestionnaireResponse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      questionnaire,
      response,
      imageEntries,
    }: {
      questionnaire: fhir4.Questionnaire;
      response: fhir4.QuestionnaireResponse;
      imageEntries?: fhir4.BundleEntry[];
    }) => saveResponse(questionnaire, response, imageEntries),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse", "search"] });
      queryClient.invalidateQueries({ queryKey: ["Observation", "search"] });
    },
  });
}

export function useUpdateQuestionnaireResponse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      questionnaire,
      response,
      etag,
      imageEntries,
      existing,
    }: {
      questionnaire: fhir4.Questionnaire;
      response: fhir4.QuestionnaireResponse;
      etag: string;
      imageEntries?: fhir4.BundleEntry[];
      existing?: fhir4.QuestionnaireResponse;
    }) => saveResponse(questionnaire, response, imageEntries, etag, existing),
    onSuccess: (result: FhirResult<fhir4.QuestionnaireResponse>) => {
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse", "search"] });
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse", result.data.id] });
      queryClient.invalidateQueries({ queryKey: ["Observation", "search"] });
    },
  });
}

export function useDeleteQuestionnaireResponse() {
  const queryClient = useQueryClient();
  return useMutation({
    // 生成した Observation も一緒に消す(回答が消えると derivedFrom の指す先が
    // 無くなり、由来を辿れない Observation だけが残るため)。
    mutationFn: async (response: fhir4.QuestionnaireResponse) => {
      if (!generatedObservationRefs(response).length) {
        return deleteResource("QuestionnaireResponse", response.id ?? "");
      }
      await postBundle(responseDeleteBundle(response));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse", "search"] });
      queryClient.invalidateQueries({ queryKey: ["Observation", "search"] });
    },
  });
}

// ---- カルテ画面のタイムライン ----
//
// 診療記録・処方・テンプレート回答を 1 本の時系列にまとめて無限スクロールする。
// 3 つは別リソースなので個別に無限クエリを持ち、表示側(buildKarteTimeline)が
// 「どこまで表示してよいか」を判断する。
//
// キーはいずれも既存の作成・更新・削除が無効化する ["<型>", "search"] 配下に置く
// (登録後にタイムラインが自動で再取得される)。
const KARTE_PAGE = 20;

// _include / _revinclude の関連リソースも entry に混ざるため、次ページのオフセットは
// entry 数ではなく _count 固定で進める。
function karteNextOffset(bundle: fhir4.Bundle | undefined, lastOffset: number): number | undefined {
  return hasRelation(bundle, "next") ? lastOffset + KARTE_PAGE : undefined;
}

export function useKarteClinicalNotesInfinite(patientId: string | undefined) {
  return useInfiniteQuery({
    queryKey: ["Composition", "search", "karte", patientId],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      params.set("subject", `Patient/${patientId}`);
      params.set("type", "http://loinc.org|11506-3");
      params.set("_count", String(KARTE_PAGE));
      params.set("_offset", String(pageParam));
      params.set("_sort", "-date");
      // _summary は付けない。カルテは本文を
      // 表示し、テンプレート回答の重複判定にも section の参照拡張が要るため。
      return searchResource<fhir4.Composition>("Composition", params);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, _pages, lastOffset) => karteNextOffset(lastPage.data, lastOffset),
    enabled: Boolean(patientId),
  });
}

export function useKartePrescriptionsInfinite(patientId: string | undefined) {
  return useInfiniteQuery({
    queryKey: ["ServiceRequest", "search", "karte", patientId],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      params.set("_count", String(KARTE_PAGE));
      params.set("_offset", String(pageParam));
      params.set("_sort", "-authoredon");
      // 検体検査・放射線検査は明細も ServiceRequest なので、オーダーのヘッダだけを
      // 1 ページの対象にする(明細がカードとして紛れ込まず、ページ数も項目数に
      // 左右されない)。
      params.set("based-on:missing", "true");
      // カルテは薬剤名・検査項目名まで表示するので、処方明細と検体検査・放射線検査の
      // 明細(構成項目まで 2 段)も同じレスポンスで受け取る。
      params.append("_revinclude", "MedicationRequest:based-on");
      // 検体検査のカードから「検査結果表示」を出せるかの判定に、そのオーダーを
      // 元にした検査結果も添えてもらう。
      params.append("_revinclude", "DiagnosticReport:based-on");
      // 放射線検査カードの進捗(依頼済・受付済・実施済・中止)と実施記録。
      params.append("_revinclude", "Task:focus");
      params.append("_revinclude", "Procedure:based-on");
      params.append("_revinclude:iterate", "ServiceRequest:based-on");
      // 実施記録にぶら下がる造影剤・被曝線量。Procedure は上の _revinclude で
      // 入ってくるので、その子を :iterate で 1 段先まで展開してもらう。
      params.append("_revinclude:iterate", "MedicationAdministration:part-of");
      params.append("_revinclude:iterate", "Observation:part-of");
      return searchResource<fhir4.Resource>("ServiceRequest", params);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, _pages, lastOffset) => karteNextOffset(lastPage.data, lastOffset),
    enabled: Boolean(patientId),
  });
}

export function useKarteQuestionnaireResponsesInfinite(patientId: string | undefined) {
  return useInfiniteQuery({
    queryKey: ["QuestionnaireResponse", "search", "karte", patientId],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      params.set("_count", String(KARTE_PAGE));
      params.set("_offset", String(pageParam));
      params.set("_sort", "-authored");
      params.set("_include", "QuestionnaireResponse:questionnaire");
      return searchResource<fhir4.Resource>("QuestionnaireResponse", params);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, _pages, lastOffset) => karteNextOffset(lastPage.data, lastOffset),
    enabled: Boolean(patientId),
  });
}

export function useDeletePrescription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (srId: string) => {
      const mrIds = await fetchRelatedMedicationRequestIds(srId);
      return postBundle(buildPrescriptionDeleteBundle(srId, mrIds));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
    },
  });
}

// 検体検査は明細も ServiceRequest なので、ぶら下がっているものを引いてから
// ヘッダごと消す(処方の MedicationRequest と同じ考え方)。
export function useDeleteLabOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (srId: string) => {
      const params = new URLSearchParams();
      params.set("_id", srId);
      params.set("_revinclude:iterate", "ServiceRequest:based-on");
      const { data: bundle } = await searchResource<fhir4.ServiceRequest>("ServiceRequest", params);
      const itemIds = labOrderItemRequests(serviceRequestsOf(bundle), srId)
        .map((request) => request.id)
        .filter((id): id is string => Boolean(id));
      return postBundle(buildLabOrderDeleteBundle(srId, itemIds));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
    },
  });
}

// 細菌検査オーダーも明細(検体グループ・検査項目)が独立した ServiceRequest なので、
// 消す直前に明細を引き直してからまとめて消す(検体検査と同じ)。
export function useDeleteMicroOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (srId: string) => {
      const params = new URLSearchParams();
      params.set("_id", srId);
      params.set("_revinclude:iterate", "ServiceRequest:based-on");
      const { data: bundle } = await searchResource<fhir4.ServiceRequest>("ServiceRequest", params);
      const itemIds = microOrderItemRequests(serviceRequestsOf(bundle), srId)
        .map((request) => request.id)
        .filter((id): id is string => Boolean(id));
      return postBundle(buildMicroOrderDeleteBundle(srId, itemIds));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
    },
  });
}

// 放射線オーダーも明細が独立した ServiceRequest なので、ヘッダだけ消すと明細が
// 残ってしまう。消す直前に明細を引き直してからまとめて消す(検体検査と同じ)。
export function useDeleteRadOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (srId: string) => {
      const params = new URLSearchParams();
      params.set("_id", srId);
      params.set("_revinclude:iterate", "ServiceRequest:based-on");
      const { data: bundle } = await searchResource<fhir4.ServiceRequest>("ServiceRequest", params);
      const itemRequests = radOrderItemRequests(serviceRequestsOf(bundle), srId);
      const itemIds = itemRequests
        .map((request) => request.id)
        .filter((id): id is string => Boolean(id));
      // 明細が参照しているテンプレート回答も一緒に消す(孤児を残さない)。
      return postBundle(
        buildRadOrderDeleteBundle(srId, itemIds, radOrderResponseIds(itemRequests)),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
    },
  });
}
