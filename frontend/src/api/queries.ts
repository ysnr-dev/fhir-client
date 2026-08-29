import { useMemo } from "react";
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  groupVitalEntries,
  vitalDeleteBundle,
  vitalSaveBundle,
  VITAL_ENTRY_SYSTEM,
} from "../fhir/vitalHelpers";
import { buildClinicalNoteDeleteBundle } from "../fhir/clinicalNoteHelpers";
import {
  LOCATION_TYPE_CODES,
  locationDisplayName,
  sortLocations,
} from "../fhir/locationHelpers";
import { KARTE_UNSCHEDULED_DAY, compareKarteDaysDesc } from "../fhir/karteTimeline";
import { today } from "../lib/dates";
import {
  MAX_BED_COUNT,
  PHYSICAL_TYPE_SYSTEM,
  ROOM_PHYSICAL_TYPE,
  WARD_PHYSICAL_TYPE,
  WARD_TYPE_CODE,
  bedNumber,
  buildRoomDeleteBundle,
  buildRoomSaveBundle,
  countByParent,
  partOfId,
  type RoomSaveInput,
} from "../fhir/wardHelpers";
import {
  ADMISSION_CLASS_CODE,
  ADMISSION_STATUS,
  DISCHARGED_STATUS,
  PLANNED_STATUS,
  buildCancelledEncounter,
  buildDischargedEncounter,
  encounterBedId,
  buildEncounterUpdateBundle,
  latestEncounterByBed,
} from "../fhir/encounterHelpers";
import {
  buildLabResultBundle,
  buildLabResultDeleteBundle,
  buildLabResultUpdateBundle,
  isLabelSpecimen,
  observationIdsFromReport,
  specimenIdsFromReport,
  splitLabResultDetailBundle,
  summarizeDiagnosticReport,
  type LabResultFormValues,
  type LabResultSummary,
  type SpecimenRef,
} from "../fhir/labResultHelpers";
import { isInjectionServiceRequest } from "../fhir/injectionHelpers";
import {
  LAB_ORDER_TYPE,
  buildLabOrderDeleteBundle,
  isOrderItemRequest,
  isLabServiceRequest,
  labOrderItemRequests,
  labOrderItems,
  labOrderLabel,
  serviceRequestsOf,
} from "../fhir/labOrderHelpers";
import {
  LAB_LABEL_NUMBER_SYSTEM,
  buildSpecimenArrival,
  buildSpecimenArrivalCancel,
  labelSpecimensByOrderId,
  type ArrivalRecorder,
} from "../fhir/labSpecimenHelpers";
import {
  buildLabTaskUpdate,
  labTasksByOrderId,
  type LabTaskStatus,
} from "../fhir/labTaskHelpers";
import {
  buildMicroOrderDeleteBundle,
  isMicroServiceRequest,
  microOrderItemRequests,
  microOrderLabel,
} from "../fhir/microOrderHelpers";
import { buildMicroResultDeleteBundle } from "../fhir/microResultHelpers";
import {
  PATHO_ORDER_TYPE,
  buildPathoOrderDeleteBundle,
  isPathoServiceRequest,
  pathoOrderItemRequests,
  pathoOrderLabel,
  pathoOrderResponseIds,
} from "../fhir/pathoOrderHelpers";
import { buildPathoResultDeleteBundle } from "../fhir/pathoResultHelpers";
import {
  TRANSFUSION_ORDER_TYPE,
  buildTransfusionOrderDeleteBundle,
  isTransfusionServiceRequest,
  transfusionOrderItemRequests,
} from "../fhir/transfusionOrderHelpers";
import {
  buildTransfusionTaskUpdate,
  transfusionTasksByOrderId,
  type TransfusionTaskStatus,
} from "../fhir/transfusionTaskHelpers";
import {
  buildPathoTaskUpdate,
  pathoTasksByOrderId,
  type PathoTaskStatus,
} from "../fhir/pathoTaskHelpers";
import {
  ORDER_TYPE_SYSTEM,
  PRESCRIPTION_CATEGORY_SYSTEM,
  buildPrescriptionDeleteBundle,
  departmentOf,
  isPrescriptionServiceRequest,
} from "../fhir/prescriptionHelpers";
import {
  buildRxTaskUpdate,
  rxTasksByOrderId,
  type RxTaskStatus,
} from "../fhir/rxTaskHelpers";
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
import {
  PHYSIO_ORDER_TYPE,
  buildPhysioOrderDeleteBundle,
  isPhysioServiceRequest,
  physioOrderItemRequests,
  physioOrderResponseIds,
  physioOrderTime,
} from "../fhir/physioOrderHelpers";
import { buildPhysioPerformDeleteEntries } from "../fhir/physioResultHelpers";
import {
  buildPhysioTaskUpdate,
  physioTaskStatus,
  physioTasksByOrderId,
  type PhysioTaskStatus,
} from "../fhir/physioTaskHelpers";
import {
  ENDOSCOPY_ORDER_TYPE,
  buildEndoscopyOrderDeleteBundle,
  isEndoscopyServiceRequest,
  endoscopyOrderItemRequests,
  endoscopyOrderResponseIds,
  endoscopyOrderTime,
} from "../fhir/endoscopyOrderHelpers";
import { buildEndoscopyPerformDeleteEntries } from "../fhir/endoscopyResultHelpers";
import {
  buildEndoscopyTaskUpdate,
  endoscopyTaskStatus,
  endoscopyTasksByOrderId,
  type EndoscopyTaskStatus,
} from "../fhir/endoscopyTaskHelpers";
import {
  TREATMENT_ORDER_TYPE,
  buildTreatmentOrderDeleteBundle,
  isTreatmentServiceRequest,
  treatmentOrderItemRequests,
  treatmentOrderTime,
} from "../fhir/treatmentOrderHelpers";
import { buildTreatmentPerformDeleteEntries } from "../fhir/treatmentResultHelpers";
import {
  MEAL_ORDER_TYPE,
  buildMealOrderStopEntries,
  isMealOrderRunningOn,
  isMealServiceRequest,
  mealOrderEndsOnOrAfter,
  type MealTiming,
} from "../fhir/mealOrderHelpers";
import {
  buildTreatmentTaskUpdate,
  treatmentTaskStatus,
  treatmentTasksByOrderId,
  type TreatmentTaskStatus,
} from "../fhir/treatmentTaskHelpers";
import {
  SURGERY_ORDER_TYPE,
  buildSurgeryOrderDeleteBundle,
  buildSurgeryMoveBundle,
  buildSurgeryScheduleBundle,
  buildSurgeryScheduleServiceRequest,
  isSurgeryServiceRequest,
  summarizeSurgeryOrder,
  surgeryOrderItemRequests,
  surgeryOrderResponseIds,
  type SurgeryScheduleValues,
} from "../fhir/surgeryOrderHelpers";
import {
  buildSurgeryTaskUpdate,
  surgeryTaskStatus,
  surgeryTasksByOrderId,
  type SurgeryTaskStatus,
} from "../fhir/surgeryTaskHelpers";
import { buildSurgeryPerformDeleteEntries } from "../fhir/surgeryResultHelpers";
import {
  buildAnesthesiaChartData,
  isAnesthesiaChartHub,
  type AnesthesiaChartData,
} from "../fhir/anesthesiaChartHelpers";
import { buildPractitionerDeleteBundle } from "../fhir/practitionerHelpers";
import {
  addDays,
  buildSlotCreateBundle,
  buildSlotDeleteBundle,
  scheduleTypeOf,
  type ScheduleType,
  type SlotStatus,
} from "../fhir/scheduleHelpers";
import {
  appointmentActorId,
  appointmentSlotIds,
  buildBookBundle,
  buildCancelBundle,
  buildCancelEntries,
  buildRescheduleBundle,
  buildRescheduleEntries,
  isActiveAppointment,
  isExamAppointment,
} from "../fhir/appointmentHelpers";
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
  observationExtractEnabled,
  responseDeleteBundle,
  responseSaveBundle,
} from "../fhir/observationExtract";
import { resourceFromBundleResponse, resourceWithImagesBundle } from "../fhir/schemaImage";
import {
  DEFAULT_IDENTIFIER_SYSTEM,
  nextPatientNumber,
  patientNumberOf,
} from "../fhir/patientHelpers";
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
  readHistory,
  readResource,
  searchResource,
  typeOperation,
  updateResource,
  type FhirResult,
} from "./fhirClient";
import { fetchFacilitySettings } from "./facilityClient";

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

// 患者番号の自動採番。上流は identifier での並べ替えに対応しておらず、対応しても
// 文字列順では "9" が "10" より後になるので、識別子だけを取り出して全件走査する。
// 1 ページの件数は上流の上限に切られてもよい(next リンクを辿って最後まで読む)。
const PATIENT_NUMBER_SCAN_COUNT = 500;
// 走査するページ数の上限。ここで打ち切ると番号が重複しうるので、採番後に空きを確認する。
const PATIENT_NUMBER_SCAN_PAGES = 40;

async function fetchNextPatientNumber(): Promise<string> {
  const patients: fhir4.Patient[] = [];

  for (let page = 0; page < PATIENT_NUMBER_SCAN_PAGES; page += 1) {
    const params = new URLSearchParams();
    params.set("_elements", "identifier");
    params.set("_count", String(PATIENT_NUMBER_SCAN_COUNT));
    params.set("_offset", String(page * PATIENT_NUMBER_SCAN_COUNT));
    const { data } = await searchResource<fhir4.Patient>("Patient", params);
    for (const entry of data.entry ?? []) {
      if (entry.resource) patients.push(entry.resource);
    }
    if (!hasRelation(data, "next")) break;
  }

  // 走査を打ち切った場合と、同時に登録された場合に備えて空き番号まで進める。
  let candidate = Number(nextPatientNumber(patients));
  for (let i = 0; i < PATIENT_NUMBER_SCAN_PAGES; i += 1) {
    const params = new URLSearchParams();
    params.set("identifier", `${DEFAULT_IDENTIFIER_SYSTEM}|${candidate}`);
    params.set("_summary", "count");
    const { data } = await searchResource<fhir4.Patient>("Patient", params);
    if (!data.total) break;
    candidate += 1;
  }

  return String(candidate);
}

export function useCreatePatient() {
  const queryClient = useQueryClient();
  return useMutation({
    // 患者番号が空欄のまま登録されたら、ここで採番してから作る。
    mutationFn: async (patient: fhir4.Patient) => {
      if (patientNumberOf(patient)) return createResource(patient);
      const value = await fetchNextPatientNumber();
      return createResource({
        ...patient,
        identifier: [{ system: DEFAULT_IDENTIFIER_SYSTEM, value }, ...(patient.identifier ?? [])],
      });
    },
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

// --- 自院 --------------------------------------------------------------------
//
// 本アプリはマルチテナントではなく、診療科・診察室・スタッフは自院のものしか
// 登録しない。他院の医療機関・医師は診療情報提供書の宛先候補として登録するので、
// 「どれが自院か」は backend の単一行設定(管理 > 自院設定)が持つ。
//
// 未設定でも画面は従来どおり動く(所属を選ばせる UI が残る)。呼び出し側は
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
  // type=dept でも引けるが、診療科を診療科たらしめているのは「所属医療機関を持つ」
  // 方(フォームが必須にしているのはこちら)なので、判別は partOf で行う。
  else params.set("partof:missing", "false");
  // 診療科コードの昇順。コード未設定の科は末尾に回り(上流は NULL を後ろに置く)、
  // その中では名称順になる = sortDepartmentsByCode と同じ並び。
  params.set("_sort", "identifier,name");
  return params;
}

// 条件に合う診療科を全件集める。上流の _count 上限は 100 なので、次ページが
// 尽きるまで _offset を進めて読み切る。セレクトの選択肢と一括登録の重複判定は
// 全件が要るのでこちらを使う(一覧画面は useDepartmentPage)。
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

// 一覧画面用。並べ替えもページングも上流に任せる(診療科コード順の _sort に
// 対応したので、全件読んでから画面側で切り出す必要が無くなった)。
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
      query.data?.data.entry
        ?.map((e) => e.resource)
        .filter((r): r is fhir4.Organization => Boolean(r)) ?? [],
    total: query.data?.data.total ?? 0,
    count: DEPARTMENT_COUNT,
    hasPrevious: hasRelation(query.data?.data, "previous"),
    hasNext: hasRelation(query.data?.data, "next"),
  };
}

// 自院の診療科。予約枠・外来一覧・部門ワークリストのように「自院の科を選ぶ」
// 画面はこちらを使う。自院未設定の環境では従来どおり全医療機関の診療科を返す。
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

// 予約枠の担当医セレクト用。医療従事者は施設あたり数百人を超えない前提で
// まとめて取り、並べ替えは画面側で行う(useOrganizationOptions と同じ扱い)。
export function usePractitionerOptions() {
  const params = new URLSearchParams();
  params.set("_count", "100");

  const query = useQuery({
    queryKey: ["Practitioner", "search", "options"],
    queryFn: () => searchResource<fhir4.Practitioner>("Practitioner", params),
  });

  return {
    ...query,
    practitioners:
      query.data?.data.entry
        ?.map((e) => e.resource)
        .filter((r): r is fhir4.Practitioner => Boolean(r)) ?? [],
  };
}

// ---- 場所(Location) ----
//
// 診察室・撮影室のマスタ。単体で使うことはなく、予約枠(Schedule.actor)の
// 主体として参照する。

export interface LocationSearchParams {
  name?: string;
  status?: string;
}

const LOCATION_COUNT = 20;

export function useLocationSearch(search: LocationSearchParams, offset: number) {
  const params = new URLSearchParams();
  if (search.name) params.set("name", search.name);
  if (search.status) params.set("status", search.status);
  // 入院の場所(病棟・病室・ベッド)はこの一覧の担当ではない(/wards が持つ)。
  // 上流の token 検索に :not は無いので「除く」ではなく「診察室の種別だけを
  // 挙げて OR で引く」で分ける。取得後に落とすやり方だと total とページ内件数が
  // ずれるため、サーバー側で絞りきる。
  params.set("type", LOCATION_TYPE_CODES.join(","));
  params.set("_count", String(LOCATION_COUNT));
  params.set("_offset", String(offset));

  const query = useQuery({
    queryKey: ["Location", "search", search, offset],
    queryFn: () => searchResource<fhir4.Location>("Location", params),
    placeholderData: keepPreviousData,
  });

  return {
    ...query,
    locations:
      query.data?.data.entry
        ?.map((e) => e.resource)
        .filter((r): r is fhir4.Location => Boolean(r)) ?? [],
    total: query.data?.data.total ?? 0,
    count: LOCATION_COUNT,
    hasPrevious: hasRelation(query.data?.data, "previous"),
    hasNext: hasRelation(query.data?.data, "next"),
  };
}

// 選択肢用。使用しない場所を枠の主体に選べても仕方がないので active だけ返す。
export function useLocationOptions() {
  const params = new URLSearchParams();
  params.set("status", "active");
  // 診察室のセレクトなので、入院の場所は除く(useLocationSearch と同じ理由)。
  params.set("type", LOCATION_TYPE_CODES.join(","));
  params.set("_count", "100");

  const query = useQuery({
    queryKey: ["Location", "search", "options"],
    queryFn: () => searchResource<fhir4.Location>("Location", params),
  });

  return {
    ...query,
    // 表示順 → 名称の順。上流は独自拡張で _sort できないのでここで並べる
    // (全件を 1 回で読む選択肢なので、読み手で並べても取りこぼしは出ない)。
    locations: sortLocations(
      query.data?.data.entry
        ?.map((e) => e.resource)
        .filter((r): r is fhir4.Location => Boolean(r)) ?? [],
    ),
  };
}

export function useLocation(id: string | undefined) {
  return useQuery({
    queryKey: ["Location", id],
    queryFn: () => readResource<fhir4.Location>("Location", id as string),
    enabled: Boolean(id),
  });
}

export function useCreateLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (location: fhir4.Location) => createResource(location),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Location"] });
    },
  });
}

export function useUpdateLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ location, etag }: { location: fhir4.Location; etag: string }) =>
      updateResource(location, etag),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Location"] });
    },
  });
}

export function useDeleteLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteResource("Location", id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Location"] });
    },
  });
}

// ---- 病棟・病室・ベッド(Location の 3 階層) ----
//
// 入院の場所マスタ。病棟(type=HU)の下に病室(partOf=病棟)、その下にベッド
// (partOf=病室)がぶら下がる。上の「場所」節(診察室・撮影室)とは画面も一覧も
// 分ける。階層とコードの決め方は fhir/wardHelpers.ts の冒頭にまとめてある。
//
// 病棟・病室・ベッドはどれも Location なので、作成・単体取得・更新は上の
// useCreateLocation / useLocation / useUpdateLocation をそのまま使う。ここに
// 足すのは、階層があるせいでやり方が変わるもの(子ごと引く検索、子を巻き込む
// 保存・削除)だけ。
//
// 一覧に出す「病室数」「ベッド数」は _revinclude=Location:partof で子ごと取って
// 数える。_revinclude の結果は _count の対象外(上流 IncludeResolver)なので
// 子を取りこぼさない。行ごとに件数を数えるクエリを投げるより 1 往復で済む。

/** 検索結果を match(親)と include(子)に分ける。どちらも Location なので型では分けられない。 */
function splitLocationMatches(bundle: fhir4.Bundle<fhir4.Resource> | undefined) {
  const matches: fhir4.Location[] = [];
  const children: fhir4.Location[] = [];

  for (const entry of bundle?.entry ?? []) {
    const resource = entry.resource;
    if (resource?.resourceType !== "Location") continue;
    if (entry.search?.mode === "include") children.push(resource as fhir4.Location);
    else matches.push(resource as fhir4.Location);
  }

  return { matches, children };
}

export interface WardSearchParams {
  name?: string;
  status?: string;
}

const WARD_COUNT = 20;
const ROOM_COUNT = 20;

export function useWardSearch(search: WardSearchParams, offset: number) {
  const params = new URLSearchParams();
  params.set("type", WARD_TYPE_CODE);
  if (search.name) params.set("name", search.name);
  if (search.status) params.set("status", search.status);
  // 並びは病棟名順。既定の id 順では登録のたびに順番が変わって読みにくい。
  params.set("_sort", "name");
  params.set("_count", String(WARD_COUNT));
  params.set("_offset", String(offset));
  // 一覧に病室数を出すため、ぶら下がる病室も一緒に取る。
  params.set("_revinclude", "Location:partof");

  const query = useQuery({
    queryKey: ["Location", "wards", search, offset],
    queryFn: () => searchResource<fhir4.Resource>("Location", params),
    placeholderData: keepPreviousData,
  });

  const { matches, children } = splitLocationMatches(query.data?.data);

  return {
    ...query,
    wards: matches,
    /** 病棟 id -> 病室数。 */
    roomCounts: countByParent(children),
    total: query.data?.data.total ?? 0,
    count: WARD_COUNT,
    hasPrevious: hasRelation(query.data?.data, "previous"),
    hasNext: hasRelation(query.data?.data, "next"),
  };
}

/** 1 つの病棟にぶら下がる病室。配下のベッドも一緒に取って件数と削除に使う。 */
export function useRoomSearch(wardId: string | undefined, offset: number) {
  const params = new URLSearchParams();
  params.set("partof", `Location/${wardId}`);
  // 「301号室」「302号室」と並べたいので病室名順。
  params.set("_sort", "name");
  params.set("_count", String(ROOM_COUNT));
  params.set("_offset", String(offset));
  params.set("_revinclude", "Location:partof");

  const query = useQuery({
    queryKey: ["Location", "rooms", wardId, offset],
    queryFn: () => searchResource<fhir4.Resource>("Location", params),
    placeholderData: keepPreviousData,
    enabled: Boolean(wardId),
  });

  const { matches, children } = splitLocationMatches(query.data?.data);

  return {
    ...query,
    rooms: matches,
    /** 表示中の病室にぶら下がるベッド。件数表示と、病室削除の巻き込みに使う。 */
    beds: children,
    /** 病室 id -> ベッド数。 */
    bedCounts: countByParent(children),
    total: query.data?.data.total ?? 0,
    count: ROOM_COUNT,
    hasPrevious: hasRelation(query.data?.data, "previous"),
    hasNext: hasRelation(query.data?.data, "next"),
  };
}

/** 1 つの病室のベッド。編集画面がベッド数の初期値と増減の差分に使う。 */
export function useRoomBeds(roomId: string | undefined) {
  const params = new URLSearchParams();
  params.set("partof", `Location/${roomId}`);
  // ベッド数の上限ぶん取れれば足りる(MAX_BED_COUNT を超えては作れない)。
  params.set("_count", String(MAX_BED_COUNT + 1));

  const query = useQuery({
    queryKey: ["Location", "beds", roomId],
    queryFn: () => searchResource<fhir4.Location>("Location", params),
    enabled: Boolean(roomId),
  });

  return {
    ...query,
    beds:
      query.data?.data.entry
        ?.map((e) => e.resource)
        .filter((r): r is fhir4.Location => Boolean(r)) ?? [],
  };
}

/**
 * 病棟を削除する。上流に参照整合性は無いので、配下の病室が残っていないかを
 * ここで確かめてから消す(残したまま消すと親のいない病室が宙に浮く)。
 */
export function useDeleteWard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const params = new URLSearchParams();
      params.set("partof", `Location/${id}`);
      params.set("_summary", "count");
      const { data } = await searchResource<fhir4.Location>("Location", params);
      if ((data.total ?? 0) > 0) {
        throw new Error(
          "この病棟には病室が登録されています。先に病室をすべて削除してください。",
        );
      }
      return deleteResource("Location", id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Location"] });
    },
  });
}

/** 病室の登録・更新。ベッドの増減を巻き込むので単体 PUT ではなく Bundle で書く。 */
export function useSaveRoom() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RoomSaveInput) => postBundle(buildRoomSaveBundle(input)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Location"] });
    },
  });
}

/** 病室を配下のベッドごと削除する。 */
export function useDeleteRoom() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ roomId, beds }: { roomId: string; beds: fhir4.Location[] }) =>
      postBundle(buildRoomDeleteBundle(roomId, beds)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Location"] });
    },
  });
}

/** 病棟のセレクト用。使わない病棟を選べても仕方がないので active だけ返す。 */
export function useWardOptions() {
  const params = new URLSearchParams();
  params.set("type", WARD_TYPE_CODE);
  params.set("status", "active");
  params.set("_sort", "name");
  params.set("_count", "100");

  const query = useQuery({
    queryKey: ["Location", "wards", "options"],
    queryFn: () => searchResource<fhir4.Location>("Location", params),
  });

  return {
    ...query,
    wards:
      query.data?.data.entry
        ?.map((e) => e.resource)
        .filter((r): r is fhir4.Location => Boolean(r)) ?? [],
  };
}

export interface WardGrid {
  /** 病室名順。 */
  rooms: fhir4.Location[];
  /** 病室 id -> その病室のベッド(番号順)。 */
  bedsByRoom: Map<string, fhir4.Location[]>;
}

/**
 * 入院患者一覧のグリッド用に、1 つの病棟の病室とベッドをまとめて取る。
 * 一覧(useRoomSearch)と違ってページングしないのは、病棟ぶんの表を 1 画面に
 * 出しきるため。_revinclude の子は _count の対象外なのでベッドは取りこぼさない。
 */
async function fetchWardGrid(wardId: string): Promise<WardGrid> {
  const PAGE = 100;
  const rooms: fhir4.Location[] = [];
  const beds: fhir4.Location[] = [];

  for (let offset = 0; ; offset += PAGE) {
    const params = new URLSearchParams();
    params.set("partof", `Location/${wardId}`);
    params.set("_sort", "name");
    params.set("_count", String(PAGE));
    params.set("_offset", String(offset));
    params.set("_revinclude", "Location:partof");

    const { data: bundle } = await searchResource<fhir4.Resource>("Location", params);
    const { matches, children } = splitLocationMatches(bundle);
    rooms.push(...matches);
    beds.push(...children);
    if (matches.length < PAGE) break;
  }

  const bedsByRoom = new Map<string, fhir4.Location[]>();
  for (const bed of beds) {
    const roomId = partOfId(bed);
    if (!roomId) continue;
    const list = bedsByRoom.get(roomId);
    if (list) list.push(bed);
    else bedsByRoom.set(roomId, [bed]);
  }
  for (const list of bedsByRoom.values()) {
    list.sort((a, b) => (bedNumber(a) ?? 0) - (bedNumber(b) ?? 0));
  }

  return { rooms, bedsByRoom };
}

export function useWardGrid(wardId: string | undefined) {
  const query = useQuery({
    queryKey: ["Location", "ward-grid", wardId],
    queryFn: () => fetchWardGrid(wardId as string),
    enabled: Boolean(wardId),
    placeholderData: keepPreviousData,
  });

  return {
    ...query,
    rooms: query.data?.rooms ?? [],
    bedsByRoom: query.data?.bedsByRoom ?? new Map<string, fhir4.Location[]>(),
  };
}

// ---- 入院(Encounter) ----
//
// 入院は Encounter 1 件で「その患者が今どのベッドに居るか」を表す
// (組み立て方は fhir/encounterHelpers.ts の冒頭)。
//
// 病棟で絞らず院内の入院を全部取ってからベッド id で突き合わせる。上流は
// 多段チェーン検索(location.partof.partof=<病棟>)に対応したので病棟で絞る
// こともできるが、件数はベッド総数が上限で高が知れているうえ、全部持っていれば
// 「この患者は既に別の病棟に入院している」の判定も追加のリクエスト無しでできる
// ため、あえて全件のままにしている(病床数が増えて truncated が出るようなら
// チェーン検索で絞る作りに変える)。
//
// 「その日に在院していた患者」を出すので、退院済み(finished)も含めて期間が
// その日に重なるものを引く。FHIR の date 検索は期間に対して eq が「検索値の範囲が
// 対象の期間を完全に含む」と定められていて重なりではないので、重なりは ge と le の
// AND で表す(仕様どおりの書き方であって、上流の制限ではない):
//   date=ge<日> → 退院していない、またはその日以降に退院した
//   date=le<日> → その日までに入院している
// 取り消した入院(entered-in-error)は在院ではないので status で外す。

const INPATIENT_PAGE = 100;
const INPATIENT_MAX_PAGES = 5;

export interface InpatientResult {
  /** ベッド id -> 入院中の Encounter。 */
  byBed: Map<string, fhir4.Encounter>;
  /** 患者 id -> 患者。_include で一緒に取ったもの。 */
  patientsById: Map<string, fhir4.Patient>;
  /** 入院中の Encounter 全件(既入院の判定に使う)。 */
  encounters: fhir4.Encounter[];
  /** 上限ページまで読んでも終わらなかった(表示が欠けている)。 */
  truncated: boolean;
}

async function fetchInpatients(date: string): Promise<InpatientResult> {
  const encounters: fhir4.Encounter[] = [];
  const patientsById = new Map<string, fhir4.Patient>();
  let truncated = false;

  for (let page = 0; page < INPATIENT_MAX_PAGES; page += 1) {
    const params = new URLSearchParams();
    params.set("status", `${ADMISSION_STATUS},${DISCHARGED_STATUS}`);
    params.set("class", ADMISSION_CLASS_CODE);
    // 同じ名前を 2 回渡すと AND になる(重なりの条件。上のコメント参照)。
    params.append("date", `ge${date}`);
    params.append("date", `le${date}`);
    params.set("_count", String(INPATIENT_PAGE));
    params.set("_offset", String(page * INPATIENT_PAGE));
    // 氏名・カナ・生年月日・性別を出すのに患者の現物が要る。
    params.set("_include", "Encounter:subject");

    const { data: bundle } = await searchResource<fhir4.Resource>("Encounter", params);

    let matched = 0;
    for (const entry of bundle.entry ?? []) {
      const resource = entry.resource;
      if (resource?.resourceType === "Encounter") {
        encounters.push(resource as fhir4.Encounter);
        matched += 1;
      } else if (resource?.resourceType === "Patient" && resource.id) {
        patientsById.set(resource.id, resource as fhir4.Patient);
      }
    }

    if (matched < INPATIENT_PAGE) break;
    if (page === INPATIENT_MAX_PAGES - 1) truncated = true;
  }

  return { byBed: latestEncounterByBed(encounters), patientsById, encounters, truncated };
}

/** ベッドが属する病棟。 */
export interface BedWard {
  wardId: string;
  wardName: string;
}

/**
 * ベッド id -> その病棟。入院中の患者に「入院病棟」を出す/病棟で絞るのに使う。
 *
 * ［事実］入院(Encounter)が記録するのは**ベッドだけ**で、display も「301号室 ベッド1」
 * (bedDisplayName)なので病棟名を含まない。病棟は ベッド → 病室 → 病棟 の partOf を
 * 辿らないと分からない。
 *
 * ［実装］病棟ごとに引くと病棟数だけリクエストが増えるので、**全病棟をまとめて 1 本**で
 * 引く(partof のカンマ OR)。`_revinclude=Location:partof` の子は `_count` の対象外
 * なので、病室のページングだけ見ればベッドは取りこぼさない(fetchWardGrid と同じ作り)。
 */
async function fetchBedWardIndex(): Promise<Map<string, BedWard>> {
  const wardParams = new URLSearchParams();
  wardParams.set("type", WARD_TYPE_CODE);
  wardParams.set("status", "active");
  wardParams.set("_count", "100");
  const { data: wardBundle } = await searchResource<fhir4.Location>("Location", wardParams);
  const wards =
    wardBundle.entry
      ?.map((e) => e.resource)
      .filter((r): r is fhir4.Location => r?.resourceType === "Location") ?? [];
  if (wards.length === 0) return new Map();

  const PAGE = 100;
  const rooms: fhir4.Location[] = [];
  const beds: fhir4.Location[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const params = new URLSearchParams();
    params.set("partof", wards.map((ward) => `Location/${ward.id}`).join(","));
    params.set("_count", String(PAGE));
    params.set("_offset", String(offset));
    params.set("_revinclude", "Location:partof");

    const { data: bundle } = await searchResource<fhir4.Resource>("Location", params);
    const { matches, children } = splitLocationMatches(bundle);
    rooms.push(...matches);
    beds.push(...children);
    if (matches.length < PAGE) break;
  }

  // 病室は途中のページに散るので、全ページ読み終えてから突き合わせる。
  const wardById = new Map(wards.map((ward) => [ward.id ?? "", ward]));
  const wardIdByRoom = new Map<string, string>();
  for (const room of rooms) {
    const wardId = partOfId(room);
    if (room.id && wardId) wardIdByRoom.set(room.id, wardId);
  }

  const index = new Map<string, BedWard>();
  for (const bed of beds) {
    const roomId = partOfId(bed);
    const wardId = roomId ? wardIdByRoom.get(roomId) : undefined;
    const ward = wardId ? wardById.get(wardId) : undefined;
    if (!bed.id || !ward?.id) continue;
    index.set(bed.id, { wardId: ward.id, wardName: locationDisplayName(ward) });
  }
  return index;
}

export function useBedWardIndex() {
  const query = useQuery({
    queryKey: ["Location", "bed-ward-index"],
    queryFn: fetchBedWardIndex,
    // 病棟の構成は日に何度も変わらない。開くたびに引き直さない。
    staleTime: 5 * 60 * 1000,
  });
  return { ...query, bedWards: query.data ?? new Map<string, BedWard>() };
}

/** date(YYYY-MM-DD)にベッドを使っていた入院。既定は当日ぶん。 */
export function useInpatientEncounters(date: string) {
  return useQuery({
    queryKey: ["Encounter", "inpatients", date],
    queryFn: () => fetchInpatients(date),
    enabled: Boolean(date),
    placeholderData: keepPreviousData,
  });
}

/** 空きベッドへの入院登録。 */
export function useAdmitPatient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (encounter: fhir4.Encounter) => createResource(encounter),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Encounter"] });
    },
  });
}

/** 退院。入院を終える(記録は status=finished + 退院日として残る)。 */
/**
 * 退院。継続する食事オーダーを一緒に止められる(退院後も食事が出続けるのを防ぐ)。
 * 入院の書き換えと同じ transaction に載せるので、退院だけ通って食事が残ることはない。
 */
export function useDischargePatient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      encounter,
      dischargeDate,
      mealOrders = [],
      mealEndTiming,
    }: {
      encounter: fhir4.Encounter;
      dischargeDate: string;
      /** 一緒に終了させる食事オーダー。画面で「終了する」を外したときは空。 */
      mealOrders?: fhir4.ServiceRequest[];
      /** 退院日のどの食事まで出すか。 */
      mealEndTiming: MealTiming;
    }) =>
      postBundle(
        buildEncounterUpdateBundle(
          buildDischargedEncounter(encounter, dischargeDate),
          buildMealOrderStopEntries(mealOrders, dischargeDate, mealEndTiming),
        ),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Encounter"] });
      // 食事オーダーの終了もこの transaction で書いているので読み直させる。
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
    },
  });
}

/** 入院登録の取り消し(誤登録)。退院とは別物なので退院日は残さない。 */
export function useCancelAdmission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (encounter: fhir4.Encounter) =>
      postBundle(buildEncounterUpdateBundle(buildCancelledEncounter(encounter))),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Encounter"] });
    },
  });
}

/**
 * 組み立て済みの Encounter で上書きする汎用の更新。入院実施・予定取消・転室・
 * 外出泊・転科転棟予定・退院予定のように「helpers で書き換えた 1 件を保存する」
 * 操作をまとめて受ける。
 */
export function useUpdateEncounter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (encounter: fhir4.Encounter) =>
      postBundle(buildEncounterUpdateBundle(encounter)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Encounter"] });
    },
  });
}

export interface PlannedAdmissionsResult {
  /** 入院予定の Encounter。入院予定日順。 */
  encounters: fhir4.Encounter[];
  patientsById: Map<string, fhir4.Patient>;
  truncated: boolean;
}

// 入院予定は日付で絞れない(予定日はどこまでも先があり得る)ので全件取る。
// ページングの形は fetchInpatients と同じ。
async function fetchPlannedAdmissions(): Promise<PlannedAdmissionsResult> {
  const encounters: fhir4.Encounter[] = [];
  const patientsById = new Map<string, fhir4.Patient>();
  let truncated = false;

  for (let page = 0; page < INPATIENT_MAX_PAGES; page += 1) {
    const params = new URLSearchParams();
    params.set("status", PLANNED_STATUS);
    params.set("class", ADMISSION_CLASS_CODE);
    // 入院予定日(period.start)の早い順。
    params.set("_sort", "date");
    params.set("_count", String(INPATIENT_PAGE));
    params.set("_offset", String(page * INPATIENT_PAGE));
    params.set("_include", "Encounter:subject");

    const { data: bundle } = await searchResource<fhir4.Resource>("Encounter", params);

    let matched = 0;
    for (const entry of bundle.entry ?? []) {
      const resource = entry.resource;
      if (resource?.resourceType === "Encounter") {
        encounters.push(resource as fhir4.Encounter);
        matched += 1;
      } else if (resource?.resourceType === "Patient" && resource.id) {
        patientsById.set(resource.id, resource as fhir4.Patient);
      }
    }

    if (matched < INPATIENT_PAGE) break;
    if (page === INPATIENT_MAX_PAGES - 1) truncated = true;
  }

  return { encounters, patientsById, truncated };
}

/** 入院予定(status=planned)の一覧。 */
export function usePlannedAdmissions() {
  return useQuery({
    queryKey: ["Encounter", "planned-admissions"],
    queryFn: fetchPlannedAdmissions,
    placeholderData: keepPreviousData,
  });
}

// ---- カルテの患者情報に出す入院 ----
//
// 「その患者が今どの病棟・病室に入院しているか」を患者 id だけで引く。入院患者一覧と
// 違って病棟が分かっていないので、Encounter が指すベッドから partOf を辿って
// 病室名・病棟名を取る(Encounter に控えた display は「301号室 ベッド1」の書き方で、
// 病棟名も入っていないのでここでは使わない)。

export interface PatientAdmission {
  encounter: fhir4.Encounter;
  /** 病棟の Location.id。辿れなければ空文字。オーダーに焼き付ける病棟の参照に使う。 */
  wardId: string;
  /** 病棟名。辿れなければ空文字。 */
  wardName: string;
  /** 病室名。辿れなければ空文字。 */
  roomName: string;
}

async function fetchPatientAdmission(patientId: string): Promise<PatientAdmission | null> {
  const params = new URLSearchParams();
  params.set("subject", `Patient/${patientId}`);
  params.set("status", ADMISSION_STATUS);
  params.set("class", ADMISSION_CLASS_CODE);
  params.set("_count", "10");

  const { data: bundle } = await searchResource<fhir4.Encounter>("Encounter", params);
  const encounters =
    bundle.entry
      ?.map((e) => e.resource)
      .filter((r): r is fhir4.Encounter => r?.resourceType === "Encounter") ?? [];
  // 同じ患者に入院中が 2 件並ぶことは無い想定だが、あれば入院日が新しい方を採る
  // (データがおかしくてもカルテの見出しが壊れないように)。
  const encounter = encounters.reduce<fhir4.Encounter | undefined>(
    (latest, current) =>
      !latest || (current.period?.start ?? "") > (latest.period?.start ?? "") ? current : latest,
    undefined,
  );
  if (!encounter) return null;

  const bedId = encounterBedId(encounter);
  if (!bedId) return { encounter, wardId: "", wardName: "", roomName: "" };

  // ベッドと、その上の病室・病棟をまとめて引く。階層は physicalType(wa/ro/bd)で
  // 見分ける。_include:iterate に応えない上流でも病室までは返るので、
  // 病棟が無ければそこから 1 件だけ読み足す。
  const locationParams = new URLSearchParams();
  locationParams.set("_id", bedId);
  locationParams.append("_include", "Location:partof");
  locationParams.append("_include:iterate", "Location:partof");

  const { data: locationBundle } = await searchResource<fhir4.Location>(
    "Location",
    locationParams,
  );
  const locations =
    locationBundle.entry
      ?.map((e) => e.resource)
      .filter((r): r is fhir4.Location => r?.resourceType === "Location") ?? [];
  const ofType = (code: string) =>
    locations.find((location) =>
      location.physicalType?.coding?.some(
        (coding) => coding.system === PHYSICAL_TYPE_SYSTEM && coding.code === code,
      ),
    );

  const room = ofType(ROOM_PHYSICAL_TYPE.code);
  let ward = ofType(WARD_PHYSICAL_TYPE.code);
  if (!ward) {
    const wardId = room ? partOfId(room) : undefined;
    if (wardId) ward = (await readResource<fhir4.Location>("Location", wardId)).data;
  }

  return {
    encounter,
    wardId: ward?.id ?? "",
    wardName: ward?.name ?? "",
    roomName: room?.name ?? "",
  };
}

/** 患者が入院中ならその入院と病棟名。入院していなければ null。 */
export function usePatientAdmission(patientId: string | undefined) {
  return useQuery({
    queryKey: ["Encounter", "patient-admission", patientId],
    queryFn: () => fetchPatientAdmission(patientId as string),
    enabled: Boolean(patientId),
  });
}

// ---- 予約枠(Schedule / Slot) ----

export interface ScheduleSearchParams {
  /** 担当医の Practitioner.id。 */
  practitionerId?: string;
  /** 診察室の Location.id。 */
  locationId?: string;
  /** 使わなくなった枠表は削除せず active=false にするので、既定は有効のみ。 */
  activeOnly?: boolean;
}

const SCHEDULE_COUNT = 20;

export function useScheduleSearch(search: ScheduleSearchParams, offset: number) {
  const params = new URLSearchParams();
  // actor は参照先の型を明示して渡す(既定の参照先は Practitioner)。
  if (search.practitionerId) params.append("actor", `Practitioner/${search.practitionerId}`);
  if (search.locationId) params.append("actor", `Location/${search.locationId}`);
  if (search.activeOnly) params.set("active", "true");
  params.set("_count", String(SCHEDULE_COUNT));
  params.set("_offset", String(offset));

  const query = useQuery({
    queryKey: ["Schedule", "search", search, offset],
    queryFn: () => searchResource<fhir4.Schedule>("Schedule", params),
    placeholderData: keepPreviousData,
  });

  return {
    ...query,
    schedules:
      query.data?.data.entry
        ?.map((e) => e.resource)
        .filter((r): r is fhir4.Schedule => Boolean(r)) ?? [],
    total: query.data?.data.total ?? 0,
    count: SCHEDULE_COUNT,
    hasPrevious: hasRelation(query.data?.data, "previous"),
    hasNext: hasRelation(query.data?.data, "next"),
  };
}

export function useSchedule(id: string | undefined) {
  return useQuery({
    queryKey: ["Schedule", id],
    queryFn: () => readResource<fhir4.Schedule>("Schedule", id as string),
    enabled: Boolean(id),
  });
}

export function useCreateSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (schedule: fhir4.Schedule) => createResource(schedule),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Schedule"] });
    },
  });
}

export function useUpdateSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ schedule, etag }: { schedule: fhir4.Schedule; etag: string }) =>
      updateResource(schedule, etag),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Schedule"] });
    },
  });
}

/**
 * 枠表を削除する。上流は参照整合性を見ないので、先にぶら下がる Slot を消さないと
 * どの枠表にも属さない Slot が残る。予約の入った枠があるときは何も消さずに中断する
 * (予約の取消が先。予約の管理はこの画面の担当ではない)。
 */
export function useDeleteSchedule() {
  const queryClient = useQueryClient();
  const CHUNK = 100;

  return useMutation({
    mutationFn: async (id: string) => {
      const slots = await fetchScheduleSlots(id);
      if (slots.some((slot) => slot.status === "busy" || slot.status === "busy-tentative")) {
        throw new Error(
          "予約が入っている枠があるため削除できません。予約を取り消してから削除してください。",
        );
      }

      for (let i = 0; i < slots.length; i += CHUNK) {
        await postBundle(buildSlotDeleteBundle(slots.slice(i, i + CHUNK)));
      }
      return deleteResource("Schedule", id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Schedule"] });
      queryClient.invalidateQueries({ queryKey: ["Slot"] });
    },
  });
}

// 枠表にぶら下がる Slot。R4 は Slot.end に検索パラメータを定めていないので、
// 期間は start を 2 回並べた AND で表す(上流 README の「空き枠を探す」と同じ形)。
// 1 週間でも 15 分枠なら数百件になるため、次ページが尽きるまで読み切る。
async function fetchScheduleSlots(
  scheduleId: string,
  range?: { from: string; to: string },
  status?: string,
): Promise<fhir4.Slot[]> {
  const PAGE = 100;
  const slots: fhir4.Slot[] = [];

  for (let offset = 0; ; offset += PAGE) {
    const params = new URLSearchParams();
    params.set("schedule", `Schedule/${scheduleId}`);
    if (status) params.set("status", status);
    if (range) {
      params.append("start", `ge${range.from}`);
      params.append("start", `lt${range.to}`);
    }
    params.set("_sort", "start");
    params.set("_count", String(PAGE));
    params.set("_offset", String(offset));

    const { data: bundle } = await searchResource<fhir4.Slot>("Slot", params);
    const page =
      bundle.entry?.map((e) => e.resource).filter((r): r is fhir4.Slot => Boolean(r)) ?? [];
    slots.push(...page);
    if (page.length < PAGE) return slots;
  }
}

export function useSlotWeek(scheduleId: string | undefined, weekStartISO: string) {
  const query = useQuery({
    queryKey: ["Slot", "week", scheduleId, weekStartISO],
    queryFn: () =>
      fetchScheduleSlots(scheduleId as string, {
        from: weekStartISO,
        to: addDays(weekStartISO, 7),
      }),
    enabled: Boolean(scheduleId),
    placeholderData: keepPreviousData,
  });

  return { ...query, slots: query.data ?? [] };
}

/**
 * 一括生成の重複判定に使う、生成対象期間の既存 Slot。カレンダーは 1 週間しか
 * 読んでいないので、月単位で作るときはこちらで期間ぶんを引き直す。
 */
export function useSlotsInRange(
  scheduleId: string | undefined,
  range: { from: string; to: string },
  enabled: boolean,
) {
  const query = useQuery({
    queryKey: ["Slot", "range", scheduleId, range.from, range.to],
    queryFn: () =>
      fetchScheduleSlots(scheduleId as string, {
        from: range.from,
        // 終了日を含めたいので翌日未満で切る。
        to: addDays(range.to, 1),
      }),
    enabled: enabled && Boolean(scheduleId) && Boolean(range.from) && Boolean(range.to),
  });

  return { ...query, slots: query.data ?? [] };
}

/**
 * 曜日パターンから作った Slot をまとめて登録する。1 か月ぶんで数百件になるので、
 * 1 リクエストが大きくなりすぎないよう 100 件ずつの transaction に分けて送る。
 */
export function useGenerateSlots() {
  const queryClient = useQueryClient();
  const CHUNK = 100;

  return useMutation({
    mutationFn: async (slots: fhir4.Slot[]) => {
      for (let i = 0; i < slots.length; i += CHUNK) {
        await postBundle(buildSlotCreateBundle(slots.slice(i, i + CHUNK)));
      }
      return slots.length;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Slot"] });
    },
  });
}

/**
 * 枠の状態を変える(停止 ⇄ 再開)。カレンダーは検索結果の Slot を持っているだけで
 * ETag が無いため、単体 PUT ではなく transaction Bundle で書く
 * (useUpdateRadTaskStatus と同じ理由)。
 */
export function useUpdateSlotStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ slots, status }: { slots: fhir4.Slot[]; status: SlotStatus }) =>
      postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: slots
          .filter((slot) => slot.id)
          .map((slot) => ({
            resource: { ...slot, status },
            request: { method: "PUT" as const, url: `Slot/${slot.id}` },
          })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Slot"] });
    },
  });
}

export function useDeleteSlots() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (slots: fhir4.Slot[]) => postBundle(buildSlotDeleteBundle(slots)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Slot"] });
    },
  });
}

// 予約を取る画面の枠表セレクト。診療科は上流の specialty 検索に頼らず、取得後に
// コードで絞る(枠表は施設あたり数十件の想定で、全件読んでも軽い)。
// 種別(診察予約/検査予約)も同様に取得後に絞る。
export function useScheduleOptions(filter: {
  departmentCode?: string;
  practitionerId?: string;
  scheduleType?: ScheduleType;
}) {
  const params = new URLSearchParams();
  params.set("active", "true");
  if (filter.practitionerId) params.append("actor", `Practitioner/${filter.practitionerId}`);
  params.set("_count", "100");

  const query = useQuery({
    queryKey: ["Schedule", "search", "options", filter.practitionerId ?? ""],
    queryFn: () => searchResource<fhir4.Schedule>("Schedule", params),
  });

  const all =
    query.data?.data.entry
      ?.map((e) => e.resource)
      .filter((r): r is fhir4.Schedule => Boolean(r)) ?? [];

  const byType = filter.scheduleType
    ? all.filter((schedule) => scheduleTypeOf(schedule) === filter.scheduleType)
    : all;

  return {
    ...query,
    schedules: filter.departmentCode
      ? byType.filter((schedule) => {
          const codes =
            schedule.specialty?.flatMap((s) => s.coding?.map((c) => c.code) ?? []) ?? [];
          // 診療科を設定していない枠表は、どの科からも選べる共通の枠として残す
          // (除外すると診療科を「すべて」に戻すまで候補に出ず、気づきにくい)。
          return codes.length === 0 || codes.includes(filter.departmentCode);
        })
      : byType,
  };
}

/**
 * 月ぶんの空き枠。月カレンダーの「その日の空き数」に使う。
 * status=free だけを引くので、予約が埋まるほど軽くなる。
 */
/**
 * 月カレンダーの「その日の空き枠数」バッジ。枠の現物は要らず日付ごとの件数だけ
 * なので、$distinct-dates の件数モードで 1 リクエストにする(15 分枠なら 1 か月で
 * 数百〜千件になるため、全件読んで数える作りだと転送量が大きい)。
 */
export function useFreeSlotCountsOfMonth(
  scheduleId: string | undefined,
  range: { from: string; to: string },
) {
  const query = useQuery({
    queryKey: ["Slot", "month", "free-counts", scheduleId, range.from],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("schedule", `Schedule/${scheduleId}`);
      params.set("status", "free");
      params.append("start", `ge${range.from}`);
      params.append("start", `lt${range.to}`);
      return fetchDateCounts("Slot", params, "start");
    },
    enabled: Boolean(scheduleId),
    placeholderData: keepPreviousData,
  });

  return { ...query, freeCounts: query.data ?? new Map<string, number>() };
}

/** 選んだ日の枠(全ステータス)。時刻ごとの「空き 2/3」を出すのに使う。 */
export function useDaySlots(scheduleId: string | undefined, date: string) {
  const query = useQuery({
    queryKey: ["Slot", "day", scheduleId, date],
    queryFn: () =>
      fetchScheduleSlots(scheduleId as string, { from: date, to: addDays(date, 1) }),
    enabled: Boolean(scheduleId) && Boolean(date),
  });

  return { ...query, slots: query.data ?? [] };
}

// ---- 予約(Appointment) ----

/**
 * その患者の予約。1 患者の予約は当面 100 件を超えない前提でまとめて取り、
 * 並べ替え(新しい順)は画面側で行う(上流の _sort に依存しないため)。
 */
export function useAppointmentSearch(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("patient", `Patient/${patientId}`);
  params.set("_count", "100");
  // 新しい順。上流は同値を id でタイブレークするのでページ送りをまたいでも安定する。
  params.set("_sort", "-date");

  const query = useQuery({
    queryKey: ["Appointment", "search", patientId],
    queryFn: () => searchResource<fhir4.Appointment>("Appointment", params),
    enabled: Boolean(patientId),
  });

  return {
    ...query,
    appointments:
      query.data?.data.entry
        ?.map((e) => e.resource)
        .filter((r): r is fhir4.Appointment => Boolean(r)) ?? [],
  };
}

export function useAppointment(id: string | undefined) {
  return useQuery({
    queryKey: ["Appointment", id],
    queryFn: () => readResource<fhir4.Appointment>("Appointment", id as string),
    enabled: Boolean(id),
  });
}

/**
 * 放射線オーダーに紐づく有効な検査予約(1 オーダーに 1 件)。予約日時の変更は
 * オーダーの編集画面から行うので、編集を開くときに予約の現物を用意しておく。
 */
export function useRadOrderAppointment(srId: string | undefined) {
  const params = new URLSearchParams();
  if (srId) params.set("based-on", `ServiceRequest/${srId}`);

  const query = useQuery({
    queryKey: ["Appointment", "rad-order", srId],
    queryFn: () => searchResource<fhir4.Appointment>("Appointment", params),
    enabled: Boolean(srId),
  });

  return {
    ...query,
    appointment: (query.data?.data.entry ?? [])
      .map((e) => e.resource)
      .filter((r): r is fhir4.Appointment => r?.resourceType === "Appointment")
      .find(isActiveAppointment),
  };
}

// 予約の登録・取消・日時変更。いずれも Appointment と Slot を 1 つの transaction で
// 書く(Bundle の組み立ては appointmentHelpers を参照)。
//
// 取消・変更で空きに戻す枠は、一覧が持っているのは参照だけなので mutation の中で
// 引き直す。Slot の現物が無いと status だけを差し替えた PUT を組めない。
function invalidateAppointments(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["Appointment"] });
  queryClient.invalidateQueries({ queryKey: ["Slot"] });
}

async function fetchAppointmentSlots(appointment: fhir4.Appointment): Promise<fhir4.Slot[]> {
  const results = await Promise.all(
    appointmentSlotIds(appointment).map((id) => readResource<fhir4.Slot>("Slot", id)),
  );
  return results.map((r) => r.data);
}

export function useBookAppointment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ appointment, slots }: { appointment: fhir4.Appointment; slots: fhir4.Slot[] }) =>
      postBundle(buildBookBundle(appointment, slots)),
    onSuccess: () => invalidateAppointments(queryClient),
  });
}

export function useCancelAppointment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (appointment: fhir4.Appointment) =>
      postBundle(buildCancelBundle(appointment, await fetchAppointmentSlots(appointment))),
    onSuccess: () => invalidateAppointments(queryClient),
  });
}

/**
 * 診察予約の日時変更。検査予約(オーダーにぶら下がる予約)の日時は、オーダーヘッダの
 * 撮影日時と同時に動かす必要があるので、この mutation ではなく放射線オーダーの更新
 * (useUpdateRadOrder)に同梱して変える。
 */
export function useRescheduleAppointment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      appointment,
      slots,
    }: {
      appointment: fhir4.Appointment;
      slots: fhir4.Slot[];
    }) =>
      postBundle(
        buildRescheduleBundle(appointment, await fetchAppointmentSlots(appointment), slots),
      ),
    onSuccess: () => invalidateAppointments(queryClient),
  });
}

// ---- 外来一覧(受付ワークリスト) ----
//
// 診察日 1 日ぶんの予約を読み、診療科・医師・診察室・状態での絞り込みは画面側で行う。
// 上流は specialty や actor でも検索できるが、1 日ぶんなら数十件なので、全件読んで
// から絞る方が絞り込みの切り替えで結果がぶれない(放射線検査一覧と同じ理由)。

const OUTPATIENT_PAGE = 100;
// 1 日の予約がこの件数を超えることは想定していない。超えた場合は読むのをやめ、
// 画面に「一部のみ」と出す(黙って切り捨てると全件見えているように見えるため)。
const OUTPATIENT_MAX_PAGES = 5;

/** 外来一覧の 1 行。予約(Appointment)1 件ぶん。 */
export interface OutpatientRow {
  appointment: fhir4.Appointment;
  patient?: fhir4.Patient;
}

export interface OutpatientListResult {
  rows: OutpatientRow[];
  /** 上限まで読んでも読み切れなかった。 */
  truncated: boolean;
}

async function fetchOutpatientList(date: string): Promise<OutpatientListResult> {
  const appointments: fhir4.Appointment[] = [];
  const patientsById = new Map<string, fhir4.Patient>();
  let truncated = false;

  for (let page = 0; page < OUTPATIENT_MAX_PAGES; page += 1) {
    const params = new URLSearchParams();
    // R4 の date は Appointment.start。上流はタイムゾーンを持たない検索値を自身の
    // ローカルタイムゾーン(Asia/Tokyo)で解釈するので、日付をそのまま渡せば
    // 「その日」になる(/metadata の implementation.description に設定が出る)。
    params.set("date", date);
    // 取消・誤登録はその日の外来から外れたものなので上流で落とす。
    params.set("status:not", "cancelled,entered-in-error");
    params.set("_count", String(OUTPATIENT_PAGE));
    params.set("_offset", String(page * OUTPATIENT_PAGE));
    // 患者番号を出すのに患者の現物が要る。
    params.set("_include", "Appointment:patient");

    const { data: bundle } = await searchResource<fhir4.Resource>("Appointment", params);

    let matched = 0;
    for (const entry of bundle.entry ?? []) {
      const resource = entry.resource;
      if (resource?.resourceType === "Appointment") {
        appointments.push(resource as fhir4.Appointment);
        matched += 1;
      } else if (resource?.resourceType === "Patient" && resource.id) {
        patientsById.set(resource.id, resource as fhir4.Patient);
      }
    }

    if (matched < OUTPATIENT_PAGE) break;
    if (page === OUTPATIENT_MAX_PAGES - 1) truncated = true;
  }

  const rows = appointments
    // 検査予約(オーダーにぶら下がる予約)の受付・実施は部門のワークリストが追うので
    // 外来一覧には出さない。これだけは検索パラメータで表せないので画面側で落とす。
    .filter((appointment) => !isExamAppointment(appointment))
    .map((appointment) => ({
      appointment,
      patient: patientsById.get(appointmentActorId(appointment, "Patient")),
    }));

  // 診察の順に並べたいので開始時刻の早い順(予約タブの新しい順とは逆)。
  rows.sort((a, b) => (a.appointment.start ?? "").localeCompare(b.appointment.start ?? ""));

  return { rows, truncated };
}

/** 診察日 1 日ぶんの予約。日付が未選択の間は読みに行かない。 */
export function useOutpatientList(date: string) {
  return useQuery({
    queryKey: ["Appointment", "outpatient", date],
    queryFn: () => fetchOutpatientList(date),
    enabled: Boolean(date),
    placeholderData: keepPreviousData,
  });
}

/**
 * 受付・受付取消を予約の status に書き込む。単体の PUT には If-Match(ETag)が
 * 要るが、一覧は検索結果から Appointment を持っているだけで ETag を持たないので、
 * If-Match の付かない transaction Bundle の PUT で書く(放射線 Task の進捗と同じ)。
 */
export function useUpdateAppointmentStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      appointment,
      status,
    }: {
      appointment: fhir4.Appointment;
      status: fhir4.Appointment["status"];
    }) => {
      // BundleEntry.resource は基底の Resource 型なので、更新後の予約は
      // Appointment として組んでから渡す(直接書くと status が余剰プロパティに
      // なる)。appointmentHelpers の slotEntry と同じ形。
      const updated: fhir4.Appointment = { ...appointment, status };

      return postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: [
          {
            resource: updated,
            request: { method: "PUT", url: `Appointment/${appointment.id}` },
          },
        ],
      });
    },
    onSuccess: () => invalidateAppointments(queryClient),
  });
}

/** 当日受付。枠を持たない予約を受付済で登録する(buildWalkInAppointment を参照)。 */
export function useWalkInCheckIn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (appointment: fhir4.Appointment) => createResource(appointment),
    onSuccess: () => invalidateAppointments(queryClient),
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

// 放射線検査の実施記録(Procedure 一式)。オーダーとは別リソースで、オーダーの検索から
// 辿れないので別に引く。カルテカードの FHIR JSON 表示で使う。
export function useRadPerformDetail(orderId: string | undefined) {
  return useQuery({
    queryKey: ["Procedure", "search", "rad-perform", orderId],
    queryFn: () =>
      searchResource<fhir4.Resource>("Procedure", radPerformSearchParams(orderId ?? "")),
    enabled: Boolean(orderId),
  });
}

// ---- 部門ワークリスト共通 ----
//
// 放射線・検体検査・処方の一覧は、1 日ぶんのオーダー(ヘッダ)を _offset で
// ページングしながら全件読み、患者(_include)と進捗(Task の _revinclude)を
// 同じ応答から回収する、という骨格が共通。ドメインごとの明細の回収と行の
// 組み立てはコールバックで注入する。

const WORKLIST_PAGE = 100;
// 1 日のオーダーがこの件数を超えることは想定していない。超えた場合は読むのをやめ、
// 画面に「一部のみ」と出す(黙って切り捨てると全件見えているように見えるため)。
const WORKLIST_MAX_PAGES = 5;

/**
 * ヘッダ検索の共通パラメータ。呼び出し側でドメインの _revinclude を足す。
 *
 * 日付を当てる先はドメインで違う。放射線・検体検査は実施予定日(撮影日・検査日)を
 * occurrenceDateTime に持つのでそれで引く。処方は実施予定日を持たないので処方日
 * (authoredOn)で引く。
 */
function worklistParams(
  category: string,
  date: string,
  page: number,
  dateParam: "occurrence" | "authoredon" = "authoredon",
): URLSearchParams {
  const params = new URLSearchParams();
  params.set("category", category);
  // occurrenceDateTime は撮影時刻まで持つことがあるが、上流が日付をローカル
  // タイムゾーンで解釈するので、そのまま渡せば「その日の撮影」になる。
  params.set(dateParam, date);
  // 明細はオーダーそのものではないので、ヒットさせるのはヘッダだけにする。
  params.set("based-on:missing", "true");
  params.set("_count", String(WORKLIST_PAGE));
  params.set("_offset", String(page * WORKLIST_PAGE));
  params.set("_include", "ServiceRequest:subject");
  return params;
}

/**
 * ページングしながら全件読む。Patient と Task はここで回収し、それ以外の
 * リソースは collect に渡す(ヘッダとして数えたら true を返す)。
 */
async function fetchWorklistBundles(
  buildParams: (page: number) => URLSearchParams,
  collect: (resource: fhir4.Resource) => boolean,
): Promise<{ patientsById: Map<string, fhir4.Patient>; tasks: fhir4.Task[]; truncated: boolean }> {
  const patientsById = new Map<string, fhir4.Patient>();
  const tasks: fhir4.Task[] = [];
  let truncated = false;

  for (let page = 0; page < WORKLIST_MAX_PAGES; page += 1) {
    const { data: bundle } = await searchResource<fhir4.Resource>(
      "ServiceRequest",
      buildParams(page),
    );

    let matched = 0;
    for (const entry of bundle.entry ?? []) {
      const resource = entry.resource;
      if (!resource) continue;
      if (resource.resourceType === "Patient") {
        if (resource.id) patientsById.set(resource.id, resource as fhir4.Patient);
      } else if (resource.resourceType === "Task") {
        tasks.push(resource as fhir4.Task);
      } else if (collect(resource)) {
        matched += 1;
      }
    }

    if (matched < WORKLIST_PAGE) break;
    if (page === WORKLIST_MAX_PAGES - 1) truncated = true;
  }

  return { patientsById, tasks, truncated };
}

/**
 * 時刻を持たないオーダーの一覧(検体検査・処方)の並び順。患者番号順に並べて
 * 呼び出しや突き合わせで探しやすくする。患者が読めなかった行は末尾へ。
 */
function comparePatientNumber(
  a: { patient?: fhir4.Patient },
  b: { patient?: fhir4.Patient },
): number {
  const aNumber = a.patient?.identifier?.[0]?.value ?? "";
  const bNumber = b.patient?.identifier?.[0]?.value ?? "";
  if (!aNumber || !bNumber) return aNumber ? -1 : bNumber ? 1 : 0;
  return aNumber.localeCompare(bNumber, undefined, { numeric: true });
}

/** Task の書き込み用エントリ。まだ id が無い(新規)なら POST、あれば PUT。 */
function taskBundleEntry(resource: fhir4.Task): fhir4.BundleEntry {
  return {
    resource,
    request: resource.id
      ? { method: "PUT", url: `Task/${resource.id}` }
      : { method: "POST", url: "Task" },
  };
}

/**
 * 受付などの進捗を書き込む hook を作る。Task がまだ無いオーダーでは新しく作る。
 * 単体の PUT ではなく transaction Bundle にするのは、更新に If-Match(ETag)が要る
 * ためで、一覧は検索結果から Task を持っているだけで ETag を持たないため。
 * (実施記録の削除も同時に行う放射線検査は、このファクトリではなく専用の
 * useUpdateRadTaskStatus を持つ。)
 */
function makeUpdateTaskStatusHook<S extends fhir4.Task["status"]>(
  buildUpdate: (
    task: fhir4.Task | undefined,
    order: fhir4.ServiceRequest,
    status: S,
  ) => fhir4.Task,
  worklistKey: string,
) {
  return function useUpdateTaskStatus() {
    const queryClient = useQueryClient();

    return useMutation({
      mutationFn: async ({
        order,
        task,
        status,
      }: {
        order: fhir4.ServiceRequest;
        task: fhir4.Task | undefined;
        status: S;
      }) => {
        const taskEntry = taskBundleEntry(buildUpdate(task, order, status));
        return postBundle({ resourceType: "Bundle", type: "transaction", entry: [taskEntry] });
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["ServiceRequest", worklistKey] });
        // カルテのオーダーカード側の表示にも効くよう、検索キャッシュも読み直させる。
        queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      },
    });
  };
}

// ---- 放射線検査一覧(部門ワークリスト) ----
//
// 撮影日で 1 日ぶんの放射線検査オーダーを読み、モダリティ・入外区分・診療科・
// ステータスでの絞り込みは画面側で行う。上流は診療科・病棟(拡張)や進捗
// (_has:Task:focus:status)でも絞れるようになったが、絞り込みの選択肢をその日の
// オーダーから組み立てている(RadWorklistPage を参照)ため、サーバーで絞ると
// 選んだ値しか候補に出なくなる。1 日ぶんなら数十件なので、全件読んでから絞る方が、
// ページごとに絞り込み結果が変わる作りより扱いやすい。
//
// 撮影日は ServiceRequest.occurrenceDateTime(実施予定日時)で引く。

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

  const { patientsById, tasks, truncated } = await fetchWorklistBundles(
    (page) => {
      const params = worklistParams(
        `${ORDER_TYPE_SYSTEM}|${RAD_ORDER_TYPE.code}`,
        date,
        page,
        "occurrence",
      );
      // 撮影項目も同じ応答に添えてもらう。
      params.set("_revinclude:iterate", "ServiceRequest:based-on");
      params.set("_revinclude", "Task:focus");
      return params;
    },
    (resource) => {
      if (resource.resourceType !== "ServiceRequest") return false;
      const request = resource as fhir4.ServiceRequest;
      // 検索にヒットしたヘッダと、添えられた明細を分ける。
      if (isRadServiceRequest(request) && !request.basedOn?.length) {
        orders.push(request);
        return true;
      }
      items.push(request);
      return false;
    },
  );

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
function radPerformSearchParams(orderId: string): URLSearchParams {
  const params = new URLSearchParams();
  params.set("based-on", `ServiceRequest/${orderId}`);
  params.set("_count", "100");
  params.append("_revinclude", "MedicationAdministration:part-of");
  params.append("_revinclude", "Observation:part-of");
  return params;
}

async function fetchRadPerformResources(orderId: string) {
  const { data: bundle } = await searchResource<fhir4.Resource>(
    "Procedure",
    radPerformSearchParams(orderId),
  );

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
      const taskEntry = taskBundleEntry(buildRadTaskUpdate(task, order, status));

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
      // 取消では実施記録も消しているので、FHIR JSON 表示の実施記録も引き直させる。
      queryClient.invalidateQueries({ queryKey: ["Procedure", "search"] });
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
      queryClient.invalidateQueries({ queryKey: ["Procedure", "search"] });
    },
  });
}

// ---- 検体検査一覧(部門ワークリスト) ----
//
// 検査日(検体を採る日)で 1 日ぶんの検体検査オーダーを読む。作りは放射線検査一覧と
// 同じで、検体・入外区分・診療科での絞り込みは画面側で行う(理由は放射線検査一覧の
// 節のコメントを参照)。
//
// 検査日は ServiceRequest.occurrenceDateTime(実施予定日時)で引く。

/** 検体検査一覧の 1 行。オーダー(ヘッダ)1 件ぶん。 */
export interface LabWorklistRow {
  order: fhir4.ServiceRequest;
  /** 検査項目(明細)。パネルの構成項目まで含む平坦な一覧。 */
  itemRequests: fhir4.ServiceRequest[];
  patient?: fhir4.Patient;
  /** 進捗。部門がまだ触っていないオーダーには無い(= 依頼済)。 */
  task?: fhir4.Task;
  /** 管(ラベル発行が作った Specimen)。発行・到着の状況表示に使う。 */
  specimens: fhir4.Specimen[];
  /** このオーダーを元に登録済みの検査結果の id。空なら結果はまだ無い。 */
  reportId: string;
}

export interface LabWorklistResult {
  rows: LabWorklistRow[];
  /** 上限まで読んでも読み切れなかった。 */
  truncated: boolean;
}

async function fetchLabWorklist(date: string): Promise<LabWorklistResult> {
  const orders: fhir4.ServiceRequest[] = [];
  const items: fhir4.ServiceRequest[] = [];
  const specimens: fhir4.Specimen[] = [];
  // オーダー id → そのオーダーを元にした検査結果の id(結果登録が済んだかの判定用)。
  const reportIdByOrderId = new Map<string, string>();

  const { patientsById, tasks, truncated } = await fetchWorklistBundles(
    (page) => {
      const params = worklistParams(
        `${ORDER_TYPE_SYSTEM}|${LAB_ORDER_TYPE.code}`,
        date,
        page,
        "occurrence",
      );
      // 検査項目・管(発行済み Specimen)・検査結果も同じ応答に添えてもらう。
      params.set("_revinclude:iterate", "ServiceRequest:based-on");
      params.append("_revinclude", "Task:focus");
      params.append("_revinclude", "Specimen:request");
      params.append("_revinclude", "DiagnosticReport:based-on");
      return params;
    },
    (resource) => {
      if (resource.resourceType === "Specimen") {
        specimens.push(resource as fhir4.Specimen);
      } else if (resource.resourceType === "DiagnosticReport") {
        const report = resource as fhir4.DiagnosticReport;
        for (const reference of report.basedOn ?? []) {
          const orderId = reference.reference?.match(/^ServiceRequest\/(.+)$/)?.[1];
          if (orderId && report.id) reportIdByOrderId.set(orderId, report.id);
        }
      } else if (resource.resourceType === "ServiceRequest") {
        const request = resource as fhir4.ServiceRequest;
        // 検索にヒットしたヘッダと、添えられた明細を分ける。
        if (isLabServiceRequest(request) && !request.basedOn?.length) {
          orders.push(request);
          return true;
        }
        items.push(request);
      }
      return false;
    },
  );

  const labTaskByOrderId = labTasksByOrderId(tasks);
  const specimensByOrderId = labelSpecimensByOrderId(specimens);

  const rows = orders.map((order) => ({
    order,
    itemRequests: labOrderItemRequests(items, order.id ?? ""),
    patient: patientsById.get(order.subject?.reference?.split("/").pop() ?? ""),
    task: labTaskByOrderId.get(order.id ?? ""),
    specimens: specimensByOrderId.get(order.id ?? "") ?? [],
    reportId: reportIdByOrderId.get(order.id ?? "") ?? "",
  }));

  // 検体検査オーダーは時刻を持たない(検査日だけ)ので、患者番号順に並べる。
  rows.sort(comparePatientNumber);

  return { rows, truncated };
}

/** 検査日 1 日ぶんの検体検査オーダー。日付が未選択の間は読みに行かない。 */
export function useLabWorklist(date: string) {
  return useQuery({
    queryKey: ["ServiceRequest", "lab-worklist", date],
    queryFn: () => fetchLabWorklist(date),
    enabled: Boolean(date),
    placeholderData: keepPreviousData,
  });
}

/** 受付などの進捗を書き込む(組み立ては makeUpdateTaskStatusHook を参照)。 */
export const useUpdateLabTaskStatus = makeUpdateTaskStatusHook<LabTaskStatus>(
  buildLabTaskUpdate,
  "lab-worklist",
);

// ---- 処方一覧(部門ワークリスト) ----
//
// 処方日で 1 日ぶんの処方オーダーを読む。画面の作りは検体検査一覧と同じで、
// 入外区分・処方区分・診療科での絞り込みは画面側で行う(理由は検体検査一覧の節の
// コメントを参照)。処方は実施予定日を持たないので、日付は処方日(authoredOn)で引く。
//
// 処方オーダーはオーダー種別(order-type)を持たない(注射より前から存在するため)ので、
// 検体検査・放射線検査のように種別コードでは引けない。代わりに処方オーダーだけが持つ
// 処方区分の CodeSystem を system だけ指定して引く(FHIR token 検索の `system|` 形式)。

/** 処方一覧の 1 行。オーダー(ヘッダ)1 件ぶん。 */
export interface RxWorklistRow {
  order: fhir4.ServiceRequest;
  /** 処方明細。RP ごとの用法・医薬品はここから組み立てる(groupByRp)。 */
  medicationRequests: fhir4.MedicationRequest[];
  patient?: fhir4.Patient;
  /** 進捗。部門がまだ触っていないオーダーには無い(= 依頼済)。 */
  task?: fhir4.Task;
}

export interface RxWorklistResult {
  rows: RxWorklistRow[];
  /** 上限まで読んでも読み切れなかった。 */
  truncated: boolean;
}

async function fetchRxWorklist(date: string): Promise<RxWorklistResult> {
  const orders: fhir4.ServiceRequest[] = [];
  const medicationRequests: fhir4.MedicationRequest[] = [];

  const { patientsById, tasks, truncated } = await fetchWorklistBundles(
    (page) => {
      // 処方オーダーはオーダー種別(order-type)を持たない(注射より前から存在する)ので、
      // 処方オーダーだけが持つ処方区分の CodeSystem を system だけ指定して引く
      // (FHIR token 検索の `system|` 形式。注射は別の CodeSystem なので混ざらない)。
      const params = worklistParams(`${PRESCRIPTION_CATEGORY_SYSTEM}|`, date, page);
      // 処方明細も同じ応答に添えてもらう。
      params.set("_revinclude", "MedicationRequest:based-on");
      params.append("_revinclude", "Task:focus");
      return params;
    },
    (resource) => {
      if (resource.resourceType === "MedicationRequest") {
        medicationRequests.push(resource as fhir4.MedicationRequest);
      } else if (resource.resourceType === "ServiceRequest") {
        const request = resource as fhir4.ServiceRequest;
        // 検索で絞り込んではいるが、オーダー種別を持たないことも確かめてから並べる
        // (注射・検体検査が処方として混ざらないようにする最後の砦)。
        if (isPrescriptionServiceRequest(request) && !request.basedOn?.length) {
          orders.push(request);
          return true;
        }
      }
      return false;
    },
  );

  const rxTaskByOrderId = rxTasksByOrderId(tasks);
  const medicationRequestsByOrderId = new Map<string, fhir4.MedicationRequest[]>();
  for (const mr of medicationRequests) {
    for (const reference of mr.basedOn ?? []) {
      const orderId = reference.reference?.match(/^ServiceRequest\/(.+)$/)?.[1];
      if (!orderId) continue;
      const list = medicationRequestsByOrderId.get(orderId);
      if (list) list.push(mr);
      else medicationRequestsByOrderId.set(orderId, [mr]);
    }
  }

  const rows = orders.map((order) => ({
    order,
    medicationRequests: medicationRequestsByOrderId.get(order.id ?? "") ?? [],
    patient: patientsById.get(order.subject?.reference?.split("/").pop() ?? ""),
    task: rxTaskByOrderId.get(order.id ?? ""),
  }));

  // 処方オーダーは時刻を持たない(処方日だけ)ので、患者番号順に並べる(検体検査と同じ)。
  rows.sort(comparePatientNumber);

  return { rows, truncated };
}

/** 処方日 1 日ぶんの処方オーダー。日付が未選択の間は読みに行かない。 */
export function useRxWorklist(date: string) {
  return useQuery({
    queryKey: ["ServiceRequest", "rx-worklist", date],
    queryFn: () => fetchRxWorklist(date),
    enabled: Boolean(date),
    placeholderData: keepPreviousData,
  });
}

/** 処方箋発行などの進捗を書き込む(組み立ては makeUpdateTaskStatusHook を参照)。 */
export const useUpdateRxTaskStatus = makeUpdateTaskStatusHook<RxTaskStatus>(
  buildRxTaskUpdate,
  "rx-worklist",
);

/**
 * 調剤登録。調剤結果(MedicationDispense)と調剤済の Task を 1 つの transaction で
 * 書き込む。Bundle の組み立ては rxDispenseHelpers を参照。
 */
export function useRegisterRxDispense() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "rx-worklist"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["MedicationDispense"] });
    },
  });
}

/**
 * 検体到着確認のための 1 オーダーぶんの文脈。スキャンした番号の逆引き結果
 * (order id)から、患者・検査項目・進捗を 1 リクエストで揃える
 * (docs/lab-arrival-design.md §4-1。_id 検索 + revinclude は上流で確認済み)。
 */
export interface LabArrivalContext {
  order: fhir4.ServiceRequest;
  itemRequests: fhir4.ServiceRequest[];
  patient?: fhir4.Patient;
  task?: fhir4.Task;
  /** 管(ラベル発行が作った Specimen)。到着の揃い判定に使う。 */
  specimens: fhir4.Specimen[];
}

export async function fetchLabArrivalContext(orderId: string): Promise<LabArrivalContext | null> {
  const params = new URLSearchParams();
  params.set("_id", orderId);
  params.set("_count", "100");
  params.set("_revinclude:iterate", "ServiceRequest:based-on");
  params.append("_revinclude", "Task:focus");
  params.append("_revinclude", "Specimen:request");
  params.set("_include", "ServiceRequest:subject");

  const { data: bundle } = await searchResource<fhir4.Resource>("ServiceRequest", params);

  let order: fhir4.ServiceRequest | undefined;
  const items: fhir4.ServiceRequest[] = [];
  const tasks: fhir4.Task[] = [];
  const specimens: fhir4.Specimen[] = [];
  let patient: fhir4.Patient | undefined;
  for (const entry of bundle.entry ?? []) {
    const resource = entry.resource;
    if (!resource) continue;
    if (resource.resourceType === "Patient") patient = resource as fhir4.Patient;
    else if (resource.resourceType === "Task") tasks.push(resource as fhir4.Task);
    else if (resource.resourceType === "Specimen") specimens.push(resource as fhir4.Specimen);
    else if (resource.resourceType === "ServiceRequest") {
      const request = resource as fhir4.ServiceRequest;
      if (request.id === orderId) order = request;
      else items.push(request);
    }
  }
  if (!order) return null;

  return {
    order,
    itemRequests: labOrderItemRequests(items, orderId),
    patient,
    task: labTasksByOrderId(tasks).get(orderId),
    specimens: labelSpecimensByOrderId(specimens).get(orderId) ?? [],
  };
}

/** ラベル番号から管(Specimen)を引く。到着確認のスキャン逆引き。 */
export async function fetchLabelSpecimenByNumber(number: string): Promise<fhir4.Specimen | null> {
  const params = new URLSearchParams();
  params.set("accession", `${LAB_LABEL_NUMBER_SYSTEM}|${number}`);

  const { data: bundle } = await searchResource<fhir4.Specimen>("Specimen", params);
  const specimen = (bundle.entry ?? [])
    .map((entry) => entry.resource)
    .find((resource): resource is fhir4.Specimen => resource?.resourceType === "Specimen");
  return specimen ?? null;
}

/** オーダーの管(ラベル発行が作った Specimen)の一覧。orderId が空なら空配列。 */
export async function fetchLabelSpecimens(orderId: string): Promise<fhir4.Specimen[]> {
  if (!orderId) return [];
  const params = new URLSearchParams();
  params.set("request", `ServiceRequest/${orderId}`);
  params.set("_count", "100");

  const { data: bundle } = await searchResource<fhir4.Specimen>("Specimen", params);
  return (bundle.entry ?? [])
    .map((entry) => entry.resource)
    .filter((resource): resource is fhir4.Specimen => resource?.resourceType === "Specimen")
    .filter(isLabelSpecimen);
}

/**
 * 検体到着の記録・取消。管の Specimen(receivedTime)と、必要ならオーダーの進捗
 * (Task)を 1 つの transaction で書き込む。transaction なのは ETag を持たないため
 * (useUpdateLabTaskStatus と同じ)に加え、「最後の管の到着」と「実施済への遷移」が
 * 片方だけ成功する事態を避けるため。
 */
export function useUpdateLabArrival() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      specimen,
      cancel,
      recorder,
      taskUpdate,
    }: {
      specimen: fhir4.Specimen;
      cancel?: boolean;
      recorder?: ArrivalRecorder;
      taskUpdate?: {
        order: fhir4.ServiceRequest;
        task: fhir4.Task | undefined;
        status: LabTaskStatus;
      };
    }) => {
      const resource = cancel
        ? buildSpecimenArrivalCancel(specimen)
        : buildSpecimenArrival(specimen, recorder);
      const entries: fhir4.BundleEntry[] = [
        { resource, request: { method: "PUT", url: `Specimen/${specimen.id}` } },
      ];
      if (taskUpdate) {
        const task = buildLabTaskUpdate(taskUpdate.task, taskUpdate.order, taskUpdate.status);
        entries.push({
          resource: task,
          request: task.id
            ? { method: "PUT", url: `Task/${task.id}` }
            : { method: "POST", url: "Task" },
        });
      }
      return postBundle({ resourceType: "Bundle", type: "transaction", entry: entries });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "lab-worklist"] });
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
  /** オーダーの依頼科。紐付けた検査結果の診療科として採用する。 */
  departmentId: string;
  departmentName: string;
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
        ...departmentOf(header),
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

// 検体採取日の降順で全検査結果の要約(id・採取日・入外区分)を取得する。
// 上流の _sort は同値時に id 昇順で安定するため、ページ境界をまたいでも並びが一致する。
// category は検体検査(LAB)・細菌検査(MB)の別。
async function fetchLabResultSummaries(
  patientId: string,
  category: string,
): Promise<LabResultSummary[]> {
  const summaries: LabResultSummary[] = [];

  for (let page = 0; page < LAB_RESULT_ORDER_MAX_PAGES; page += 1) {
    const params = new URLSearchParams();
    params.set("patient", `Patient/${patientId}`);
    params.set("category", category);
    params.set("_count", String(LAB_RESULT_ORDER_PAGE));
    params.set("_offset", String(page * LAB_RESULT_ORDER_PAGE));
    params.set("_sort", "-date");
    // 要約に使う要素だけ返させ、検査項目の参照(result)などの本文は省く。
    // 上流の _elements はトップレベルの JSON キー名の一致で切り出すため、
    // choice 型は基底名(effective)ではなく実際のキー名で指定する。
    // extension は診療科(ローカル拡張)を要約に含めるために要る。
    params.set("_elements", "id,effectiveDateTime,category,extension");

    const { data: bundle } = await searchResource<fhir4.DiagnosticReport>(
      "DiagnosticReport",
      params,
    );
    const pageReports =
      bundle.entry
        ?.map((entry) => entry.resource)
        .filter((r): r is fhir4.DiagnosticReport => Boolean(r?.id)) ?? [];
    summaries.push(...pageReports.map(summarizeDiagnosticReport));

    if (pageReports.length < LAB_RESULT_ORDER_PAGE) break;
  }

  return summaries;
}

// 検体採取日ペイン・内容ページの「前へ/次へ」の双方で使う検査結果の並び。
function useResultSummariesQuery(category: string, patientId: string | undefined) {
  // 作成・更新・削除時の invalidateQueries(["DiagnosticReport", "search"]) で
  // まとめて無効化されるよう search 配下のキーにしている。
  return useQuery({
    queryKey: ["DiagnosticReport", "search", "order", category, patientId],
    queryFn: () => fetchLabResultSummaries(patientId as string, category),
    enabled: Boolean(patientId),
    // 前後移動のたびにページが再マウントされるため、連打で毎回引き直さないよう
    // 少しだけ寝かせる。更新・削除時は invalidateQueries 側で無効化される。
    staleTime: 30_000,
  });
}

/** 検査結果タブの検体採取日ペイン用。全検査結果の要約を新しい順で返す。 */
export function useLabResultEntries(patientId: string | undefined) {
  const query = useResultSummariesQuery("LAB", patientId);
  return {
    entries: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
  };
}

/** 細菌検査タブの検体採取日ペイン用。全細菌検査結果の要約を新しい順で返す。 */
export function useMicroResultEntries(patientId: string | undefined) {
  const query = useResultSummariesQuery("MB", patientId);
  return {
    entries: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
  };
}

// ---- $distinct-dates(サーバー集計) ----

/** 実行環境のタイムゾーンオフセット("+09:00" 形式)。$distinct-dates の日境界に使う。 */
function localTimezoneOffset(): string {
  const minutes = -new Date().getTimezoneOffset();
  const sign = minutes >= 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

interface DistinctDatesResult {
  /** 新しい順。precision=day なら "2026-08-23"、full なら UTC の dateTime。 */
  dates: string[];
  /** 対象パラメータの値を持たないリソースが 1 件でもあるか。 */
  hasUndated: boolean;
}

/**
 * GET /<型>/$distinct-dates。ある date 検索パラメータが取る値の重複なし集合を
 * サーバー集計で取得する(上流の独自 operation)。「診療日の一覧」「直近 N 回分の
 * 採取日」を作るために全リソースを読み切って日付だけ拾っていたページングを置き換える。
 */
async function fetchDistinctDates(
  resourceType: string,
  params: URLSearchParams,
  dateParam: string,
  options: { precision?: "day" | "full"; limit?: number } = {},
): Promise<DistinctDatesResult> {
  params.set("date-param", dateParam);
  // day(既定)はローカルの日付に丸める。full は dateTime の実値(経過表の列)。
  if (options.precision === "full") params.set("precision", "full");
  else params.set("timezone", localTimezoneOffset());
  if (options.limit) params.set("limit", String(options.limit));

  const { data } = await typeOperation<fhir4.Parameters>(resourceType, "distinct-dates", params);
  const dates: string[] = [];
  let hasUndated = false;
  for (const parameter of data.parameter ?? []) {
    if (parameter.name === "date") {
      const value = parameter.valueDate ?? parameter.valueDateTime;
      if (value) dates.push(value);
    } else if (parameter.name === "undated") {
      hasUndated = Boolean(parameter.valueBoolean);
    }
  }
  return { dates, hasUndated };
}

/**
 * 同じ operation の件数モード(count=true)。日付 -> 件数の Map を返す。
 * 応答は Parameters の不変条件(value と part は排他)により part 形式になる。
 */
async function fetchDateCounts(
  resourceType: string,
  params: URLSearchParams,
  dateParam: string,
): Promise<Map<string, number>> {
  params.set("date-param", dateParam);
  params.set("timezone", localTimezoneOffset());
  params.set("count", "true");

  const { data } = await typeOperation<fhir4.Parameters>(resourceType, "distinct-dates", params);
  const counts = new Map<string, number>();
  for (const parameter of data.parameter ?? []) {
    if (parameter.name !== "date") continue;
    const date = parameter.part?.find((p) => p.name === "value")?.valueDate;
    const count = parameter.part?.find((p) => p.name === "count")?.valueInteger;
    if (date && count !== undefined) counts.set(date, count);
  }
  return counts;
}

// ---- 時系列表示 ----

// 上流 fhir-server の _count 上限 100 を 1 ページとして順に辿る。
const LAB_TIMELINE_PAGE = 100;
// 同一期間内の件数が極端に多い場合の暴走防止。
const LAB_TIMELINE_MAX_PAGES = 10;

export interface LabTimelineResources {
  reports: fhir4.DiagnosticReport[];
  observations: fhir4.Observation[];
}

// 時系列表示は「直近 dateCount 回分の検体採取日」を横軸にする。
// まず $distinct-dates で直近 dateCount 個の採取日を集計し、いちばん古い採取日
// 以降のレポートを Observation ごと(_include)取得する。以前は採取日が
// dateCount+1 個現れるまで全件をページングしていた(最悪 10 リクエスト +
// 全 Observation の転送)が、これで通常 2 リクエストに収まる。
async function fetchLabTimelineResources(
  patientId: string,
  dateCount: number,
): Promise<LabTimelineResources> {
  const dateParams = new URLSearchParams();
  dateParams.set("patient", `Patient/${patientId}`);
  dateParams.set("category", "LAB");
  const { dates } = await fetchDistinctDates("DiagnosticReport", dateParams, "date", {
    limit: dateCount,
  });
  if (dates.length === 0) return { reports: [], observations: [] };

  // 上流は日付をローカルタイムゾーンで解釈するので、下限はその日の 0 時になる。
  const oldest = dates[dates.length - 1];
  const reports: fhir4.DiagnosticReport[] = [];
  const observations: fhir4.Observation[] = [];

  for (let page = 0; page < LAB_TIMELINE_MAX_PAGES; page += 1) {
    const params = new URLSearchParams();
    params.set("patient", `Patient/${patientId}`);
    params.set("category", "LAB");
    params.set("date", `ge${oldest}`);
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
        reports.push(resource as fhir4.DiagnosticReport);
      } else if (resource?.resourceType === "Observation") {
        observations.push(resource as fhir4.Observation);
      }
    }

    if (pageReports < LAB_TIMELINE_PAGE) break;
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
    // オーダーに紐付く結果は、ラベル発行が作った管の Specimen を参照するので、
    // 組み立ての前にオーダーの管を引く(labResultHelpers の planSpecimens を参照)。
    mutationFn: async ({ values, patientId }: { values: LabResultFormValues; patientId: string }) => {
      const labelSpecimens = await fetchLabelSpecimens(values.orderId);
      return postBundle(buildLabResultBundle(values, patientId, labelSpecimens));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
    },
  });
}

export function useUpdateLabResult() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      values,
      patientId,
      reportId,
      originalObservationIds,
      originalSpecimens,
    }: {
      values: LabResultFormValues;
      patientId: string;
      reportId: string;
      originalObservationIds: string[];
      originalSpecimens: SpecimenRef[];
    }) => {
      const labelSpecimens = await fetchLabelSpecimens(values.orderId);
      return postBundle(
        buildLabResultUpdateBundle(
          values,
          patientId,
          reportId,
          originalObservationIds,
          originalSpecimens,
          labelSpecimens,
        ),
      );
    },
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
      // 削除対象の Observation / Specimen は詳細と同じ検索で実体ごと引く。
      // Specimen は結果側が所有するものだけを消す(ラベル由来はオーダー側の
      // 台帳なので、結果を消しても発行・到着の記録は残す)。
      const params = new URLSearchParams();
      params.set("_id", reportId);
      params.append("_include", "DiagnosticReport:result");
      params.append("_include", "DiagnosticReport:specimen");
      const { data: bundle } = await searchResource<fhir4.Resource>("DiagnosticReport", params);
      const { report, specimens } = splitLabResultDetailBundle(bundle);
      if (!report) throw new Error("検査結果が見つかりません");
      const ownedSpecimenIds = specimens
        .filter((s) => !isLabelSpecimen(s))
        .map((s) => s.id)
        .filter((id): id is string => Boolean(id));
      return postBundle(
        buildLabResultDeleteBundle(reportId, observationIdsFromReport(report), ownedSpecimenIds),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
    },
  });
}

// ---- 細菌検査結果 ----

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

// 版履歴の取得件数。1 つの記録がこれを超えて修正されることは想定していない。
const HISTORY_COUNT = 50;

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


/**
 * 診療記録の版履歴。「いつ誰が何を直したか」を辿るために使う。
 * クエリキーを ["Composition", id] 配下に置き、更新の invalidate が効くようにする。
 */
export function useClinicalNoteHistory(id: string | undefined, enabled: boolean) {
  const query = useQuery({
    queryKey: ["Composition", id, "history"],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("_count", String(HISTORY_COUNT));
      const { data: bundle } = await readHistory<fhir4.Composition>(
        "Composition",
        id as string,
        params,
      );
      return bundle;
    },
    enabled: Boolean(id) && enabled,
  });

  return {
    ...query,
    // 上流の _history は新しい版から返す(回帰 spec で固定済み)。
    versions: (query.data?.entry ?? [])
      .map((e) => e.resource)
      .filter((r): r is fhir4.Composition => r?.resourceType === "Composition"),
  };
}

export function useClinicalNote(id: string | undefined) {
  return useQuery({
    queryKey: ["Composition", id],
    queryFn: () => readResource<fhir4.Composition>("Composition", id as string),
    enabled: Boolean(id),
  });
}

/**
 * Bundle エントリのうち、既存の QuestionnaireResponse を書き換える/消すものの id。
 * その回答から前回生成した Observation は作り直し(または道連れ削除)の対象になる。
 * 新規記入(urn:uuid で POST)は前回の生成物を持たないので含まない。
 */
function refreshedResponseIds(entries: fhir4.BundleEntry[]): string[] {
  const ids = new Set<string>();
  for (const entry of entries) {
    const method = entry.request?.method;
    if (method !== "PUT" && method !== "DELETE") continue;
    const id = entry.request?.url?.match(/^QuestionnaireResponse\/(.+)$/)?.[1];
    if (id) ids.add(id);
  }
  return [...ids];
}

/** 上記の回答から前回生成した Observation を消す DELETE エントリ。 */
async function staleObservationEntries(entries: fhir4.BundleEntry[]): Promise<fhir4.BundleEntry[]> {
  const refs = await fetchDerivedObservationRefs(refreshedResponseIds(entries));
  return refs.map((reference) => ({
    request: { method: "DELETE" as const, url: reference },
  }));
}

// entries はテンプレート記載の QuestionnaireResponse(とそのシェーマ画像 Binary、
// 回答から生成した Observation)。診療記録本体と同じ transaction Bundle で保存する
// — 先行 POST すると本体を保存しなかったときに QR だけが孤児として残るため
// (saveWithImages と同じ設計)。
//
// 記載を編集し直したときは、前回その回答から生成した Observation を消してから
// 作り直す(単独登録のテンプレート回答と同じ方式。項目と Observation を 1 対 1 で
// 対応付けて差分更新すると、テンプレート側のコード変更で対応が崩れる)。
async function saveClinicalNote(
  composition: fhir4.Composition,
  entries: fhir4.BundleEntry[],
  etag?: string,
): Promise<FhirResult<fhir4.Composition>> {
  const stale = await staleObservationEntries(entries);
  return saveWithImages(composition, [...stale, ...entries], etag);
}

export function useCreateClinicalNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      composition,
      entries,
    }: {
      composition: fhir4.Composition;
      entries: fhir4.BundleEntry[];
    }) => saveClinicalNote(composition, entries),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Composition", "search"] });
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse", "search"] });
      queryClient.invalidateQueries({ queryKey: ["Observation", "search"] });
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
    }) => saveClinicalNote(composition, entries, etag),
    onSuccess: (result: FhirResult<fhir4.Composition>) => {
      queryClient.invalidateQueries({ queryKey: ["Composition", "search"] });
      queryClient.invalidateQueries({ queryKey: ["Composition", result.data.id] });
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse"] });
      queryClient.invalidateQueries({ queryKey: ["Observation", "search"] });
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
        // 消す回答から生成した Observation も道連れにする(由来を辿れない
        // Observation だけが残らないように)。
        const stale = await staleObservationEntries(bundle.entry ?? []);
        await postBundle({ ...bundle, entry: [...stale, ...(bundle.entry ?? [])] });
      } else {
        await deleteResource("Composition", id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Composition", "search"] });
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse"] });
      queryClient.invalidateQueries({ queryKey: ["Observation", "search"] });
    },
  });
}

const ALLERGY_COUNT = 20;

export function useAllergySearch(patientId: string | undefined, offset: number) {
  const params = new URLSearchParams();
  if (patientId) params.set("patient", `Patient/${patientId}`);
  params.set("_count", String(ALLERGY_COUNT));
  params.set("_offset", String(offset));
  // 一覧に出しているのは記録日なので、並べ替えも記録日の降順で揃える
  // (発症日で並べたい画面ができたら上流の `onset` 検索パラメータが使える)。
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

/**
 * 同じテンプレートに対する直近の回答。新規登録画面の「前回の回答を複写」に使う。
 *
 * canonical("<url>|<version>")の完全一致で引くので、テンプレートのバージョンを
 * 上げると前回の回答は見つからなくなる。設問が変わっていれば回答の対応も崩れる
 * ため、版をまたいで複写しないのは意図した動作。
 * クエリキーを ["QuestionnaireResponse", "search"] 配下に置き、登録・更新・削除の
 * invalidate がそのまま効くようにする。
 */
export function useLatestQuestionnaireResponse(
  patientId: string | undefined,
  canonical: string | undefined,
) {
  const query = useQuery({
    queryKey: ["QuestionnaireResponse", "search", "latest", patientId, canonical],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      params.set("questionnaire", canonical as string);
      params.set("_sort", "-authored");
      params.set("_count", "1");
      const { data: bundle } = await searchResource<fhir4.QuestionnaireResponse>(
        "QuestionnaireResponse",
        params,
      );
      return bundle.entry?.[0]?.resource;
    },
    enabled: Boolean(patientId && canonical),
  });

  return { ...query, latest: query.data };
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

/**
 * これらの回答から生成した Observation の参照。回答を更新・削除するときに、前回の
 * 生成物を消すために引く(Observation.derivedFrom が唯一の根拠)。
 * 複数の回答はカンマ区切り(OR)の 1 検索でまとめて引く。1 回答あたりの項目数は
 * 多くても数十、1 記載あたりのテンプレート数も数個なので 1 ページで足りる。
 */
async function fetchDerivedObservationRefs(responseIds: string[]): Promise<string[]> {
  const ids = responseIds.filter(Boolean);
  if (ids.length === 0) return [];
  const params = new URLSearchParams();
  params.set("derived-from", ids.map((id) => `QuestionnaireResponse/${id}`).join(","));
  params.set("_elements", "id");
  params.set("_count", "100");
  const { data } = await searchResource<fhir4.Observation>("Observation", params);
  return (data.entry ?? [])
    .map((entry) => entry.resource?.id)
    .filter((id): id is string => Boolean(id))
    .map((id) => `Observation/${id}`);
}

// 回答から Observation を生成するテンプレートは、回答・画像・Observation を 1 つの
// transaction で書く。生成しないテンプレートは従来どおりの保存経路のまま
// (無駄に Bundle にしない)。ただし抽出を後から無効にしたテンプレートでは、前回
// 生成した Observation を消すために Bundle 経路へ回る。
async function saveResponse(
  questionnaire: fhir4.Questionnaire,
  response: fhir4.QuestionnaireResponse,
  imageEntries?: fhir4.BundleEntry[],
  etag?: string,
): Promise<FhirResult<fhir4.QuestionnaireResponse>> {
  const extracts = observationExtractEnabled(questionnaire);
  const existingObservationRefs = response.id ? await fetchDerivedObservationRefs([response.id]) : [];
  if (!extracts && !existingObservationRefs.length) {
    return saveWithImages(response, imageEntries, etag);
  }

  const { data: bundle } = await postBundle(
    responseSaveBundle({ questionnaire, response, imageEntries, etag, existingObservationRefs }),
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
    }: {
      questionnaire: fhir4.Questionnaire;
      response: fhir4.QuestionnaireResponse;
      etag: string;
      imageEntries?: fhir4.BundleEntry[];
    }) => saveResponse(questionnaire, response, imageEntries, etag),
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
      const id = response.id ?? "";
      const observationRefs = await fetchDerivedObservationRefs([id]);
      if (!observationRefs.length) return deleteResource("QuestionnaireResponse", id);
      await postBundle(responseDeleteBundle(id, observationRefs));
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

// 先読み(日付未定・未来の予定)の取得上限。どちらも未処理の仕事なので溜まらない前提。
const KARTE_PENDING_COUNT = 100;

/**
 * カードを実施予定日(occurrence)の位置に出すオーダー種別。診療日ペインの日付も
 * ここに挙げた種別だけ occurrence から数える(karteTimeline の orderCardDay と対)。
 *
 * 細菌検査は occurrence を書いていないので入れない(authoredOn で数える)。
 * 処方・注射はそもそも実施予定日の概念を持たない。
 */
const OCCURRENCE_ORDER_TYPES = [
  LAB_ORDER_TYPE.code,
  RAD_ORDER_TYPE.code,
  PHYSIO_ORDER_TYPE.code,
  ENDOSCOPY_ORDER_TYPE.code,
  TREATMENT_ORDER_TYPE.code,
  SURGERY_ORDER_TYPE.code,
  // 食事は開始日(occurrence)にカードを出す。オーダー日は「いつ指示したか」で、
  // 食事そのものは開始日から始まるため。
  MEAL_ORDER_TYPE.code,
  // 病理は採取(予定)日にカードを出す。検体を採る日が病理部門の作業の起点で、
  // 部門一覧もその日付で引くため(細菌検査と違い occurrence を必ず書く)。
  PATHO_ORDER_TYPE.code,
  // 輸血は投与予定日にカードを出す。輸血部門の一覧もその日付で引く。
  TRANSFUSION_ORDER_TYPE.code,
];

const OCCURRENCE_ORDER_TYPE_TOKENS = OCCURRENCE_ORDER_TYPES.map(
  (code) => `${ORDER_TYPE_SYSTEM}|${code}`,
).join(",");

// _include / _revinclude の関連リソースも entry に混ざるため、次ページのオフセットは
// entry 数ではなく _count 固定で進める。
function karteNextOffset(bundle: fhir4.Bundle | undefined, lastOffset: number): number | undefined {
  return hasRelation(bundle, "next") ? lastOffset + KARTE_PAGE : undefined;
}

/**
 * プロブレム絞り込みの検索値。3 リソースとも参照検索なので、カンマ区切りで OR に
 * なる(親プロブレムを選んだときは下位プロブレムの分も並ぶ)。
 *
 * null は絞り込みなし、undefined は「まだプロブレムが確定していない」= 取得を
 * 始めない、の意味。絞り込み前の並びを一瞬見せないための区別。
 */
export type KarteProblemFilter = string[] | null | undefined;

function problemSearchValue(problemIds: string[]): string {
  return problemIds.map((id) => `Condition/${id}`).join(",");
}

// クエリキーは値が変われば別のページング列になる。絞り込みごとに 1 列を持つので、
// 絞り込みの切り替えは先頭ページからの読み直しになる。
function problemQueryKey(problemIds: KarteProblemFilter): string | null {
  return problemIds?.length ? problemIds.join(",") : null;
}

export function useKarteClinicalNotesInfinite(
  patientId: string | undefined,
  problemIds: KarteProblemFilter = null,
) {
  return useInfiniteQuery({
    queryKey: ["Composition", "search", "karte", patientId, problemQueryKey(problemIds)],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      params.set("subject", `Patient/${patientId}`);
      params.set("type", "http://loinc.org|11506-3");
      // 対象プロブレムは問題リストセクション(LOINC 11450-4)の section.entry に持つので、
      // R4 標準の entry で引ける(参照検索のカンマは OR)。
      if (problemIds?.length) params.set("entry", problemSearchValue(problemIds));
      params.set("_count", String(KARTE_PAGE));
      params.set("_offset", String(pageParam));
      params.set("_sort", "-date");
      // _summary は付けない。カルテは本文を
      // 表示し、テンプレート回答の重複判定にも section の参照拡張が要るため。
      return searchResource<fhir4.Composition>("Composition", params);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, _pages, lastOffset) => karteNextOffset(lastPage.data, lastOffset),
    enabled: Boolean(patientId) && problemIds !== undefined,
  });
}

export function useKartePrescriptionsInfinite(
  patientId: string | undefined,
  problemIds: KarteProblemFilter = null,
) {
  return useInfiniteQuery({
    queryKey: ["ServiceRequest", "search", "karte", patientId, problemQueryKey(problemIds)],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      // オーダーの対象プロブレムは reasonReference(R4 標準)。明細も親から
      // 引き継いだ理由を持つが、下の based-on:missing でヘッダだけに絞られる。
      if (problemIds?.length) params.set("reason-reference", problemSearchValue(problemIds));
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
      // 検体検査・放射線検査カードの進捗(依頼済・受付済・実施済・中止)と、
      // 放射線検査の実施記録。進捗の Task は部門で code が違うだけなので 1 つで足りる。
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
    enabled: Boolean(patientId) && problemIds !== undefined,
  });
}

/**
 * 先読みするオーダー。カルテのオーダーは authoredOn の降順でページングするので、
 * 「日付未定のもの」と「実施予定日が先のもの」は初期表示に出てこない
 * (申込が古いほど埋もれる)。種別で切ると「手術は件数が少ないから全件取れる」という
 * 種別依存の理屈になるので、**状態で切って**全件読む。どちらも件数は自然に小さい
 * (未定は未処理の仕事なので溜まらず、未来の予定も有限)。
 *
 * ページングの結果と重複しうるが、タイムライン側が ServiceRequest.id で寄せる。
 */
export function useKartePendingOrders(
  patientId: string | undefined,
  problemIds: KarteProblemFilter = null,
) {
  const enabled = Boolean(patientId) && problemIds !== undefined;

  function baseParams(): URLSearchParams {
    const params = new URLSearchParams();
    params.set("patient", `Patient/${patientId}`);
    if (problemIds?.length) params.set("reason-reference", problemSearchValue(problemIds));
    // カードになるのはヘッダだけ(明細は下の :iterate で添えてもらう)。
    params.set("based-on:missing", "true");
    params.set("_count", String(KARTE_PENDING_COUNT));
    params.set("_include", "ServiceRequest:subject");
    params.append("_revinclude", "MedicationRequest:based-on");
    params.append("_revinclude", "DiagnosticReport:based-on");
    params.append("_revinclude", "Task:focus");
    params.append("_revinclude", "Procedure:based-on");
    params.append("_revinclude:iterate", "ServiceRequest:based-on");
    params.append("_revinclude:iterate", "MedicationAdministration:part-of");
    params.append("_revinclude:iterate", "Observation:part-of");
    return params;
  }

  const unscheduled = useQuery({
    queryKey: ["ServiceRequest", "search", "karte-unscheduled", patientId, problemQueryKey(problemIds)],
    queryFn: () => {
      const params = baseParams();
      params.set("occurrence:missing", "true");
      return searchResource<fhir4.Resource>("ServiceRequest", params);
    },
    enabled,
  });

  const upcoming = useQuery({
    queryKey: ["ServiceRequest", "search", "karte-upcoming", patientId, problemQueryKey(problemIds)],
    queryFn: () => {
      const params = baseParams();
      // 今日より後の実施予定。今日ぶんは authoredOn のページング初回で拾える。
      params.set("occurrence", `gt${today()}`);
      return searchResource<fhir4.Resource>("ServiceRequest", params);
    },
    enabled,
  });

  const bundles = useMemo(
    () => [unscheduled.data?.data, upcoming.data?.data].filter((b): b is fhir4.Bundle => Boolean(b)),
    [unscheduled.data, upcoming.data],
  );

  return { bundles, error: unscheduled.error ?? upcoming.error ?? null };
}

export function useKarteQuestionnaireResponsesInfinite(
  patientId: string | undefined,
  problemIds: KarteProblemFilter = null,
) {
  return useInfiniteQuery({
    queryKey: ["QuestionnaireResponse", "search", "karte", patientId, problemQueryKey(problemIds)],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      // 診療記録と同じローカル拡張による絞り込み。
      if (problemIds?.length) params.set("problem", problemSearchValue(problemIds));
      params.set("_count", String(KARTE_PAGE));
      params.set("_offset", String(pageParam));
      params.set("_sort", "-authored");
      params.set("_include", "QuestionnaireResponse:questionnaire");
      return searchResource<fhir4.Resource>("QuestionnaireResponse", params);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, _pages, lastOffset) => karteNextOffset(lastPage.data, lastOffset),
    enabled: Boolean(patientId) && problemIds !== undefined,
  });
}

// バイタルは 1 回の測定が項目ごとの Observation に分かれるので、identifier で束ねて
// 1 枚のカードにする(groupVitalEntries)。テンプレート回答から抽出した Observation は
// 回答のカードとして既に出るため、derived-from を持つものは除く。
export function useKarteVitalsInfinite(
  patientId: string | undefined,
  problemIds: KarteProblemFilter = null,
) {
  return useInfiniteQuery({
    queryKey: ["Observation", "search", "karte-vital", patientId, problemQueryKey(problemIds)],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      params.set("category", "vital-signs");
      params.set("derived-from:missing", "true");
      if (problemIds?.length) params.set("problem", problemSearchValue(problemIds));
      params.set("_count", String(KARTE_PAGE));
      params.set("_offset", String(pageParam));
      params.set("_sort", "-date");
      return searchResource<fhir4.Observation>("Observation", params);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, _pages, lastOffset) => karteNextOffset(lastPage.data, lastOffset),
    enabled: Boolean(patientId) && problemIds !== undefined,
  });
}

// ---- 診療日インデックス ----
//
// 診療日ペインには、タイムラインの読み込み状況に関係なく全診療日を最初から出す。
// 検索条件(プロブレム絞り込みを含む)はタイムラインの各無限クエリと揃えること。
// キーも同じ ["<型>", "search"] 配下に置くので、登録・削除の invalidate で一緒に
// 再取得される。
// 診療日の集合は $distinct-dates のサーバー集計で取る。以前はリソース種別ごとに
// 患者の全履歴を _elements 付きで最後のページまで読んでいた(日付の distinct を
// 取るだけのフルスキャン ×4)。limit はカルテの左ペインに出す日数の実用上限。
async function fetchKarteDays(
  resourceType: string,
  params: URLSearchParams,
  dateParam: string,
): Promise<string[]> {
  const { dates, hasUndated } = await fetchDistinctDates(resourceType, params, dateParam, {
    limit: 1000,
  });
  // 日付を持たないリソースは空文字で持ち、タイムラインの「日付なし」に揃える。
  return hasUndated ? [...dates, ""] : dates;
}

/** 診療日ペインに出す全診療日(降順)。 */
export function useKarteDayIndex(
  patientId: string | undefined,
  problemIds: KarteProblemFilter = null,
) {
  const enabled = Boolean(patientId) && problemIds !== undefined;
  const problemKey = problemQueryKey(problemIds);

  const notes = useQuery({
    queryKey: ["Composition", "search", "karte-days", patientId, problemKey],
    queryFn: () =>
      fetchKarteDays(
        "Composition",
        (() => {
          const params = new URLSearchParams();
          params.set("subject", `Patient/${patientId}`);
          params.set("type", "http://loinc.org|11506-3");
          if (problemIds?.length) params.set("problem", problemSearchValue(problemIds));
          return params;
        })(),
        "date",
      ),
    enabled,
  });

  const prescriptions = useQuery({
    queryKey: ["ServiceRequest", "search", "karte-days", patientId, problemKey],
    queryFn: () =>
      fetchKarteDays(
        "ServiceRequest",
        (() => {
          const params = new URLSearchParams();
          params.set("patient", `Patient/${patientId}`);
          if (problemIds?.length) params.set("reason-reference", problemSearchValue(problemIds));
          // タイムラインと同じく、オーダーのヘッダだけを数える(明細を含めない)。
          params.set("based-on:missing", "true");
          // 実施予定日でカードを出す種別は下の occurrence ソースが数えるので、ここでは外す
          // (両方で数えるとカードの無い日が診療日ペインに並ぶ)。
          params.set("category:not", OCCURRENCE_ORDER_TYPE_TOKENS);
          return params;
        })(),
        "authoredon",
      ),
    enabled,
  });

  // 実施予定日でカードを出すオーダー。日付未定(undated)はタイムラインと同じ仮想日に写す。
  const scheduledOrders = useQuery({
    queryKey: ["ServiceRequest", "search", "karte-days-occurrence", patientId, problemKey],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      if (problemIds?.length) params.set("reason-reference", problemSearchValue(problemIds));
      params.set("based-on:missing", "true");
      params.set("category", OCCURRENCE_ORDER_TYPE_TOKENS);
      const { dates, hasUndated } = await fetchDistinctDates(
        "ServiceRequest",
        params,
        "occurrence",
        { limit: 1000 },
      );
      return hasUndated ? [...dates, KARTE_UNSCHEDULED_DAY] : dates;
    },
    enabled,
  });

  const responses = useQuery({
    queryKey: ["QuestionnaireResponse", "search", "karte-days", patientId, problemKey],
    queryFn: () =>
      fetchKarteDays(
        "QuestionnaireResponse",
        (() => {
          const params = new URLSearchParams();
          params.set("patient", `Patient/${patientId}`);
          if (problemIds?.length) params.set("problem", problemSearchValue(problemIds));
          return params;
        })(),
        "authored",
      ),
    enabled,
  });

  const vitals = useQuery({
    queryKey: ["Observation", "search", "karte-days", patientId, problemKey],
    queryFn: () =>
      fetchKarteDays(
        "Observation",
        (() => {
          const params = new URLSearchParams();
          params.set("patient", `Patient/${patientId}`);
          params.set("category", "vital-signs");
          params.set("derived-from:missing", "true");
          if (problemIds?.length) params.set("problem", problemSearchValue(problemIds));
          return params;
        })(),
        "date",
      ),
    enabled,
  });

  const queries = [notes, prescriptions, scheduledOrders, responses, vitals];
  const days = useMemo(() => {
    const merged = new Set<string>();
    for (const list of [
      notes.data,
      prescriptions.data,
      scheduledOrders.data,
      responses.data,
      vitals.data,
    ]) {
      for (const day of list ?? []) merged.add(day);
    }
    return Array.from(merged).sort(compareKarteDaysDesc);
  }, [notes.data, prescriptions.data, scheduledOrders.data, responses.data, vitals.data]);

  return {
    days,
    isLoading: queries.some((q) => q.isPending),
    error: queries.find((q) => q.error)?.error ?? null,
  };
}

/** 編集対象の測定 1 回分。identifier で束ねてあるので 1 検索で全項目そろう。 */
export function useVitalEntry(entryId: string | undefined) {
  return useQuery({
    queryKey: ["Observation", "search", "vital-entry", entryId],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("identifier", `${VITAL_ENTRY_SYSTEM}|${entryId}`);
      params.set("_count", "50");
      const { data } = await searchResource<fhir4.Observation>("Observation", params);
      const observations = (data.entry ?? [])
        .map((entry) => entry.resource)
        .filter((r): r is fhir4.Observation => r?.resourceType === "Observation");
      return groupVitalEntries(observations)[0] ?? null;
    },
    enabled: Boolean(entryId),
  });
}

function invalidateVitals(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["Observation", "search"] });
}

// 経過表は「直近 N 回分の測定」を横軸にする。1 回の測定が 8 件前後の Observation に
// 分かれるので、まず $distinct-dates(precision=full)で直近 N 個の測定日時を集計し、
// いちばん古い測定日時以降の Observation をまとめて取る。検査結果の時系列表示と
// 同じ流儀(以前は測定日時が N+1 個現れるまで全件をページングしていた)。
const VITAL_FLOWSHEET_PAGE = 100;
const VITAL_FLOWSHEET_MAX_PAGES = 10;

async function fetchVitalFlowsheetObservations(
  patientId: string,
  columnCount: number,
): Promise<fhir4.Observation[]> {
  const dateParams = new URLSearchParams();
  dateParams.set("patient", `Patient/${patientId}`);
  dateParams.set("category", "vital-signs");
  const { dates: instants } = await fetchDistinctDates("Observation", dateParams, "date", {
    precision: "full",
    limit: columnCount,
  });
  if (instants.length === 0) return [];

  const observations: fhir4.Observation[] = [];
  for (let page = 0; page < VITAL_FLOWSHEET_MAX_PAGES; page += 1) {
    const params = new URLSearchParams();
    params.set("patient", `Patient/${patientId}`);
    params.set("category", "vital-signs");
    // ge は境界を含むので、N 個目の測定日時そのものも取れる。
    params.set("date", `ge${instants[instants.length - 1]}`);
    params.set("_count", String(VITAL_FLOWSHEET_PAGE));
    params.set("_offset", String(page * VITAL_FLOWSHEET_PAGE));
    params.set("_sort", "-date");

    const { data: bundle } = await searchResource<fhir4.Observation>("Observation", params);
    const pageObservations = (bundle.entry ?? [])
      .map((entry) => entry.resource)
      .filter((r): r is fhir4.Observation => r?.resourceType === "Observation");
    observations.push(...pageObservations);

    if (pageObservations.length < VITAL_FLOWSHEET_PAGE) break;
  }

  return observations;
}

export function useVitalFlowsheet(patientId: string | undefined, columnCount: number) {
  return useQuery({
    // 登録・更新・削除の invalidateQueries(["Observation", "search"]) でまとめて
    // 無効化されるよう search 配下のキーにしている。
    queryKey: ["Observation", "search", "vital-flowsheet", patientId, columnCount],
    queryFn: () => fetchVitalFlowsheetObservations(patientId ?? "", columnCount),
    enabled: Boolean(patientId),
    placeholderData: keepPreviousData,
  });
}

export function useSaveVitalEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      observations,
      existingObservationIds,
    }: {
      observations: fhir4.Observation[];
      existingObservationIds?: string[];
    }) => postBundle(vitalSaveBundle(observations, existingObservationIds)),
    onSuccess: () => invalidateVitals(queryClient),
  });
}

export function useDeleteVitalEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (observationIds: string[]) => postBundle(vitalDeleteBundle(observationIds)),
    onSuccess: () => invalidateVitals(queryClient),
  });
}

export function useDeletePrescription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (srId: string) => postBundle(buildPrescriptionDeleteBundle(srId)),
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

/** 予約日時の変更(付け替え先の枠)。放射線オーダーの更新に同梱する。 */
export interface RadBookingChange {
  appointment: fhir4.Appointment;
  slots: fhir4.Slot[];
}

/**
 * 放射線オーダーの更新。予約日時を変えたときは、予約の付け替え(Appointment の日時と
 * 枠の busy/free)も同じ transaction で書く。オーダーだけ・予約だけが動いて撮影日時が
 * 食い違うことを防ぐため。
 *
 * ヘッダの撮影日時は Bundle を組む前に新しい枠の日時にしてある(フォームが枠を選んだ
 * 時点で書き換える)ので、ここではオーダー側に触らない。
 */
export function useUpdateRadOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      bundle,
      booking,
    }: {
      bundle: fhir4.Bundle;
      booking: RadBookingChange | null;
    }) => {
      if (!booking) return postBundle(bundle);
      // 空きに戻す元の枠は参照しか持っていないので、ここで引き直す(取消と同じ)。
      const entries = buildRescheduleEntries(
        booking.appointment,
        await fetchAppointmentSlots(booking.appointment),
        booking.slots,
      );
      return postBundle({ ...bundle, entry: [...(bundle.entry ?? []), ...entries] });
    },
    onSuccess: () => {
      // 撮影日時が動くと放射線検査一覧の当日ぶんも変わるので、ServiceRequest は
      // まとめて読み直させる。
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
      invalidateAppointments(queryClient);
    },
  });
}

// 放射線オーダーも明細が独立した ServiceRequest なので、ヘッダだけ消すと明細が
// 残ってしまう。消す直前に明細を引き直してからまとめて消す(検体検査と同じ)。
// オーダーに紐づく検査予約があれば、取消(cancelled + 枠の free 化)も同じ
// transaction に同梱する(予約だけ残ってオーダーが無い状態を作らない)。
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

      const appointmentEntries = await fetchRadAppointmentCancelEntries(srId);

      // 明細が参照しているテンプレート回答も一緒に消す(孤児を残さない)。
      return postBundle(
        buildRadOrderDeleteBundle(
          srId,
          itemIds,
          radOrderResponseIds(itemRequests),
          appointmentEntries,
        ),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
      queryClient.invalidateQueries({ queryKey: ["Appointment"] });
      queryClient.invalidateQueries({ queryKey: ["Slot"] });
    },
  });
}

/** オーダーヘッダに紐づく有効な検査予約の取消エントリ。予約が無ければ空。 */
async function fetchRadAppointmentCancelEntries(srId: string): Promise<fhir4.BundleEntry[]> {
  const params = new URLSearchParams();
  params.set("based-on", `ServiceRequest/${srId}`);
  const { data: bundle } = await searchResource<fhir4.Appointment>("Appointment", params);
  const appointments = (bundle.entry ?? [])
    .map((e) => e.resource)
    .filter((r): r is fhir4.Appointment => r?.resourceType === "Appointment")
    .filter(isActiveAppointment);

  const entries: fhir4.BundleEntry[] = [];
  for (const appointment of appointments) {
    entries.push(...buildCancelEntries(appointment, await fetchAppointmentSlots(appointment)));
  }
  return entries;
}

// ---- 生理検査オーダー ----
//
// 放射線検査と同じ形。ヘッダと明細が別リソースなので 1 リクエストにまとめて取り、
// 部門一覧・実施記録・予約の扱いも放射線と同型にしている。違うのは実施記録に
// 被曝線量(Observation)がぶら下がらない点。

export function usePhysioOrderDetail(srId: string | undefined) {
  const params = new URLSearchParams();
  if (srId) params.set("_id", srId);
  params.set("_revinclude:iterate", "ServiceRequest:based-on");

  return useQuery({
    queryKey: ["ServiceRequest", "detail", "physio-order", srId],
    queryFn: () => searchResource<fhir4.ServiceRequest>("ServiceRequest", params),
    enabled: Boolean(srId),
  });
}

// 生理検査の実施記録(Procedure 一式)。オーダーとは別リソースで、オーダーの検索から
// 辿れないので別に引く。カルテカードの FHIR JSON 表示で使う。
export function usePhysioPerformDetail(orderId: string | undefined) {
  return useQuery({
    queryKey: ["Procedure", "search", "physio-perform", orderId],
    queryFn: () =>
      searchResource<fhir4.Resource>("Procedure", physioPerformSearchParams(orderId ?? "")),
    enabled: Boolean(orderId),
  });
}

/** 生理検査一覧の 1 行。オーダー(ヘッダ)1 件ぶん。 */
export interface PhysioWorklistRow {
  order: fhir4.ServiceRequest;
  /** 検査項目(明細)。セットの構成項目まで含む平坦な一覧。 */
  itemRequests: fhir4.ServiceRequest[];
  patient?: fhir4.Patient;
  /** 進捗。部門がまだ触っていないオーダーには無い(= 依頼済)。 */
  task?: fhir4.Task;
}

export interface PhysioWorklistResult {
  rows: PhysioWorklistRow[];
  /** 上限まで読んでも読み切れなかった。 */
  truncated: boolean;
}

async function fetchPhysioWorklist(date: string): Promise<PhysioWorklistResult> {
  const orders: fhir4.ServiceRequest[] = [];
  const items: fhir4.ServiceRequest[] = [];

  const { patientsById, tasks, truncated } = await fetchWorklistBundles(
    (page) => {
      const params = worklistParams(
        `${ORDER_TYPE_SYSTEM}|${PHYSIO_ORDER_TYPE.code}`,
        date,
        page,
        "occurrence",
      );
      // 検査項目も同じ応答に添えてもらう。
      params.set("_revinclude:iterate", "ServiceRequest:based-on");
      params.set("_revinclude", "Task:focus");
      return params;
    },
    (resource) => {
      if (resource.resourceType !== "ServiceRequest") return false;
      const request = resource as fhir4.ServiceRequest;
      // 検索にヒットしたヘッダと、添えられた明細を分ける。
      if (isPhysioServiceRequest(request) && !request.basedOn?.length) {
        orders.push(request);
        return true;
      }
      items.push(request);
      return false;
    },
  );

  const taskByOrderId = physioTasksByOrderId(tasks);

  const rows = orders.map((order) => ({
    order,
    itemRequests: physioOrderItemRequests(items, order.id ?? ""),
    patient: patientsById.get(order.subject?.reference?.split("/").pop() ?? ""),
    task: taskByOrderId.get(order.id ?? ""),
  }));

  // 実施時刻の早い順。時刻を指定していないオーダー(実施日だけ)は後ろにまとめる。
  rows.sort((a, b) => physioWorklistSortKey(a).localeCompare(physioWorklistSortKey(b)));

  return { rows, truncated };
}

function physioWorklistSortKey(row: PhysioWorklistRow): string {
  return physioOrderTime(row.order) || "99:99";
}

/** 実施日 1 日ぶんの生理検査オーダー。日付が未選択の間は読みに行かない。 */
export function usePhysioWorklist(date: string) {
  return useQuery({
    queryKey: PHYSIO_WORKLIST_KEY(date),
    queryFn: () => fetchPhysioWorklist(date),
    enabled: Boolean(date),
    placeholderData: keepPreviousData,
  });
}

const PHYSIO_WORKLIST_KEY = (date: string) => ["ServiceRequest", "physio-worklist", date];

/**
 * 実施の取消で片付ける実施記録。オーダーにぶら下がる Procedure と、その子の
 * 薬剤(MedicationAdministration)を 1 リクエストで集める。
 * 放射線と違い被曝線量(Observation)は作らないので引かない。
 *
 * 一覧が持っている行の情報からではなく、その場で引き直す。取消は稀な操作で、
 * 一覧を開いた後に別の端末で登録された実施記録も残さず消したいため。
 */
function physioPerformSearchParams(orderId: string): URLSearchParams {
  const params = new URLSearchParams();
  params.set("based-on", `ServiceRequest/${orderId}`);
  params.set("_count", "100");
  params.append("_revinclude", "MedicationAdministration:part-of");
  return params;
}

async function fetchPhysioPerformResources(orderId: string) {
  const { data: bundle } = await searchResource<fhir4.Resource>(
    "Procedure",
    physioPerformSearchParams(orderId),
  );

  const procedures: fhir4.Procedure[] = [];
  const administrations: fhir4.MedicationAdministration[] = [];
  for (const entry of bundle.entry ?? []) {
    const resource = entry.resource;
    if (resource?.resourceType === "Procedure") procedures.push(resource as fhir4.Procedure);
    else if (resource?.resourceType === "MedicationAdministration") {
      administrations.push(resource as fhir4.MedicationAdministration);
    }
  }
  return { procedures, administrations };
}

/**
 * 受付・実施などの進捗を書き込む。Task がまだ無いオーダーでは新しく作る。
 * 実施済から戻す(取消)ときは、実施記録も同じ transaction で消す
 * (放射線検査と同じ理由。docs/rad-result-design.md §7-6)。
 */
export function useUpdatePhysioTaskStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      order,
      task,
      status,
    }: {
      order: fhir4.ServiceRequest;
      task: fhir4.Task | undefined;
      status: PhysioTaskStatus;
    }) => {
      const taskEntry = taskBundleEntry(buildPhysioTaskUpdate(task, order, status));

      const cancelsPerform = physioTaskStatus(task) === "completed" && status !== "completed";
      const performed = cancelsPerform
        ? await fetchPhysioPerformResources(order.id ?? "")
        : { procedures: [], administrations: [] };
      const performEntries = buildPhysioPerformDeleteEntries(
        performed.procedures,
        performed.administrations,
      );

      return postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: [...performEntries, taskEntry],
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "physio-worklist"] });
      // カルテのオーダーカードも進捗と実施情報を出しているので読み直させる。
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      // 取消では実施記録も消しているので、FHIR JSON 表示の実施記録も引き直させる。
      queryClient.invalidateQueries({ queryKey: ["Procedure", "search"] });
    },
  });
}

/**
 * 生理検査の実施登録。実施記録(Procedure 一式)と Task の完了を 1 つの
 * transaction で書き込む。Bundle の組み立ては physioResultHelpers を参照。
 */
export function useRegisterPhysioPerform() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "physio-worklist"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["Procedure", "search"] });
    },
  });
}

/**
 * 生理検査オーダーに紐づく有効な検査予約(1 オーダーに 1 件)。予約日時の変更は
 * オーダーの編集画面から行うので、編集を開くときに予約の現物を用意しておく。
 */
export function usePhysioOrderAppointment(srId: string | undefined) {
  const params = new URLSearchParams();
  if (srId) params.set("based-on", `ServiceRequest/${srId}`);

  const query = useQuery({
    queryKey: ["Appointment", "physio-order", srId],
    queryFn: () => searchResource<fhir4.Appointment>("Appointment", params),
    enabled: Boolean(srId),
  });

  return {
    ...query,
    appointment: (query.data?.data.entry ?? [])
      .map((e) => e.resource)
      .filter((r): r is fhir4.Appointment => r?.resourceType === "Appointment")
      .find(isActiveAppointment),
  };
}

/**
 * 生理検査オーダーの更新。予約日時を変えたときは、予約の付け替え(Appointment の
 * 日時と枠の busy/free)も同じ transaction で書く。オーダーだけ・予約だけが動いて
 * 実施日時が食い違うことを防ぐため。
 */
export function useUpdatePhysioOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      bundle,
      booking,
    }: {
      bundle: fhir4.Bundle;
      booking: RadBookingChange | null;
    }) => {
      if (!booking) return postBundle(bundle);
      // 空きに戻す元の枠は参照しか持っていないので、ここで引き直す(取消と同じ)。
      const entries = buildRescheduleEntries(
        booking.appointment,
        await fetchAppointmentSlots(booking.appointment),
        booking.slots,
      );
      return postBundle({ ...bundle, entry: [...(bundle.entry ?? []), ...entries] });
    },
    onSuccess: () => {
      // 実施日時が動くと生理検査一覧の当日ぶんも変わるので、ServiceRequest は
      // まとめて読み直させる。
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
      invalidateAppointments(queryClient);
    },
  });
}

// 生理検査オーダーも明細が独立した ServiceRequest なので、ヘッダだけ消すと明細が
// 残ってしまう。消す直前に明細を引き直してからまとめて消す(放射線検査と同じ)。
export function useDeletePhysioOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (srId: string) => {
      const params = new URLSearchParams();
      params.set("_id", srId);
      params.set("_revinclude:iterate", "ServiceRequest:based-on");
      const { data: bundle } = await searchResource<fhir4.ServiceRequest>("ServiceRequest", params);
      const itemRequests = physioOrderItemRequests(serviceRequestsOf(bundle), srId);
      const itemIds = itemRequests
        .map((request) => request.id)
        .filter((id): id is string => Boolean(id));

      const appointmentEntries = await fetchPhysioAppointmentCancelEntries(srId);

      // 明細が参照しているテンプレート回答も一緒に消す(孤児を残さない)。
      return postBundle(
        buildPhysioOrderDeleteBundle(
          srId,
          itemIds,
          physioOrderResponseIds(itemRequests),
          appointmentEntries,
        ),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
      queryClient.invalidateQueries({ queryKey: ["Appointment"] });
      queryClient.invalidateQueries({ queryKey: ["Slot"] });
    },
  });
}

/** オーダーヘッダに紐づく有効な検査予約の取消エントリ。予約が無ければ空。 */
async function fetchPhysioAppointmentCancelEntries(srId: string): Promise<fhir4.BundleEntry[]> {
  const params = new URLSearchParams();
  params.set("based-on", `ServiceRequest/${srId}`);
  const { data: bundle } = await searchResource<fhir4.Appointment>("Appointment", params);
  const appointments = (bundle.entry ?? [])
    .map((e) => e.resource)
    .filter((r): r is fhir4.Appointment => r?.resourceType === "Appointment")
    .filter(isActiveAppointment);

  const entries: fhir4.BundleEntry[] = [];
  for (const appointment of appointments) {
    entries.push(...buildCancelEntries(appointment, await fetchAppointmentSlots(appointment)));
  }
  return entries;
}

// ---- 内視鏡オーダー ----
//
// 生理検査と同じ形。ヘッダと明細が別リソースなので 1 リクエストにまとめて取り、
// 部門一覧・実施記録・予約の扱いも同型にしている。

export function useEndoscopyOrderDetail(srId: string | undefined) {
  const params = new URLSearchParams();
  if (srId) params.set("_id", srId);
  params.set("_revinclude:iterate", "ServiceRequest:based-on");

  return useQuery({
    queryKey: ["ServiceRequest", "detail", "endoscopy-order", srId],
    queryFn: () => searchResource<fhir4.ServiceRequest>("ServiceRequest", params),
    enabled: Boolean(srId),
  });
}

// 内視鏡の実施記録(Procedure 一式)。オーダーとは別リソースで、オーダーの検索から
// 辿れないので別に引く。カルテカードの FHIR JSON 表示で使う。
export function useEndoscopyPerformDetail(orderId: string | undefined) {
  return useQuery({
    queryKey: ["Procedure", "search", "endoscopy-perform", orderId],
    queryFn: () =>
      searchResource<fhir4.Resource>("Procedure", endoscopyPerformSearchParams(orderId ?? "")),
    enabled: Boolean(orderId),
  });
}

/** 内視鏡一覧の 1 行。オーダー(ヘッダ)1 件ぶん。 */
export interface EndoscopyWorklistRow {
  order: fhir4.ServiceRequest;
  /** 検査項目(明細)。セットの構成項目まで含む平坦な一覧。 */
  itemRequests: fhir4.ServiceRequest[];
  patient?: fhir4.Patient;
  /** 進捗。部門がまだ触っていないオーダーには無い(= 依頼済)。 */
  task?: fhir4.Task;
}

export interface EndoscopyWorklistResult {
  rows: EndoscopyWorklistRow[];
  /** 上限まで読んでも読み切れなかった。 */
  truncated: boolean;
}

async function fetchEndoscopyWorklist(date: string): Promise<EndoscopyWorklistResult> {
  const orders: fhir4.ServiceRequest[] = [];
  const items: fhir4.ServiceRequest[] = [];

  const { patientsById, tasks, truncated } = await fetchWorklistBundles(
    (page) => {
      const params = worklistParams(
        `${ORDER_TYPE_SYSTEM}|${ENDOSCOPY_ORDER_TYPE.code}`,
        date,
        page,
        "occurrence",
      );
      // 検査項目も同じ応答に添えてもらう。
      params.set("_revinclude:iterate", "ServiceRequest:based-on");
      params.set("_revinclude", "Task:focus");
      return params;
    },
    (resource) => {
      if (resource.resourceType !== "ServiceRequest") return false;
      const request = resource as fhir4.ServiceRequest;
      // 検索にヒットしたヘッダと、添えられた明細を分ける。
      if (isEndoscopyServiceRequest(request) && !request.basedOn?.length) {
        orders.push(request);
        return true;
      }
      items.push(request);
      return false;
    },
  );

  const taskByOrderId = endoscopyTasksByOrderId(tasks);

  const rows = orders.map((order) => ({
    order,
    itemRequests: endoscopyOrderItemRequests(items, order.id ?? ""),
    patient: patientsById.get(order.subject?.reference?.split("/").pop() ?? ""),
    task: taskByOrderId.get(order.id ?? ""),
  }));

  // 実施時刻の早い順。時刻を指定していないオーダー(実施日だけ)は後ろにまとめる。
  rows.sort((a, b) => endoscopyWorklistSortKey(a).localeCompare(endoscopyWorklistSortKey(b)));

  return { rows, truncated };
}

function endoscopyWorklistSortKey(row: EndoscopyWorklistRow): string {
  return endoscopyOrderTime(row.order) || "99:99";
}

/** 実施日 1 日ぶんの内視鏡オーダー。日付が未選択の間は読みに行かない。 */
export function useEndoscopyWorklist(date: string) {
  return useQuery({
    queryKey: ENDOSCOPY_WORKLIST_KEY(date),
    queryFn: () => fetchEndoscopyWorklist(date),
    enabled: Boolean(date),
    placeholderData: keepPreviousData,
  });
}

const ENDOSCOPY_WORKLIST_KEY = (date: string) => ["ServiceRequest", "endoscopy-worklist", date];

/**
 * 実施の取消で片付ける実施記録。オーダーにぶら下がる Procedure と、その子の
 * 薬剤(MedicationAdministration)を 1 リクエストで集める。
 * 放射線と違い被曝線量(Observation)は作らないので引かない。
 *
 * 一覧が持っている行の情報からではなく、その場で引き直す。取消は稀な操作で、
 * 一覧を開いた後に別の端末で登録された実施記録も残さず消したいため。
 */
function endoscopyPerformSearchParams(orderId: string): URLSearchParams {
  const params = new URLSearchParams();
  params.set("based-on", `ServiceRequest/${orderId}`);
  params.set("_count", "100");
  params.append("_revinclude", "MedicationAdministration:part-of");
  return params;
}

async function fetchEndoscopyPerformResources(orderId: string) {
  const { data: bundle } = await searchResource<fhir4.Resource>(
    "Procedure",
    endoscopyPerformSearchParams(orderId),
  );

  const procedures: fhir4.Procedure[] = [];
  const administrations: fhir4.MedicationAdministration[] = [];
  for (const entry of bundle.entry ?? []) {
    const resource = entry.resource;
    if (resource?.resourceType === "Procedure") procedures.push(resource as fhir4.Procedure);
    else if (resource?.resourceType === "MedicationAdministration") {
      administrations.push(resource as fhir4.MedicationAdministration);
    }
  }
  return { procedures, administrations };
}

/**
 * 受付・実施などの進捗を書き込む。Task がまだ無いオーダーでは新しく作る。
 * 実施済から戻す(取消)ときは、実施記録も同じ transaction で消す
 * (放射線検査と同じ理由。docs/rad-result-design.md §7-6)。
 */
export function useUpdateEndoscopyTaskStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      order,
      task,
      status,
    }: {
      order: fhir4.ServiceRequest;
      task: fhir4.Task | undefined;
      status: EndoscopyTaskStatus;
    }) => {
      const taskEntry = taskBundleEntry(buildEndoscopyTaskUpdate(task, order, status));

      const cancelsPerform = endoscopyTaskStatus(task) === "completed" && status !== "completed";
      const performed = cancelsPerform
        ? await fetchEndoscopyPerformResources(order.id ?? "")
        : { procedures: [], administrations: [] };
      const performEntries = buildEndoscopyPerformDeleteEntries(
        performed.procedures,
        performed.administrations,
      );

      return postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: [...performEntries, taskEntry],
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "endoscopy-worklist"] });
      // カルテのオーダーカードも進捗と実施情報を出しているので読み直させる。
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      // 取消では実施記録も消しているので、FHIR JSON 表示の実施記録も引き直させる。
      queryClient.invalidateQueries({ queryKey: ["Procedure", "search"] });
    },
  });
}

/**
 * 内視鏡の実施登録。実施記録(Procedure 一式)と Task の完了を 1 つの
 * transaction で書き込む。Bundle の組み立ては endoscopyResultHelpers を参照。
 */
export function useRegisterEndoscopyPerform() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "endoscopy-worklist"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["Procedure", "search"] });
    },
  });
}

/**
 * 内視鏡オーダーに紐づく有効な検査予約(1 オーダーに 1 件)。予約日時の変更は
 * オーダーの編集画面から行うので、編集を開くときに予約の現物を用意しておく。
 */
export function useEndoscopyOrderAppointment(srId: string | undefined) {
  const params = new URLSearchParams();
  if (srId) params.set("based-on", `ServiceRequest/${srId}`);

  const query = useQuery({
    queryKey: ["Appointment", "endoscopy-order", srId],
    queryFn: () => searchResource<fhir4.Appointment>("Appointment", params),
    enabled: Boolean(srId),
  });

  return {
    ...query,
    appointment: (query.data?.data.entry ?? [])
      .map((e) => e.resource)
      .filter((r): r is fhir4.Appointment => r?.resourceType === "Appointment")
      .find(isActiveAppointment),
  };
}

/**
 * 内視鏡オーダーの更新。予約日時を変えたときは、予約の付け替え(Appointment の
 * 日時と枠の busy/free)も同じ transaction で書く。オーダーだけ・予約だけが動いて
 * 実施日時が食い違うことを防ぐため。
 */
export function useUpdateEndoscopyOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      bundle,
      booking,
    }: {
      bundle: fhir4.Bundle;
      booking: RadBookingChange | null;
    }) => {
      if (!booking) return postBundle(bundle);
      // 空きに戻す元の枠は参照しか持っていないので、ここで引き直す(取消と同じ)。
      const entries = buildRescheduleEntries(
        booking.appointment,
        await fetchAppointmentSlots(booking.appointment),
        booking.slots,
      );
      return postBundle({ ...bundle, entry: [...(bundle.entry ?? []), ...entries] });
    },
    onSuccess: () => {
      // 実施日時が動くと内視鏡一覧の当日ぶんも変わるので、ServiceRequest は
      // まとめて読み直させる。
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
      invalidateAppointments(queryClient);
    },
  });
}

// 内視鏡オーダーも明細が独立した ServiceRequest なので、ヘッダだけ消すと明細が
// 残ってしまう。消す直前に明細を引き直してからまとめて消す(放射線検査と同じ)。
export function useDeleteEndoscopyOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (srId: string) => {
      const params = new URLSearchParams();
      params.set("_id", srId);
      params.set("_revinclude:iterate", "ServiceRequest:based-on");
      const { data: bundle } = await searchResource<fhir4.ServiceRequest>("ServiceRequest", params);
      const itemRequests = endoscopyOrderItemRequests(serviceRequestsOf(bundle), srId);
      const itemIds = itemRequests
        .map((request) => request.id)
        .filter((id): id is string => Boolean(id));

      const appointmentEntries = await fetchEndoscopyAppointmentCancelEntries(srId);

      // 明細が参照しているテンプレート回答も一緒に消す(孤児を残さない)。
      return postBundle(
        buildEndoscopyOrderDeleteBundle(
          srId,
          itemIds,
          endoscopyOrderResponseIds(itemRequests),
          appointmentEntries,
        ),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
      queryClient.invalidateQueries({ queryKey: ["Appointment"] });
      queryClient.invalidateQueries({ queryKey: ["Slot"] });
    },
  });
}

/** オーダーヘッダに紐づく有効な検査予約の取消エントリ。予約が無ければ空。 */
async function fetchEndoscopyAppointmentCancelEntries(srId: string): Promise<fhir4.BundleEntry[]> {
  const params = new URLSearchParams();
  params.set("based-on", `ServiceRequest/${srId}`);
  const { data: bundle } = await searchResource<fhir4.Appointment>("Appointment", params);
  const appointments = (bundle.entry ?? [])
    .map((e) => e.resource)
    .filter((r): r is fhir4.Appointment => r?.resourceType === "Appointment")
    .filter(isActiveAppointment);

  const entries: fhir4.BundleEntry[] = [];
  for (const appointment of appointments) {
    entries.push(...buildCancelEntries(appointment, await fetchAppointmentSlots(appointment)));
  }
  return entries;
}


// ---- 処置オーダー ----
//
// 生理検査と同じ形。ヘッダと明細が別リソースなので 1 リクエストにまとめて取り、
// 部門一覧・実施記録・予約の扱いも同型にしている。違うのは明細がテンプレート回答
// (QuestionnaireResponse)を参照しないので、削除で片付ける対象がオーダーと予約だけな点。

export function useTreatmentOrderDetail(srId: string | undefined) {
  const params = new URLSearchParams();
  if (srId) params.set("_id", srId);
  params.set("_revinclude:iterate", "ServiceRequest:based-on");

  return useQuery({
    queryKey: ["ServiceRequest", "detail", "treatment-order", srId],
    queryFn: () => searchResource<fhir4.ServiceRequest>("ServiceRequest", params),
    enabled: Boolean(srId),
  });
}

// 処置の実施記録(Procedure 一式)。オーダーとは別リソースで、オーダーの検索から
// 辿れないので別に引く。カルテカードの FHIR JSON 表示で使う。
export function useTreatmentPerformDetail(orderId: string | undefined) {
  return useQuery({
    queryKey: ["Procedure", "search", "treatment-perform", orderId],
    queryFn: () =>
      searchResource<fhir4.Resource>("Procedure", treatmentPerformSearchParams(orderId ?? "")),
    enabled: Boolean(orderId),
  });
}

/** 処置一覧の 1 行。オーダー(ヘッダ)1 件ぶん。 */
export interface TreatmentWorklistRow {
  order: fhir4.ServiceRequest;
  /** 処置項目(明細)。セットの構成項目まで含む平坦な一覧。 */
  itemRequests: fhir4.ServiceRequest[];
  patient?: fhir4.Patient;
  /** 進捗。部門がまだ触っていないオーダーには無い(= 依頼済)。 */
  task?: fhir4.Task;
}

export interface TreatmentWorklistResult {
  rows: TreatmentWorklistRow[];
  /** 上限まで読んでも読み切れなかった。 */
  truncated: boolean;
}

async function fetchTreatmentWorklist(date: string): Promise<TreatmentWorklistResult> {
  const orders: fhir4.ServiceRequest[] = [];
  const items: fhir4.ServiceRequest[] = [];

  const { patientsById, tasks, truncated } = await fetchWorklistBundles(
    (page) => {
      const params = worklistParams(
        `${ORDER_TYPE_SYSTEM}|${TREATMENT_ORDER_TYPE.code}`,
        date,
        page,
        "occurrence",
      );
      // 処置項目も同じ応答に添えてもらう。
      params.set("_revinclude:iterate", "ServiceRequest:based-on");
      params.set("_revinclude", "Task:focus");
      return params;
    },
    (resource) => {
      if (resource.resourceType !== "ServiceRequest") return false;
      const request = resource as fhir4.ServiceRequest;
      // 検索にヒットしたヘッダと、添えられた明細を分ける。
      if (isTreatmentServiceRequest(request) && !request.basedOn?.length) {
        orders.push(request);
        return true;
      }
      items.push(request);
      return false;
    },
  );

  const taskByOrderId = treatmentTasksByOrderId(tasks);

  const rows = orders.map((order) => ({
    order,
    itemRequests: treatmentOrderItemRequests(items, order.id ?? ""),
    patient: patientsById.get(order.subject?.reference?.split("/").pop() ?? ""),
    task: taskByOrderId.get(order.id ?? ""),
  }));

  // 実施時刻の早い順。時刻を指定していないオーダー(実施日だけ)は後ろにまとめる。
  rows.sort((a, b) => treatmentWorklistSortKey(a).localeCompare(treatmentWorklistSortKey(b)));

  return { rows, truncated };
}

function treatmentWorklistSortKey(row: TreatmentWorklistRow): string {
  return treatmentOrderTime(row.order) || "99:99";
}

/** 実施日 1 日ぶんの処置オーダー。日付が未選択の間は読みに行かない。 */
export function useTreatmentWorklist(date: string) {
  return useQuery({
    queryKey: TREATMENT_WORKLIST_KEY(date),
    queryFn: () => fetchTreatmentWorklist(date),
    enabled: Boolean(date),
    placeholderData: keepPreviousData,
  });
}

const TREATMENT_WORKLIST_KEY = (date: string) => ["ServiceRequest", "treatment-worklist", date];

/**
 * 実施の取消で片付ける実施記録。オーダーにぶら下がる Procedure と、その子の
 * 薬剤(MedicationAdministration)を 1 リクエストで集める。
 * 生理検査と同じく被曝線量(Observation)は作らないので引かない。
 *
 * 一覧が持っている行の情報からではなく、その場で引き直す。取消は稀な操作で、
 * 一覧を開いた後に別の端末で登録された実施記録も残さず消したいため。
 */
function treatmentPerformSearchParams(orderId: string): URLSearchParams {
  const params = new URLSearchParams();
  params.set("based-on", `ServiceRequest/${orderId}`);
  params.set("_count", "100");
  params.append("_revinclude", "MedicationAdministration:part-of");
  return params;
}

async function fetchTreatmentPerformResources(orderId: string) {
  const { data: bundle } = await searchResource<fhir4.Resource>(
    "Procedure",
    treatmentPerformSearchParams(orderId),
  );

  const procedures: fhir4.Procedure[] = [];
  const administrations: fhir4.MedicationAdministration[] = [];
  for (const entry of bundle.entry ?? []) {
    const resource = entry.resource;
    if (resource?.resourceType === "Procedure") procedures.push(resource as fhir4.Procedure);
    else if (resource?.resourceType === "MedicationAdministration") {
      administrations.push(resource as fhir4.MedicationAdministration);
    }
  }
  return { procedures, administrations };
}

/**
 * 受付・実施などの進捗を書き込む。Task がまだ無いオーダーでは新しく作る。
 * 実施済から戻す(取消)ときは、実施記録も同じ transaction で消す
 * (放射線検査と同じ理由。docs/rad-result-design.md §7-6)。
 */
export function useUpdateTreatmentTaskStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      order,
      task,
      status,
    }: {
      order: fhir4.ServiceRequest;
      task: fhir4.Task | undefined;
      status: TreatmentTaskStatus;
    }) => {
      const taskEntry = taskBundleEntry(buildTreatmentTaskUpdate(task, order, status));

      const cancelsPerform = treatmentTaskStatus(task) === "completed" && status !== "completed";
      const performed = cancelsPerform
        ? await fetchTreatmentPerformResources(order.id ?? "")
        : { procedures: [], administrations: [] };
      const performEntries = buildTreatmentPerformDeleteEntries(
        performed.procedures,
        performed.administrations,
      );

      return postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: [...performEntries, taskEntry],
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "treatment-worklist"] });
      // カルテのオーダーカードも進捗と実施情報を出しているので読み直させる。
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      // 取消では実施記録も消しているので、FHIR JSON 表示の実施記録も引き直させる。
      queryClient.invalidateQueries({ queryKey: ["Procedure", "search"] });
    },
  });
}

/**
 * 処置の実施登録。実施記録(Procedure 一式)と Task の完了を 1 つの
 * transaction で書き込む。Bundle の組み立ては treatmentResultHelpers を参照。
 */
export function useRegisterTreatmentPerform() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "treatment-worklist"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["Procedure", "search"] });
    },
  });
}

/**
 * 処置オーダーに紐づく有効な処置予約(1 オーダーに 1 件)。予約日時の変更は
 * オーダーの編集画面から行うので、編集を開くときに予約の現物を用意しておく。
 */
export function useTreatmentOrderAppointment(srId: string | undefined) {
  const params = new URLSearchParams();
  if (srId) params.set("based-on", `ServiceRequest/${srId}`);

  const query = useQuery({
    queryKey: ["Appointment", "treatment-order", srId],
    queryFn: () => searchResource<fhir4.Appointment>("Appointment", params),
    enabled: Boolean(srId),
  });

  return {
    ...query,
    appointment: (query.data?.data.entry ?? [])
      .map((e) => e.resource)
      .filter((r): r is fhir4.Appointment => r?.resourceType === "Appointment")
      .find(isActiveAppointment),
  };
}

/**
 * 処置オーダーの更新。予約日時を変えたときは、予約の付け替え(Appointment の
 * 日時と枠の busy/free)も同じ transaction で書く。オーダーだけ・予約だけが動いて
 * 実施日時が食い違うことを防ぐため。
 */
export function useUpdateTreatmentOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      bundle,
      booking,
    }: {
      bundle: fhir4.Bundle;
      booking: RadBookingChange | null;
    }) => {
      if (!booking) return postBundle(bundle);
      // 空きに戻す元の枠は参照しか持っていないので、ここで引き直す(取消と同じ)。
      const entries = buildRescheduleEntries(
        booking.appointment,
        await fetchAppointmentSlots(booking.appointment),
        booking.slots,
      );
      return postBundle({ ...bundle, entry: [...(bundle.entry ?? []), ...entries] });
    },
    onSuccess: () => {
      // 実施日時が動くと処置一覧の当日ぶんも変わるので、ServiceRequest は
      // まとめて読み直させる。
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
      invalidateAppointments(queryClient);
    },
  });
}

// 処置オーダーも明細が独立した ServiceRequest なので、ヘッダだけ消すと明細が
// 残ってしまう。消す直前に明細を引き直してからまとめて消す(生理検査と同じ)。
export function useDeleteTreatmentOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (srId: string) => {
      const params = new URLSearchParams();
      params.set("_id", srId);
      params.set("_revinclude:iterate", "ServiceRequest:based-on");
      const { data: bundle } = await searchResource<fhir4.ServiceRequest>("ServiceRequest", params);
      const itemRequests = treatmentOrderItemRequests(serviceRequestsOf(bundle), srId);
      const itemIds = itemRequests
        .map((request) => request.id)
        .filter((id): id is string => Boolean(id));

      const appointmentEntries = await fetchTreatmentAppointmentCancelEntries(srId);

      return postBundle(buildTreatmentOrderDeleteBundle(srId, itemIds, appointmentEntries));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
      queryClient.invalidateQueries({ queryKey: ["Appointment"] });
      queryClient.invalidateQueries({ queryKey: ["Slot"] });
    },
  });
}

/** オーダーヘッダに紐づく有効な処置予約の取消エントリ。予約が無ければ空。 */
async function fetchTreatmentAppointmentCancelEntries(srId: string): Promise<fhir4.BundleEntry[]> {
  const params = new URLSearchParams();
  params.set("based-on", `ServiceRequest/${srId}`);
  const { data: bundle } = await searchResource<fhir4.Appointment>("Appointment", params);
  const appointments = (bundle.entry ?? [])
    .map((e) => e.resource)
    .filter((r): r is fhir4.Appointment => r?.resourceType === "Appointment")
    .filter(isActiveAppointment);

  const entries: fhir4.BundleEntry[] = [];
  for (const appointment of appointments) {
    entries.push(...buildCancelEntries(appointment, await fetchAppointmentSlots(appointment)));
  }
  return entries;
}


// ---- 食事オーダー ----
//
// 明細も進捗 Task も持たないので、どの問い合わせも ServiceRequest 1 本で済む。

export function useMealOrderDetail(srId: string | undefined) {
  const params = new URLSearchParams();
  if (srId) params.set("_id", srId);

  return useQuery({
    queryKey: ["ServiceRequest", "detail", "meal-order", srId],
    queryFn: () => searchResource<fhir4.ServiceRequest>("ServiceRequest", params),
    enabled: Boolean(srId),
  });
}

/**
 * まだ続いている食事オーダー。食事変更のときに前のオーダーを終了させるため、
 * 新規登録の画面が「今どの食事が出ているか」を出すのに使う。
 *
 * 終了はローカル拡張なので上流では絞れない。有効なオーダーを引いてから、
 * 基準日(新しい食事の開始日)にまだ続いているものだけをここで残す。
 */
export function useActiveMealOrders(patientId: string | undefined, at: string) {
  const params = new URLSearchParams();
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("category", `${ORDER_TYPE_SYSTEM}|${MEAL_ORDER_TYPE.code}`);
  params.set("status", "active");
  params.set("_sort", "-authoredon");
  params.set("_count", "20");

  return useQuery({
    queryKey: ["ServiceRequest", "search", "meal-active", patientId, at],
    queryFn: async () => {
      const { data: bundle } = await searchResource<fhir4.ServiceRequest>(
        "ServiceRequest",
        params,
      );
      return serviceRequestsOf(bundle)
        .filter(isMealServiceRequest)
        .filter((sr) => isMealOrderRunningOn(sr, at));
    },
    enabled: Boolean(patientId) && Boolean(at),
  });
}

/**
 * その患者の有効な食事オーダー。退院で止める対象を選ぶのに使う。
 *
 * useActiveMealOrders と違って基準日を取らないのは、退院日を打ち替えるたびに
 * 引き直したくないため。どれを止めるかは退院日とその日のどの食事までかで決まるので、
 * 絞り込み(mealOrderNeedsStop)は画面側で行う。
 */
export function usePatientMealOrders(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("category", `${ORDER_TYPE_SYSTEM}|${MEAL_ORDER_TYPE.code}`);
  params.set("status", "active");
  // 新しい順。まだ続いているオーダーは必ずこの中に入るので 1 ページで足りる。
  params.set("_sort", "-authoredon");
  params.set("_count", "20");

  return useQuery({
    queryKey: ["ServiceRequest", "search", "meal-patient", patientId],
    queryFn: async () => {
      const { data: bundle } = await searchResource<fhir4.ServiceRequest>("ServiceRequest", params);
      return serviceRequestsOf(bundle).filter(isMealServiceRequest);
    },
    enabled: Boolean(patientId),
  });
}

/**
 * カレンダーに出す 1 か月ぶんの食事オーダー。
 *
 * 食事は開始したら次の指示まで続くので、その月に始まったものだけでは足りない
 * (前の月から続いているオーダーがその月の食事を決めていることがある)。月末までに
 * 始まった有効なオーダーを引き、月初より前に終わったものをここで落とす。
 * 終了はローカル拡張なので上流では絞れない(useActiveMealOrders と同じ事情)。
 */
export function useMealOrderMonth(patientId: string | undefined, monthStart: string, monthEnd: string) {
  const params = new URLSearchParams();
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("category", `${ORDER_TYPE_SYSTEM}|${MEAL_ORDER_TYPE.code}`);
  params.set("status", "active");
  params.set("occurrence", `le${monthEnd}`);
  // 1 患者の食事オーダーは入院 1 回でせいぜい数十件なので 1 ページで足りる。
  params.set("_count", "100");

  return useQuery({
    queryKey: ["ServiceRequest", "search", "meal-month", patientId, monthStart, monthEnd],
    queryFn: async () => {
      const { data: bundle } = await searchResource<fhir4.ServiceRequest>("ServiceRequest", params);
      return serviceRequestsOf(bundle)
        .filter(isMealServiceRequest)
        .filter((sr) => mealOrderEndsOnOrAfter(sr, monthStart));
    },
    enabled: Boolean(patientId) && Boolean(monthStart) && Boolean(monthEnd),
  });
}

export function useUpdateMealOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      // 開始日が動くとカードの載る日も変わるので、まとめて読み直させる。
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
    },
  });
}

/** 明細も予約も持たないので、ヘッダ 1 件を消すだけ。 */
export function useDeleteMealOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (srId: string) => deleteResource("ServiceRequest", srId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
    },
  });
}

// ---- 手術オーダー ----
//
// 処置と同じくヘッダと明細(術式)が別リソースなので 1 リクエストにまとめて取る。
// 第 1 段階(申込〜日程確保)では実施記録・予約を持たないため、削除で片付ける対象は
// ヘッダと明細だけ、進捗の変更も Task 1 件の書き込みだけになる。

export function useSurgeryOrderDetail(srId: string | undefined) {
  const params = new URLSearchParams();
  if (srId) params.set("_id", srId);
  params.set("_revinclude:iterate", "ServiceRequest:based-on");

  return useQuery({
    queryKey: ["ServiceRequest", "detail", "surgery-order", srId],
    queryFn: () => searchResource<fhir4.ServiceRequest>("ServiceRequest", params),
    enabled: Boolean(srId),
  });
}

/** 手術一覧の 1 行。オーダー(ヘッダ)1 件ぶん。 */
export interface SurgeryWorklistRow {
  order: fhir4.ServiceRequest;
  /** 術式(明細)。並び順のとおりで、先頭が主術式。 */
  itemRequests: fhir4.ServiceRequest[];
  patient?: fhir4.Patient;
  /** 進捗。手術部がまだ触っていないオーダーには無い(= 申込済)。 */
  task?: fhir4.Task;
}

export interface SurgeryWorklistResult {
  rows: SurgeryWorklistRow[];
  /** 上限まで読んでも読み切れなかった。 */
  truncated: boolean;
}

async function fetchSurgeryWorklist(date: string): Promise<SurgeryWorklistResult> {
  const orders: fhir4.ServiceRequest[] = [];
  const items: fhir4.ServiceRequest[] = [];

  const { patientsById, tasks, truncated } = await fetchWorklistBundles(
    (page) => {
      // 予定手術日(occurrencePeriod)で絞る。日程未定の申込は一覧の対象外
      // (申込済のまま日程が決まっていないオーダーはカルテ側から辿る)。
      const params = worklistParams(
        `${ORDER_TYPE_SYSTEM}|${SURGERY_ORDER_TYPE.code}`,
        date,
        page,
        "occurrence",
      );
      // 術式も同じ応答に添えてもらう。
      params.set("_revinclude:iterate", "ServiceRequest:based-on");
      params.set("_revinclude", "Task:focus");
      return params;
    },
    (resource) => {
      if (resource.resourceType !== "ServiceRequest") return false;
      const request = resource as fhir4.ServiceRequest;
      // 検索にヒットしたヘッダと、添えられた明細を分ける。
      if (isSurgeryServiceRequest(request) && !request.basedOn?.length) {
        orders.push(request);
        return true;
      }
      items.push(request);
      return false;
    },
  );

  const taskByOrderId = surgeryTasksByOrderId(tasks);

  const rows = orders.map((order) => ({
    order,
    itemRequests: surgeryOrderItemRequests(items, order.id ?? ""),
    patient: patientsById.get(order.subject?.reference?.split("/").pop() ?? ""),
    task: taskByOrderId.get(order.id ?? ""),
  }));

  // 手術室 → 入室予定時刻の順。同じ部屋の時間の重なり(ダブルブッキング)が
  // 並びでそのまま見えるようにする(第 1 段階は枠を持たず目視で確かめるため)。
  rows.sort((a, b) => surgeryWorklistSortKey(a).localeCompare(surgeryWorklistSortKey(b)));

  return { rows, truncated };
}

function surgeryWorklistSortKey(row: SurgeryWorklistRow): string {
  const summary = summarizeSurgeryOrder(row.order);
  return `${summary.roomName || "〜"}|${summary.scheduledTime || "99:99"}`;
}

/**
 * 日程未定の手術申込。予定手術日を入れずに申し込まれたもの(= 手術部が枠を割り当てる
 * のを待っている申込)を集める。日付で絞れないので `occurrence:missing` で引く。
 *
 * 希望日を書いた申込は occurrence を持つのでここには出ない(予定日別タブのその日に
 * 「申込済」として出る)。手術部の待ち行列が 2 か所に分かれるが、1 か所に集めるには
 * 希望日と確定日を別要素で持つか登録時から Task を作る必要があり、どちらも高くつく。
 */
export function useSurgeryUnscheduledList() {
  return useQuery({
    queryKey: ["ServiceRequest", "surgery-unscheduled"],
    queryFn: () => fetchSurgeryUnscheduled(),
    placeholderData: keepPreviousData,
  });
}

async function fetchSurgeryUnscheduled(): Promise<SurgeryWorklistResult> {
  const orders: fhir4.ServiceRequest[] = [];
  const items: fhir4.ServiceRequest[] = [];

  const { patientsById, tasks, truncated } = await fetchWorklistBundles(
    (page) => {
      const params = new URLSearchParams();
      params.set("category", `${ORDER_TYPE_SYSTEM}|${SURGERY_ORDER_TYPE.code}`);
      params.set("occurrence:missing", "true");
      params.set("based-on:missing", "true");
      params.set("_count", String(WORKLIST_PAGE));
      params.set("_offset", String(page * WORKLIST_PAGE));
      params.set("_include", "ServiceRequest:subject");
      params.set("_revinclude:iterate", "ServiceRequest:based-on");
      params.set("_revinclude", "Task:focus");
      return params;
    },
    (resource) => {
      if (resource.resourceType !== "ServiceRequest") return false;
      const request = resource as fhir4.ServiceRequest;
      if (isSurgeryServiceRequest(request) && !request.basedOn?.length) {
        orders.push(request);
        return true;
      }
      items.push(request);
      return false;
    },
  );

  const taskByOrderId = surgeryTasksByOrderId(tasks);

  const rows = orders.map((order) => ({
    order,
    itemRequests: surgeryOrderItemRequests(items, order.id ?? ""),
    patient: patientsById.get(order.subject?.reference?.split("/").pop() ?? ""),
    task: taskByOrderId.get(order.id ?? ""),
  }));

  // 緊急を先頭に、あとは申込日の古い順(待たせている順)。
  rows.sort((a, b) => {
    const urgency = surgeryUrgencyRank(a.order) - surgeryUrgencyRank(b.order);
    if (urgency !== 0) return urgency;
    return (a.order.authoredOn ?? "").localeCompare(b.order.authoredOn ?? "");
  });

  return { rows, truncated };
}

/** 緊急 → 準緊急 → 予定 の順に小さい値を返す。 */
function surgeryUrgencyRank(order: fhir4.ServiceRequest): number {
  if (order.priority === "stat") return 0;
  if (order.priority === "urgent") return 1;
  return 2;
}

/**
 * 日程の確定。オーダーの日程と Task(受付済 = 日程確定)を 1 transaction で書く。
 * 片方だけ通ると「日程は入ったが未受付」「受付済だが日程未定」になってしまう。
 */
export function useConfirmSurgerySchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      order,
      task,
      values,
    }: {
      order: fhir4.ServiceRequest;
      task: fhir4.Task | undefined;
      values: SurgeryScheduleValues;
    }) => {
      const scheduled = buildSurgeryScheduleServiceRequest(order, values);
      return postBundle(
        buildSurgeryScheduleBundle(
          order,
          values,
          // Task には確定後のオーダー(priority・requester)を渡す。
          taskBundleEntry(buildSurgeryTaskUpdate(task, scheduled, "accepted")),
        ),
      );
    },
    onSuccess: () => {
      // 予定日が入ると予定日別タブにも移るので、手術関連はまとめて読み直させる。
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
    },
  });
}

/**
 * 手術室カレンダーのドラッグ＆ドロップによる日程の移動。
 *
 * 動かすのは予定日時と手術室だけで、進捗(Task)は触らない
 * (buildSurgeryMoveBundle 参照)。所要時間は呼び出し側が今の値をそのまま渡す。
 */
export function useMoveSurgerySchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      order,
      values,
    }: {
      order: fhir4.ServiceRequest;
      values: SurgeryScheduleValues;
    }) => postBundle(buildSurgeryMoveBundle(order, values)),
    onSuccess: () => {
      // 日付をまたぐ移動があるので、日別のキャッシュをまとめて読み直させる。
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
    },
  });
}

/**
 * 日程未定のまま入室する(緊急手術)。押した日時をそのまま予定日時にして、
 * Task を入室中にするところまでを 1 transaction で書く。
 *
 * 緊急手術は日程を決めてから始めるものではないので、「日程を確定 → 入室」の
 * 2 操作を踏ませると現場が先に手術を始めて記録が後追いになる。入室した事実の方が
 * 確かなので、それを予定日時として記録し、以後は予定日別タブの当日ぶんに並べる。
 */
export function useAdmitUnscheduledSurgery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      order,
      task,
      now,
    }: {
      order: fhir4.ServiceRequest;
      task: fhir4.Task | undefined;
      /** 入室日時。datetime-local の入力形式(YYYY-MM-DDTHH:mm)。 */
      now: string;
    }) => {
      const summary = summarizeSurgeryOrder(order);
      // 日程だけを埋める。所要時間・手術室は申込で希望していればそのまま残す。
      const values: SurgeryScheduleValues = {
        scheduledDate: now.slice(0, 10),
        scheduledTime: now.slice(11, 16),
        durationMinutes: summary.durationMinutes != null ? String(summary.durationMinutes) : "",
        roomId: summary.roomId,
        roomName: summary.roomName,
      };
      const scheduled = buildSurgeryScheduleServiceRequest(order, values);
      return postBundle(
        buildSurgeryScheduleBundle(
          order,
          values,
          taskBundleEntry(buildSurgeryTaskUpdate(task, scheduled, "in-progress")),
        ),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
    },
  });
}

/**
 * 予定手術日 1 日ぶんの手術オーダーの取得条件。
 *
 * 登録の直前にキャッシュを介さず引き直したい場面(ダブルブッキングの確認。
 * useSurgeryConflictCheck)があるので、キーと取得関数を 1 か所にまとめて
 * queryClient.fetchQuery からも同じものを使えるようにしてある。
 */
export function surgeryWorklistQuery(date: string) {
  return {
    queryKey: ["ServiceRequest", "surgery-worklist", date] as const,
    queryFn: () => fetchSurgeryWorklist(date),
  };
}

/** 予定手術日 1 日ぶんの手術オーダー。日付が未選択の間は読みに行かない。 */
export function useSurgeryWorklist(date: string) {
  return useQuery({
    ...surgeryWorklistQuery(date),
    enabled: Boolean(date),
    placeholderData: keepPreviousData,
  });
}

/**
 * 手術室カレンダーの週表示が読む 7 日ぶん。
 *
 * 日別のクエリを 7 本並べるだけなので、キャッシュは一覧・日表示とそのまま共有
 * される(週を見てから日へ降りるときに読み直しが起きない)。
 */
export function useSurgeryWorklistWeek(dates: string[]) {
  return useQueries({
    queries: dates.map((date) => ({
      ...surgeryWorklistQuery(date),
      enabled: Boolean(date),
      placeholderData: keepPreviousData,
    })),
  });
}

/**
 * 実施の取消で片付ける実施記録。ハブにぶら下がる薬剤と測定値も 1 リクエストで集める。
 *
 * 一覧が持っている行の情報からではなく、その場で引き直す。取消は稀な操作で、
 * 一覧を開いた後に別の端末で登録された実施記録も残さず消したいため(処置と同じ)。
 */
function surgeryPerformSearchParams(orderId: string): URLSearchParams {
  const params = new URLSearchParams();
  params.set("based-on", `ServiceRequest/${orderId}`);
  params.set("_count", "100");
  params.append("_revinclude", "MedicationAdministration:part-of");
  params.append("_revinclude", "Observation:part-of");
  return params;
}

async function fetchSurgeryPerformResources(orderId: string) {
  const { data: bundle } = await searchResource<fhir4.Resource>(
    "Procedure",
    surgeryPerformSearchParams(orderId),
  );

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
 * 手術の実施記録(Procedure 一式)。オーダーとは別リソースでオーダーの検索から
 * 辿れないので別に引く。カルテカードの FHIR JSON 表示で使う。
 */
export function useSurgeryPerformDetail(orderId: string | undefined) {
  return useQuery({
    queryKey: ["Procedure", "search", "surgery-perform", orderId],
    queryFn: () =>
      searchResource<fhir4.Resource>("Procedure", surgeryPerformSearchParams(orderId ?? "")),
    enabled: Boolean(orderId),
  });
}

/**
 * 受付(日程確定)・入室・中止などの進捗を書き込む。Task がまだ無いオーダーでは新しく作る。
 * 実施済から戻す(実施取消)ときは、実施記録も同じ transaction で消す
 * (放射線検査と同じ理由。docs/rad-result-design.md §7-6)。
 */
export function useUpdateSurgeryTaskStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      order,
      task,
      status,
    }: {
      order: fhir4.ServiceRequest;
      task: fhir4.Task | undefined;
      status: SurgeryTaskStatus;
    }) => {
      const taskEntry = taskBundleEntry(buildSurgeryTaskUpdate(task, order, status));

      const cancelsPerform = surgeryTaskStatus(task) === "completed" && status !== "completed";
      const performed = cancelsPerform
        ? await fetchSurgeryPerformResources(order.id ?? "")
        : { procedures: [], administrations: [], observations: [] };
      const performEntries = buildSurgeryPerformDeleteEntries(
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
      invalidateSurgery(queryClient);
    },
  });
}

/**
 * 手術の実施登録。実施記録一式と Task の実施済を 1 つの transaction で書き込む。
 * Bundle の組み立ては surgeryResultHelpers を参照。
 */
export function useRegisterSurgeryPerform() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      invalidateSurgery(queryClient);
    },
  });
}

/**
 * 手術の進捗・実施記録が動いたときに読み直させるもの。日程未定タブは
 * 中止・入室でも中身が変わるので必ず含める。
 */
function invalidateSurgery(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "surgery-worklist"] });
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "surgery-unscheduled"] });
  // カルテのオーダーカードも進捗と実施情報を出しているので読み直させる。
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
  // 取消では実施記録も消しているので、FHIR JSON 表示の実施記録も引き直させる。
  queryClient.invalidateQueries({ queryKey: ["Procedure", "search"] });
}

/** 手術オーダーの更新。ヘッダ + 明細の transaction を書くだけ(予約の付け替えは無い)。 */
export function useUpdateSurgeryOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      // 予定日時が動くと手術一覧の当日ぶんも変わるので、ServiceRequest は
      // まとめて読み直させる。
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
    },
  });
}

// 手術オーダーも明細が独立した ServiceRequest なので、ヘッダだけ消すと明細が
// 残ってしまう。消す直前に明細を引き直してからまとめて消す(処置と同じ)。
// 術前指示をテンプレートから書いていれば、その回答も一緒に消す(孤児を残さない)。
export function useDeleteSurgeryOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (srId: string) => {
      const params = new URLSearchParams();
      params.set("_id", srId);
      params.set("_revinclude:iterate", "ServiceRequest:based-on");
      const { data: bundle } = await searchResource<fhir4.ServiceRequest>("ServiceRequest", params);
      const requests = serviceRequestsOf(bundle);
      const itemIds = surgeryOrderItemRequests(requests, srId)
        .map((request) => request.id)
        .filter((id): id is string => Boolean(id));
      const responseIds = surgeryOrderResponseIds(requests);

      return postBundle(buildSurgeryOrderDeleteBundle(srId, itemIds, responseIds));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
    },
  });
}


// ---- 麻酔チャート(docs/anesthesia-chart-design.md) ----

/**
 * part-of の子を _offset でページングして全件読む。5 分毎の打点 × 数時間で
 * 100 件を超えるのが普通なので、実施記録のような 1 ページ読みでは足りない。
 * ページ数の上限は暴走ガード(超えたら以降を捨てる。20 ページ = 2000 件)。
 */
async function fetchAllByPartOf<T extends fhir4.Resource>(
  resourceType: string,
  hubId: string,
): Promise<T[]> {
  const collected: T[] = [];
  for (let page = 0; page < 20; page += 1) {
    const params = new URLSearchParams();
    params.set("part-of", `Procedure/${hubId}`);
    params.set("_count", "100");
    params.set("_offset", String(page * 100));
    const { data: bundle } = await searchResource<T>(resourceType, params);
    const resources = (bundle.entry ?? [])
      .filter((entry) => entry.search?.mode !== "include")
      .map((entry) => entry.resource)
      .filter((resource): resource is T => resource?.resourceType === resourceType);
    collected.push(...resources);
    const total = bundle.total;
    if (resources.length < 100 || (total != null && collected.length >= total)) break;
  }
  return collected;
}

async function fetchAnesthesiaChart(orderId: string): Promise<AnesthesiaChartData | null> {
  const params = new URLSearchParams();
  params.set("based-on", `ServiceRequest/${orderId}`);
  params.set("_count", "100");
  const { data: bundle } = await searchResource<fhir4.Procedure>("Procedure", params);
  const hub = (bundle.entry ?? [])
    .map((entry) => entry.resource)
    .filter((resource): resource is fhir4.Procedure => resource?.resourceType === "Procedure")
    .find(
      (procedure) => isAnesthesiaChartHub(procedure) && procedure.status !== "entered-in-error",
    );
  if (!hub?.id) return null;

  const [observations, administrations] = await Promise.all([
    fetchAllByPartOf<fhir4.Observation>("Observation", hub.id),
    fetchAllByPartOf<fhir4.MedicationAdministration>("MedicationAdministration", hub.id),
  ]);
  return buildAnesthesiaChartData(hub, observations, administrations);
}

/** オーダー 1 件の麻酔チャート。無ければ null(ページは「開始」ボタンを出す)。 */
export function useAnesthesiaChart(orderId: string | undefined) {
  return useQuery({
    queryKey: ["anesthesia-chart", orderId],
    queryFn: () => fetchAnesthesiaChart(orderId ?? ""),
    enabled: Boolean(orderId),
  });
}

/**
 * チャートへの書き込み。開始(ハブ POST)・打点/イベント/薬剤の追加・持続の終了や
 * 確定(PUT)・削除まで、すべて transaction Bundle のエントリで受ける。打点は
 * 1 時点の組を 1 transaction で書き、途中失敗で組が欠けないようにする。
 */
export function useAnesthesiaChartWrite(orderId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entries: fhir4.BundleEntry[]) =>
      postBundle({ resourceType: "Bundle", type: "transaction", entry: entries }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["anesthesia-chart", orderId] });
      // 実施取消のフェッチ(based-on 検索)にもチャートの子が載るので読み直させる。
      queryClient.invalidateQueries({ queryKey: ["Procedure", "search"] });
    },
  });
}

// ---- 病理検査オーダー ----

// 病理オーダーもヘッダと検体明細が別リソースなので、検体検査・細菌検査と同じ形で
// 1 リクエストにまとめて取る。
export function usePathoOrderDetail(srId: string | undefined) {
  const params = new URLSearchParams();
  if (srId) params.set("_id", srId);
  params.set("_revinclude:iterate", "ServiceRequest:based-on");

  return useQuery({
    queryKey: ["ServiceRequest", "detail", "patho-order", srId],
    queryFn: () => searchResource<fhir4.ServiceRequest>("ServiceRequest", params),
    enabled: Boolean(srId),
  });
}

// 検体明細が独立した ServiceRequest なので、消す直前に明細を引き直してから
// まとめて消す(検体検査・細菌検査と同じ)。
export function useDeletePathoOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (srId: string) => {
      const params = new URLSearchParams();
      params.set("_id", srId);
      params.set("_revinclude:iterate", "ServiceRequest:based-on");
      const { data: bundle } = await searchResource<fhir4.ServiceRequest>("ServiceRequest", params);
      const requests = serviceRequestsOf(bundle);
      const itemIds = pathoOrderItemRequests(requests, srId)
        .map((request) => request.id)
        .filter((id): id is string => Boolean(id));
      // テンプレートの記入内容も一緒に消す(オーダーが消えると誰も参照しなくなるため)。
      const responseIds = pathoOrderResponseIds(requests.filter((r) => r.id === srId));
      return postBundle(buildPathoOrderDeleteBundle(srId, itemIds, responseIds));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
    },
  });
}

// ---- 病理検査一覧(部門ワークリスト) ----
//
// 採取(予定)日で 1 日ぶんの病理検査オーダーを読む。画面の作りは検体検査一覧と同じで、
// 検査区分・入外区分・病棟・診療科・進捗での絞り込みは画面側で行う
// (理由は検体検査一覧の節のコメントを参照)。

/** 病理検査一覧の 1 行。オーダー(ヘッダ)1 件ぶん。 */
export interface PathoWorklistRow {
  order: fhir4.ServiceRequest;
  /** 検体明細。臓器・検体タイプはここから組み立てる。 */
  itemRequests: fhir4.ServiceRequest[];
  patient?: fhir4.Patient;
  /** 進捗。部門がまだ触っていないオーダーには無い(= 依頼済)。 */
  task?: fhir4.Task;
  /** このオーダーを元に登録済みの病理レポートの id。空ならレポートはまだ無い。 */
  reportId: string;
  /** レポートの報告区分(preliminary / final / amended)。 */
  reportStatus: string;
}

export interface PathoWorklistResult {
  rows: PathoWorklistRow[];
  /** 上限まで読んでも読み切れなかった。 */
  truncated: boolean;
}

async function fetchPathoWorklist(date: string): Promise<PathoWorklistResult> {
  const orders: fhir4.ServiceRequest[] = [];
  const items: fhir4.ServiceRequest[] = [];
  // オーダー id → そのオーダーを元にした病理レポート(id と報告区分)。
  const reportByOrderId = new Map<string, { id: string; status: string }>();

  const { patientsById, tasks, truncated } = await fetchWorklistBundles(
    (page) => {
      const params = worklistParams(
        `${ORDER_TYPE_SYSTEM}|${PATHO_ORDER_TYPE.code}`,
        date,
        page,
        "occurrence",
      );
      // 検体明細・進捗・病理レポートも同じ応答に添えてもらう。
      params.set("_revinclude:iterate", "ServiceRequest:based-on");
      params.append("_revinclude", "Task:focus");
      params.append("_revinclude", "DiagnosticReport:based-on");
      return params;
    },
    (resource) => {
      if (resource.resourceType === "DiagnosticReport") {
        const report = resource as fhir4.DiagnosticReport;
        for (const reference of report.basedOn ?? []) {
          const orderId = reference.reference?.match(/^ServiceRequest\/(.+)$/)?.[1];
          if (orderId && report.id) {
            reportByOrderId.set(orderId, { id: report.id, status: report.status });
          }
        }
      } else if (resource.resourceType === "ServiceRequest") {
        const request = resource as fhir4.ServiceRequest;
        // 検索にヒットしたヘッダと、添えられた明細を分ける。
        if (isPathoServiceRequest(request) && !request.basedOn?.length) {
          orders.push(request);
          return true;
        }
        items.push(request);
      }
      return false;
    },
  );

  const taskByOrderId = pathoTasksByOrderId(tasks);

  const rows = orders.map((order) => {
    const report = reportByOrderId.get(order.id ?? "");
    return {
      order,
      itemRequests: pathoOrderItemRequests(items, order.id ?? ""),
      patient: patientsById.get(order.subject?.reference?.split("/").pop() ?? ""),
      task: taskByOrderId.get(order.id ?? ""),
      reportId: report?.id ?? "",
      reportStatus: report?.status ?? "",
    };
  });

  // 病理オーダーは採取時刻を持つこともあるが、日単位の一覧では患者番号順が扱いやすい。
  rows.sort(comparePatientNumber);

  return { rows, truncated };
}

/** 採取(予定)日 1 日ぶんの病理検査オーダー。日付が未選択の間は読みに行かない。 */
export function usePathoWorklist(date: string) {
  return useQuery({
    queryKey: ["ServiceRequest", "patho-worklist", date],
    queryFn: () => fetchPathoWorklist(date),
    enabled: Boolean(date),
    placeholderData: keepPreviousData,
  });
}

/** 受付などの進捗を書き込む(組み立ては makeUpdateTaskStatusHook を参照)。 */
export const useUpdatePathoTaskStatus = makeUpdateTaskStatusHook<PathoTaskStatus>(
  buildPathoTaskUpdate,
  "patho-worklist",
);

// ---- 病理診断レポート ----

function fetchPathoOrderCandidates(patientId: string): Promise<LabOrderCandidate[]> {
  return fetchOrderCandidates(patientId, isPathoServiceRequest, pathoOrderLabel);
}

/** 病理レポートに紐付ける病理検査オーダーの候補。 */
export function usePathoOrderCandidates(
  patientId: string | undefined,
  currentReportId?: string,
) {
  return useOrderCandidatesQuery(
    ["ServiceRequest", "search", "patho-order-candidates", patientId],
    fetchPathoOrderCandidates,
    patientId,
    currentReportId,
  );
}

/**
 * 病理タブの報告日ペイン用。組織診(SP)・細胞診(CP)の両方を新しい順で返す。
 * category はトークン検索なのでカンマ区切りで OR になる。
 */
export function usePathoResultEntries(patientId: string | undefined) {
  const query = useResultSummariesQuery("SP,CP", patientId);
  return {
    entries: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
  };
}

// 内容表示・編集の取得は検体検査結果と同じ形(_id + result / specimen の _include)。
export function usePathoResultDetail(reportId: string | undefined) {
  return useLabResultDetail(reportId);
}

// 病理レポートを保存・削除するとオーダーの紐付け状況が変わるため、
// 病理オーダーの候補(["ServiceRequest", "search"] 配下)も無効化する。
export function useCreatePathoResult() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "patho-worklist"] });
    },
  });
}

export function useUpdatePathoResult() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "search"] });
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "detail"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "patho-worklist"] });
    },
  });
}

export function useDeletePathoResult() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (reportId: string) => {
      // 削除対象の Observation / Specimen は DiagnosticReport の参照から辿る。
      const { data: report } = await readResource<fhir4.DiagnosticReport>(
        "DiagnosticReport",
        reportId,
      );
      return postBundle(
        buildPathoResultDeleteBundle(
          reportId,
          observationIdsFromReport(report),
          specimenIdsFromReport(report),
        ),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "patho-worklist"] });
    },
  });
}

// ---- 輸血オーダー ----

// 輸血オーダーもヘッダと製剤明細が別リソースなので、病理・検体検査と同じ形で
// 1 リクエストにまとめて取る。
export function useTransfusionOrderDetail(srId: string | undefined) {
  const params = new URLSearchParams();
  if (srId) params.set("_id", srId);
  params.set("_revinclude:iterate", "ServiceRequest:based-on");

  return useQuery({
    queryKey: ["ServiceRequest", "detail", "transfusion-order", srId],
    queryFn: () => searchResource<fhir4.ServiceRequest>("ServiceRequest", params),
    enabled: Boolean(srId),
  });
}

// 製剤明細が独立した ServiceRequest なので、消す直前に明細を引き直してから
// まとめて消す(病理・検体検査と同じ)。
export function useDeleteTransfusionOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (srId: string) => {
      const params = new URLSearchParams();
      params.set("_id", srId);
      params.set("_revinclude:iterate", "ServiceRequest:based-on");
      const { data: bundle } = await searchResource<fhir4.ServiceRequest>("ServiceRequest", params);
      const requests = serviceRequestsOf(bundle);
      const itemIds = transfusionOrderItemRequests(requests, srId)
        .map((request) => request.id)
        .filter((id): id is string => Boolean(id));
      return postBundle(buildTransfusionOrderDeleteBundle(srId, itemIds));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
    },
  });
}

// ---- 輸血の事前検査(血液型・不規則抗体)の参照 ----
//
// 輸血オーダー画面に読み取り専用で並べるためだけの検索。オーダーには参照を保存せず
// (正本は検査結果側。docs/transfusion-order-design.md §2.5)、書く医師が取り違えに
// 気付けるようにするのが目的。
//
// LOINC コードで直接引くのは、この 3 項目が「どの検査オーダーで出したか」に関係なく
// 患者に 1 つ定まる値だから(検査結果の一覧から探させると、輸血のたびに医師が
// 過去の検体検査を辿ることになる)。

/** ABO 血液型 / RhD 血液型 / 不規則抗体スクリーニング の LOINC。 */
export const PRETRANSFUSION_LOINC = {
  abo: "883-9",
  rhd: "10331-7",
  antibodyScreen: "890-4",
} as const;

export interface PretransfusionResult {
  /** 表示名(ABO血液型 など)。 */
  label: string;
  /** 結果の表示。まだ検査されていなければ空。 */
  value: string;
  /** 検査日 "YYYY-MM-DD"。 */
  date: string;
}

const PRETRANSFUSION_LABELS: { code: string; label: string }[] = [
  { code: PRETRANSFUSION_LOINC.abo, label: "ABO血液型" },
  { code: PRETRANSFUSION_LOINC.rhd, label: "RhD血液型" },
  { code: PRETRANSFUSION_LOINC.antibodyScreen, label: "不規則抗体" },
];

const LOINC_SYSTEM = "http://loinc.org";

/** Observation の値を 1 行の文字列にする(型・単位を問わず読める形にする)。 */
function observationValueText(observation: fhir4.Observation): string {
  if (observation.valueQuantity) {
    const { value, unit } = observation.valueQuantity;
    return value == null ? "" : `${value}${unit ?? ""}`;
  }
  if (observation.valueCodeableConcept) {
    const concept = observation.valueCodeableConcept;
    return concept.text ?? concept.coding?.find((c) => c.display)?.display ?? "";
  }
  if (observation.valueString) return observation.valueString;
  return "";
}

/**
 * 輸血前の検査結果(血液型・不規則抗体)。項目ごとに最新の 1 件だけを返す。
 * 検査されていない項目も「未検査」として出したいので、行そのものは常に 3 つ返す。
 */
export function usePretransfusionResults(patientId: string | undefined) {
  return useQuery({
    queryKey: ["Observation", "search", "pretransfusion", patientId],
    queryFn: async (): Promise<PretransfusionResult[]> => {
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      // コードはカンマ区切りで OR になる。3 項目を 1 検索でまとめて引く。
      params.set(
        "code",
        PRETRANSFUSION_LABELS.map(({ code }) => `${LOINC_SYSTEM}|${code}`).join(","),
      );
      params.set("_count", "50");
      params.set("_sort", "-date");

      const { data } = await searchResource<fhir4.Observation>("Observation", params);
      const observations = (data.entry ?? [])
        .map((entry) => entry.resource)
        .filter((r): r is fhir4.Observation => r?.resourceType === "Observation");

      return PRETRANSFUSION_LABELS.map(({ code, label }) => {
        // _sort=-date で新しい順に並んでいるので、最初に見つかったものが最新。
        const latest = observations.find((observation) =>
          observation.code?.coding?.some((c) => c.system === LOINC_SYSTEM && c.code === code),
        );
        return {
          label,
          value: latest ? observationValueText(latest) : "",
          date: (latest?.effectiveDateTime ?? latest?.issued ?? "").slice(0, 10),
        };
      });
    },
    enabled: Boolean(patientId),
    // オーダー画面を開くたびに引き直す必要は無い(血液型は変わらない)。
    staleTime: 5 * 60_000,
  });
}

// ---- 輸血一覧(部門ワークリスト) ----
//
// 投与予定日で 1 日ぶんの輸血オーダーを読む。画面の作りは病理検査一覧と同じで、
// 輸血検査区分・製剤区分・入外区分・病棟・診療科・進捗での絞り込みは画面側で行う
// (理由は検体検査一覧の節のコメントを参照)。
//
// 病理と違い DiagnosticReport は無い(輸血に結果レポートは無く、記録は実施記録側)。

/** 輸血一覧の 1 行。オーダー(ヘッダ)1 件ぶん。 */
export interface TransfusionWorklistRow {
  order: fhir4.ServiceRequest;
  /** 製剤明細。製剤名・単位数はここから組み立てる。 */
  itemRequests: fhir4.ServiceRequest[];
  patient?: fhir4.Patient;
  /** 進捗。部門がまだ触っていないオーダーには無い(= 依頼済)。 */
  task?: fhir4.Task;
}

export interface TransfusionWorklistResult {
  rows: TransfusionWorklistRow[];
  /** 上限まで読んでも読み切れなかった。 */
  truncated: boolean;
}

async function fetchTransfusionWorklist(date: string): Promise<TransfusionWorklistResult> {
  const orders: fhir4.ServiceRequest[] = [];
  const items: fhir4.ServiceRequest[] = [];

  const { patientsById, tasks, truncated } = await fetchWorklistBundles(
    (page) => {
      const params = worklistParams(
        `${ORDER_TYPE_SYSTEM}|${TRANSFUSION_ORDER_TYPE.code}`,
        date,
        page,
        "occurrence",
      );
      // 製剤明細と進捗も同じ応答に添えてもらう。
      params.set("_revinclude:iterate", "ServiceRequest:based-on");
      params.append("_revinclude", "Task:focus");
      return params;
    },
    (resource) => {
      if (resource.resourceType !== "ServiceRequest") return false;
      const request = resource as fhir4.ServiceRequest;
      // 検索にヒットしたヘッダと、添えられた明細を分ける。
      if (isTransfusionServiceRequest(request) && !request.basedOn?.length) {
        orders.push(request);
        return true;
      }
      items.push(request);
      return false;
    },
  );

  const taskByOrderId = transfusionTasksByOrderId(tasks);

  const rows = orders.map((order) => ({
    order,
    itemRequests: transfusionOrderItemRequests(items, order.id ?? ""),
    patient: patientsById.get(order.subject?.reference?.split("/").pop() ?? ""),
    task: taskByOrderId.get(order.id ?? ""),
  }));

  // 輸血オーダーは投与予定時刻を持つが、日単位の一覧では患者番号順が扱いやすい
  // (病理・検体検査と同じ)。
  rows.sort(comparePatientNumber);

  return { rows, truncated };
}

/** 投与予定日 1 日ぶんの輸血オーダー。日付が未選択の間は読みに行かない。 */
export function useTransfusionWorklist(date: string) {
  return useQuery({
    queryKey: ["ServiceRequest", "transfusion-worklist", date],
    queryFn: () => fetchTransfusionWorklist(date),
    enabled: Boolean(date),
    placeholderData: keepPreviousData,
  });
}

/** 受付などの進捗を書き込む(組み立ては makeUpdateTaskStatusHook を参照)。 */
export const useUpdateTransfusionTaskStatus = makeUpdateTaskStatusHook<TransfusionTaskStatus>(
  buildTransfusionTaskUpdate,
  "transfusion-worklist",
);
