import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  buildLabResultDeleteBundle,
  observationIdsFromReport,
  specimenIdsFromReport,
} from "../fhir/labResultHelpers";
import {
  buildPrescriptionDeleteBundle,
  splitPrescriptionDetailBundle,
} from "../fhir/prescriptionHelpers";
import { buildPractitionerDeleteBundle } from "../fhir/practitionerHelpers";
import { deleteLoginAccount } from "./authClient";
import { buildQuestionnaire, collectPendingImageEntries } from "../fhir/questionnaireHelpers";
import { questionnaireCanonical } from "../fhir/questionnaireResponseHelpers";
import {
  buildQuestionnaireExport,
  buildTransferExport,
  downloadQuestionnaireExport,
  parseTransferImport,
} from "../fhir/questionnaireTransfer";
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

// 編集画面で職種・所属の初期値に使う。1 人につき 1 件だけ扱うため先頭を返す。
export function usePractitionerRole(practitionerId: string | undefined) {
  const params = new URLSearchParams();
  if (practitionerId) params.set("practitioner", `Practitioner/${practitionerId}`);

  const query = useQuery({
    queryKey: ["PractitionerRole", "practitioner", practitionerId],
    queryFn: () => searchResource<fhir4.PractitionerRole>("PractitionerRole", params),
    enabled: Boolean(practitionerId),
  });

  return {
    ...query,
    role: query.data?.data.entry?.map((e) => e.resource).find((r) => r),
  };
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

const PRESCRIPTION_COUNT = 20;

export function usePrescriptionSearch(patientId: string | undefined, offset: number) {
  const params = new URLSearchParams();
  if (patientId) params.set("patient", `Patient/${patientId}`);
  params.set("_count", String(PRESCRIPTION_COUNT));
  params.set("_offset", String(offset));
  // 処方日の降順（新しい順）。_sort のキーは検索パラメータ名（小文字 authoredon）。
  // FHIR プロパティ名 authoredOn では当該サーバーに無視されるため注意。
  params.set("_sort", "-authoredon");

  const query = useQuery({
    queryKey: ["ServiceRequest", "search", patientId, offset],
    queryFn: () => searchResource<fhir4.ServiceRequest>("ServiceRequest", params),
    placeholderData: keepPreviousData,
    enabled: Boolean(patientId),
  });

  return {
    ...query,
    bundle: query.data?.data,
    total: query.data?.data.total ?? 0,
    count: PRESCRIPTION_COUNT,
    hasPrevious: hasRelation(query.data?.data, "previous"),
    hasNext: hasRelation(query.data?.data, "next"),
  };
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
async function fetchLabResultOrder(patientId: string): Promise<string[]> {
  const ids: string[] = [];

  for (let page = 0; page < LAB_RESULT_ORDER_MAX_PAGES; page += 1) {
    const params = new URLSearchParams();
    params.set("patient", `Patient/${patientId}`);
    params.set("category", "LAB");
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
export function useLabResultNavigation(patientId: string | undefined, reportId: string | undefined) {
  // 作成・更新・削除時の invalidateQueries(["DiagnosticReport", "search"]) で
  // まとめて無効化されるよう search 配下のキーにしている。
  const query = useQuery({
    queryKey: ["DiagnosticReport", "search", "order", patientId],
    queryFn: () => fetchLabResultOrder(patientId as string),
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

export function useCreateLabResult() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "search"] });
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

const CLINICAL_NOTE_COUNT = 20;

// 診療記録(経過記録)。type=LOINC 11506-3 の Composition だけを扱う。
export function useClinicalNoteSearch(patientId: string | undefined, offset: number) {
  const params = new URLSearchParams();
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("type", "http://loinc.org|11506-3");
  params.set("_count", String(CLINICAL_NOTE_COUNT));
  params.set("_offset", String(offset));
  // 記録日時の降順(新しい順)
  params.set("_sort", "-date");
  // narrative(Base64 画像込み)を一覧転送から省くための指定。現状の上流 fhir-server は
  // _summary を無視して全量を返す(2026-08-01 確認)が、将来対応すれば自動で軽くなる。
  // summarize 側は section 欠落(SUBSETTED)を常に許容している。
  params.set("_summary", "true");

  const query = useQuery({
    queryKey: ["Composition", "search", patientId, offset],
    queryFn: () => searchResource<fhir4.Composition>("Composition", params),
    placeholderData: keepPreviousData,
    enabled: Boolean(patientId),
  });

  return {
    ...query,
    bundle: query.data?.data,
    total: query.data?.data.total ?? 0,
    count: CLINICAL_NOTE_COUNT,
    hasPrevious: hasRelation(query.data?.data, "previous"),
    hasNext: hasRelation(query.data?.data, "next"),
  };
}

export function useClinicalNote(id: string | undefined) {
  return useQuery({
    queryKey: ["Composition", id],
    queryFn: () => readResource<fhir4.Composition>("Composition", id as string),
    enabled: Boolean(id),
  });
}

export function useCreateClinicalNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (composition: fhir4.Composition) => createResource(composition),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Composition", "search"] });
    },
  });
}

export function useUpdateClinicalNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ composition, etag }: { composition: fhir4.Composition; etag: string }) =>
      updateResource(composition, etag),
    onSuccess: (result: FhirResult<fhir4.Composition>) => {
      queryClient.invalidateQueries({ queryKey: ["Composition", "search"] });
      queryClient.invalidateQueries({ queryKey: ["Composition", result.data.id] });
    },
  });
}

export function useDeleteClinicalNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteResource("Composition", id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Composition", "search"] });
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

const QUESTIONNAIRE_RESPONSE_COUNT = 20;

export function useQuestionnaireResponseSearch(patientId: string | undefined, offset: number) {
  const params = new URLSearchParams();
  if (patientId) params.set("patient", `Patient/${patientId}`);
  params.set("_count", String(QUESTIONNAIRE_RESPONSE_COUNT));
  params.set("_offset", String(offset));
  // 記入日時の降順(新しい順)。
  params.set("_sort", "-authored");
  // タイトル表示用の元テンプレートを同じレスポンスで受け取る(canonical を解決する _include)。
  params.set("_include", "QuestionnaireResponse:questionnaire");

  const query = useQuery({
    queryKey: ["QuestionnaireResponse", "search", patientId, offset],
    queryFn: () => searchResource<fhir4.Resource>("QuestionnaireResponse", params),
    placeholderData: keepPreviousData,
    enabled: Boolean(patientId),
  });

  // _include の Questionnaire も entry に混ざって返るため resourceType で分ける。
  const resources = query.data?.data.entry?.map((e) => e.resource) ?? [];
  const responses = resources.filter(
    (r): r is fhir4.QuestionnaireResponse => r?.resourceType === "QuestionnaireResponse",
  );
  const questionnaires = resources.filter(
    (r): r is fhir4.Questionnaire => r?.resourceType === "Questionnaire",
  );

  return {
    ...query,
    responses,
    questionnaires,
    total: query.data?.data.total ?? 0,
    count: QUESTIONNAIRE_RESPONSE_COUNT,
    hasPrevious: hasRelation(query.data?.data, "previous"),
    hasNext: hasRelation(query.data?.data, "next"),
  };
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

// テンプレート回答フォームの初期値式(%conditions / %labResults / %prescriptions)の
// 元データ取得。傷病名はアクティブなもの全件(上流の _count 上限 100 まで)、
// 検査結果・処方は最新 1 件を _sort + _count=1 + _include/_revinclude の 1 リクエスト
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
  rxParams.set("_count", "1");
  rxParams.set("_sort", "-authoredon");
  rxParams.set("_revinclude", "MedicationRequest:based-on");
  const rxDetail = useQuery({
    queryKey: ["ServiceRequest", "populate", patientId],
    queryFn: () => searchResource<fhir4.Resource>("ServiceRequest", rxParams),
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

export function useCreateQuestionnaireResponse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      response,
      imageEntries,
    }: {
      response: fhir4.QuestionnaireResponse;
      imageEntries?: fhir4.BundleEntry[];
    }) => saveWithImages(response, imageEntries),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse", "search"] });
    },
  });
}

export function useUpdateQuestionnaireResponse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      response,
      etag,
      imageEntries,
    }: {
      response: fhir4.QuestionnaireResponse;
      etag: string;
      imageEntries?: fhir4.BundleEntry[];
    }) => saveWithImages(response, imageEntries, etag),
    onSuccess: (result: FhirResult<fhir4.QuestionnaireResponse>) => {
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse", "search"] });
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse", result.data.id] });
    },
  });
}

export function useDeleteQuestionnaireResponse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteResource("QuestionnaireResponse", id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse", "search"] });
    },
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
