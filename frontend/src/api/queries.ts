import { useMemo } from "react";
import { ADVERSE_EVENT_CATEGORY, parseAdverseEvent, type AdverseEventRecord } from "../fhir/adverseEventHelpers";
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import {
  groupVitalEntries,
  vitalDeleteBundle,
  vitalSaveBundle,
  VITAL_ENTRY_SYSTEM,
  DEFAULT_VITAL_THRESHOLDS,
} from "../fhir/vitalHelpers";
import {
  DISCHARGE_SUMMARY_TYPE_SEARCH,
  KARTE_NOTE_TYPE_SEARCH,
  buildClinicalNoteDeleteBundle,
} from "../fhir/clinicalNoteHelpers";
import type { DischargeSummarySources } from "../fhir/dischargeSummaryHelpers";
import {
  DOCUMENT_DUE_TASK_CODE,
  buildCompletedDocumentDueEntries,
  cancelDocumentDueEntries,
} from "../fhir/documentDueHelpers";
import {
  LOCATION_TYPE_CODES,
  locationDisplayName,
  sortLocations,
} from "../fhir/locationHelpers";
import { compareKarteDaysDesc, orderCardDay } from "../fhir/karteTimeline";
import {
  buildActivityProvenanceEntry,
  buildOrderProvenanceEntry,
  buildPathwayApplyProvenanceEntry,
  buildReviewProvenance,
  latestReview,
  provenancesOf,
  reviewProvenanceEntry,
  type OrderActivity,
  type OrderEnterer,
} from "../fhir/provenanceHelpers";
import { errorMessages } from "../fhir/outcome";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import {
  PATHWAY_APPLY_ID_SYSTEM,
  PATHWAY_LEVEL_SYSTEM,
  PATHWAY_MARKER_CODE,
  PATHWAY_MARKER_SYSTEM,
  parsePathwayApplication,
  pathwayInstantiatesUri,
  type PathwayApplicationRecord,
} from "../fhir/pathwayApplyHelpers";
import { PATHWAY_APPLY_GOAL_ID_SYSTEM } from "../fhir/pathwayCloseHelpers";
import { parsePathwayWardTasks, type PathwayWardTask } from "../fhir/pathwayWorklistHelpers";
import { buildPathwayEvaluationCards, type PathwayEvaluationCard } from "../fhir/pathwayKarteHelpers";
import { orderProgressByOrderId, type OrderProgress } from "../fhir/orderProgressHelpers";
import { EVALUATION_ITEM_SYSTEM } from "../fhir/pathwayEvaluationHelpers";
import { PATHWAY_VARIANCE_TASK_CODE } from "../fhir/pathwayVarianceHelpers";
import { useCurrentPractitioner } from "./authQueries";
import { nowFhirDateTime, today } from "../lib/dates";
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
  sortPlannedAdmissions,
  buildCancelledEncounter,
  buildDischargedEncounter,
  encounterBedId,
  encounterEvents,
  withEventWards,
  buildEncounterUpdateBundle,
  latestEncounterByBed,
  type EncounterEvent,
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
  type LabResultSubject,
  type LabResultSummary,
  type SpecimenRef,
} from "../fhir/labResultHelpers";
import { LAB_PANIC_NOTE, LAB_PANIC_TASK_CODE } from "../fhir/labPanicHelpers";
import {
  ALERT_PRIORITY_PARAM,
  buildCompletedNotificationTask,
  buildCancelledNotificationTask,
  completeNotificationEntry,
  hasTaskCode,
  notificationTaskEntry,
  splitNotificationBundle,
} from "../fhir/notificationHelpers";
import {
  RAD_CRITICAL_FINDING_NOTE,
  RAD_CRITICAL_FINDING_TASK_CODE,
  radCriticalFindingEntries,
} from "../fhir/radCriticalFindingHelpers";
import {
  RAD_REPORT_TOO_LARGE_MESSAGE,
  buildRadReportDeleteEntries,
  isRadReport,
  radCriticalFindingOf,
  radReportBundleTooLarge,
} from "../fhir/radReportHelpers";
import {
  RESULT_REVIEW_NOTE,
  RESULT_REVIEW_TASK_CODE,
  isReviewableReportStatus,
  resultReviewTaskEntries,
  urgentAwareReviewTaskEntries,
  urgentNotificationOpenAfter,
  type ReviewReportKind,
} from "../fhir/resultReviewHelpers";
import {
  completeNotificationEntries,
  notificationRows,
  NOTIFICATION_CODES,
  type NotificationRow,
} from "../components/notifications/notificationRegistry";
import { approvalTransactionEntries } from "./notificationActions";
import {
  approvalOrdersOfBundle,
  buildOrderApprovalTaskEntry,
} from "../fhir/orderApprovalTaskHelpers";
import { TASK_CODE_SYSTEM } from "../fhir/taskHelpers";
import { orderDay, referenceId } from "../fhir/shared";
import { HAS_LAB_MAPPED_TYPES, summarizeInfections, type InfectionRow } from "../fhir/infectionHelpers";
import {
  buildInjectionTaskUpdate,
  injectionTasksByOrderId,
  type InjectionTaskStatus,
} from "../fhir/injectionTaskHelpers";
import {
  buildInjectionPerformDeleteEntries,
  type InjectionPerformDisplay,
} from "../fhir/injectionPerformHelpers";
import {
  INJECTION_ORDER_TYPE,
  INJECTION_SERIES_SYSTEM,
  buildInjectionSeriesDeleteBundle,
  injectionSeriesOf,
  isInjectionServiceRequest,
  type InjectionDayTarget,
} from "../fhir/injectionHelpers";
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
  MICRO_ORDER_TYPE,
  buildMicroOrderDeleteBundle,
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
  transfusionTaskStatus,
  transfusionTasksByOrderId,
  type TransfusionTaskStatus,
} from "../fhir/transfusionTaskHelpers";
import { buildTransfusionPerformDeleteEntries } from "../fhir/transfusionResultHelpers";
import {
  buildPathoTaskUpdate,
  pathoTasksByOrderId,
  type PathoTaskStatus,
} from "../fhir/pathoTaskHelpers";
import {
  DEFAULT_PRESCRIPTION_CATEGORY,
  ORDER_TYPE_SYSTEM,
  PRESCRIPTION_CATEGORY_SYSTEM,
  buildPrescriptionDeleteBundle,
  departmentOf,
  groupByRp,
  isPrescriptionServiceRequest,
} from "../fhir/prescriptionHelpers";
import { rpEndDate } from "../fhir/medicationScheduleHelpers";
import { ingredientKey, type ActiveMedication } from "../fhir/medicationSafetyHelpers";
import {
  buildRxTaskUpdate,
  rxTaskStatus,
  rxTasksByOrderId,
  type RxTaskStatus,
} from "../fhir/rxTaskHelpers";
import {
  REGIMEN_ORDER_TYPE,
  buildRegimenMoveBundle,
  isRegimenServiceRequest,
  parseRegimenApplication,
  regimenDayOrderKind,
  regimenOrderOf,
  REGIMEN_INSTANCE_SYSTEM,
  sortByRp,
  completeRegimenEntry,
  discontinuationReasonLabel,
  holdRegimenEntry,
  revokeRegimenEntry,
  type RegimenDiscontinuation,
  type RegimenApplication,
  type RegimenDayOrder,
} from "../fhir/regimenOrderHelpers";
import {
  RAD_ORDER_TYPE,
  buildRadOrderDeleteBundle,
  isRadServiceRequest,
  radOrderItemRequests,
  radOrderResponseIds,
  radOrderTime,
} from "../fhir/radOrderHelpers";
import { buildRadPerformDeleteEntries, splitRadPerformBundle } from "../fhir/radResultHelpers";
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
  DEFAULT_MEAL_SCHEDULE,
  MEAL_ORDER_TYPE,
  isMealServiceRequest,
} from "../fhir/mealOrderHelpers";
import {
  NURSING_ORDER_TYPE,
  buildNursingOrderRevokeEntry,
  buildNursingOrderStopEntries,
  isNursingServiceRequest,
} from "../fhir/nursingOrderHelpers";
import { nursingPerformsByOrderId, type NursingPerformDisplay } from "../fhir/nursingPerformHelpers";
import {
  buildNursingTaskUpdate,
  isNursingTask,
  nursingTaskEntry,
  nursingTaskStatus,
  nursingTasksByOrderId,
  withTaskOwner,
} from "../fhir/nursingTaskHelpers";
import {
  REHAB_ORDER_TYPE,
  buildRehabOrderCloseEntry,
  buildRehabOrderStopEntries,
  isRehabServiceRequest,
} from "../fhir/rehabOrderHelpers";
import {
  buildRehabTaskUpdate,
  rehabTasksByOrderId,
  type RehabTaskStatus,
} from "../fhir/rehabTaskHelpers";
import {
  NUTRITION_GUIDANCE_ORDER_TYPE,
  buildNutritionGuidanceOrderCloseEntry,
  buildNutritionGuidanceOrderStopEntries,
  isNutritionGuidanceServiceRequest,
  nutritionGuidanceOrderResponseIds,
} from "../fhir/nutritionGuidanceOrderHelpers";
import {
  buildNutritionGuidanceTaskUpdate,
  nutritionGuidanceTasksByOrderId,
  type NutritionGuidanceTaskStatus,
} from "../fhir/nutritionGuidanceTaskHelpers";
import {
  buildNutritionGuidancePerformDeleteEntries,
  nutritionGuidancePerformsByOrderId,
  type NutritionGuidancePerformDisplay,
} from "../fhir/nutritionGuidanceResultHelpers";
import {
  CONSULT_ORDER_TYPE,
  buildConsultOrderDeleteBundle,
  buildConsultOrderReplyEntry,
  buildConsultOrderStatusEntry,
  consultReply,
  isConsultServiceRequest,
} from "../fhir/consultOrderHelpers";
import {
  RADIOTHERAPY_ORDER_TYPE,
  buildRadiotherapyOrderDeleteBundle,
  buildRadiotherapyOrderStatusEntry,
  isRadiotherapyServiceRequest,
  type RadiotherapyTermination,
} from "../fhir/radiotherapyOrderHelpers";
import {
  radiotherapyCourseSummariesByOrderId,
} from "../fhir/radiotherapySummaryHelpers";
import {
  buildRadiotherapyFractionCancelBundle,
  buildRadiotherapyFractionNotDoneBundle,
  buildRadiotherapyFractionRestoreBundle,
  isRadiotherapyFraction,
  radiotherapyFractionsByOrderId,
  rescheduleRadiotherapyFraction,
  type RadiotherapyFractionDisplay,
} from "../fhir/radiotherapyResultHelpers";
import {
  buildRadiotherapyTaskUpdate,
  radiotherapyOrderStatusFor,
  radiotherapyTaskStatus,
  radiotherapyTasksByOrderId,
  type RadiotherapyTaskStatus,
} from "../fhir/radiotherapyTaskHelpers";
import {
  buildConsultTaskUpdate,
  consultOrderStatusFor,
  consultTasksByOrderId,
  type ConsultTaskStatus,
} from "../fhir/consultTaskHelpers";
import {
  rehabPerformsByOrderId,
  type RehabPerformDisplay,
} from "../fhir/rehabResultHelpers";
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
import {
  buildSurgeryPerformDeleteEntries,
  isSurgeryProcedure,
} from "../fhir/surgeryResultHelpers";
import {
  FLOWSHEET_EXAM_TYPES,
  encounterStays,
  type EncounterStay,
} from "../fhir/flowsheetEventHelpers";
import type { FlowsheetInjectionData } from "../fhir/flowsheetInjectionHelpers";
import type { FlowsheetOralData } from "../fhir/flowsheetOralHelpers";
import {
  buildOralPerformDeleteEntries,
  type OralPerformDisplay,
} from "../fhir/oralPerformHelpers";
import { DEFAULT_MEDICATION_SCHEDULE } from "../fhir/medicationScheduleHelpers";

/**
 * 内服の予定を出すのに遡る日数。処方の投与日数には上限が無いが、上流は投与日数を
 * 索引しないので「これより前に始まった処方は引かない」線を引く必要がある。
 */
const ORAL_LOOKBACK_DAYS = 92;
import {
  buildAnesthesiaChartData,
  isAnesthesiaChartHub,
  type AnesthesiaChartData,
} from "../fhir/anesthesiaChartHelpers";
import { buildPractitionerDeleteBundle } from "../fhir/practitionerHelpers";
import {
  SERVICE_TYPE_SYSTEM as SCHEDULE_SERVICE_TYPE_SYSTEM,
  addDays,
  buildSlotCreateBundle,
  buildSlotDeleteBundle,
  scheduleTypeOf,
  type ScheduleType,
  type SlotStatus,
} from "../fhir/scheduleHelpers";
import {
  ACTIVE_APPOINTMENT_STATUSES,
  appointmentActorId,
  appointmentOrderId,
  appointmentSlotIds,
  buildBookBundle,
  buildCancelBundle,
  buildCancelEntries,
  buildNutritionGuidanceAppointmentBundle,
  buildChemoAppointmentBundle,
  buildRehabAppointmentBundle,
  buildRescheduleBundle,
  buildRescheduleEntries,
  isExamAppointment,
  withCheckedInAt,
  type SlotSelection,
} from "../fhir/appointmentHelpers";
import {
  EXAM_IN_PROGRESS_STATUS,
  OUTPATIENT_CLASS_CODE,
  latestExamByAppointment,
  outpatientEncounterAppointmentId,
} from "../fhir/outpatientEncounterHelpers";
import {
  DOCTOR_ROLE_CODES,
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
  buildPatientFileBundle,
  PATIENT_FILE_CATEGORY_SYSTEM,
  type PatientFileCategory,
  type PatientFileDraft,
} from "../fhir/patientFileHelpers";
import {
  DEFAULT_IDENTIFIER_SYSTEM,
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
  fetchBinaryBlob,
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
import { deleteImagingStudy, fetchStoredStudies, fetchStudyInstances } from "./imagingClient";
import { IMAGING_STUDY_SUMMARY_ELEMENTS } from "../fhir/imagingHelpers";

// シェーマ画像を伴う保存は、画像 Binary と本体を 1 つの transaction Bundle で
// atomic に書く(片方だけ保存されて孤児 Binary が残ることを防ぐ)。画像がない
// 保存は単体リソースの POST / PUT。戻り値は両者で同じ形に揃える。
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

// 患者番号の自動採番。上流の $next-identifier が「登録済み(削除済み含む)と払い出し済みの
// 最大値 + 1」を直列化して返すので、同時に登録しても同じ番号にはならない。
async function fetchNextPatientNumber(): Promise<string> {
  const params = new URLSearchParams();
  params.set("system", DEFAULT_IDENTIFIER_SYSTEM);
  const { data } = await typeOperation<fhir4.Parameters>("Patient", "next-identifier", params);
  const value = data.parameter?.find((p) => p.name === "value")?.valueString;
  if (!value) throw new Error("患者番号を採番できませんでした。");
  return value;
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
// 病棟で絞らず院内の入院を全部取ってからベッド id で突き合わせる。上流の
// 多段チェーン検索(location.partof.partof=<病棟>)で病棟で絞る
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

const INPATIENT_PAGE = 500;
const INPATIENT_MAX_PAGES = 2;

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

export async function fetchInpatients(date: string): Promise<InpatientResult> {
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

/**
 * 病棟マップの転床の一括確定。組み立て済みの transaction Bundle(複数の Encounter の PUT)を
 * そのまま送る。組み立ては fhir/bedMovePlanHelpers.ts。
 */
export function useCommitBedMoves() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Encounter"] });
    },
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

/**
 * 退院。入院を終える(記録は status=finished + 退院日時として残る)。継続する食事・
 * リハビリ・栄養指導・看護指示を一緒に止められる(退院後も食事が出続けたり、終わった
 * はずのリハビリが部門一覧に並び続けるのを防ぐ)。入院の書き換えと同じ transaction に
 * 載せるので、退院だけ通ってオーダーが残ることはない。
 *
 * 食事のエントリは画面が fhir/mealEncounterSync で組んで渡す(退院時刻までに出た
 * 最後の食事で止め、退院予定で止めていたものは理由を退院に上書きする)。
 */
export function useDischargePatient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      encounter,
      dischargeAt,
      mealEntries = [],
      rehabOrders = [],
      nutritionGuidanceOrders = [],
      nursingOrders = [],
      extraEntries = [],
    }: {
      encounter: fhir4.Encounter;
      /** 退院日時(YYYY-MM-DDTHH:mm)。 */
      dischargeAt: string;
      /** 退院と同じ transaction に載せるその他の entry(退院時サマリーの督促 Task など)。 */
      extraEntries?: fhir4.BundleEntry[];
      /** 食事オーダーの連動エントリ(buildDischargeSyncEntries)。画面で外したときは空。 */
      mealEntries?: fhir4.BundleEntry[];
      /** 一緒に終了させるリハビリオーダー。退院日を終了日にする。 */
      rehabOrders?: fhir4.ServiceRequest[];
      /** 一緒に終了させる栄養指導オーダー。退院日を終了日にする。 */
      nutritionGuidanceOrders?: fhir4.ServiceRequest[];
      /** 一緒に終了させる看護指示。退院日を終了日にする(指示受け Task は触らない)。 */
      nursingOrders?: fhir4.ServiceRequest[];
    }) => {
      const dischargeDate = dischargeAt.slice(0, 10);
      return postBundle(
        buildEncounterUpdateBundle(buildDischargedEncounter(encounter, dischargeAt), [
          ...mealEntries,
          // リハビリは食事と違い時間帯を持たないので、退院日をそのまま終了日にする。
          // 進捗 Task はここでは触らない(部門が「終了」で締める。オーダーに終了日が
          // 入っていれば翌日以降の部門一覧には出てこない)。
          ...buildRehabOrderStopEntries(rehabOrders, dischargeDate),
          // 栄養指導もリハビリと同じ期間継続型なので同じ扱い。
          ...buildNutritionGuidanceOrderStopEntries(nutritionGuidanceOrders, dischargeDate),
          ...buildNursingOrderStopEntries(nursingOrders, dischargeDate),
          ...extraEntries,
        ]),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Encounter"] });
      // 食事・リハビリの終了もこの transaction で書いているので読み直させる。
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
      // 退院時サマリーの督促(通知 Task)。
      queryClient.invalidateQueries({ queryKey: ["Task"] });
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
 *
 * 外出泊・退院予定のように食事オーダーも一緒に書くときは `{ encounter, extraEntries }` で
 * 渡す(同じ transaction に載る)。
 */
export function useUpdateEncounter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (
      input: fhir4.Encounter | { encounter: fhir4.Encounter; extraEntries: fhir4.BundleEntry[] },
    ) =>
      "resourceType" in input
        ? postBundle(buildEncounterUpdateBundle(input))
        : postBundle(buildEncounterUpdateBundle(input.encounter, input.extraEntries)),
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: ["Encounter"] });
      if (!("resourceType" in input) && input.extraEntries.length > 0) {
        queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
      }
    },
  });
}

export interface PlannedAdmissionsResult {
  /** 入院予定の Encounter。日付未定を先頭に、あとは入院予定日順。 */
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

  return { encounters: sortPlannedAdmissions(encounters), patientsById, truncated };
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

  // ベッドと、その上の病室・病棟をまとめて引く。階層は physicalType(wa/ro/bd)で見分ける。
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
  const ward = ofType(WARD_PHYSICAL_TYPE.code);

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

/**
 * その期間にかかる入院(入院中・退院済)から、イベントと入院期間を取り出す。
 * date を ge/le で 2 回渡して「期間が範囲と重なる」入院を引く(fetchInpatients と同じ手)。
 * 誤登録(entered-in-error)と入院予定はイベントにならないので status で外す。
 *
 * 食事カレンダー(月の暦の印)と経過表(イベントの帯・病日)の両方が使う。
 * イベントは範囲内に絞るが、**入院期間は絞らない**。範囲より前に始まった入院でも、
 * 範囲内の列の病日を数えるのに要るため。
 */
export function usePatientEncounterEvents(
  patientId: string | undefined,
  rangeStart: string,
  rangeEnd: string,
) {
  const params = new URLSearchParams();
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("status", `${ADMISSION_STATUS},${DISCHARGED_STATUS}`);
  params.set("class", ADMISSION_CLASS_CODE);
  params.append("date", `ge${rangeStart}`);
  params.append("date", `le${rangeEnd}`);
  params.set("_count", "20");

  return useQuery({
    queryKey: ["Encounter", "patient-events", patientId, rangeStart, rangeEnd],
    queryFn: async (): Promise<{ events: EncounterEvent[]; stays: EncounterStay[] }> => {
      const { data: bundle } = await searchResource<fhir4.Encounter>("Encounter", params);
      const encounters =
        bundle.entry
          ?.map((e) => e.resource)
          .filter((r): r is fhir4.Encounter => r?.resourceType === "Encounter") ?? [];
      const events = encounters
        .flatMap((encounter) => encounterEvents(encounter))
        .filter((event) => event.date >= rangeStart && event.date <= rangeEnd);
      const bedIds = Array.from(
        new Set(events.flatMap((e) => [e.bedId, e.fromBedId]).filter((id): id is string => !!id)),
      );
      return {
        events: withEventWards(events, await fetchWardNameByBed(bedIds)),
        stays: encounterStays(encounters),
      };
    },
    enabled: Boolean(patientId) && Boolean(rangeStart) && Boolean(rangeEnd),
  });
}

/**
 * 経過表のイベントの帯に出す手術の実施記録(ハブ Procedure)。
 *
 * 手術は performedPeriod を持ち、上流の `date` は期間として索引しているので、
 * from〜to に掛かる手術だけを引く(術後日数の行のために表示期間より前の手術も要るので、
 * 呼び出し側が from を術後日数の上限ぶん前にずらす)。
 */
export function usePatientSurgeryPerforms(patientId: string | undefined, from: string, to: string) {
  return useQuery({
    queryKey: ["Procedure", "search", "surgery-patient", patientId, from, to],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      params.set("category", `${ORDER_TYPE_SYSTEM}|${SURGERY_ORDER_TYPE.code}`);
      params.append("date", `ge${from}`);
      params.append("date", `le${to}`);
      // 2 件目以降の術式(partOf 付き)はハブと同じ日時なので、ハブだけをイベントにする。
      params.set("part-of:missing", "true");
      params.set("status:not", "entered-in-error,not-done");
      params.set("_count", "100");
      const { data: bundle } = await searchResource<fhir4.Procedure>("Procedure", params);
      return resourcesOfType<fhir4.Procedure>(bundle, "Procedure").filter(isSurgeryProcedure);
    },
    enabled: Boolean(patientId) && Boolean(from) && Boolean(to),
  });
}

/**
 * 経過表の注射欄に出す、その期間の注射オーダー一式。
 *
 * 注射は 1 施行(= 1 日)= 1 ServiceRequest で、薬剤(用法・開始時刻)・進捗・実施記録が
 * それぞれ別リソースに分かれる。カルテのタイムラインと同じ `_revinclude` の組みで
 * 1 回の検索にまとめて取る(上流で動作を確認済み)。
 */
export function usePatientInjectionOrders(
  patientId: string | undefined,
  rangeStart: string,
  rangeEnd: string,
) {
  return useQuery({
    queryKey: ["ServiceRequest", "search", "flowsheet-injections", patientId, rangeStart, rangeEnd],
    queryFn: async (): Promise<FlowsheetInjectionData> => {
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      params.set("category", `${ORDER_TYPE_SYSTEM}|${INJECTION_ORDER_TYPE.code}`);
      params.set("based-on:missing", "true");
      params.append("occurrence", `ge${rangeStart}`);
      params.append("occurrence", `le${rangeEnd}`);
      params.append("_revinclude", "MedicationRequest:based-on");
      params.append("_revinclude", "Task:focus");
      params.append("_revinclude", "Procedure:based-on");
      params.append("_revinclude:iterate", "MedicationAdministration:part-of");
      params.set("_count", "100");

      const { data: bundle } = await searchResource<fhir4.Resource>("ServiceRequest", params);
      const resources = (bundle.entry ?? [])
        .map((entry) => entry.resource)
        .filter((r): r is fhir4.Resource => Boolean(r));
      const of = <T extends fhir4.Resource>(type: T["resourceType"]) =>
        resources.filter((r): r is T => r.resourceType === type);

      return {
        orders: of<fhir4.ServiceRequest>("ServiceRequest"),
        medicationRequests: of<fhir4.MedicationRequest>("MedicationRequest"),
        tasks: of<fhir4.Task>("Task"),
        procedures: of<fhir4.Procedure>("Procedure"),
        administrations: of<fhir4.MedicationAdministration>("MedicationAdministration"),
      };
    },
    enabled: Boolean(patientId) && Boolean(rangeStart) && Boolean(rangeEnd),
  });
}

/**
 * 経過表の内服欄に出す、その期間にかかる入院処方と与薬の記録。
 *
 * 処方の ServiceRequest は order-type の category を持たない(持たないこと自体が処方の
 * 印)ので、注射のように種別で絞れない。処方だけが持つ `PRESCRIPTION_CATEGORY_SYSTEM` を
 * **system だけ指定**して絞り(処方ワークリストと同じ手)、入外区分と処方かどうかの最終
 * 判定はクライアントで行う。
 *
 * 処方は 1 件が投与日数ぶん続くので、期間の開始より前に始まったものも要る。投与日数は
 * 上流で索引できないため、下限は「期間の開始 − 92 日」で引く(注射の連日展開の上限
 * 90 日に合わせた経験則。これを超える長期処方は期間を過去に送れば読める)。
 */
export function usePatientOralPrescriptions(
  patientId: string | undefined,
  rangeStart: string,
  rangeEnd: string,
) {
  return useQuery({
    queryKey: ["ServiceRequest", "search", "flowsheet-oral", patientId, rangeStart, rangeEnd],
    queryFn: async (): Promise<FlowsheetOralData> => {
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      params.set("category", `${PRESCRIPTION_CATEGORY_SYSTEM}|`);
      params.append("occurrence", `ge${addDays(rangeStart, -ORAL_LOOKBACK_DAYS)}`);
      params.append("occurrence", `le${rangeEnd}`);
      params.append("_revinclude", "MedicationRequest:based-on");
      params.append("_revinclude", "Task:focus");
      params.append("_revinclude", "Procedure:based-on");
      params.append("_revinclude:iterate", "MedicationAdministration:part-of");
      params.set("_count", "100");

      const { data: bundle } = await searchResource<fhir4.Resource>("ServiceRequest", params);
      const resources = (bundle.entry ?? [])
        .map((entry) => entry.resource)
        .filter((r): r is fhir4.Resource => Boolean(r));
      const of = <T extends fhir4.Resource>(type: T["resourceType"]) =>
        resources.filter((r): r is T => r.resourceType === type);

      return {
        orders: of<fhir4.ServiceRequest>("ServiceRequest"),
        medicationRequests: of<fhir4.MedicationRequest>("MedicationRequest"),
        tasks: of<fhir4.Task>("Task"),
        procedures: of<fhir4.Procedure>("Procedure"),
        administrations: of<fhir4.MedicationAdministration>("MedicationAdministration"),
      };
    },
    enabled: Boolean(patientId) && Boolean(rangeStart) && Boolean(rangeEnd),
  });
}

/**
 * 重複投与チェック(`docs/order-common-backlog.md` §3)に使う、基準日に効いている処方の薬剤。
 *
 * 処方の絞り込みは経過表の内服欄と同じ手(`usePatientOralPrescriptions` のコメント)。
 * 投与日数は上流で索引できないので基準日の 92 日前から引き、効いているかどうかは
 * 投与終了日(`rpEndDate`)を出してクライアントで判定する。中止した処方は数えない。
 */
export function useActiveMedications(patientId: string | undefined, onDate: string) {
  const rangeStart = onDate ? addDays(onDate, -ORAL_LOOKBACK_DAYS) : "";

  const query = useQuery({
    queryKey: ["ServiceRequest", "search", "active-medications", patientId, onDate],
    queryFn: async (): Promise<ActiveMedication[]> => {
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      params.set("category", `${PRESCRIPTION_CATEGORY_SYSTEM}|`);
      params.append("occurrence", `ge${rangeStart}`);
      params.append("occurrence", `le${onDate}`);
      params.append("_revinclude", "MedicationRequest:based-on");
      params.append("_revinclude", "Task:focus");
      params.set("_count", "100");

      const { data: bundle } = await searchResource<fhir4.Resource>("ServiceRequest", params);
      const resources = (bundle.entry ?? [])
        .map((entry) => entry.resource)
        .filter((r): r is fhir4.Resource => Boolean(r));
      const orders = resources
        .filter((r): r is fhir4.ServiceRequest => r.resourceType === "ServiceRequest")
        .filter(isPrescriptionServiceRequest);
      const medicationRequests = resources.filter(
        (r): r is fhir4.MedicationRequest => r.resourceType === "MedicationRequest",
      );
      const tasksByOrder = rxTasksByOrderId(
        resources.filter((r): r is fhir4.Task => r.resourceType === "Task"),
      );

      const active: ActiveMedication[] = [];
      for (const order of orders) {
        if (!order.id) continue;
        if (rxTaskStatus(tasksByOrder.get(order.id)) === "cancelled") continue;
        const startDate = (order.occurrenceDateTime ?? "").slice(0, 10);
        if (!startDate) continue;
        const mrs = medicationRequests.filter((mr) =>
          mr.basedOn?.some((ref) => ref.reference === `ServiceRequest/${order.id}`),
        );
        for (const rp of groupByRp(mrs)) {
          const endDate = rpEndDate(startDate, rp) ?? startDate;
          if (endDate < onDate) continue;
          for (const line of rp.medicines) {
            const ingredient = ingredientKey({
              yj_code: line.yjCode,
              medicine_code: line.code,
              generic: line.generic,
            });
            if (!ingredient) continue;
            active.push({ orderId: order.id, name: line.name, ingredient, endDate });
          }
        }
      }
      return active;
    },
    enabled: Boolean(patientId) && Boolean(onDate),
    staleTime: 30 * 1000,
  });

  return { ...query, medications: query.data ?? [] };
}

/** 与薬の記録(1 枠ぶん)。ハブと薬剤の記録を 1 transaction で作る。 */
export function useRegisterOralPerform() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
    },
  });
}

/** 与薬の取消。記録ごと消す(進捗 Task は動かしていないので戻す先が無い)。 */
export function useCancelOralPerforms() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (performs: OralPerformDisplay[]) =>
      postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: buildOralPerformDeleteEntries(performs),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
    },
  });
}

/**
 * 経過表の看護欄に出す、その期間に有効な看護指示と実施記録。
 *
 * 指示は「期間 + 頻度」で持ち日時を持たないので、期間に掛かっているものを
 * order-period で引く。実施は Observation(観察)と Procedure(行為)に分かれるので、
 * 既存の `useNursingPerformsOf` と同じ取り方をする。
 */
export function usePatientNursingFlowsheet(
  patientId: string | undefined,
  rangeStart: string,
  rangeEnd: string,
) {
  return useQuery({
    queryKey: ["ServiceRequest", "search", "flowsheet-nursing", patientId, rangeStart, rangeEnd],
    queryFn: async () => {
      const params = nursingOrderParams(patientId, "active");
      setOrderPeriod(params, rangeStart, rangeEnd);
      // 実施は**表示している期間だけ**引く(患者の全期間を引くと、長期入院で
      // 200 件の上限に当たって古い記録しか返らない)。
      const setRange = (p: URLSearchParams) => {
        p.set("patient", `Patient/${patientId}`);
        p.append("date", `ge${rangeStart}`);
        p.append("date", `le${rangeEnd}`);
      };
      const observationParams = nursingPerformParams();
      setRange(observationParams);

      const [{ data: bundle }, performsByOrderId, { data: observationBundle }] = await Promise.all([
        searchResource<fhir4.Resource>("ServiceRequest", params),
        fetchNursingPerforms(setRange),
        // 水分出納は値(mL)を足すので、整形前の Observation も要る。
        searchResource<fhir4.Observation>("Observation", observationParams),
      ]);
      const set = nursingOrderSetOf(bundle);
      return {
        orders: set.orders,
        performsByOrderId,
        observations: resourcesOfType<fhir4.Observation>(observationBundle, "Observation"),
      };
    },
    enabled: Boolean(patientId) && Boolean(rangeStart) && Boolean(rangeEnd),
  });
}

/**
 * 経過表の食事摂取量。期間にかかる食事オーダーと、記録の Observation を引く。
 *
 * 食事オーダーは継続オーダーで、前の月から続いているものがその日の食事を決めている
 * ことがあるので、`useMealOrderMonth` と同じく期間に掛かっているオーダーを引く。
 */
export function usePatientMealIntake(
  patientId: string | undefined,
  rangeStart: string,
  rangeEnd: string,
) {
  return useQuery({
    queryKey: ["ServiceRequest", "search", "flowsheet-meal", patientId, rangeStart, rangeEnd],
    queryFn: async () => {
      const orderParams = new URLSearchParams();
      orderParams.set("subject", `Patient/${patientId}`);
      orderParams.set("category", `${ORDER_TYPE_SYSTEM}|${MEAL_ORDER_TYPE.code}`);
      orderParams.set("status", "active");
      setOrderPeriod(orderParams, rangeStart, rangeEnd);
      orderParams.set("_count", "100");

      const observationParams = new URLSearchParams();
      observationParams.set("patient", `Patient/${patientId}`);
      observationParams.set("category", `${ORDER_TYPE_SYSTEM}|${MEAL_ORDER_TYPE.code}`);
      observationParams.append("date", `ge${rangeStart}`);
      observationParams.append("date", `le${rangeEnd}`);
      observationParams.set("_count", "200");

      const [{ data: orderBundle }, { data: observationBundle }] = await Promise.all([
        searchResource<fhir4.ServiceRequest>("ServiceRequest", orderParams),
        searchResource<fhir4.Observation>("Observation", observationParams),
      ]);
      return {
        orders: serviceRequestsOf(orderBundle).filter(isMealServiceRequest),
        observations: resourcesOfType<fhir4.Observation>(observationBundle, "Observation"),
      };
    },
    enabled: Boolean(patientId) && Boolean(rangeStart) && Boolean(rangeEnd),
  });
}

/** 食事摂取量の記録(1 食ぶん)。作成・上書き・削除を 1 transaction で送る。 */
export function useSaveMealIntake() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search", "flowsheet-meal"] });
    },
  });
}

/**
 * 経過表のイベントの帯に出す検査オーダー(放射線・内視鏡・生理)のヘッダ。
 * 検体・細菌・病理は患者が動かないうえ毎日の採血で帯が埋まるので出さない
 * (そちらは検体検査時系列タブに表がある)。
 */
export function usePatientExamOrders(
  patientId: string | undefined,
  rangeStart: string,
  rangeEnd: string,
) {
  return useQuery({
    queryKey: ["ServiceRequest", "search", "flowsheet-exams", patientId, rangeStart, rangeEnd],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      params.set(
        "category",
        FLOWSHEET_EXAM_TYPES.map((type) => `${ORDER_TYPE_SYSTEM}|${type.code}`).join(","),
      );
      // 日時を持つのはヘッダだけ(明細は持たない)。ヘッダは code も持たないので、
      // 検査名はぶら下がる明細から採る(イベント一覧の「内容」に出す)。
      params.set("based-on:missing", "true");
      params.append("occurrence", `ge${rangeStart}`);
      params.append("occurrence", `le${rangeEnd}`);
      params.set("status:not", "revoked,entered-in-error");
      params.set("_count", "100");
      params.append("_revinclude:iterate", "ServiceRequest:based-on");
      // 実施記録(ハブ Procedure)。予定と実施を印で塗り分けるのに使う。
      params.append("_revinclude", "Procedure:based-on");
      const { data: bundle } = await searchResource<fhir4.Resource>("ServiceRequest", params);
      const resources = (bundle.entry ?? [])
        .map((entry) => entry.resource)
        .filter((r): r is fhir4.Resource => Boolean(r));
      // status の条件はヘッダにしか掛からないので、_revinclude で届く明細にも同じ条件を掛ける。
      const all = resources
        .filter((r): r is fhir4.ServiceRequest => r.resourceType === "ServiceRequest")
        .filter((sr) => sr.status !== "revoked" && sr.status !== "entered-in-error");
      // _revinclude で明細も混ざって返るので、ヘッダ(basedOn 無し)と分けて返す。
      return {
        headers: all.filter((sr) => !sr.basedOn?.length),
        items: all.filter((sr) => sr.basedOn?.length),
        procedures: resources.filter(
          (r): r is fhir4.Procedure => r.resourceType === "Procedure",
        ),
      };
    },
    enabled: Boolean(patientId) && Boolean(rangeStart) && Boolean(rangeEnd),
  });
}

/** ベッド id → 病棟名。ベッドと親の病室・病棟をまとめて引き、partOf を 2 段辿る。 */
async function fetchWardNameByBed(bedIds: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (bedIds.length === 0) return result;

  const params = new URLSearchParams();
  params.set("_id", bedIds.join(","));
  params.append("_include", "Location:partof");
  params.append("_include:iterate", "Location:partof");
  params.set("_count", String(bedIds.length));
  const { data: bundle } = await searchResource<fhir4.Location>("Location", params);
  const byId = new Map<string, fhir4.Location>();
  for (const entry of bundle.entry ?? []) {
    const r = entry.resource;
    if (r?.resourceType === "Location" && r.id) byId.set(r.id, r);
  }

  for (const bedId of bedIds) {
    const bed = byId.get(bedId);
    const roomId = bed ? partOfId(bed) : undefined;
    const room = roomId ? byId.get(roomId) : undefined;
    const ward = room ? byId.get(partOfId(room) ?? "") : undefined;
    if (ward?.name) result.set(bedId, ward.name);
  }
  return result;
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

// 予約を取る画面の枠表セレクト。
// 診療科は取得後にコードで絞る。診療科を設定していない枠表をどの科からも選べるように
// 残すためで、specialty 検索では「その科 または 未設定」を 1 回で引けない。
// 種別は診察予約以外をサーバーで絞る。診察予約は種別を持たない枠表も含むので
// (scheduleTypeOf)、取得後に判定する。
export function useScheduleOptions(filter: {
  departmentCode?: string;
  practitionerId?: string;
  scheduleType?: ScheduleType;
}) {
  const params = new URLSearchParams();
  params.set("active", "true");
  if (filter.practitionerId) params.append("actor", `Practitioner/${filter.practitionerId}`);
  if (filter.scheduleType && filter.scheduleType !== "consultation") {
    params.set("service-type", `${SCHEDULE_SERVICE_TYPE_SYSTEM}|${filter.scheduleType}`);
  }
  params.set("_count", "100");

  const query = useQuery({
    queryKey: [
      "Schedule",
      "search",
      "options",
      filter.practitionerId ?? "",
      filter.scheduleType === "consultation" ? "" : (filter.scheduleType ?? ""),
    ],
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

/** 取り消せる予約(`isActiveAppointment`)だけを返す status 条件を付ける。 */
function setActiveAppointmentStatus(params: URLSearchParams) {
  params.set("status", ACTIVE_APPOINTMENT_STATUSES.join(","));
}

/**
 * オーダーに紐づく有効な検査予約(放射線・生理検査・内視鏡・処置は 1 オーダーに 1 件)。
 * 予約日時の変更はオーダーの編集画面から行うので、編集を開くときに予約の現物を用意しておく。
 */
export function useOrderAppointment(srId: string | undefined) {
  const params = new URLSearchParams();
  if (srId) params.set("based-on", `ServiceRequest/${srId}`);
  setActiveAppointmentStatus(params);

  const query = useQuery({
    queryKey: ["Appointment", "order", srId],
    queryFn: () => searchResource<fhir4.Appointment>("Appointment", params),
    enabled: Boolean(srId),
  });

  return {
    ...query,
    appointment: query.data
      ? resourcesOfType<fhir4.Appointment>(query.data.data, "Appointment")[0]
      : undefined,
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

/** 予約が押さえている枠の現物(Slot.id → Slot)。複数の予約の分を 1 回の検索で引く。 */
async function fetchSlotsById(appointments: fhir4.Appointment[]): Promise<Map<string, fhir4.Slot>> {
  const ids = [...new Set(appointments.flatMap(appointmentSlotIds))];
  if (ids.length === 0) return new Map();
  const params = new URLSearchParams();
  params.set("_id", ids.join(","));
  params.set("_count", String(ids.length));
  const { data: bundle } = await searchResource<fhir4.Slot>("Slot", params);
  return new Map(
    resourcesOfType<fhir4.Slot>(bundle, "Slot").flatMap((slot) => (slot.id ? [[slot.id, slot]] : [])),
  );
}

function slotsOf(appointment: fhir4.Appointment, slotsById: Map<string, fhir4.Slot>): fhir4.Slot[] {
  return appointmentSlotIds(appointment)
    .map((id) => slotsById.get(id))
    .filter((slot): slot is fhir4.Slot => Boolean(slot));
}

async function fetchAppointmentSlots(appointment: fhir4.Appointment): Promise<fhir4.Slot[]> {
  return slotsOf(appointment, await fetchSlotsById([appointment]));
}

/** 予約それぞれの取消エントリ(予約の取消と、押さえていた枠を空きに戻す PUT)。 */
async function buildCancelEntriesOf(appointments: fhir4.Appointment[]): Promise<fhir4.BundleEntry[]> {
  const slotsById = await fetchSlotsById(appointments);
  return appointments.flatMap((appointment) =>
    buildCancelEntries(appointment, slotsOf(appointment, slotsById)),
  );
}

/** オーダーヘッダに紐づく有効な予約の取消エントリ。予約が無ければ空。 */
async function fetchOrderAppointmentCancelEntries(srId: string): Promise<fhir4.BundleEntry[]> {
  const params = new URLSearchParams();
  params.set("based-on", `ServiceRequest/${srId}`);
  setActiveAppointmentStatus(params);
  const { data: bundle } = await searchResource<fhir4.Appointment>("Appointment", params);
  return buildCancelEntriesOf(resourcesOfType<fhir4.Appointment>(bundle, "Appointment"));
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

const OUTPATIENT_PAGE = 500;
// 1 日の予約がこの件数を超えることは想定していない。超えた場合は読むのをやめ、
// 画面に「一部のみ」と出す(黙って切り捨てると全件見えているように見えるため)。
const OUTPATIENT_MAX_PAGES = 2;

/** 外来一覧の 1 行。予約(Appointment)1 件ぶん。 */
export interface OutpatientRow {
  appointment: fhir4.Appointment;
  patient?: fhir4.Patient;
  /** この予約の診察(外来 Encounter)。診察が始まっていなければ無い。 */
  encounter?: fhir4.Encounter;
}

export interface OutpatientListResult {
  rows: OutpatientRow[];
  /** 上限まで読んでも読み切れなかった。 */
  truncated: boolean;
}

/**
 * その日の外来の診察(Encounter)を予約 id ごとに引く。
 *
 * status では絞らない(診察中と診察終了の両方が要る)。取り消した診察開始
 * (entered-in-error)は latestExamByAppointment が落とす — 上流の Encounter が
 * status:not 修飾子に応えるか未確認なので、画面側で落とす方を採る。
 *
 * 予約からの逆引き(Encounter.appointment 検索)は使わず、入院一覧と同じ
 * 「日付 + class」で 1 日ぶんを読んでから突き合わせる(上流の対応状況に依存しない)。
 */
async function fetchOutpatientExams(date: string): Promise<Map<string, fhir4.Encounter>> {
  const encounters: fhir4.Encounter[] = [];

  for (let page = 0; page < OUTPATIENT_MAX_PAGES; page += 1) {
    const params = new URLSearchParams();
    params.set("class", OUTPATIENT_CLASS_CODE);
    // 同じ名前を 2 回渡すと AND(期間の重なり)になる。fetchInpatients と同じ手。
    params.append("date", `ge${date}`);
    params.append("date", `le${date}`);
    params.set("_count", String(OUTPATIENT_PAGE));
    params.set("_offset", String(page * OUTPATIENT_PAGE));

    const { data: bundle } = await searchResource<fhir4.Encounter>("Encounter", params);
    const matched =
      bundle.entry
        ?.map((e) => e.resource)
        .filter((r): r is fhir4.Encounter => r?.resourceType === "Encounter") ?? [];
    encounters.push(...matched);
    if (matched.length < OUTPATIENT_PAGE) break;
  }

  return latestExamByAppointment(encounters);
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

  const examByAppointment = await fetchOutpatientExams(date);

  const rows = appointments
    // 検査予約(オーダーにぶら下がる予約)の受付・実施は部門のワークリストが追うので
    // 外来一覧には出さない。これだけは検索パラメータで表せないので画面側で落とす。
    .filter((appointment) => !isExamAppointment(appointment))
    .map((appointment) => ({
      appointment,
      patient: patientsById.get(appointmentActorId(appointment, "Patient")),
      encounter: appointment.id ? examByAppointment.get(appointment.id) : undefined,
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
 *
 * 受付では受付時刻も一緒に残す(予約時間とは別の列で出すため)。受付取消では
 * 消して、受付していない予約に受付時刻が残らないようにする。
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
      const updated: fhir4.Appointment = withCheckedInAt(
        { ...appointment, status },
        status === "checked-in" ? nowFhirDateTime() : "",
      );

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

// ---- 診察の開始・終了(外来 Encounter) ----
//
// 診察中は Appointment.status では表せないので、診察開始で外来 Encounter を建てる
// (理由は fhir/outpatientEncounterHelpers.ts の冒頭)。診察を書き換えるときに予約も
// 一緒に動かすものは、片方だけが通ることのないよう必ず同じ transaction に載せる。

function invalidateOutpatientExams(queryClient: QueryClient) {
  invalidateAppointments(queryClient);
  queryClient.invalidateQueries({ queryKey: ["Encounter"] });
}

/** 診察開始。予約は受付済(checked-in)のままなので触らない。 */
export function useStartOutpatientExam() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (encounter: fhir4.Encounter) => createResource(encounter),
    onSuccess: () => invalidateOutpatientExams(queryClient),
  });
}

/**
 * 診察を書き換える。診察終了(Encounter を finished + 予約を fulfilled)・
 * 診察終了の取消(in-progress + checked-in)・診察開始の取消(entered-in-error、
 * 予約は据え置き)をこれ 1 本で賄う。
 *
 * 予約も動かすときは appointment を渡す。診察だけが進んで予約が受付済のまま、
 * といった食い違いを作らないよう 1 本の transaction で書く。一覧は検索結果の
 * リソースを持っているだけで ETag が無いため、単体 PUT ではなく Bundle で書く。
 */
export function useUpdateOutpatientExam() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      encounter,
      appointment,
      appointmentStatus,
    }: {
      encounter: fhir4.Encounter;
      appointment?: fhir4.Appointment;
      appointmentStatus?: fhir4.Appointment["status"];
    }) => {
      const extraEntries: fhir4.BundleEntry[] = [];
      if (appointment && appointmentStatus) {
        // BundleEntry.resource は基底の Resource 型なので、更新後の予約は
        // Appointment として組んでから渡す(useUpdateAppointmentStatus と同じ)。
        const updated: fhir4.Appointment = { ...appointment, status: appointmentStatus };
        extraEntries.push({
          resource: updated,
          request: { method: "PUT", url: `Appointment/${appointment.id}` },
        });
      }
      return postBundle(buildEncounterUpdateBundle(encounter, extraEntries));
    },
    onSuccess: () => invalidateOutpatientExams(queryClient),
  });
}

/**
 * 受付内容(診療科・担当医・診察室)の変更。外来一覧のケバブメニューから、受付の
 * 前後を問わず変えられるようにするためのもの。
 *
 * 診察が始まっている予約では、診察の Encounter が持つ担当医・診察室も一緒に
 * 書き換える(予約だけ変わって診察の記録が前のままになるのを防ぐため、同じ
 * transaction に載せる)。一覧は検索結果のリソースを持っているだけで ETag が
 * 無いため、単体 PUT ではなく Bundle で書く(useUpdateAppointmentStatus と同じ)。
 */
export function useUpdateOutpatientReception() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      appointment,
      encounter,
    }: {
      appointment: fhir4.Appointment;
      encounter?: fhir4.Encounter;
    }) => {
      const entry: fhir4.BundleEntry[] = [
        {
          resource: appointment,
          request: { method: "PUT", url: `Appointment/${appointment.id}` },
        },
      ];
      if (encounter) {
        entry.push({
          resource: encounter,
          request: { method: "PUT", url: `Encounter/${encounter.id}` },
        });
      }
      return postBundle({ resourceType: "Bundle", type: "transaction", entry });
    },
    onSuccess: () => invalidateOutpatientExams(queryClient),
  });
}

/** カルテのヘッダに「診察終了」を出すのに要るもの。 */
export interface OutpatientExam {
  encounter: fhir4.Encounter;
  /** 診察のもとになった予約。診察終了で fulfilled に書き換えるので現物が要る。 */
  appointment?: fhir4.Appointment;
}

async function fetchPatientOutpatientExam(patientId: string): Promise<OutpatientExam | null> {
  const params = new URLSearchParams();
  params.set("subject", `Patient/${patientId}`);
  params.set("status", EXAM_IN_PROGRESS_STATUS);
  params.set("class", OUTPATIENT_CLASS_CODE);
  params.set("_count", "10");

  const { data: bundle } = await searchResource<fhir4.Encounter>("Encounter", params);
  const encounters =
    bundle.entry
      ?.map((e) => e.resource)
      .filter((r): r is fhir4.Encounter => r?.resourceType === "Encounter") ?? [];
  // 同じ患者の診察が 2 件並ぶことは無い想定だが、あれば開始が新しい方を採る
  // (データがおかしくてもカルテの見出しが壊れないように)。
  const encounter = encounters.reduce<fhir4.Encounter | undefined>(
    (latest, current) =>
      !latest || (current.period?.start ?? "") > (latest.period?.start ?? "") ? current : latest,
    undefined,
  );
  if (!encounter) return null;

  const appointmentId = outpatientEncounterAppointmentId(encounter);
  if (!appointmentId) return { encounter };
  const { data: appointment } = await readResource<fhir4.Appointment>(
    "Appointment",
    appointmentId,
  );
  return { encounter, appointment };
}

/** その患者がいま診察中ならその診察。診察中でなければ null。 */
export function usePatientOutpatientExam(patientId: string | undefined) {
  return useQuery({
    queryKey: ["Encounter", "patient-outpatient-exam", patientId],
    queryFn: () => fetchPatientOutpatientExam(patientId as string),
    enabled: Boolean(patientId),
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
  params.append("_revinclude", "MedicationRequest:based-on");
  // 注射の詳細に進捗(依頼済・中止…)を出すため、Task も同じ応答で受け取る。
  params.append("_revinclude", "Task:focus");

  return useQuery({
    queryKey: ["ServiceRequest", "detail", srId],
    queryFn: () => searchResource<fhir4.Resource>("ServiceRequest", params),
    enabled: Boolean(srId),
  });
}

// 連日オーダーの後続日。編集中・削除中の注射と同じ束ね(requisition)で、その日より
// 後の注射日のオーダーを注射日の順に薬剤ごと返す。一括で展開できるのは 14 日までなので
// _count は余裕を見た固定値で足りる。
// 注射日は occurrence(登録日時 authoredOn ではない。同時に展開した日はすべて同じ
// 登録日時を持つので、authoredOn では後続日を区別できない)。
export function useInjectionSeriesLater(sr: fhir4.ServiceRequest | undefined) {
  const series = sr ? injectionSeriesOf(sr) : null;
  const patientId = referenceId(sr?.subject?.reference);
  const date = sr ? orderDay(sr) : "";
  const params = new URLSearchParams();
  if (patientId) params.set("patient", patientId);
  params.set("category", `${ORDER_TYPE_SYSTEM}|${INJECTION_ORDER_TYPE.code}`);
  if (series) params.set("requisition", `${INJECTION_SERIES_SYSTEM}|${series.requisition}`);
  if (date) params.set("occurrence", `gt${date}`);
  params.set("_sort", "occurrence");
  params.append("_revinclude", "MedicationRequest:based-on");
  // 中止を「この日以降」まとめて書くとき、後続日に既にある Task が要る
  // (status だけだと Task を二重に作ってしまう)。
  params.append("_revinclude", "Task:focus");
  params.set("_count", "100");

  return useQuery({
    queryKey: ["ServiceRequest", "search", "injection-series-later", sr?.id],
    queryFn: async (): Promise<InjectionDayTarget[]> => {
      const { data: bundle } = await searchResource<fhir4.Resource>("ServiceRequest", params);
      const resources = (bundle.entry ?? []).map((e) => e.resource).filter(Boolean);
      const mrsBySr = new Map<string, fhir4.MedicationRequest[]>();
      for (const r of resources) {
        if (r?.resourceType !== "MedicationRequest") continue;
        const mr = r as fhir4.MedicationRequest;
        const parent = referenceId(mr.basedOn?.[0]?.reference);
        if (!parent) continue;
        mrsBySr.set(parent, [...(mrsBySr.get(parent) ?? []), mr]);
      }
      const taskBySr = injectionTasksByOrderId(
        resources.filter((r): r is fhir4.Task => r?.resourceType === "Task"),
      );
      return resources
        .filter((r): r is fhir4.ServiceRequest => r?.resourceType === "ServiceRequest")
        .filter((s) => s.id !== sr?.id)
        .map((s) => ({
          serviceRequest: s,
          medicationRequests: mrsBySr.get(s.id ?? "") ?? [],
          task: taskBySr.get(s.id ?? ""),
        }));
    },
    enabled: Boolean(sr && series && patientId && date),
  });
}

/**
 * 注射の進捗を書き込む。連日オーダーは「この日のみ」でも「この日以降すべて」でも
 * 同じ形(日ごとの Task)なので、対象の配列を受け取って 1 つの transaction で書く
 * (途中の日だけ中止済み、という half-done を作らない)。
 */
export function useUpdateInjectionTaskStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      targets,
      status,
    }: {
      targets: { serviceRequest: fhir4.ServiceRequest; task: fhir4.Task | undefined }[];
      status: InjectionTaskStatus;
    }) =>
      postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: targets.map(({ serviceRequest, task }) =>
          taskBundleEntry(buildInjectionTaskUpdate(task, serviceRequest, status)),
        ),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "injection-worklist"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
    },
  });
}

/**
 * 注射の実施登録。実施記録一式と(予定回数に達したら)Task の実施済を 1 つの
 * transaction で書き込む。Bundle の組み立ては injectionPerformHelpers を参照。
 */
export function useRegisterInjectionPerform() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
    },
  });
}

/**
 * 注射の実施取消。そのオーダーの実施記録をすべて消し、実施済になっていた Task は
 * 依頼済に戻す(払出済だったかは分からないので、いちばん手前に戻す)。
 * 記録を消す理由は buildInjectionPerformDeleteEntries を参照。
 */
export function useCancelInjectionPerforms() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      order,
      task,
      performs,
    }: {
      order: fhir4.ServiceRequest;
      task: fhir4.Task | undefined;
      performs: InjectionPerformDisplay[];
    }) => {
      const entries = buildInjectionPerformDeleteEntries(performs);
      if (task?.id && task.status === "completed") {
        entries.push(taskBundleEntry(buildInjectionTaskUpdate(task, order, "requested")));
      }
      return postBundle({ resourceType: "Bundle", type: "transaction", entry: entries });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
    },
  });
}

/**
 * 連日オーダーを複数日まとめて削除する。予約(化学療法の日オーダーに取ってある外来化学療法室)も
 * 一緒に取り消す —— オーダーが消えたのに枠が埋まったままになるのを防ぐ(§8.15 N-13)。
 *
 * useDeleteInjectionSeries の本体(読み直しの指示を伴わない)。パスの取り消しがまとめて消すときにも使う。
 */
export const deleteInjectionSeriesRequest = async (srIds: string[]) => {
  const bundle = buildInjectionSeriesDeleteBundle(srIds);
  const cancels = await orderAppointmentCancelEntries(srIds);
  return postBundle({ ...bundle, entry: [...(bundle.entry ?? []), ...cancels] });
};

export function useDeleteInjectionSeries() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteInjectionSeriesRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
      invalidateAppointments(queryClient);
    },
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

const WORKLIST_PAGE = 500;
// 1 日のオーダーがこの件数を超えることは想定していない。超えた場合は読むのをやめ、
// 画面に「一部のみ」と出す(黙って切り捨てると全件見えているように見えるため)。
const WORKLIST_MAX_PAGES = 2;

/**
 * ヘッダ検索の共通パラメータ。呼び出し側でドメインの _revinclude を足す。
 *
 * 日付はオーダー開始日(occurrenceDateTime: 撮影日・検査日・注射日・投与予定日 …)で引く。
 * 全種別で occurrence が開始日、authoredOn が登録日時(fhir/shared.ts 冒頭)。
 * 例外は処方一覧だけで、交付日(登録日)で引く(理由は useRxWorklist のコメント)。
 */
function worklistParams(
  category: string,
  date: string,
  page: number,
  dateParam: "occurrence" | "authoredon" = "occurrence",
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
// (_has:Task:focus:status)でも絞れるが、絞り込みの選択肢をその日の
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
  /** 読影レポート。未登録なら空。 */
  reportId: string;
  reportStatus: string;
}

export interface RadWorklistResult {
  rows: RadWorklistRow[];
  /** 上限まで読んでも読み切れなかった。 */
  truncated: boolean;
}

async function fetchRadWorklist(date: string): Promise<RadWorklistResult> {
  const orders: fhir4.ServiceRequest[] = [];
  const items: fhir4.ServiceRequest[] = [];
  const reportByOrderId = new Map<string, { id: string; status: string }>();

  const { patientsById, tasks, truncated } = await fetchWorklistBundles(
    (page) => {
      const params = worklistParams(
        `${ORDER_TYPE_SYSTEM}|${RAD_ORDER_TYPE.code}`,
        date,
        page,
        "occurrence",
      );
      // 撮影項目・進捗・読影レポートも同じ応答に添えてもらう。
      // _revinclude は複数指定するので append(set だと先に入れたものが消える)。
      params.set("_revinclude:iterate", "ServiceRequest:based-on");
      params.append("_revinclude", "Task:focus");
      params.append("_revinclude", "DiagnosticReport:based-on");
      return params;
    },
    (resource) => {
      if (resource.resourceType === "DiagnosticReport") {
        const report = resource as fhir4.DiagnosticReport;
        const orderId = report.basedOn?.[0]?.reference?.match(/^ServiceRequest\/(.+)$/)?.[1];
        if (orderId && report.id && isRadReport(report)) {
          reportByOrderId.set(orderId, { id: report.id, status: report.status });
        }
        return false;
      }
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
    reportId: reportByOrderId.get(order.id ?? "")?.id ?? "",
    reportStatus: reportByOrderId.get(order.id ?? "")?.status ?? "",
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
  return splitRadPerformBundle(bundle);
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
      // 読影レポートが付いた検査は取り消させない。実施記録を消すとレポートの撮影日時の
      // 根拠が消え、撮っていない検査に読影が残る(docs/rad-report-design.md §8)。
      if (cancelsPerform && (await radOrderHasReport(order.id ?? ""))) {
        throw new Error("読影レポートがあるため取り消せません。読影レポートを削除してから取り消してください。");
      }
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

// ---- 放射線検査の読影レポート ----
//
// 構造は fhir/radReportHelpers(docs/rad-report-design.md)。オーダー 1 件に読影レポート 1 件。

/** オーダーに読影レポートが付いているか。実施の取消を止めるのに使う。 */
async function radOrderHasReport(orderId: string): Promise<boolean> {
  const params = new URLSearchParams();
  params.set("based-on", `ServiceRequest/${orderId}`);
  params.set("_count", "10");
  const { data: bundle } = await searchResource<fhir4.DiagnosticReport>("DiagnosticReport", params);
  return resourcesOfType<fhir4.DiagnosticReport>(bundle, "DiagnosticReport").some(isRadReport);
}

/** オーダーに付いた読影レポート(所見の Observation を添える)。入力モーダルが使う。 */
export function useRadReportByOrder(orderId: string | undefined) {
  const params = new URLSearchParams();
  if (orderId) params.set("based-on", `ServiceRequest/${orderId}`);
  params.append("_include", "DiagnosticReport:result");
  params.set("_count", "10");

  return useQuery({
    queryKey: ["DiagnosticReport", "detail", "rad-order", orderId],
    queryFn: () => searchResource<fhir4.Resource>("DiagnosticReport", params),
    enabled: Boolean(orderId),
  });
}

/** 読影レポートの内容(所見の Observation を添える)。取得の形は検体検査結果と同じ。 */
export function useRadReportDetail(reportId: string | undefined) {
  return useLabResultDetail(reportId);
}

const RAD_REPORT_TASK_CODES = [RESULT_REVIEW_TASK_CODE.code, RAD_CRITICAL_FINDING_TASK_CODE.code];

/**
 * 読影レポート保存の Bundle に通知を足す。宛先(依頼医)と既存の通知 2 種はここで引く。
 *
 * - 重要所見: 要点があれば暫定報告でも出す。要点の変更で未確認に戻し、外したら取り下げる
 * - 検査結果確認: 最終報告・訂正報告になったとき(暫定報告では出さない)。ただし重要所見が
 *   未確認で残る間は出さず、未確認のものは取り下げる(重要所見の確認で既読も残すため)
 */
async function withRadReportTasks(bundle: fhir4.Bundle): Promise<fhir4.Bundle> {
  const entry = bundle.entry ?? [];
  const reportEntry = entry.find((e) => e.resource?.resourceType === "DiagnosticReport");
  const report = reportEntry?.resource as fhir4.DiagnosticReport | undefined;
  const reference = report?.id ? `DiagnosticReport/${report.id}` : reportEntry?.fullUrl;
  if (!report || !reference) return bundle;

  const patientId = report.subject?.reference?.split("/").pop() ?? "";
  const orderReference = report.basedOn?.[0]?.reference;
  const orderId = orderReference?.split("/").pop();
  const [owner, tasks] = await Promise.all([
    orderId ? fetchOrderRequester(orderId) : Promise.resolve(undefined),
    report.id
      ? fetchReportTasks(report.id, RAD_REPORT_TASK_CODES)
      : Promise.resolve(new Map<string, fhir4.Task>()),
  ]);

  const date = report.effectiveDateTime?.slice(0, 10) ?? "";
  const exam = report.code?.text ?? "";
  const basedOn = orderReference ? [{ reference: orderReference }] : undefined;

  const existingCritical = tasks.get(RAD_CRITICAL_FINDING_TASK_CODE.code);
  const criticalEntries = radCriticalFindingEntries(
    { reportReference: reference, patientId, owner, date, exam, point: radCriticalFindingOf(report), basedOn },
    existingCritical,
  );

  return {
    ...bundle,
    entry: [
      ...entry,
      ...criticalEntries,
      ...urgentAwareReviewTaskEntries(
        { reportReference: reference, patientId, owner, kind: "rad", date, summary: exam, basedOn },
        isReviewableReportStatus(report.status),
        tasks.get(RESULT_REVIEW_TASK_CODE.code),
        urgentNotificationOpenAfter(criticalEntries, existingCritical),
      ),
    ],
  };
}

function invalidateRadReport(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "search"] });
  queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "detail"] });
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "rad-worklist"] });
  queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse"] });
  queryClient.invalidateQueries({ queryKey: NOTIFICATION_TASK_KEY });
}

/**
 * 読影レポートの登録・更新(Bundle は radReportHelpers の buildRadReportBundle)。
 * 新しく送る画像が上流の本文上限に届く量なら、送る前に止める。
 */
export function useSaveRadReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (bundle: fhir4.Bundle) => {
      if (radReportBundleTooLarge(bundle)) throw new Error(RAD_REPORT_TOO_LARGE_MESSAGE);
      return postBundle(await withRadReportTasks(bundle));
    },
    retry: false,
    onSuccess: () => invalidateRadReport(queryClient),
  });
}

/**
 * 読影レポートの削除。所見・テンプレート回答を消し、未確認の通知(検査結果確認・重要所見)を
 * 取り下げる。削除したレポートを指す通知が未確認のまま残らないようにするため。
 */
export function useDeleteRadReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (reportId: string) => {
      const [{ data: report }, tasks] = await Promise.all([
        readResource<fhir4.DiagnosticReport>("DiagnosticReport", reportId),
        fetchReportTasks(reportId, RAD_REPORT_TASK_CODES),
      ]);
      const cancelEntries = Array.from(tasks.values())
        .filter((task) => task.status === "requested")
        .map((task) => notificationTaskEntry(buildCancelledNotificationTask(task), task.id));
      return postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: [...buildRadReportDeleteEntries(report), ...cancelEntries],
      });
    },
    retry: false,
    onSuccess: () => invalidateRadReport(queryClient),
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
// 処方日(交付日 = 登録日 authoredOn の日付)で 1 日ぶんの処方オーダーを読む。画面の作りは
// 検体検査一覧と同じで、入外区分・処方区分・診療科での絞り込みは画面側で行う(理由は
// 検体検査一覧の節のコメントを参照)。
//
// 他の部門一覧と違って開始日(occurrence = 投与開始日)で引かないのは、薬剤部は「今日交付
// された処方」を当日に受け取って開始日の前日までに調剤するため。入院の定期処方は木曜に
// 出して月曜開始のような形になるので、開始日で引くと月曜まで一覧に出てこない。開始日は
// 一覧の列で見せる。
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
      const params = worklistParams(`${PRESCRIPTION_CATEGORY_SYSTEM}|`, date, page, "authoredon");
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

// ---- 注射一覧(部門ワークリスト) ----
//
// 注射日(occurrence)で 1 日ぶんの注射オーダーを読む。注射は 1 日 1 オーダー(連日は
// 日ごとに展開済み)なので、注射日で引けばその日の施用ぶんがそのまま並ぶ。
// 残りの絞り込みは画面側(理由は useRxWorklist と同じ)。

export interface InjectionWorklistRow {
  order: fhir4.ServiceRequest;
  medicationRequests: fhir4.MedicationRequest[];
  patient?: fhir4.Patient;
  /** 進捗。部門がまだ触っていないオーダーには無い(= 依頼済)。 */
  task?: fhir4.Task;
}

async function fetchInjectionWorklist(date: string): Promise<RxWorklistResultLike<InjectionWorklistRow>> {
  const orders: fhir4.ServiceRequest[] = [];
  const medicationRequests: fhir4.MedicationRequest[] = [];

  const { patientsById, tasks, truncated } = await fetchWorklistBundles(
    (page) => {
      const params = worklistParams(`${ORDER_TYPE_SYSTEM}|${INJECTION_ORDER_TYPE.code}`, date, page);
      params.set("_revinclude", "MedicationRequest:based-on");
      params.append("_revinclude", "Task:focus");
      return params;
    },
    (resource) => {
      if (resource.resourceType === "MedicationRequest") {
        medicationRequests.push(resource as fhir4.MedicationRequest);
      } else if (resource.resourceType === "ServiceRequest") {
        const request = resource as fhir4.ServiceRequest;
        if (isInjectionServiceRequest(request)) {
          orders.push(request);
          return true;
        }
      }
      return false;
    },
  );

  const taskByOrderId = injectionTasksByOrderId(tasks);
  const mrsByOrderId = new Map<string, fhir4.MedicationRequest[]>();
  for (const mr of medicationRequests) {
    for (const reference of mr.basedOn ?? []) {
      const orderId = reference.reference?.match(/^ServiceRequest\/(.+)$/)?.[1];
      if (!orderId) continue;
      const list = mrsByOrderId.get(orderId);
      if (list) list.push(mr);
      else mrsByOrderId.set(orderId, [mr]);
    }
  }

  const rows = orders.map((order) => ({
    order,
    medicationRequests: mrsByOrderId.get(order.id ?? "") ?? [],
    patient: patientsById.get(order.subject?.reference?.split("/").pop() ?? ""),
    task: taskByOrderId.get(order.id ?? ""),
  }));
  rows.sort(comparePatientNumber);
  return { rows, truncated };
}

interface RxWorklistResultLike<Row> {
  rows: Row[];
  truncated: boolean;
}

/** 注射日 1 日ぶんの注射オーダー。日付が未選択の間は読みに行かない。 */
export function useInjectionWorklist(date: string) {
  return useQuery({
    queryKey: ["ServiceRequest", "injection-worklist", date],
    queryFn: () => fetchInjectionWorklist(date),
    enabled: Boolean(date),
    placeholderData: keepPreviousData,
  });
}

/**
 * 注射の払出登録。払出結果(MedicationDispense)と払出済の Task を 1 つの transaction で
 * 書き込む。Bundle の組み立ては injectionDispenseHelpers を参照。
 */
export function useRegisterInjectionDispense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "injection-worklist"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
    },
  });
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

// ---- 検査結果に紐付けるオーダー(検体検査・細菌検査・病理)の候補 ----

// 上流 fhir-server の _count 上限 500 を 1 ページとして順に辿る。
const LAB_ORDER_CANDIDATE_PAGE = 500;
// オーダーが極端に多い患者での暴走防止。
const LAB_ORDER_CANDIDATE_MAX_PAGES = 2;
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
  /** オーダーの依頼医。パニック値(緊急異常値)の通知の宛先にする。無ければ宛先なし。 */
  requester?: fhir4.Reference;
}

// 患者のオーダー(ヘッダ)のうち、指定した種別のものを新しい順に集める。ラベルの
// 組み立てだけがオーダー種別ごとに異なるので、そこを差し替えられるようにしている。
//
// 明細は選択肢のラベルに使うので `_revinclude:iterate=ServiceRequest:based-on` で、
// 「結果が既に登録されているか」は `_revinclude=DiagnosticReport:based-on` で
// 同じ応答に添えてもらう。
async function fetchOrderCandidates(
  patientId: string,
  orderTypeCode: string,
  buildLabel: (header: fhir4.ServiceRequest, itemRequests: fhir4.ServiceRequest[]) => string,
): Promise<LabOrderCandidate[]> {
  const candidates: LabOrderCandidate[] = [];

  for (let page = 0; page < LAB_ORDER_CANDIDATE_MAX_PAGES; page += 1) {
    const params = new URLSearchParams();
    params.set("patient", `Patient/${patientId}`);
    params.set("category", `${ORDER_TYPE_SYSTEM}|${orderTypeCode}`);
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
      if (!header.id) continue;
      candidates.push({
        id: header.id,
        label: buildLabel(header, labOrderItemRequests(serviceRequests, header.id)),
        reportId: reportIdByOrderId.get(header.id) ?? "",
        requester: header.requester,
        ...departmentOf(header),
      });
    }

    if (headers.length < LAB_ORDER_CANDIDATE_PAGE) break;
    if (candidates.filter((c) => !c.reportId).length >= LAB_ORDER_CANDIDATE_LIMIT) break;
  }

  return candidates;
}

function fetchLabOrderCandidates(patientId: string): Promise<LabOrderCandidate[]> {
  return fetchOrderCandidates(patientId, LAB_ORDER_TYPE.code, (header, itemRequests) =>
    labOrderLabel(header, labOrderItems(header, itemRequests)),
  );
}

function fetchMicroOrderCandidates(patientId: string): Promise<LabOrderCandidate[]> {
  return fetchOrderCandidates(patientId, MICRO_ORDER_TYPE.code, microOrderLabel);
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

/**
 * ログイン中の医療従事者。オーダーの来歴(Provenance)に入力者・承認者として名乗る相手。
 * Practitioner に紐付かないアカウント(管理者)では名乗れないので null(検体到着の記録者と
 * 同じ扱い)。
 */
function useOrderEnterer(): OrderEnterer | null {
  const { practitionerId, practitioner } = useCurrentPractitioner();
  return practitionerId && practitioner
    ? { practitionerId, display: practitionerDisplayName(practitioner) }
    : null;
}

/**
 * オーダーの登録・編集 Bundle に「誰が入力したか」の Provenance を 1 件足す。
 *
 * 代行入力(医師以外のログインが指示医師を選んで入力する)を残すには、オーダー本体に入る
 * requester(= 指示医師)とは別にログイン中の本人を記録する必要があるが、resource を組み立てる
 * fhir/*.ts は React 非依存でログインユーザーを見られない。そこで登録(useCreatePrescription)と
 * 各種別の更新フックが、組み立て済みの Bundle をこれに通してから POST する
 * (postBundle はマスタ・予約枠まで通るので、そこに仕込むのは広すぎる)。
 */
function useWithOrderProvenance(): (bundle: fhir4.Bundle) => fhir4.Bundle {
  const enterer = useOrderEnterer();
  return (bundle) => {
    const entry = enterer ? buildOrderProvenanceEntry(bundle, enterer) : null;
    if (!entry || !enterer) return bundle;
    // 代行入力なら指示医師あての承認待ちの通知も同じ transaction で作る
    // (来歴は urn:uuid で参照する。上流が採番済みの id に解決する)。
    const task = buildOrderApprovalTaskEntry(entry, approvalOrdersOfBundle(bundle), enterer);
    return { ...bundle, entry: [...(bundle.entry ?? []), entry, ...(task ? [task] : [])] };
  };
}

/**
 * 進捗・状態だけを変える活動(中止・完了・休止・再開)の来歴を作る。対象のオーダーと
 * 指示医師は呼ぶ側が渡す(Bundle には Task やヘッダの状態しか入らないため)。
 */
function useActivityProvenance(): (
  orders: fhir4.ServiceRequest[],
  activity: OrderActivity,
) => fhir4.BundleEntry[] {
  const enterer = useOrderEnterer();
  return (orders, activity) => {
    const entry = enterer ? buildActivityProvenanceEntry(orders, activity, enterer) : null;
    if (!entry || !enterer) return [];
    const task = buildOrderApprovalTaskEntry(
      entry,
      orders.map((order) => ({ order, reference: `ServiceRequest/${order.id}` })),
      enterer,
    );
    return task ? [entry, task] : [entry];
  };
}

/**
 * 来歴を書いた・承認したあとに、詳細の来歴と通知(承認待ち)を読み直させる。
 * 登録・編集で承認待ちの通知が増えるので、来歴を書く 16 種別ぶんの onSuccess を
 * 触らずに済むようここで両方を無効化する。
 */
function invalidateProvenance(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["Provenance"] });
  queryClient.invalidateQueries({ queryKey: NOTIFICATION_TASK_KEY });
}

/**
 * オーダーの新規登録。名前は処方由来だが、**16 種別すべての登録がこのフックを通る**
 * (組み立て済みの transaction Bundle を受け取って POST するだけなので共用している)。
 * 来歴(入力者)は useWithOrderProvenance で添える。
 */
export function useCreatePrescription() {
  const queryClient = useQueryClient();
  const withProvenance = useWithOrderProvenance();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(withProvenance(bundle)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      invalidateProvenance(queryClient);
    },
  });
}

/**
 * そのオーダーの来歴。詳細を開いたときだけ引く(カルテ本流は 1 ページ 20 件・先読みは
 * 100 件 × 2 本をカルテを開くたびに叩くので、そこに _revinclude を足すと編集回数ぶん膨らむ。
 * 入力者は詳細でだけ見えればよい情報)。
 */
export function useOrderProvenance(serviceRequestId: string | undefined) {
  const params = new URLSearchParams();
  if (serviceRequestId) params.set("target", `ServiceRequest/${serviceRequestId}`);
  params.set("_sort", "recorded");
  params.set("_count", "50");

  return useQuery({
    queryKey: ["Provenance", "search", "order", serviceRequestId],
    queryFn: () => searchResource<fhir4.Provenance>("Provenance", params),
    enabled: Boolean(serviceRequestId),
  });
}

/**
 * 承認。渡された来歴に verifier と署名を足し、その来歴あての承認待ちの通知を対応済みにして、
 * 1 つの transaction で PUT する(1 オーダーに登録と編集の承認待ちが並んでいれば、まとめて
 * 「いまの内容を確認した」ことになる)。来歴は id で渡して中で最新を読み直す
 * (一覧を開いたままにしていても、古い内容で上書きしない)。
 * 承認できるのは author(指示医師)本人だけで、判定は呼ぶ側(canApprove)が行う。
 */
export function useApproveOrderProvenances() {
  const queryClient = useQueryClient();
  const enterer = useOrderEnterer();
  return useMutation({
    mutationFn: async (provenanceIds: string[]) => {
      if (!enterer) throw new Error("医療従事者に紐付いたアカウントでログインしてください");
      const entry = await approvalTransactionEntries(provenanceIds, enterer);
      if (entry.length === 0) return null;
      return postBundle({ resourceType: "Bundle", type: "transaction", entry });
    },
    retry: false,
    onSuccess: () => invalidateProvenance(queryClient),
  });
}

/** 承認ボタンを出すかどうか。ログイン中の医療従事者が指示医師(author)本人のときだけ。 */
export function useCanApproveOrder(authorReference: string | undefined): boolean {
  const { practitionerId } = useCurrentPractitioner();
  return Boolean(practitionerId && authorReference === `Practitioner/${practitionerId}`);
}

export function useUpdatePrescription() {
  const queryClient = useQueryClient();
  const withProvenance = useWithOrderProvenance();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(withProvenance(bundle)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
      invalidateProvenance(queryClient);
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

// 上流 fhir-server の _count 上限が 500 のため、それを 1 ページとして順に辿る。
const LAB_RESULT_ORDER_PAGE = 500;
// 患者あたりの検査結果が極端に多い場合の暴走防止（最大 1000 件まで前後移動できる）。
const LAB_RESULT_ORDER_MAX_PAGES = 2;

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
 * 採取日」を作るのに使う。
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

// 上流 fhir-server の _count 上限 500 を 1 ページとして順に辿る。
const LAB_TIMELINE_PAGE = 500;
// 同一期間内の件数が極端に多い場合の暴走防止。
const LAB_TIMELINE_MAX_PAGES = 2;

export interface LabTimelineResources {
  reports: fhir4.DiagnosticReport[];
  observations: fhir4.Observation[];
}

// 時系列表示は「直近 dateCount 回分の検体採取日」を横軸にする。
// まず $distinct-dates で直近 dateCount 個の採取日を集計し、いちばん古い採取日
// 以降のレポートを Observation ごと(_include)取得する。通常 2 リクエストに収まる。
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

/** 選んだ検査項目の版履歴。訂正で値がどう変わったかを読むために引く。 */
export interface LabObservationHistory {
  id: string;
  /** 新しい版から順(上流の _history の並びのまま)。 */
  versions: fhir4.Observation[];
}

// 版履歴は 1 項目 1 リクエストになるので、内容表示で選んだ項目だけを引く
// (1 レポートの全項目を引くと数十回の照会になる)。
export function useLabObservationHistories(observationIds: string[]) {
  return useQuery({
    queryKey: ["Observation", "history", observationIds.join(",")],
    queryFn: async (): Promise<LabObservationHistory[]> => {
      const params = new URLSearchParams();
      params.set("_count", String(HISTORY_COUNT));
      const results = await Promise.all(
        observationIds.map((id) => readHistory<fhir4.Observation>("Observation", id, params)),
      );
      return results.map(({ data }, index) => ({
        id: observationIds[index],
        versions: (data.entry ?? [])
          .map((entry) => entry.resource)
          .filter((r): r is fhir4.Observation => r?.resourceType === "Observation"),
      }));
    },
    enabled: observationIds.length > 0,
  });
}

// 検査結果を保存・削除するとオーダーの紐付け状況が変わるため、
// 検体検査オーダーの候補(["ServiceRequest", "search"] 配下)も無効化する。
// 通知(Task) ------------------------------------------------------------------
//
// 緊急異常値・オーダー承認などの通知を 1 つのクエリで引く。種別ごとの見せ方と
// 対応の仕方は components/notifications/notificationRegistry が持つ。

const NOTIFICATION_TASK_KEY = ["Task", "notification"];

/**
 * このレポートに付いている種別ごとの通知(種別コード → Task)。訂正で出し直す・取り下げるために
 * 引く。複数の種別を 1 回の検索で引く。
 */
async function fetchReportTasks(
  reportId: string,
  codes: string[],
): Promise<Map<string, fhir4.Task>> {
  const params = new URLSearchParams();
  params.set("focus", `DiagnosticReport/${reportId}`);
  params.set("code", codes.map((code) => `${TASK_CODE_SYSTEM}|${code}`).join(","));
  params.set("_count", String(codes.length * 5));
  const { data: bundle } = await searchResource<fhir4.Task>("Task", params);
  const tasks = resourcesOfType<fhir4.Task>(bundle, "Task");
  const result = new Map<string, fhir4.Task>();
  for (const code of codes) {
    const task = tasks.find((t) => hasTaskCode(t, code));
    if (task) result.set(code, task);
  }
  return result;
}

async function fetchReportTask(reportId: string, code: string): Promise<fhir4.Task | undefined> {
  return (await fetchReportTasks(reportId, [code])).get(code);
}

/**
 * この検査結果を誰がいつ確認したか。詳細を開いたときだけ引く(一覧には載せない)。
 * 確認の正本は来歴なので、通知(Task)ではなくこちらを読む。
 */
export function useResultReviewProvenance(reportId: string | undefined) {
  const params = new URLSearchParams();
  if (reportId) params.set("target", `DiagnosticReport/${reportId}`);
  params.set("_sort", "recorded");
  params.set("_count", "20");

  return useQuery({
    queryKey: ["Provenance", "search", "report", reportId],
    queryFn: () => searchResource<fhir4.Provenance>("Provenance", params),
    select: (result) => latestReview(provenancesOf(result.data)),
    enabled: Boolean(reportId),
    staleTime: 60_000,
  });
}

/**
 * この患者の未確認のレポート id。カルテの採取日ペインの印に使う。
 * 未確認は通知(Task)が未対応であることと同じなので、来歴ではなく通知を引く。
 */
export function useUnreviewedReportIds(patientId: string | undefined) {
  const params = new URLSearchParams();
  params.set("code", `${TASK_CODE_SYSTEM}|${RESULT_REVIEW_TASK_CODE.code}`);
  params.set("status", "requested");
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("_count", String(WORKLIST_PAGE));

  return useQuery({
    queryKey: [...NOTIFICATION_TASK_KEY, "unreviewed", patientId],
    queryFn: () => searchResource<fhir4.Task>("Task", params),
    select: (result) =>
      new Set(
        (result.data.entry ?? [])
          .map((entry) => (entry.resource as fhir4.Task | undefined)?.focus?.reference)
          .map((reference) => reference?.split("/").pop())
          .filter((id): id is string => Boolean(id)),
      ),
    enabled: Boolean(patientId),
    staleTime: 60_000,
  });
}

/**
 * 検査結果を確認する。来歴(正本)を作り、その結果あての通知が未対応なら同じ transaction で
 * 対応済みにする。宛先でない医師が先に読むこともあるので、確認できる人は限らない。
 *
 * 結果を読めば緊急の通知(緊急異常値・重要所見)の内容も読んだことになるので、それらが
 * 未確認なら一緒に確認する(緊急の通知が出ている間は検査結果確認の通知を作らないため)。
 */
export function useMarkResultReviewed() {
  const queryClient = useQueryClient();
  const enterer = useOrderEnterer();
  return useMutation({
    mutationFn: async (reportId: string) => {
      if (!enterer) throw new Error("医療従事者に紐付いたアカウントでログインしてください");
      const notes: Record<string, string> = {
        [RESULT_REVIEW_TASK_CODE.code]: RESULT_REVIEW_NOTE,
        [LAB_PANIC_TASK_CODE.code]: LAB_PANIC_NOTE,
        [RAD_CRITICAL_FINDING_TASK_CODE.code]: RAD_CRITICAL_FINDING_NOTE,
      };
      const tasks = await fetchReportTasks(reportId, Object.keys(notes));
      const entry: fhir4.BundleEntry[] = [
        reviewProvenanceEntry(buildReviewProvenance(`DiagnosticReport/${reportId}`, enterer)),
      ];
      for (const [code, task] of tasks) {
        if (task.status !== "requested") continue;
        entry.push(completeNotificationEntry(buildCompletedNotificationTask(task, enterer, notes[code])));
      }
      return postBundle({ resourceType: "Bundle", type: "transaction", entry });
    },
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Provenance"] });
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_TASK_KEY });
    },
  });
}

/** オーダーの依頼医。通知の宛先に使う。 */
async function fetchOrderRequester(orderId: string): Promise<fhir4.Reference | undefined> {
  const { data } = await readResource<fhir4.ServiceRequest>("ServiceRequest", orderId);
  return data.requester;
}

/**
 * 結果保存の Bundle に、検査結果確認の通知を足す。
 *
 * 細菌検査・病理は Bundle を組み立ててから保存フックに渡す作りなので、宛先(依頼医)と
 * 既にある通知はここで引く。中間報告のうちは通知しない(検体検査と同じ)。
 */
async function withResultReviewTask(
  bundle: fhir4.Bundle,
  kind: ReviewReportKind,
  summaryOf: (report: fhir4.DiagnosticReport) => string,
): Promise<fhir4.Bundle> {
  const entry = bundle.entry ?? [];
  const reportEntry = entry.find((e) => e.resource?.resourceType === "DiagnosticReport");
  const report = reportEntry?.resource as fhir4.DiagnosticReport | undefined;
  const reference = report?.id ? `DiagnosticReport/${report.id}` : reportEntry?.fullUrl;
  if (!report || !reference || report.status === "preliminary") return bundle;

  const patientId = report.subject?.reference?.split("/").pop() ?? "";
  const orderReference = report.basedOn?.[0]?.reference;
  const orderId = orderReference?.split("/").pop();
  const [owner, existingTask] = await Promise.all([
    orderId ? fetchOrderRequester(orderId) : Promise.resolve(undefined),
    report.id
      ? fetchReportTask(report.id, RESULT_REVIEW_TASK_CODE.code)
      : Promise.resolve(undefined),
  ]);

  return {
    ...bundle,
    entry: [
      ...entry,
      ...resultReviewTaskEntries(
        {
          reportReference: reference,
          patientId,
          owner,
          kind,
          date: report.effectiveDateTime?.slice(0, 10) ?? "",
          summary: summaryOf(report),
          basedOn: orderReference ? [{ reference: orderReference }] : undefined,
        },
        true,
        existingTask,
      ),
    ],
  };
}

/** 一覧・件数に共通の検索条件。宛先を指定すると自分あてだけに絞る。 */
function notificationParams(ownerId?: string | null): URLSearchParams {
  const params = new URLSearchParams();
  params.set("code", NOTIFICATION_CODES);
  params.set("status", "requested");
  if (ownerId) params.set("owner", `Practitioner/${ownerId}`);
  return params;
}

/**
 * 未対応の通知。患者は `_include=Task:subject` で同じ応答に添える(上流の
 * `_include=Task:focus` は ServiceRequest しか返さないので、対象は id だけ持って
 * カルテへ渡す)。種別の絞り込みは取得済みの行に対して画面側で行う。
 */
export function useNotifications(ownerId?: string | null) {
  const params = notificationParams(ownerId);
  params.set("_include", "Task:subject");
  params.set("_sort", "-authored-on");
  params.set("_count", "100");

  return useQuery({
    queryKey: [...NOTIFICATION_TASK_KEY, "list", ownerId ?? "all"],
    queryFn: () => searchResource<fhir4.Resource>("Task", params),
    select: (result) => {
      const { tasks, patients } = splitNotificationBundle(result.data);
      return notificationRows(tasks, patients);
    },
    staleTime: 60_000,
  });
}

/**
 * ヘッダーのベルに出す未対応件数。`_summary=count` で件数だけを引く
 * (本文も `_include` も返らないので、自動更新を入れても軽い)。
 *
 * 全体とアラート(`priority=stat,asap`)の **2 本**を引く。ベルはアラートが 1 件でも
 * あるときだけ赤くするので、内訳が要る。
 *
 * 自動更新は既定では止めてある。上流は FHIR リクエストごとに AuditEvent を 1 行書くので、
 * 無償のサーバーでは開きっぱなしの画面が監査ログとインスタンスの稼働時間を食う。
 * 止めている間も、ページ遷移・ウィンドウのフォーカス復帰・通知の書き込みでは読み直す。
 */
export function useNotificationCounts(ownerId: string | null | undefined, polling: boolean) {
  const all = useNotificationCount(ownerId, polling);
  const alert = useNotificationCount(ownerId, polling, ALERT_PRIORITY_PARAM);

  return {
    total: all.data ?? 0,
    alertTotal: alert.data ?? 0,
    isStale: all.isStale || alert.isStale,
    refetch: () => {
      all.refetch();
      alert.refetch();
    },
  };
}

function useNotificationCount(
  ownerId: string | null | undefined,
  polling: boolean,
  priority?: string,
) {
  const params = notificationParams(ownerId);
  if (priority) params.set("priority", priority);
  params.set("_summary", "count");

  return useQuery({
    queryKey: [...NOTIFICATION_TASK_KEY, "count", ownerId ?? "all", priority ?? "all"],
    queryFn: () => searchResource<fhir4.Resource>("Task", params),
    select: (result) => result.data.total ?? 0,
    staleTime: 60_000,
    refetchInterval: polling ? 60_000 : false,
    // 上流が落ちているときにヘッダーで再試行を繰り返さない(件数を出さないだけにする)。
    retry: false,
  });
}

/**
 * 通知を対応済みにする。誰がいつ対応したかを Task の note に残す。
 * オーダー承認のように別のリソース(来歴の署名)も要る種別は、レジストリが
 * その entry を同じ transaction に足す。
 */
export function useCompleteNotifications() {
  const queryClient = useQueryClient();
  const enterer = useOrderEnterer();
  return useMutation({
    mutationFn: async (rows: NotificationRow[]) => {
      if (!enterer) throw new Error("医療従事者に紐付いたアカウントでログインしてください");
      const entry = await completeNotificationEntries(rows, enterer);
      if (entry.length === 0) return null;
      return postBundle({ resourceType: "Bundle", type: "transaction", entry });
    },
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_TASK_KEY });
      queryClient.invalidateQueries({ queryKey: ["Provenance"] });
    },
  });
}

export function useCreateLabResult() {
  const queryClient = useQueryClient();
  return useMutation({
    // オーダーに紐付く結果は、ラベル発行が作った管の Specimen を参照するので、
    // 組み立ての前にオーダーの管を引く(labResultHelpers の planSpecimens を参照)。
    // subject(性別・生年月日)は基準値の適用に使う。無ければ referenceRange を書かない。
    // owner はパニック値の通知の宛先(オーダーの依頼医)。
    mutationFn: async ({
      values,
      patientId,
      subject,
      owner,
    }: {
      values: LabResultFormValues;
      patientId: string;
      subject?: LabResultSubject;
      owner?: fhir4.Reference;
    }) => {
      const labelSpecimens = await fetchLabelSpecimens(values.orderId);
      return postBundle(buildLabResultBundle(values, patientId, labelSpecimens, subject, { owner }));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_TASK_KEY });
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
      subject,
      owner,
    }: {
      values: LabResultFormValues;
      patientId: string;
      reportId: string;
      originalObservationIds: string[];
      originalSpecimens: SpecimenRef[];
      subject?: LabResultSubject;
      owner?: fhir4.Reference;
    }) => {
      const [labelSpecimens, reportTasks] = await Promise.all([
        fetchLabelSpecimens(values.orderId),
        // 訂正でパニック値が出た/直ったときに通知を出し直す・取り下げるため、
        // また訂正した結果を読み直してもらうため、この結果に付いている通知を先に引く。
        fetchReportTasks(reportId, [LAB_PANIC_TASK_CODE.code, RESULT_REVIEW_TASK_CODE.code]),
      ]);
      const existingPanicTask = reportTasks.get(LAB_PANIC_TASK_CODE.code);
      const existingReviewTask = reportTasks.get(RESULT_REVIEW_TASK_CODE.code);
      return postBundle(
        buildLabResultUpdateBundle(
          values,
          patientId,
          reportId,
          originalObservationIds,
          originalSpecimens,
          labelSpecimens,
          subject,
          { owner, existingPanicTask, existingReviewTask },
        ),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "search"] });
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "detail"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_TASK_KEY });
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
    mutationFn: async (bundle: fhir4.Bundle) =>
      postBundle(await withResultReviewTask(bundle, "micro", microReviewSummary)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_TASK_KEY });
    },
  });
}

export function useUpdateMicroResult() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (bundle: fhir4.Bundle) =>
      postBundle(await withResultReviewTask(bundle, "micro", microReviewSummary)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "search"] });
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "detail"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_TASK_KEY });
    },
  });
}

/** 細菌検査の通知に出す要約。検体が何かで「どの検査の結果か」が分かる。 */
function microReviewSummary(report: fhir4.DiagnosticReport): string {
  return report.specimen?.[0]?.display ?? "";
}

/** 病理の通知に出す要約。検体(臓器・部位)を並べる。 */
function pathoReviewSummary(report: fhir4.DiagnosticReport): string {
  const names = (report.specimen ?? [])
    .map((specimen) => specimen.display)
    .filter((name): name is string => Boolean(name));
  return names.length > 2 ? `${names.slice(0, 2).join("・")} ほか` : names.join("・");
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
// 患者の保険・公費。レセコンが正本で、カルテからは登録しないので読み取りだけ。
// 使えなくなった保険も status=cancelled として残るため、期間や履歴を見せられる。
export function useCoverages(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("beneficiary", `Patient/${patientId}`);
  params.set("_count", "50");

  const query = useQuery({
    queryKey: ["coverages", patientId],
    queryFn: () => searchResource<fhir4.Coverage>("Coverage", params),
    enabled: Boolean(patientId),
  });

  const coverages =
    query.data?.data.entry
      ?.map((e) => e.resource)
      .filter((r): r is fhir4.Coverage => r?.resourceType === "Coverage") ?? [];

  return { ...query, coverages };
}

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

// ---- 退院時サマリー ----

/**
 * 患者の入院(入院中・退院済)。退院時サマリーの対象を選ぶのに使う。新しい順。
 * 誤登録(entered-in-error)と入院予定は対象にしない。
 */
export function usePatientAdmissions(patientId: string | undefined) {
  return useQuery({
    queryKey: ["Encounter", "patient-admissions", patientId],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("subject", `Patient/${patientId}`);
      params.set("status", `${ADMISSION_STATUS},${DISCHARGED_STATUS}`);
      params.set("class", ADMISSION_CLASS_CODE);
      params.set("_sort", "-date");
      params.set("_count", "50");
      const { data: bundle } = await searchResource<fhir4.Encounter>("Encounter", params);
      return resourcesOfType<fhir4.Encounter>(bundle, "Encounter");
    },
    enabled: Boolean(patientId),
  });
}

/** 入院 1 件の読み出し(退院時サマリーの編集で対象の入院を引くのに使う)。 */
export function useEncounter(id: string | undefined) {
  return useQuery({
    queryKey: ["Encounter", "read", id],
    queryFn: async () => (await readResource<fhir4.Encounter>("Encounter", id as string)).data,
    enabled: Boolean(id),
  });
}

/**
 * その入院の退院時サマリー(1 入院 1 件)。あれば登録ではなく編集に切り替える。
 * 上流の Composition は encounter 検索に対応済み。
 */
export function useDischargeSummaryFor(encounterId: string | undefined) {
  return useQuery({
    queryKey: ["Composition", "search", "discharge-summary", encounterId],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("encounter", `Encounter/${encounterId}`);
      params.set("type", DISCHARGE_SUMMARY_TYPE_SEARCH);
      params.set("_count", "5");
      params.set("_sort", "-date");
      const { data: bundle } = await searchResource<fhir4.Composition>("Composition", params);
      return resourcesOfType<fhir4.Composition>(bundle, "Composition")[0] ?? null;
    },
    enabled: Boolean(encounterId),
  });
}

/** その入院の未対応の文書作成督促(通知 Task)。確定保存・退院取消で閉じるのに使う。 */
export async function fetchDocumentDueTasks(encounterId: string): Promise<fhir4.Task[]> {
  const params = new URLSearchParams();
  params.set("code", `${TASK_CODE_SYSTEM}|${DOCUMENT_DUE_TASK_CODE.code}`);
  params.set("encounter", `Encounter/${encounterId}`);
  params.set("status", "requested");
  params.set("_count", "10");
  const { data: bundle } = await searchResource<fhir4.Task>("Task", params);
  return resourcesOfType<fhir4.Task>(bundle, "Task");
}

export function useDocumentDueTasks(encounterId: string | undefined) {
  return useQuery({
    queryKey: [...NOTIFICATION_TASK_KEY, "document-due", encounterId],
    queryFn: () => fetchDocumentDueTasks(encounterId as string),
    enabled: Boolean(encounterId),
  });
}

const SUMMARY_ORDER_KINDS = [
  "surgery",
  "treatment",
  "endoscopy",
  "rad",
  "physio",
  "pathology",
  "radiotherapy",
];

/**
 * 退院時サマリーの下書きに使う、入院期間のデータ。オーダー・記録は Encounter を
 * 参照していないので、患者 + 入院期間(period)の日付範囲で引く(経過表と同じ手段)。
 * 入院中は今日までを範囲にする。
 */
export function useDischargeSummarySources(
  patientId: string | undefined,
  encounter: fhir4.Encounter | undefined,
) {
  const encounterId = encounter?.id;
  return useQuery({
    queryKey: ["discharge-summary", "sources", patientId, encounterId, encounter?.period?.end ?? ""],
    queryFn: async (): Promise<DischargeSummarySources> => {
      const enc = encounter as fhir4.Encounter;
      const start = enc.period?.start?.slice(0, 10) ?? "";
      const end = enc.period?.end?.slice(0, 10) ?? today();

      const events = encounterEvents(enc);
      const bedIds = Array.from(
        new Set(events.flatMap((e) => [e.bedId, e.fromBedId]).filter((id): id is string => !!id)),
      );

      const conditionParams = new URLSearchParams();
      conditionParams.set("patient", `Patient/${patientId}`);
      conditionParams.set("_count", String(KARTE_CONDITION_COUNT));
      conditionParams.set("_sort", "-onset-date");

      const orderParams = new URLSearchParams();
      orderParams.set("patient", `Patient/${patientId}`);
      orderParams.set(
        "category",
        SUMMARY_ORDER_KINDS.map((kind) => `${ORDER_TYPE_SYSTEM}|${kind}`).join(","),
      );
      orderParams.set("based-on:missing", "true");
      orderParams.append("occurrence", `ge${start}`);
      orderParams.append("occurrence", `le${end}`);
      orderParams.set("status:not", "revoked,entered-in-error");
      orderParams.set("_count", "100");
      orderParams.append("_revinclude:iterate", "ServiceRequest:based-on");
      orderParams.append("_revinclude", "Procedure:based-on");

      const rxParams = new URLSearchParams();
      rxParams.set("patient", `Patient/${patientId}`);
      rxParams.set("category", `${PRESCRIPTION_CATEGORY_SYSTEM}|discharge`);
      rxParams.append("occurrence", `ge${start}`);
      rxParams.set("status:not", "revoked,entered-in-error");
      rxParams.set("_count", "20");
      rxParams.append("_revinclude", "MedicationRequest:based-on");

      const allergyParams = new URLSearchParams();
      allergyParams.set("patient", `Patient/${patientId}`);
      allergyParams.set("_count", "100");

      const [wardNameByBed, conditions, orders, rx, allergies] = await Promise.all([
        fetchWardNameByBed(bedIds),
        searchResource<fhir4.Condition>("Condition", conditionParams),
        searchResource<fhir4.Resource>("ServiceRequest", orderParams),
        searchResource<fhir4.Resource>("ServiceRequest", rxParams),
        searchResource<fhir4.AllergyIntolerance>("AllergyIntolerance", allergyParams),
      ]);

      const orderRequests = resourcesOfType<fhir4.ServiceRequest>(orders.data, "ServiceRequest").filter(
        (sr) => sr.status !== "revoked" && sr.status !== "entered-in-error",
      );
      return {
        encounter: enc,
        events: withEventWards(events, wardNameByBed),
        conditions: resourcesOfType<fhir4.Condition>(conditions.data, "Condition"),
        orders: {
          headers: orderRequests.filter((sr) => !sr.basedOn?.length),
          items: orderRequests.filter((sr) => sr.basedOn?.length),
          procedures: resourcesOfType<fhir4.Procedure>(orders.data, "Procedure"),
        },
        dischargeMedications: resourcesOfType<fhir4.MedicationRequest>(rx.data, "MedicationRequest"),
        allergies: resourcesOfType<fhir4.AllergyIntolerance>(allergies.data, "AllergyIntolerance"),
      };
    },
    enabled: Boolean(patientId) && Boolean(encounterId),
  });
}

/**
 * 退院時サマリーの保存。診療記録と同じ transaction(テンプレート回答・Observation の作り直し)に、
 * 転帰の Encounter PUT(entries に含めて渡す)と、確定したときは督促 Task の完了を載せる。
 */
export function useSaveDischargeSummary() {
  const queryClient = useQueryClient();
  const enterer = useOrderEnterer();
  return useMutation({
    mutationFn: async ({
      composition,
      entries,
      etag,
      dueTasks,
    }: {
      composition: fhir4.Composition;
      entries: fhir4.BundleEntry[];
      etag?: string;
      /** その入院の未対応の督促。確定(final / amended)で保存するときに閉じる。 */
      dueTasks: fhir4.Task[];
    }) => {
      const closing =
        composition.status !== "preliminary" && enterer
          ? buildCompletedDocumentDueEntries(dueTasks, enterer)
          : [];
      return saveClinicalNote(composition, [...entries, ...closing], etag);
    },
    onSuccess: (result: FhirResult<fhir4.Composition>) => {
      queryClient.invalidateQueries({ queryKey: ["Composition", "search"] });
      queryClient.invalidateQueries({ queryKey: ["Composition", result.data.id] });
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse"] });
      queryClient.invalidateQueries({ queryKey: ["Observation", "search"] });
      queryClient.invalidateQueries({ queryKey: ["Encounter"] });
      queryClient.invalidateQueries({ queryKey: ["Task"] });
    },
  });
}

/** 退院取消で、その入院の督促を取り下げる entry。 */
export async function documentDueCancelEntries(encounterId: string): Promise<fhir4.BundleEntry[]> {
  return cancelDocumentDueEntries(await fetchDocumentDueTasks(encounterId));
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

/**
 * 患者帯に出す活動中のアレルギー。1 回の検索でまとめて取る(帯はページングしない)。
 * 解消済み・非活動のものは出さない(今の禁忌ではないため)。
 */
export function useActiveAllergies(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("patient", `Patient/${patientId}`);
  params.set("clinical-status", "active");
  params.set("_count", "100");
  params.set("_sort", "-date");

  const query = useQuery({
    queryKey: ["AllergyIntolerance", "search", patientId, "active"],
    queryFn: () => searchResource<fhir4.AllergyIntolerance>("AllergyIntolerance", params),
    enabled: Boolean(patientId),
    staleTime: 30 * 1000,
  });

  const allergies =
    query.data?.data.entry
      ?.map((e) => e.resource)
      .filter((r): r is fhir4.AllergyIntolerance => Boolean(r)) ?? [];

  return { ...query, allergies };
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

// ---- 診療上の注意(Flag) ----

const FLAG_COUNT = 20;

/**
 * カルテのプロファイルタブに出す一覧。既定は有効なものだけで、
 * 「終了したものも表示」を選ぶと全件になる。
 */
export function useFlagSearch(
  patientId: string | undefined,
  offset: number,
  activeOnly: boolean,
) {
  const params = new URLSearchParams();
  if (patientId) params.set("patient", `Patient/${patientId}`);
  if (activeOnly) params.set("status", "active");
  params.set("_count", String(FLAG_COUNT));
  params.set("_offset", String(offset));
  // 一覧に出しているのは期間なので、開始日の新しい順に並べる。
  params.set("_sort", "-date");

  const query = useQuery({
    queryKey: ["Flag", "search", patientId, activeOnly, offset],
    queryFn: () => searchResource<fhir4.Flag>("Flag", params),
    placeholderData: keepPreviousData,
    enabled: Boolean(patientId),
  });

  return {
    ...query,
    bundle: query.data?.data,
    total: query.data?.data.total ?? 0,
    count: FLAG_COUNT,
    hasPrevious: hasRelation(query.data?.data, "previous"),
    hasNext: hasRelation(query.data?.data, "next"),
  };
}

/**
 * 患者帯のピクトグラム用。有効な注意を 1 回の検索でまとめて取る
 * (帯はページングしないので _count を大きめに取り、件数で切らない)。
 */
export function useActiveFlags(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("patient", `Patient/${patientId}`);
  params.set("status", "active");
  params.set("_count", "100");
  params.set("_sort", "-date");

  const query = useQuery({
    queryKey: ["Flag", "search", patientId, "active"],
    queryFn: () => searchResource<fhir4.Flag>("Flag", params),
    enabled: Boolean(patientId),
    staleTime: 30 * 1000,
  });

  const flags =
    query.data?.data.entry?.map((e) => e.resource).filter((r): r is fhir4.Flag => Boolean(r)) ?? [];

  return { ...query, flags };
}

// ---- 複数患者の一括取得(病棟マップのベッドカード用) ----
//
// 患者帯は 1 人ぶんを個別に引くが、病棟マップは 1 画面に 40〜60 人並ぶので、患者 id を
// カンマで OR にしてまとめて引く。参照パラメータのカンマ OR は PractitionerRole の
// organization= で使っている形と同じ。URL が長くなりすぎないよう患者を分割して並列に引く。

/**
 * 複数患者ぶんのリソースを患者 id ごとに振り分けて返す。buildParams は 1 塊ぶんの
 * 検索条件(患者以外)、subjectOf はリソースから患者 id を取る関数。
 */
async function fetchByPatientChunks<T extends fhir4.Resource>(
  resourceType: string,
  patientIds: string[],
  chunkSize: number,
  patientParam: string,
  buildParams: (params: URLSearchParams) => void,
  subjectOf: (resource: T) => string | undefined,
): Promise<Map<string, T[]>> {
  const result = new Map<string, T[]>();
  const chunks: string[][] = [];
  for (let i = 0; i < patientIds.length; i += chunkSize) chunks.push(patientIds.slice(i, i + chunkSize));

  const bundles = await Promise.all(
    chunks.map((ids) => {
      const params = new URLSearchParams();
      params.set(patientParam, ids.map((id) => `Patient/${id}`).join(","));
      params.set("_count", "500");
      buildParams(params);
      return searchResource<T>(resourceType, params);
    }),
  );
  for (const { data: bundle } of bundles) {
    for (const entry of bundle.entry ?? []) {
      const resource = entry.resource;
      if (!resource || resource.resourceType !== resourceType) continue;
      const patientId = subjectOf(resource);
      if (!patientId) continue;
      const list = result.get(patientId);
      if (list) list.push(resource);
      else result.set(patientId, [resource]);
    }
  }
  return result;
}

/** 患者 id を並べ替えて queryKey にする(順序が違うだけで引き直さない)。 */
function patientIdsKey(patientIds: string[]): string {
  return [...new Set(patientIds)].sort().join(",");
}

const PATIENT_CHUNK = 50;
/** 検査結果は 1 人あたりの件数が多いので、塊を小さくして _count の上限に当たりにくくする。 */
const LAB_PATIENT_CHUNK = 5;

/** 複数患者の有効な注意(Flag)。患者 id → Flag[]。 */
export function useFlagsForPatients(patientIds: string[]) {
  const key = patientIdsKey(patientIds);
  const query = useQuery({
    queryKey: ["Flag", "search", "by-patients", key],
    queryFn: () =>
      fetchByPatientChunks<fhir4.Flag>(
        "Flag",
        key.split(","),
        PATIENT_CHUNK,
        "patient",
        (params) => params.set("status", "active"),
        (flag) => referenceId(flag.subject?.reference),
      ),
    enabled: key.length > 0,
    staleTime: 60 * 1000,
  });
  return { ...query, byPatient: query.data ?? new Map<string, fhir4.Flag[]>() };
}

/** 複数患者の活動中のアレルギー。患者 id → AllergyIntolerance[]。 */
export function useAllergiesForPatients(patientIds: string[]) {
  const key = patientIdsKey(patientIds);
  const query = useQuery({
    queryKey: ["AllergyIntolerance", "search", "by-patients", key],
    queryFn: () =>
      fetchByPatientChunks<fhir4.AllergyIntolerance>(
        "AllergyIntolerance",
        key.split(","),
        PATIENT_CHUNK,
        "patient",
        (params) => params.set("clinical-status", "active"),
        (allergy) => referenceId(allergy.patient?.reference),
      ),
    enabled: key.length > 0,
    staleTime: 60 * 1000,
  });
  return { ...query, byPatient: query.data ?? new Map<string, fhir4.AllergyIntolerance[]>() };
}

/**
 * 複数患者の感染症(手入力 + 検査由来)。患者 id → 陽性の行。
 * 検査由来は患者ごとに新しい順で上限までしか見ないので、古い陽性は落ちることがある
 * (患者帯と同じ INFECTION_LAB_COUNT の考え方を塊単位にしたもの)。
 */
export function useInfectionsForPatients(patientIds: string[]) {
  const key = patientIdsKey(patientIds);
  const manual = useQuery({
    queryKey: ["Observation", "search", "by-patients", "infection-manual", key],
    queryFn: () =>
      fetchByPatientChunks<fhir4.Observation>(
        "Observation",
        key.split(","),
        PATIENT_CHUNK,
        "subject",
        (params) => params.set("category", "exam"),
        (observation) => referenceId(observation.subject?.reference),
      ),
    enabled: key.length > 0,
    staleTime: 60 * 1000,
  });
  const lab = useQuery({
    queryKey: ["Observation", "search", "by-patients", "infection-lab", key],
    queryFn: () =>
      fetchByPatientChunks<fhir4.Observation>(
        "Observation",
        key.split(","),
        LAB_PATIENT_CHUNK,
        "subject",
        (params) => {
          params.set("category", "laboratory");
          params.set("_sort", "-date");
        },
        (observation) => referenceId(observation.subject?.reference),
      ),
    enabled: key.length > 0 && HAS_LAB_MAPPED_TYPES,
    staleTime: 60 * 1000,
  });

  const byPatient = useMemo(() => {
    const result = new Map<string, InfectionRow[]>();
    const ids = new Set([...(manual.data?.keys() ?? []), ...(lab.data?.keys() ?? [])]);
    for (const id of ids) {
      const rows = summarizeInfections(manual.data?.get(id) ?? [], lab.data?.get(id) ?? []).filter(
        (row) => row.result === "positive",
      );
      if (rows.length > 0) result.set(id, rows);
    }
    return result;
  }, [manual.data, lab.data]);

  return { byPatient, error: manual.error ?? lab.error, isPending: manual.isPending || lab.isPending };
}

export function useFlag(id: string | undefined) {
  return useQuery({
    queryKey: ["Flag", id],
    queryFn: () => readResource<fhir4.Flag>("Flag", id as string),
    enabled: Boolean(id),
  });
}

export function useCreateFlag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (flag: fhir4.Flag) => createResource(flag),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Flag", "search"] });
    },
  });
}

// 削除は用意しない。誤登録も「終了」で残し、帯から消えれば運用上は足りる。
export function useUpdateFlag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ flag, etag }: { flag: fhir4.Flag; etag: string }) => updateResource(flag, etag),
    onSuccess: (result: FhirResult<fhir4.Flag>) => {
      queryClient.invalidateQueries({ queryKey: ["Flag", "search"] });
      queryClient.invalidateQueries({ queryKey: ["Flag", result.data.id] });
    },
  });
}

// ---- 血液型(ABO / RhD の Observation) ----

/**
 * 患者の血液型。ABO と RhD を LOINC のコード 2 つで 1 回の検索にまとめる
 * (`code` はカンマ区切りで OR になる)。件数が少ないのでページングはしない。
 */
export function useBloodType(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("code", `http://loinc.org|883-9,http://loinc.org|10331-7`);
  params.set("_count", "20");
  params.set("_sort", "-date");

  const query = useQuery({
    queryKey: ["Observation", "search", patientId, "blood-type"],
    queryFn: () => searchResource<fhir4.Observation>("Observation", params),
    enabled: Boolean(patientId),
    staleTime: 30 * 1000,
  });

  const observations =
    query.data?.data.entry
      ?.map((e) => e.resource)
      .filter((r): r is fhir4.Observation => Boolean(r)) ?? [];

  return { ...query, observations };
}

/**
 * 血液型の保存。ABO と RhD は別リソースなので transaction でまとめて送る
 * (片方だけ保存されて型が食い違う状態を作らないため)。
 */
export function useSaveBloodType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (observations: fhir4.Observation[]) => {
      const bundle: fhir4.Bundle = {
        resourceType: "Bundle",
        type: "transaction",
        entry: observations.map((observation) => ({
          resource: observation,
          request: observation.id
            ? { method: "PUT", url: `Observation/${observation.id}` }
            : { method: "POST", url: "Observation" },
        })),
      };
      return postBundle(bundle);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Observation", "search"] });
    },
  });
}

// ---- 妊娠・授乳(Observation) ----

/**
 * 妊娠状態と授乳状態。血液型と同じく LOINC 2 つを 1 回の検索でまとめて引く。
 * 状態が変わる情報なので、確認日の新しいものを画面側で採る(summarizePregnancy)。
 */
export function usePregnancy(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("code", `http://loinc.org|82810-3,http://loinc.org|63895-7`);
  params.set("_count", "20");
  params.set("_sort", "-date");

  const query = useQuery({
    queryKey: ["Observation", "search", patientId, "pregnancy"],
    queryFn: () => searchResource<fhir4.Observation>("Observation", params),
    enabled: Boolean(patientId),
    staleTime: 30 * 1000,
  });

  const observations =
    query.data?.data.entry
      ?.map((e) => e.resource)
      .filter((r): r is fhir4.Observation => Boolean(r)) ?? [];

  return { ...query, observations };
}

/** 妊娠・授乳の保存。血液型と同じく transaction でまとめて送る。 */
export function useSavePregnancy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (observations: fhir4.Observation[]) => {
      const bundle: fhir4.Bundle = {
        resourceType: "Bundle",
        type: "transaction",
        entry: observations.map((observation) => ({
          resource: observation,
          request: observation.id
            ? { method: "PUT", url: `Observation/${observation.id}` }
            : { method: "POST", url: "Observation" },
        })),
      };
      return postBundle(bundle);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Observation", "search"] });
    },
  });
}

// ---- 感染症(Observation) ----

/**
 * 手入力の感染症。検体検査の結果と混ざらないよう category=exam で絞る
 * (検査結果は下の useLabInfectionResults が JLAC11 コードで引く)。
 */
export function useManualInfections(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("category", "exam");
  params.set("_count", "50");
  params.set("_sort", "-date");

  const query = useQuery({
    queryKey: ["Observation", "search", patientId, "infection-manual"],
    queryFn: () => searchResource<fhir4.Observation>("Observation", params),
    enabled: Boolean(patientId),
    staleTime: 30 * 1000,
  });

  const observations =
    query.data?.data.entry
      ?.map((e) => e.resource)
      .filter((r): r is fhir4.Observation => Boolean(r)) ?? [];

  return { ...query, observations };
}

/** 感染症の判定に読む検体検査の結果の件数。新しい順にこの件数まで見る。 */
const INFECTION_LAB_COUNT = 500;

/**
 * 感染症の判定に使う検体検査の結果。
 *
 * 感染症かどうかは JLAC11 の分析物コード(先頭 5 桁)で決まるが、上流の
 * コード検索は完全一致なので前方一致で引けない。材料・測定法の違いを展開すると
 * 1 種類で数百コードになり URL に入らないため、患者の検体検査の結果を新しい順に
 * まとめて引き、分析物コードの突き合わせは画面側で行う(summarizeInfections)。
 */
export function useLabInfectionResults(patientId: string | undefined, enabled: boolean) {
  const params = new URLSearchParams();
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("category", "laboratory");
  params.set("_count", String(INFECTION_LAB_COUNT));
  params.set("_sort", "-date");

  const query = useQuery({
    queryKey: ["Observation", "search", patientId, "infection-lab"],
    queryFn: () => searchResource<fhir4.Observation>("Observation", params),
    enabled: Boolean(patientId) && enabled,
    staleTime: 30 * 1000,
  });

  const observations =
    query.data?.data.entry
      ?.map((e) => e.resource)
      .filter((r): r is fhir4.Observation => Boolean(r)) ?? [];

  return { ...query, observations };
}

/** 手入力の感染症の保存。1 件ずつなので transaction は使わない。 */
export function useSaveInfection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ observation, etag }: { observation: fhir4.Observation; etag?: string }) =>
      observation.id && etag
        ? updateResource(observation, etag)
        : createResource(observation),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Observation", "search"] });
    },
  });
}

export function useDeleteInfection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteResource("Observation", id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Observation", "search"] });
    },
  });
}

// ---- 身体計測・腎機能(プロファイルの読み取り専用の区画) ----

/**
 * 身長・体重の最新値。バイタルの中からコードで絞って引く
 * (経過表のように全項目を読む必要がない)。
 */
export function useBodyMeasures(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("patient", `Patient/${patientId}`);
  params.set("code", `http://loinc.org|8302-2,http://loinc.org|29463-7`);
  params.set("_count", "20");
  params.set("_sort", "-date");

  const query = useQuery({
    queryKey: ["Observation", "search", patientId, "body-measure"],
    queryFn: () => searchResource<fhir4.Observation>("Observation", params),
    enabled: Boolean(patientId),
    staleTime: 60 * 1000,
  });

  const observations =
    query.data?.data.entry
      ?.map((e) => e.resource)
      .filter((r): r is fhir4.Observation => Boolean(r)) ?? [];

  return { ...query, observations };
}

/**
 * 直近の検体検査の結果(新しい順)。分析物コード(先頭 5 桁)での突き合わせは画面側で
 * 行うので、ここでは患者の検査結果をまとめて引く。プロファイルの腎機能と、
 * 化学療法レジメンの投与前チェック(`regimenCheckHelpers.ts`)が同じ結果を読む。
 */
export function useRecentLabResults(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("category", "laboratory");
  params.set("_count", "200");
  params.set("_sort", "-date");

  const query = useQuery({
    queryKey: ["Observation", "search", patientId, "lab-recent"],
    queryFn: () => searchResource<fhir4.Observation>("Observation", params),
    enabled: Boolean(patientId),
    staleTime: 60 * 1000,
  });

  const observations =
    query.data?.data.entry
      ?.map((e) => e.resource)
      .filter((r): r is fhir4.Observation => Boolean(r)) ?? [];

  return { ...query, observations };
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
// 上流 fhir-server の _count 上限 500 を上限とした簡易版(それ以上は運用上想定しない)。
export function useQuestionnaireOptions(options?: { status?: fhir4.Questionnaire["status"] }) {
  const params = new URLSearchParams();
  if (options?.status) params.set("status", options.status);
  params.set("_count", "500");
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

// テンプレート回答フォームの初期値式(%conditions / %labResults / %prescriptions)の
// 元データ取得。傷病名はアクティブなもの全件(上流の _count 上限 500 まで)、
// 検査結果・処方は最新 1 件を _sort + _count + _include/_revinclude の 1 リクエスト
// で関連リソースごと取る(この組み合わせは上流の回帰 spec で保証済み)。
export function usePopulateSources(patientId: string | undefined) {
  const conditionParams = new URLSearchParams();
  if (patientId) conditionParams.set("patient", `Patient/${patientId}`);
  // 初期値式が対象にするのはアクティブな傷病名のみ(populateContext 参照)。
  conditionParams.set("clinical-status", "active");
  conditionParams.set("_count", "500");
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
  // 処方だけが持つ処方区分の system で絞る(注射も同じ ServiceRequest として保存されるため)。
  rxParams.set("category", `${PRESCRIPTION_CATEGORY_SYSTEM}|`);
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
// transaction で書く。生成しないテンプレートは単体リソースの保存経路のまま
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
 * カルテのオーダー検索から外す種別。看護指示はカルテのカードにせず指示簿タブで見せる
 * (karteTimeline 側でも落としているが、サーバー側で外さないと診療日ペインに
 * 看護指示しか無い日が空の日として並ぶ)。
 */
const KARTE_EXCLUDED_ORDER_TYPE_TOKENS = `${ORDER_TYPE_SYSTEM}|${NURSING_ORDER_TYPE.code}`;

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
      params.set("type", KARTE_NOTE_TYPE_SEARCH);
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

/**
 * カルテのオーダー本流。**取得軸 = 配置軸 = オーダー開始日(occurrence)** で、今日以前を
 * 新しい順にページングする。カードを置く日(karteTimeline の orderCardDay)と同じ軸で
 * 読むから、「この日より新しい日は読み切った」というカットオフ判定が厳密に成り立つ
 * (登録日時 authoredOn で読むと、先に登録した開始日の新しいオーダーが、その日を
 * 読み切った後に届いて欠ける)。今日より後の予定と日付未定は useKartePendingOrders が
 * 全件先読みする。
 */
export function useKartePrescriptionsInfinite(
  patientId: string | undefined,
  problemIds: KarteProblemFilter = null,
) {
  // 日を跨いで開きっぱなしのタブが古い境界で読み続けないよう、キーに今日を含める。
  const todayDay = today();
  return useInfiniteQuery({
    queryKey: ["ServiceRequest", "search", "karte", patientId, problemQueryKey(problemIds), todayDay],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      // オーダーの対象プロブレムは reasonReference(R4 標準)。明細も親から
      // 引き継いだ理由を持つが、下の based-on:missing でヘッダだけに絞られる。
      if (problemIds?.length) params.set("reason-reference", problemSearchValue(problemIds));
      params.set("_count", String(KARTE_PAGE));
      params.set("_offset", String(pageParam));
      params.set("_sort", "-occurrence");
      // 今日以前の開始日。上流は日付だけの値をローカル日で解釈するので、le{今日} で
      // 「今日の終わりまで」になる。先読み側の gt{今日} と合わせて過不足なく分割される。
      params.set("occurrence", `le${todayDay}`);
      params.set("category:not", KARTE_EXCLUDED_ORDER_TYPE_TOKENS);
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
 * 先読みするオーダー。カルテの本流は開始日(occurrence)が今日以前のものを新しい順に
 * ページングするので、「日付未定のもの」と「開始日が今日より後のもの」はそこに含まれない。
 * 種別で切ると「手術は件数が少ないから全件取れる」という種別依存の理屈になるので、
 * **状態で切って**全件読む。どちらも件数は自然に小さい(未定は未処理の仕事なので溜まらず、
 * 未来の予定も有限)。
 *
 * occurrence を持たないオーダーも occurrence:missing に
 * 入り、タイムライン側で登録日の位置に落ちる。
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
    params.set("category:not", KARTE_EXCLUDED_ORDER_TYPE_TOKENS);
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
      // 今日より後の開始日。今日以前は本流(occurrence=le{今日})が読む。
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

/**
 * カルテのタイムラインの「パス評価」(docs/clinical-pathway-design.md §6)。記載のあるアウトカムの評価を
 * 患者ぶん全部読む(1 人の患者で数十件程度なのでページングしない。タイムラインの表示範囲の計算には加わらない)。
 *
 * `Observation?patient&category=パスの印&code=判定` で評価の Observation を引き、basedOn の OAT ユニットを
 * `_include=Observation:based-on` で、その祖先の病日・適用を `_include:iterate=CarePlan:part-of` で同じ応答に揃える。
 *
 * 評価はプロブレムを指さないので、プロブレムで絞り込んでいるときは出さない。
 * キーは評価の記録(useRecordPathwayEvaluation)の読み直しと同じ ["Observation", "search", "pathway"] 配下。
 */
export function useKartePathwayEvaluations(
  patientId: string | undefined,
  problemIds: KarteProblemFilter = null,
) {
  return useQuery({
    queryKey: ["Observation", "search", "pathway", "karte-cards", patientId, problemQueryKey(problemIds)],
    queryFn: async (): Promise<PathwayEvaluationCard[]> => {
      if (problemIds?.length) return [];
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      params.set("category", `${PATHWAY_MARKER_SYSTEM}|${PATHWAY_MARKER_CODE}`);
      params.set("code", `${EVALUATION_ITEM_SYSTEM}|judgement`);
      params.set("_include", "Observation:based-on");
      params.set("_include:iterate", "CarePlan:part-of");
      params.set("_count", "500");
      const { data: bundle } = await searchResource<fhir4.Resource>("Observation", params);
      const observations = resourcesOfType<fhir4.Observation>(bundle, "Observation");
      if (observations.length === 0) return [];
      return buildPathwayEvaluationCards(observations, resourcesOfType<fhir4.CarePlan>(bundle, "CarePlan"));
    },
    enabled: Boolean(patientId) && problemIds !== undefined,
  });
}

// ---- 診療日インデックス ----
//
// 診療日ペインには、タイムラインの読み込み状況に関係なく全診療日を最初から出す。
// 検索条件(プロブレム絞り込みを含む)はタイムラインの各無限クエリと揃えること。
// キーも同じ ["<型>", "search"] 配下に置くので、登録・削除の invalidate で一緒に
// 再取得される。
// 診療日の集合は $distinct-dates のサーバー集計で取る。limit はカルテの左ペインに
// 出す日数の実用上限。
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
          params.set("type", KARTE_NOTE_TYPE_SEARCH);
          if (problemIds?.length) params.set("problem", problemSearchValue(problemIds));
          return params;
        })(),
        "date",
      ),
    enabled,
  });

  // オーダーはすべて開始日(occurrence)にカードを出すので、診療日もその 1 本で数える
  // (タイムラインと同じくヘッダだけ、看護指示は除く)。
  //
  // occurrence を持たないオーダーの置き場は種別で変わる(未定を許す種別は「日付未定」、
  // それ以外は登録日)。サーバー集計は「occurrence が無い」までしか分からないので、
  // 該当があるときだけ種別と登録日を引き直し、タイムラインと同じ orderCardDay で写す
  // —— 写さずに一律「日付未定」に足すと、カードが登録日に出るぶん空の「日付未定」が並ぶ。
  const orders = useQuery({
    queryKey: ["ServiceRequest", "search", "karte-days-occurrence", patientId, problemKey],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      if (problemIds?.length) params.set("reason-reference", problemSearchValue(problemIds));
      params.set("based-on:missing", "true");
      params.set("category:not", KARTE_EXCLUDED_ORDER_TYPE_TOKENS);
      // fetchDistinctDates は渡した params に集計用の値を足すので、引き直し用に写しを渡す。
      const { dates, hasUndated } = await fetchDistinctDates(
        "ServiceRequest",
        new URLSearchParams(params),
        "occurrence",
        { limit: 1000 },
      );
      if (!hasUndated) return dates;

      params.set("occurrence:missing", "true");
      params.set("_elements", "category,authoredOn");
      params.set("_count", String(KARTE_PENDING_COUNT));
      const { data: bundle } = await searchResource<fhir4.Resource>("ServiceRequest", params);
      const undated = resourcesOfType<fhir4.ServiceRequest>(bundle, "ServiceRequest");
      return [...dates, ...undated.map(orderCardDay)];
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

  const queries = [notes, orders, responses, vitals];
  const days = useMemo(() => {
    const merged = new Set<string>();
    for (const list of [notes.data, orders.data, responses.data, vitals.data]) {
      for (const day of list ?? []) merged.add(day);
    }
    return Array.from(merged).sort(compareKarteDaysDesc);
  }, [notes.data, orders.data, responses.data, vitals.data]);

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

// 経過表は「基準日から 1 週間」を横軸にする(1 日の中は測定ごとに列が分かれる)。
// 期間で絞った Observation をまとめて取る。1 回の測定が 8 件前後に分かれるので、
// 1 週間でも数百件になりうる。ページングで取り切る。
const VITAL_FLOWSHEET_PAGE = 500;
// 1 か月表示だと、測定の多い患者で 1000 件を超えうるので余裕を持たせる。
const VITAL_FLOWSHEET_MAX_PAGES = 4;

// 経過表に載せる Observation の区分。手入力・テンプレート抽出のバイタル(vital-signs)に
// 加えて、看護指示の観察結果(order-type の nursing。nursingPerformHelpers)も同じ表で
// 時系列に読めるようにする。カルテのバイタルカードと診療日の索引
// (useKarteVitalsInfinite / useKarteDayIndex)は vital-signs のままにしてある
// (看護観察を混ぜるとカードにならない Observation で診療日だけが増える)。
const VITAL_FLOWSHEET_CATEGORY = `vital-signs,${NURSING_ORDER_TYPE.code}`;

async function fetchVitalFlowsheetObservations(
  patientId: string,
  rangeStart: string,
  rangeEnd: string,
): Promise<fhir4.Observation[]> {
  const observations: fhir4.Observation[] = [];
  for (let page = 0; page < VITAL_FLOWSHEET_MAX_PAGES; page += 1) {
    const params = new URLSearchParams();
    params.set("patient", `Patient/${patientId}`);
    params.set("category", VITAL_FLOWSHEET_CATEGORY);
    // 日付だけの値は上流が施設のタイムゾーンで日の範囲に広げて解釈する。
    params.append("date", `ge${rangeStart}`);
    params.append("date", `le${rangeEnd}`);
    params.set("_count", String(VITAL_FLOWSHEET_PAGE));
    params.set("_offset", String(page * VITAL_FLOWSHEET_PAGE));
    params.set("_sort", "date");

    const { data: bundle } = await searchResource<fhir4.Observation>("Observation", params);
    const pageObservations = (bundle.entry ?? [])
      .map((entry) => entry.resource)
      .filter((r): r is fhir4.Observation => r?.resourceType === "Observation");
    observations.push(...pageObservations);

    if (pageObservations.length < VITAL_FLOWSHEET_PAGE) break;
  }

  return observations;
}

export function useVitalFlowsheet(
  patientId: string | undefined,
  rangeStart: string,
  rangeEnd: string,
) {
  return useQuery({
    // 登録・更新・削除の invalidateQueries(["Observation", "search"]) でまとめて
    // 無効化されるよう search 配下のキーにしている。
    queryKey: ["Observation", "search", "vital-flowsheet", patientId, rangeStart, rangeEnd],
    queryFn: () => fetchVitalFlowsheetObservations(patientId ?? "", rangeStart, rangeEnd),
    enabled: Boolean(patientId) && Boolean(rangeStart) && Boolean(rangeEnd),
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

/** useDeletePrescription の本体(読み直しの指示を伴わない)。パスの取り消しがまとめて消すときにも使う。 */
export const deletePrescriptionRequest = (srId: string) => postBundle(buildPrescriptionDeleteBundle(srId));

export function useDeletePrescription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deletePrescriptionRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
    },
  });
}

/**
 * 検体検査は明細も ServiceRequest なので、ぶら下がっているものを引いてから
 * ヘッダごと消す(処方の MedicationRequest と同じ考え方)。
 *
 * useDeleteLabOrder の本体(読み直しの指示を伴わない)。パスの取り消しがまとめて消すときにも使う。
 */
export const deleteLabOrderRequest = async (srId: string) => {
  const params = new URLSearchParams();
  params.set("_id", srId);
  params.set("_revinclude:iterate", "ServiceRequest:based-on");
  const { data: bundle } = await searchResource<fhir4.ServiceRequest>("ServiceRequest", params);
  const itemIds = labOrderItemRequests(serviceRequestsOf(bundle), srId)
    .map((request) => request.id)
    .filter((id): id is string => Boolean(id));
  return postBundle(buildLabOrderDeleteBundle(srId, itemIds));
};

export function useDeleteLabOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteLabOrderRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
    },
  });
}

/**
 * 細菌検査オーダーも明細(検体グループ・検査項目)が独立した ServiceRequest なので、
 * 消す直前に明細を引き直してからまとめて消す(検体検査と同じ)。
 *
 * useDeleteMicroOrder の本体(読み直しの指示を伴わない)。パスの取り消しがまとめて消すときにも使う。
 */
export const deleteMicroOrderRequest = async (srId: string) => {
  const params = new URLSearchParams();
  params.set("_id", srId);
  params.set("_revinclude:iterate", "ServiceRequest:based-on");
  const { data: bundle } = await searchResource<fhir4.ServiceRequest>("ServiceRequest", params);
  const itemIds = microOrderItemRequests(serviceRequestsOf(bundle), srId)
    .map((request) => request.id)
    .filter((id): id is string => Boolean(id));
  return postBundle(buildMicroOrderDeleteBundle(srId, itemIds));
};

export function useDeleteMicroOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteMicroOrderRequest,
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
  const withProvenance = useWithOrderProvenance();
  return useMutation({
    mutationFn: async ({
      bundle,
      booking,
    }: {
      bundle: fhir4.Bundle;
      booking: RadBookingChange | null;
    }) => {
      if (!booking) return postBundle(withProvenance(bundle));
      // 空きに戻す元の枠は参照しか持っていないので、ここで引き直す(取消と同じ)。
      const entries = buildRescheduleEntries(
        booking.appointment,
        await fetchAppointmentSlots(booking.appointment),
        booking.slots,
      );
      return postBundle(withProvenance({ ...bundle, entry: [...(bundle.entry ?? []), ...entries] }));
    },
    onSuccess: () => {
      // 撮影日時が動くと放射線検査一覧の当日ぶんも変わるので、ServiceRequest は
      // まとめて読み直させる。
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
      invalidateAppointments(queryClient);
      invalidateProvenance(queryClient);
    },
  });
}

/**
 * 放射線オーダーも明細が独立した ServiceRequest なので、ヘッダだけ消すと明細が
 * 残ってしまう。消す直前に明細を引き直してからまとめて消す(検体検査と同じ)。
 * オーダーに紐づく検査予約があれば、取消(cancelled + 枠の free 化)も同じ
 * transaction に同梱する(予約だけ残ってオーダーが無い状態を作らない)。
 *
 * useDeleteRadOrder の本体(読み直しの指示を伴わない)。パスの取り消しがまとめて消すときにも使う。
 */
export const deleteRadOrderRequest = async (srId: string) => {
  const params = new URLSearchParams();
  params.set("_id", srId);
  params.set("_revinclude:iterate", "ServiceRequest:based-on");
  params.append("_revinclude", "DiagnosticReport:based-on");
  const { data: bundle } = await searchResource<fhir4.ServiceRequest>("ServiceRequest", params);
  // 読影レポートが付いたオーダーは消させない(レポートの basedOn が指す先が無くなる)。
  if (resourcesOfType<fhir4.DiagnosticReport>(bundle, "DiagnosticReport").some(isRadReport)) {
    throw new Error("読影レポートがあるため削除できません。読影レポートを削除してから削除してください。");
  }
  const itemRequests = radOrderItemRequests(serviceRequestsOf(bundle), srId);
  const itemIds = itemRequests
    .map((request) => request.id)
    .filter((id): id is string => Boolean(id));

  const appointmentEntries = await fetchOrderAppointmentCancelEntries(srId);

  // 明細が参照しているテンプレート回答も一緒に消す(孤児を残さない)。
  return postBundle(
    buildRadOrderDeleteBundle(
      srId,
      itemIds,
      radOrderResponseIds(itemRequests),
      appointmentEntries,
    ),
  );
};

export function useDeleteRadOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteRadOrderRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
      queryClient.invalidateQueries({ queryKey: ["Appointment"] });
      queryClient.invalidateQueries({ queryKey: ["Slot"] });
    },
  });
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
      searchResource<fhir4.Resource>("Procedure", procedurePerformSearchParams(orderId ?? "")),
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
 * 薬剤(MedicationAdministration)を 1 リクエストで集める。生理検査・内視鏡・処置で共用する。
 * 放射線と違い被曝線量(Observation)は作らないので引かない。
 *
 * 一覧が持っている行の情報からではなく、その場で引き直す。取消は稀な操作で、
 * 一覧を開いた後に別の端末で登録された実施記録も残さず消したいため。
 */
function procedurePerformSearchParams(orderId: string): URLSearchParams {
  const params = new URLSearchParams();
  params.set("based-on", `ServiceRequest/${orderId}`);
  params.set("_count", "100");
  params.append("_revinclude", "MedicationAdministration:part-of");
  return params;
}

async function fetchProcedurePerformResources(orderId: string) {
  const { data: bundle } = await searchResource<fhir4.Resource>(
    "Procedure",
    procedurePerformSearchParams(orderId),
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
        ? await fetchProcedurePerformResources(order.id ?? "")
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
 * 生理検査オーダーの更新。予約日時を変えたときは、予約の付け替え(Appointment の
 * 日時と枠の busy/free)も同じ transaction で書く。オーダーだけ・予約だけが動いて
 * 実施日時が食い違うことを防ぐため。
 */
export function useUpdatePhysioOrder() {
  const queryClient = useQueryClient();
  const withProvenance = useWithOrderProvenance();
  return useMutation({
    mutationFn: async ({
      bundle,
      booking,
    }: {
      bundle: fhir4.Bundle;
      booking: RadBookingChange | null;
    }) => {
      if (!booking) return postBundle(withProvenance(bundle));
      // 空きに戻す元の枠は参照しか持っていないので、ここで引き直す(取消と同じ)。
      const entries = buildRescheduleEntries(
        booking.appointment,
        await fetchAppointmentSlots(booking.appointment),
        booking.slots,
      );
      return postBundle(withProvenance({ ...bundle, entry: [...(bundle.entry ?? []), ...entries] }));
    },
    onSuccess: () => {
      // 実施日時が動くと生理検査一覧の当日ぶんも変わるので、ServiceRequest は
      // まとめて読み直させる。
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
      invalidateAppointments(queryClient);
      invalidateProvenance(queryClient);
    },
  });
}

/**
 * 生理検査オーダーも明細が独立した ServiceRequest なので、ヘッダだけ消すと明細が
 * 残ってしまう。消す直前に明細を引き直してからまとめて消す(放射線検査と同じ)。
 *
 * useDeletePhysioOrder の本体(読み直しの指示を伴わない)。パスの取り消しがまとめて消すときにも使う。
 */
export const deletePhysioOrderRequest = async (srId: string) => {
  const params = new URLSearchParams();
  params.set("_id", srId);
  params.set("_revinclude:iterate", "ServiceRequest:based-on");
  const { data: bundle } = await searchResource<fhir4.ServiceRequest>("ServiceRequest", params);
  const itemRequests = physioOrderItemRequests(serviceRequestsOf(bundle), srId);
  const itemIds = itemRequests
    .map((request) => request.id)
    .filter((id): id is string => Boolean(id));

  const appointmentEntries = await fetchOrderAppointmentCancelEntries(srId);

  // 明細が参照しているテンプレート回答も一緒に消す(孤児を残さない)。
  return postBundle(
    buildPhysioOrderDeleteBundle(
      srId,
      itemIds,
      physioOrderResponseIds(itemRequests),
      appointmentEntries,
    ),
  );
};

export function useDeletePhysioOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deletePhysioOrderRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
      queryClient.invalidateQueries({ queryKey: ["Appointment"] });
      queryClient.invalidateQueries({ queryKey: ["Slot"] });
    },
  });
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
      searchResource<fhir4.Resource>("Procedure", procedurePerformSearchParams(orderId ?? "")),
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
        ? await fetchProcedurePerformResources(order.id ?? "")
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
 * 内視鏡オーダーの更新。予約日時を変えたときは、予約の付け替え(Appointment の
 * 日時と枠の busy/free)も同じ transaction で書く。オーダーだけ・予約だけが動いて
 * 実施日時が食い違うことを防ぐため。
 */
export function useUpdateEndoscopyOrder() {
  const queryClient = useQueryClient();
  const withProvenance = useWithOrderProvenance();
  return useMutation({
    mutationFn: async ({
      bundle,
      booking,
    }: {
      bundle: fhir4.Bundle;
      booking: RadBookingChange | null;
    }) => {
      if (!booking) return postBundle(withProvenance(bundle));
      // 空きに戻す元の枠は参照しか持っていないので、ここで引き直す(取消と同じ)。
      const entries = buildRescheduleEntries(
        booking.appointment,
        await fetchAppointmentSlots(booking.appointment),
        booking.slots,
      );
      return postBundle(withProvenance({ ...bundle, entry: [...(bundle.entry ?? []), ...entries] }));
    },
    onSuccess: () => {
      // 実施日時が動くと内視鏡一覧の当日ぶんも変わるので、ServiceRequest は
      // まとめて読み直させる。
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
      invalidateAppointments(queryClient);
      invalidateProvenance(queryClient);
    },
  });
}

/**
 * 内視鏡オーダーも明細が独立した ServiceRequest なので、ヘッダだけ消すと明細が
 * 残ってしまう。消す直前に明細を引き直してからまとめて消す(放射線検査と同じ)。
 *
 * useDeleteEndoscopyOrder の本体(読み直しの指示を伴わない)。パスの取り消しがまとめて消すときにも使う。
 */
export const deleteEndoscopyOrderRequest = async (srId: string) => {
  const params = new URLSearchParams();
  params.set("_id", srId);
  params.set("_revinclude:iterate", "ServiceRequest:based-on");
  const { data: bundle } = await searchResource<fhir4.ServiceRequest>("ServiceRequest", params);
  const itemRequests = endoscopyOrderItemRequests(serviceRequestsOf(bundle), srId);
  const itemIds = itemRequests
    .map((request) => request.id)
    .filter((id): id is string => Boolean(id));

  const appointmentEntries = await fetchOrderAppointmentCancelEntries(srId);

  // 明細が参照しているテンプレート回答も一緒に消す(孤児を残さない)。
  return postBundle(
    buildEndoscopyOrderDeleteBundle(
      srId,
      itemIds,
      endoscopyOrderResponseIds(itemRequests),
      appointmentEntries,
    ),
  );
};

export function useDeleteEndoscopyOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteEndoscopyOrderRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
      queryClient.invalidateQueries({ queryKey: ["Appointment"] });
      queryClient.invalidateQueries({ queryKey: ["Slot"] });
    },
  });
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
      searchResource<fhir4.Resource>("Procedure", procedurePerformSearchParams(orderId ?? "")),
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
        ? await fetchProcedurePerformResources(order.id ?? "")
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
 * 処置オーダーの更新。予約日時を変えたときは、予約の付け替え(Appointment の
 * 日時と枠の busy/free)も同じ transaction で書く。オーダーだけ・予約だけが動いて
 * 実施日時が食い違うことを防ぐため。
 */
export function useUpdateTreatmentOrder() {
  const queryClient = useQueryClient();
  const withProvenance = useWithOrderProvenance();
  return useMutation({
    mutationFn: async ({
      bundle,
      booking,
    }: {
      bundle: fhir4.Bundle;
      booking: RadBookingChange | null;
    }) => {
      if (!booking) return postBundle(withProvenance(bundle));
      // 空きに戻す元の枠は参照しか持っていないので、ここで引き直す(取消と同じ)。
      const entries = buildRescheduleEntries(
        booking.appointment,
        await fetchAppointmentSlots(booking.appointment),
        booking.slots,
      );
      return postBundle(withProvenance({ ...bundle, entry: [...(bundle.entry ?? []), ...entries] }));
    },
    onSuccess: () => {
      // 実施日時が動くと処置一覧の当日ぶんも変わるので、ServiceRequest は
      // まとめて読み直させる。
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
      invalidateAppointments(queryClient);
      invalidateProvenance(queryClient);
    },
  });
}

/**
 * 処置オーダーも明細が独立した ServiceRequest なので、ヘッダだけ消すと明細が
 * 残ってしまう。消す直前に明細を引き直してからまとめて消す(生理検査と同じ)。
 *
 * useDeleteTreatmentOrder の本体(読み直しの指示を伴わない)。パスの取り消しがまとめて消すときにも使う。
 */
export const deleteTreatmentOrderRequest = async (srId: string) => {
  const params = new URLSearchParams();
  params.set("_id", srId);
  params.set("_revinclude:iterate", "ServiceRequest:based-on");
  const { data: bundle } = await searchResource<fhir4.ServiceRequest>("ServiceRequest", params);
  const itemRequests = treatmentOrderItemRequests(serviceRequestsOf(bundle), srId);
  const itemIds = itemRequests
    .map((request) => request.id)
    .filter((id): id is string => Boolean(id));

  const appointmentEntries = await fetchOrderAppointmentCancelEntries(srId);

  return postBundle(buildTreatmentOrderDeleteBundle(srId, itemIds, appointmentEntries));
};

export function useDeleteTreatmentOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteTreatmentOrderRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
      queryClient.invalidateQueries({ queryKey: ["Appointment"] });
      queryClient.invalidateQueries({ queryKey: ["Slot"] });
    },
  });
}


/**
 * 期間継続型のオーダー(食事・リハビリ・栄養指導・看護指示)を「from〜to の期間に
 * 掛かっているもの」に絞る。開始は occurrenceDateTime、終了は各種別の *-order-end
 * 拡張を上流が order-period として索引している。終了の無いオーダーは継続中として掛かる。
 * from と to に同じ日を渡すと「その日に効いている」になる。
 */
function setOrderPeriod(params: URLSearchParams, from: string, to: string): void {
  params.append("order-period", `ge${from}`);
  params.append("order-period", `le${to}`);
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
 */
export function useActiveMealOrders(patientId: string | undefined, at: string) {
  const params = new URLSearchParams();
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("category", `${ORDER_TYPE_SYSTEM}|${MEAL_ORDER_TYPE.code}`);
  params.set("status", "active");
  setOrderPeriod(params, at, at);
  params.set("_sort", "-authoredon");
  params.set("_count", "20");

  return useQuery({
    queryKey: ["ServiceRequest", "search", "meal-active", patientId, at],
    queryFn: async () => {
      const { data: bundle } = await searchResource<fhir4.ServiceRequest>(
        "ServiceRequest",
        params,
      );
      return serviceRequestsOf(bundle).filter(isMealServiceRequest);
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
export async function fetchPatientMealOrders(patientId: string): Promise<fhir4.ServiceRequest[]> {
  const params = new URLSearchParams();
  params.set("subject", `Patient/${patientId}`);
  params.set("category", `${ORDER_TYPE_SYSTEM}|${MEAL_ORDER_TYPE.code}`);
  params.set("status", "active");
  // 新しい順。まだ続いているオーダーは必ずこの中に入るので 1 ページで足りる。
  params.set("_sort", "-authoredon");
  params.set("_count", "50");
  const { data: bundle } = await searchResource<fhir4.ServiceRequest>("ServiceRequest", params);
  return serviceRequestsOf(bundle).filter(isMealServiceRequest);
}

export function usePatientMealOrders(patientId: string | undefined) {
  return useQuery({
    queryKey: ["ServiceRequest", "search", "meal-patient", patientId],
    queryFn: () => fetchPatientMealOrders(patientId as string),
    enabled: Boolean(patientId),
  });
}

/** 施設の食事提供時刻。設定が読めるまでは既定値(08/12/18)で動く。 */
export function useMealSchedule() {
  const settings = useFacilitySettings();
  return settings.data?.meal_schedule ?? DEFAULT_MEAL_SCHEDULE;
}

/** 内服の与薬時刻(食前・食後のずらしと就寝前・起床時)。設定が読めるまでは既定値。 */
export function useMedicationSchedule() {
  const settings = useFacilitySettings();
  return settings.data?.medication_schedule ?? DEFAULT_MEDICATION_SCHEDULE;
}

/**
 * 処方区分の初期値(入外区分ごと)。処方フォームを開いたときと、入外区分を選び直した
 * ときの値に使う。設定が読めるまでは未選択(既定値)。
 */
export function usePrescriptionCategoryDefaults() {
  const settings = useFacilitySettings();
  return {
    defaults: settings.data?.prescription_category ?? DEFAULT_PRESCRIPTION_CATEGORY,
    /** 設定を読み終えたか。フォームの初期値は初回描画時にしか効かないので、呼び出し側は
     *  これが true になるまでフォームを描かない。 */
    ready: !settings.isLoading,
  };
}

const EMPTY_CONSULT_DEFAULT_TEMPLATES: Record<string, string> = {};

/** 他科依頼の依頼目的テンプレートの既定(依頼先の診療科 Organization.id → canonical)。 */
export function useConsultDefaultTemplates() {
  const settings = useFacilitySettings();
  return settings.data?.consult_default_templates ?? EMPTY_CONSULT_DEFAULT_TEMPLATES;
}

/** 経過表でバイタルを異常値として強調するしきい値。設定が読めるまでは既定値で判定する。 */
export function useVitalThresholds() {
  const settings = useFacilitySettings();
  return settings.data?.vital_thresholds ?? DEFAULT_VITAL_THRESHOLDS;
}

/**
 * カレンダーに出す 1 か月ぶんの食事オーダー。
 *
 * 食事は開始したら次の指示まで続くので、その月に始まったものだけでは足りない
 * (前の月から続いているオーダーがその月の食事を決めていることがある)。
 * その月に掛かっている(月末までに始まり、月初より前に終わっていない)オーダーを引く。
 */
export function useMealOrderMonth(patientId: string | undefined, monthStart: string, monthEnd: string) {
  const params = new URLSearchParams();
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("category", `${ORDER_TYPE_SYSTEM}|${MEAL_ORDER_TYPE.code}`);
  params.set("status", "active");
  setOrderPeriod(params, monthStart, monthEnd);
  // 1 患者の食事オーダーは入院 1 回でせいぜい数十件なので 1 ページで足りる。
  params.set("_count", "100");

  return useQuery({
    queryKey: ["ServiceRequest", "search", "meal-month", patientId, monthStart, monthEnd],
    queryFn: async () => {
      const { data: bundle } = await searchResource<fhir4.ServiceRequest>("ServiceRequest", params);
      return serviceRequestsOf(bundle).filter(isMealServiceRequest);
    },
    enabled: Boolean(patientId) && Boolean(monthStart) && Boolean(monthEnd),
  });
}

export function useUpdateMealOrder() {
  const queryClient = useQueryClient();
  const withProvenance = useWithOrderProvenance();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(withProvenance(bundle)),
    onSuccess: () => {
      // 開始日が動くとカードの載る日も変わるので、まとめて読み直させる。
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
      invalidateProvenance(queryClient);
    },
  });
}

/** 明細も予約も持たないので、ヘッダ 1 件を消すだけ。 */
/** useDeleteMealOrder の本体(読み直しの指示を伴わない)。パスの取り消しがまとめて消すときにも使う。 */
export const deleteMealOrderRequest = (srId: string) => deleteResource("ServiceRequest", srId);

export function useDeleteMealOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteMealOrderRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
    },
  });
}

// ---- リハビリオーダー ----
//
// 食事と同じ期間継続型なので、明細を持たずヘッダ 1 本で済む。食事と違うのは進捗
// Task と実施記録(Procedure)を持つところで、Task は「部門の受け入れ状態」を表し、
// 日々の実施は Task を動かさず Procedure が積み上がる
// (docs/rehab-order-design.md §4)。
//
// 「基準日に効いている(始まっていて、まだ終わっていない)」は order-period で引く
// (開始は occurrenceDateTime、終了は rehab-order-end 拡張を上流が索引している)。

export function useRehabOrderDetail(srId: string | undefined) {
  const params = new URLSearchParams();
  if (srId) {
    params.set("_id", srId);
    // 進捗と実施履歴を詳細パネル・実施入力で使うので同時に取る。
    params.set("_revinclude", "Task:focus");
    params.append("_revinclude", "Procedure:based-on");
  }

  // Task と Procedure が混ざって返るので、要素の型は Resource で受ける。
  return useQuery({
    queryKey: ["ServiceRequest", "detail", "rehab-order", srId],
    queryFn: () => searchResource<fhir4.Resource>("ServiceRequest", params),
    enabled: Boolean(srId),
  });
}

/**
 * その患者の有効なリハビリオーダー。退院で打ち切る対象を選ぶのに使う。
 * どれを止めるかは退院日で決まるので、絞り込み(rehabOrderNeedsStop)は画面側で行う
 * (usePatientMealOrders と同じ作り)。
 */
export function usePatientRehabOrders(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("category", `${ORDER_TYPE_SYSTEM}|${REHAB_ORDER_TYPE.code}`);
  params.set("status", "active");
  params.set("_sort", "-authoredon");
  params.set("_count", "20");

  return useQuery({
    queryKey: ["ServiceRequest", "search", "rehab-patient", patientId],
    queryFn: async () => {
      const { data: bundle } = await searchResource<fhir4.ServiceRequest>("ServiceRequest", params);
      return serviceRequestsOf(bundle).filter(isRehabServiceRequest);
    },
    enabled: Boolean(patientId),
  });
}

/** 指定日に効いている(始まっていて、まだ終わっていない)リハビリオーダー。 */
export function useActiveRehabOrders(patientId: string | undefined, at: string) {
  const params = new URLSearchParams();
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("category", `${ORDER_TYPE_SYSTEM}|${REHAB_ORDER_TYPE.code}`);
  params.set("status", "active");
  setOrderPeriod(params, at, at);
  params.set("_count", "50");

  return useQuery({
    queryKey: ["ServiceRequest", "search", "rehab-active", patientId, at],
    queryFn: async () => {
      const { data: bundle } = await searchResource<fhir4.ServiceRequest>("ServiceRequest", params);
      return serviceRequestsOf(bundle).filter(isRehabServiceRequest);
    },
    enabled: Boolean(patientId) && Boolean(at),
  });
}

export function useUpdateRehabOrder() {
  const queryClient = useQueryClient();
  const withProvenance = useWithOrderProvenance();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(withProvenance(bundle)),
    onSuccess: () => {
      // 開始日が動くとカードの載る日も変わるので、まとめて読み直させる。
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
      invalidateProvenance(queryClient);
    },
  });
}

/**
 * オーダーを消す。明細は持たないが、リハ部門が取った予約は道連れで取り消す
 * (放射線オーダーの削除と同じ後始末。予約だけが残って枠を塞ぐのを防ぐ)。
 *
 * useDeleteRehabOrder の本体(読み直しの指示を伴わない)。パスの取り消しがまとめて消すときにも使う。
 */
export const deleteRehabOrderRequest = async (srId: string) => {
  const appointmentEntries = await fetchOrderAppointmentCancelEntries(srId);
  return postBundle({
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      ...appointmentEntries,
      { request: { method: "DELETE", url: `ServiceRequest/${srId}` } },
    ],
  });
};

export function useDeleteRehabOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteRehabOrderRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
      invalidateAppointments(queryClient);
    },
  });
}

// ---- リハビリ一覧(部門ワークリスト) ----
//
// 他部門の一覧は「その日に実施予定のオーダー」を日付一致で引くが、リハビリは期間型
// なので「基準日に効いている(始まっていて、まだ終わっていない)オーダー」を
// order-period で引く。
//
// 疾患別リハ区分・療法種別・入外区分・病棟・診療科・進捗での絞り込みは画面側で行う
// (理由は検体検査一覧の節のコメントを参照)。

/** リハビリ一覧の 1 行。オーダー(ヘッダ)1 件ぶん。 */
export interface RehabWorklistRow {
  order: fhir4.ServiceRequest;
  patient?: fhir4.Patient;
  /** 進捗(= 部門の受け入れ状態)。部門がまだ触っていないオーダーには無い(= 依頼済)。 */
  task?: fhir4.Task;
  /** 基準日の実施記録。期間中は何度も実施するので「その日に実施したか」で見る。 */
  todayPerforms: RehabPerformDisplay[];
  /** 基準日以降の予約(近い順)。先頭が「次回予約」。 */
  appointments: fhir4.Appointment[];
}

export interface RehabWorklistResult {
  rows: RehabWorklistRow[];
  /** 上限まで読んでも読み切れなかった。 */
  truncated: boolean;
}

/**
 * 基準日に効いているリハビリオーダーのヘッダ検索。worklistParams を使わないのは
 * 日付の当て方が違うため(他部門は実施予定日の一致、リハビリは期間の重なり)。
 */
function rehabWorklistParams(date: string, page: number): URLSearchParams {
  const params = new URLSearchParams();
  params.set("category", `${ORDER_TYPE_SYSTEM}|${REHAB_ORDER_TYPE.code}`);
  params.set("status", "active");
  setOrderPeriod(params, date, date);
  params.set("based-on:missing", "true");
  params.set("_count", String(WORKLIST_PAGE));
  params.set("_offset", String(page * WORKLIST_PAGE));
  params.set("_include", "ServiceRequest:subject");
  params.set("_revinclude", "Task:focus");
  return params;
}

/** 基準日 1 日ぶんのリハビリ実施記録。オーダーの id ごとにまとめる。 */
async function fetchRehabPerformsOn(date: string): Promise<Map<string, RehabPerformDisplay[]>> {
  const params = new URLSearchParams();
  params.set("category", `${ORDER_TYPE_SYSTEM}|${REHAB_ORDER_TYPE.code}`);
  params.set("date", date);
  params.set("_count", "200");

  const { data: bundle } = await searchResource<fhir4.Procedure>("Procedure", params);
  const procedures = (bundle.entry ?? [])
    .map((e) => e.resource)
    .filter((r): r is fhir4.Procedure => r?.resourceType === "Procedure");
  return rehabPerformsByOrderId(procedures);
}

async function fetchRehabWorklist(date: string): Promise<RehabWorklistResult> {
  const orders: fhir4.ServiceRequest[] = [];

  const { patientsById, tasks, truncated } = await fetchWorklistBundles(
    (page) => rehabWorklistParams(date, page),
    (resource) => {
      if (resource.resourceType !== "ServiceRequest") return false;
      const request = resource as fhir4.ServiceRequest;
      if (!isRehabServiceRequest(request)) return false;
      orders.push(request);
      return true;
    },
  );

  // 実施記録はその日の分、予約は基準日以降の分だけが要るので別に引く。_revinclude だと
  // 継続中のオーダーの全期間ぶんが付いてくる。
  const [performsByOrderId, appointmentsByOrderId] = await Promise.all([
    fetchRehabPerformsOn(date),
    fetchRehabAppointmentsFrom(date),
  ]);

  const taskByOrderId = rehabTasksByOrderId(tasks);

  const rows = orders
    .map((order) => ({
      order,
      patient: patientsById.get(order.subject?.reference?.split("/").pop() ?? ""),
      task: taskByOrderId.get(order.id ?? ""),
      todayPerforms: performsByOrderId.get(order.id ?? "") ?? [],
      appointments: appointmentsByOrderId.get(order.id ?? "") ?? [],
    }));

  // 日単位の一覧では患者番号順が扱いやすい(病理・輸血と同じ)。
  rows.sort(comparePatientNumber);

  return { rows, truncated };
}

/** 基準日に効いているリハビリオーダー。日付が未選択の間は読みに行かない。 */
export function useRehabWorklist(date: string) {
  return useQuery({
    queryKey: ["ServiceRequest", "rehab-worklist", date],
    queryFn: () => fetchRehabWorklist(date),
    enabled: Boolean(date),
    placeholderData: keepPreviousData,
  });
}

// ---- リハビリの予約 ----
//
// リハ室の枠(Schedule の serviceType = rehab)に対して、部門が受付後に「次回予約」を
// 都度取る。オーダー登録の transaction には同梱しない(理由は appointmentHelpers の
// buildRehabAppointmentBundle を参照)。

/**
 * 基準日以降のリハビリ予約を、オーダーの id ごとにまとめる(それぞれ日時の近い順)。
 * オーダー一覧の「次回予約」列と「本日の予約」ビューを 1 回の問い合わせで賄う。
 */
async function fetchRehabAppointmentsFrom(
  from: string,
): Promise<Map<string, fhir4.Appointment[]>> {
  const params = new URLSearchParams();
  params.set("date", `ge${from}`);
  params.set("service-type", `${SCHEDULE_SERVICE_TYPE_SYSTEM}|rehab`);
  setActiveAppointmentStatus(params);
  params.set("_count", "200");
  params.set("_sort", "date");

  const { data: bundle } = await searchResource<fhir4.Appointment>("Appointment", params);
  const appointments = resourcesOfType<fhir4.Appointment>(bundle, "Appointment");

  const byOrderId = new Map<string, fhir4.Appointment[]>();
  for (const appointment of appointments) {
    const orderId = appointmentOrderId(appointment);
    if (!orderId) continue;
    const list = byOrderId.get(orderId);
    if (list) list.push(appointment);
    else byOrderId.set(orderId, [appointment]);
  }
  for (const list of byOrderId.values()) {
    list.sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));
  }
  return byOrderId;
}

/** リハビリの予約を取る。オーダーを basedOn に持つ Appointment + 枠の busy 化。 */
export function useBookRehabAppointment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      patient,
      selection,
      orderId,
    }: {
      patient: fhir4.Patient;
      selection: SlotSelection;
      orderId: string;
    }) => postBundle(buildRehabAppointmentBundle(patient, selection, orderId)),
    onSuccess: () => {
      invalidateAppointments(queryClient);
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "rehab-worklist"] });
    },
  });
}

// ---- リハビリの実施記録 ----
//
// 実施は Procedure を 1 件足すだけで進捗 Task を動かさない。他部門の実施と唯一
// 作りが違う点(rehabResultHelpers.ts の冒頭コメント / docs/rehab-order-design.md §4)。

function rehabPerformSearchParams(orderId: string): URLSearchParams {
  const params = new URLSearchParams();
  params.set("based-on", `ServiceRequest/${orderId}`);
  // 1 オーダーに実施が何十件も積み上がるので多めに取る。
  params.set("_count", "200");
  return params;
}

/**
 * そのオーダーの実施記録(全期間)。詳細パネルの実施履歴と FHIR JSON 表示で使う。
 * カルテのカードはオーダー検索の _revinclude で届くのでこれを使わない。
 */
export function useRehabPerformDetail(orderId: string | undefined) {
  return useQuery({
    queryKey: ["Procedure", "search", "rehab-perform", orderId],
    queryFn: () =>
      searchResource<fhir4.Resource>("Procedure", rehabPerformSearchParams(orderId ?? "")),
    enabled: Boolean(orderId),
  });
}

/** リハビリの進捗・実施記録・予約が動いたときに読み直させるもの。 */
function invalidateRehab(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "rehab-worklist"] });
  // カルテのオーダーカードも進捗と実施履歴を出しているので読み直させる。
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
  queryClient.invalidateQueries({ queryKey: ["Procedure", "search"] });
  // パスから受付前に実施すると Task も受付済になる。患者の Task の一覧(パスの実施入力が読む)も読み直させる。
  queryClient.invalidateQueries({ queryKey: ["Task", "search"] });
}

/**
 * 実施登録。Procedure を 1 件 POST するだけで Task は動かさない。
 * (他部門の useRegisterXxxPerform は Task を completed にする Bundle を受け取るが、
 * リハビリは期間中ずっと受付済のままなので、それに合わせてはいけない。)
 */
export function useRegisterRehabPerform() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => invalidateRehab(queryClient),
  });
}

/** 実施の取消。Procedure を消すだけ(進捗は実施で動いていないので戻す先が無い)。 */
export function useDeleteRehabPerform() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (procedureId: string) => deleteResource("Procedure", procedureId),
    onSuccess: () => invalidateRehab(queryClient),
  });
}

/**
 * 受付・終了・中止などの進捗を書き込む。Task がまだ無いオーダーでは新しく作る。
 *
 * 「終了」だけは ServiceRequest にも終了日を書く。Task を completed にするだけでは
 * status=active のまま残り、部門一覧の `occurrence=le{基準日}` に永久にヒットし
 * 続けるため(docs/rehab-order-design.md)。
 *
 * 逆に「終了を取消」では終了日を消さない。打ち切った期間まで巻き戻すと、その間に
 * 積んだ実施記録との整合が取れなくなるため。期間を延ばしたいときはオーダーを編集する。
 */
export function useUpdateRehabTaskStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      order,
      task,
      status,
      /** 終了日。status が completed のときだけ使う。 */
      endDate,
    }: {
      order: fhir4.ServiceRequest;
      task: fhir4.Task | undefined;
      status: RehabTaskStatus;
      endDate?: string;
    }) => {
      const entry: fhir4.BundleEntry[] = [taskBundleEntry(buildRehabTaskUpdate(task, order, status))];
      if (status === "completed" && endDate) {
        entry.push(buildRehabOrderCloseEntry(order, endDate));
      }
      return postBundle({ resourceType: "Bundle", type: "transaction", entry });
    },
    onSuccess: () => invalidateRehab(queryClient),
  });
}

// ---- 栄養指導オーダー ----
//
// リハビリと同じ期間継続型なので、明細を持たずヘッダ 1 本 + 進捗 Task + 実施記録
// (Procedure)で構成する。Task は「部門の受け入れ状態」を表し、日々の指導は Task を
// 動かさず Procedure が積み上がる(docs/nutrition-guidance-order-design.md §3)。
// 「基準日に効いている」はリハビリと同じく order-period で引く。

export function useNutritionGuidanceOrderDetail(srId: string | undefined) {
  const params = new URLSearchParams();
  if (srId) {
    params.set("_id", srId);
    // 進捗と実施履歴を詳細パネル・実施入力で使うので同時に取る。
    params.set("_revinclude", "Task:focus");
    params.append("_revinclude", "Procedure:based-on");
  }

  // Task と Procedure が混ざって返るので、要素の型は Resource で受ける。
  return useQuery({
    queryKey: ["ServiceRequest", "detail", "nutrition-guidance-order", srId],
    queryFn: () => searchResource<fhir4.Resource>("ServiceRequest", params),
    enabled: Boolean(srId),
  });
}

/**
 * その患者の有効な栄養指導オーダー。退院で打ち切る対象を選ぶのに使う。
 * どれを止めるかは退院日で決まるので、絞り込み(nutritionGuidanceOrderNeedsStop)は
 * 画面側で行う(usePatientRehabOrders と同じ作り)。
 */
export function usePatientNutritionGuidanceOrders(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("category", `${ORDER_TYPE_SYSTEM}|${NUTRITION_GUIDANCE_ORDER_TYPE.code}`);
  params.set("status", "active");
  params.set("_sort", "-authoredon");
  params.set("_count", "20");

  return useQuery({
    queryKey: ["ServiceRequest", "search", "nutrition-guidance-patient", patientId],
    queryFn: async () => {
      const { data: bundle } = await searchResource<fhir4.ServiceRequest>("ServiceRequest", params);
      return serviceRequestsOf(bundle).filter(isNutritionGuidanceServiceRequest);
    },
    enabled: Boolean(patientId),
  });
}

export function useUpdateNutritionGuidanceOrder() {
  const queryClient = useQueryClient();
  const withProvenance = useWithOrderProvenance();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(withProvenance(bundle)),
    onSuccess: () => {
      // 開始日が動くとカードの載る日も変わるので、まとめて読み直させる。
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
      invalidateProvenance(queryClient);
    },
  });
}

/**
 * オーダーを消す。明細は持たないが、栄養部門が取った予約は道連れで取り消し
 * (リハビリオーダーの削除と同じ後始末。予約だけが残って枠を塞ぐのを防ぐ)、
 * 指導目的をテンプレートから書いていれば記入内容も一緒に消す
 * (オーダーが消えると誰も参照しない孤児になるため)。
 *
 * useDeleteNutritionGuidanceOrder の本体(読み直しの指示を伴わない)。パスの取り消しがまとめて消すときにも使う。
 */
export const deleteNutritionGuidanceOrderRequest = async (srId: string) => {
  const [{ data: order }, appointmentEntries] = await Promise.all([
    readResource<fhir4.ServiceRequest>("ServiceRequest", srId),
    fetchOrderAppointmentCancelEntries(srId),
  ]);
  return postBundle({
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      ...appointmentEntries,
      ...nutritionGuidanceOrderResponseIds([order]).map((id) => ({
        request: { method: "DELETE" as const, url: `QuestionnaireResponse/${id}` },
      })),
      { request: { method: "DELETE", url: `ServiceRequest/${srId}` } },
    ],
  });
};

export function useDeleteNutritionGuidanceOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteNutritionGuidanceOrderRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
      // 指導目的のテンプレート記入内容も道連れで消えている。
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse", "search"] });
      invalidateAppointments(queryClient);
    },
  });
}

// ---- 栄養指導一覧(部門ワークリスト) ----
//
// 軸はリハビリ一覧と同じ。「基準日に効いている(始まっていて、まだ終わっていない)
// オーダー」を引き、終了日の判定はクライアントで行う。
//
// 指導形態・入外区分・病棟・診療科・進捗での絞り込みは画面側で行う
// (理由は検体検査一覧の節のコメントを参照)。

/** 栄養指導一覧の 1 行。オーダー(ヘッダ)1 件ぶん。 */
export interface NutritionGuidanceWorklistRow {
  order: fhir4.ServiceRequest;
  patient?: fhir4.Patient;
  /** 進捗(= 部門の受け入れ状態)。部門がまだ触っていないオーダーには無い(= 依頼済)。 */
  task?: fhir4.Task;
  /** 基準日の実施記録。期間中は何度も指導するので「その日に実施したか」で見る。 */
  todayPerforms: NutritionGuidancePerformDisplay[];
  /** 基準日以降の予約(近い順)。先頭が「次回予約」。 */
  appointments: fhir4.Appointment[];
}

export interface NutritionGuidanceWorklistResult {
  rows: NutritionGuidanceWorklistRow[];
  /** 上限まで読んでも読み切れなかった。 */
  truncated: boolean;
}

/**
 * 基準日に効いている栄養指導オーダーのヘッダ検索。worklistParams を使わないのは
 * 日付の当て方が違うため(他部門は実施予定日の一致、こちらは開始日 le + 終了判定)。
 */
function nutritionGuidanceWorklistParams(date: string, page: number): URLSearchParams {
  const params = new URLSearchParams();
  params.set("category", `${ORDER_TYPE_SYSTEM}|${NUTRITION_GUIDANCE_ORDER_TYPE.code}`);
  params.set("status", "active");
  setOrderPeriod(params, date, date);
  params.set("based-on:missing", "true");
  params.set("_count", String(WORKLIST_PAGE));
  params.set("_offset", String(page * WORKLIST_PAGE));
  params.set("_include", "ServiceRequest:subject");
  params.set("_revinclude", "Task:focus");
  return params;
}

/** 基準日 1 日ぶんの栄養指導の実施記録。オーダーの id ごとにまとめる。 */
async function fetchNutritionGuidancePerformsOn(
  date: string,
): Promise<Map<string, NutritionGuidancePerformDisplay[]>> {
  const params = new URLSearchParams();
  params.set("category", `${ORDER_TYPE_SYSTEM}|${NUTRITION_GUIDANCE_ORDER_TYPE.code}`);
  params.set("date", date);
  params.set("_count", "200");

  const { data: bundle } = await searchResource<fhir4.Procedure>("Procedure", params);
  const procedures = (bundle.entry ?? [])
    .map((e) => e.resource)
    .filter((r): r is fhir4.Procedure => r?.resourceType === "Procedure");
  return nutritionGuidancePerformsByOrderId(procedures);
}

/**
 * 基準日以降の栄養指導の予約を、オーダーの id ごとにまとめる(それぞれ日時の近い順)。
 * オーダー一覧の「次回予約」列と「本日の予約」ビューを 1 回の問い合わせで賄う。
 */
async function fetchNutritionGuidanceAppointmentsFrom(
  from: string,
): Promise<Map<string, fhir4.Appointment[]>> {
  const params = new URLSearchParams();
  params.set("date", `ge${from}`);
  params.set("service-type", `${SCHEDULE_SERVICE_TYPE_SYSTEM}|nutrition-guidance`);
  setActiveAppointmentStatus(params);
  params.set("_count", "200");
  params.set("_sort", "date");

  const { data: bundle } = await searchResource<fhir4.Appointment>("Appointment", params);
  const appointments = resourcesOfType<fhir4.Appointment>(bundle, "Appointment");

  const byOrderId = new Map<string, fhir4.Appointment[]>();
  for (const appointment of appointments) {
    const orderId = appointmentOrderId(appointment);
    if (!orderId) continue;
    const list = byOrderId.get(orderId);
    if (list) list.push(appointment);
    else byOrderId.set(orderId, [appointment]);
  }
  for (const list of byOrderId.values()) {
    list.sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));
  }
  return byOrderId;
}

async function fetchNutritionGuidanceWorklist(
  date: string,
): Promise<NutritionGuidanceWorklistResult> {
  const orders: fhir4.ServiceRequest[] = [];

  const { patientsById, tasks, truncated } = await fetchWorklistBundles(
    (page) => nutritionGuidanceWorklistParams(date, page),
    (resource) => {
      if (resource.resourceType !== "ServiceRequest") return false;
      const request = resource as fhir4.ServiceRequest;
      if (!isNutritionGuidanceServiceRequest(request)) return false;
      orders.push(request);
      return true;
    },
  );

  // 実施記録はその日の分、予約は基準日以降の分だけが要るので別に引く。_revinclude だと
  // 継続中のオーダーの全期間ぶんが付いてくる。
  const [performsByOrderId, appointmentsByOrderId] = await Promise.all([
    fetchNutritionGuidancePerformsOn(date),
    fetchNutritionGuidanceAppointmentsFrom(date),
  ]);

  const taskByOrderId = nutritionGuidanceTasksByOrderId(tasks);

  const rows = orders
    .map((order) => ({
      order,
      patient: patientsById.get(order.subject?.reference?.split("/").pop() ?? ""),
      task: taskByOrderId.get(order.id ?? ""),
      todayPerforms: performsByOrderId.get(order.id ?? "") ?? [],
      appointments: appointmentsByOrderId.get(order.id ?? "") ?? [],
    }));

  // 日単位の一覧では患者番号順が扱いやすい(リハビリ・病理と同じ)。
  rows.sort(comparePatientNumber);

  return { rows, truncated };
}

/** 基準日に効いている栄養指導オーダー。日付が未選択の間は読みに行かない。 */
export function useNutritionGuidanceWorklist(date: string) {
  return useQuery({
    queryKey: ["ServiceRequest", "nutrition-guidance-worklist", date],
    queryFn: () => fetchNutritionGuidanceWorklist(date),
    enabled: Boolean(date),
    placeholderData: keepPreviousData,
  });
}

/** 栄養指導の予約を取る。オーダーを basedOn に持つ Appointment + 枠の busy 化。 */
export function useBookNutritionGuidanceAppointment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      patient,
      selection,
      orderId,
    }: {
      patient: fhir4.Patient;
      selection: SlotSelection;
      orderId: string;
    }) => postBundle(buildNutritionGuidanceAppointmentBundle(patient, selection, orderId)),
    onSuccess: () => {
      invalidateAppointments(queryClient);
      queryClient.invalidateQueries({
        queryKey: ["ServiceRequest", "nutrition-guidance-worklist"],
      });
    },
  });
}

// ---- 栄養指導の実施記録 ----
//
// 実施は Procedure を 1 件足すだけで進捗 Task を動かさない(リハビリと同じ逸脱。
// nutritionGuidanceResultHelpers.ts の冒頭コメント)。

/**
 * そのオーダーの実施記録(全期間)。詳細パネルの実施履歴と FHIR JSON 表示で使う。
 * カルテのカードはオーダー検索の _revinclude で届くのでこれを使わない。
 */
export function useNutritionGuidancePerformDetail(orderId: string | undefined) {
  const params = new URLSearchParams();
  params.set("based-on", `ServiceRequest/${orderId ?? ""}`);
  // 1 オーダーに実施が何件も積み上がるので多めに取る。
  params.set("_count", "200");

  return useQuery({
    queryKey: ["Procedure", "search", "nutrition-guidance-perform", orderId],
    queryFn: () => searchResource<fhir4.Resource>("Procedure", params),
    enabled: Boolean(orderId),
  });
}

/** 栄養指導の進捗・実施記録・予約が動いたときに読み直させるもの。 */
function invalidateNutritionGuidance(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "nutrition-guidance-worklist"] });
  // カルテのオーダーカードも進捗と実施履歴を出しているので読み直させる。
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
  queryClient.invalidateQueries({ queryKey: ["Procedure", "search"] });
  // パスから受付前に実施すると Task も受付済になる。患者の Task の一覧(パスの実施入力が読む)も読み直させる。
  queryClient.invalidateQueries({ queryKey: ["Task", "search"] });
}

/**
 * 実施登録。Procedure(+ 指導記録テンプレートの回答)を POST するだけで Task は
 * 動かさない。(他部門の useRegisterXxxPerform は Task を completed にする Bundle を
 * 受け取るが、栄養指導は期間中ずっと受付済のままなので、それに合わせてはいけない。)
 */
export function useRegisterNutritionGuidancePerform() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      invalidateNutritionGuidance(queryClient);
      // 指導記録テンプレートの回答も一緒に書いているので読み直させる。
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse", "search"] });
    },
  });
}

/**
 * 実施の取消。Procedure と、紐付く指導記録テンプレートの回答をまとめて消す
 * (進捗は実施で動いていないので戻す先が無い)。
 */
export function useDeleteNutritionGuidancePerform() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (perform: { id: string; recordResponseId?: string }) =>
      postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: buildNutritionGuidancePerformDeleteEntries([perform]),
      }),
    onSuccess: () => {
      invalidateNutritionGuidance(queryClient);
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse", "search"] });
    },
  });
}

/**
 * 受付・終了・中止などの進捗を書き込む。Task がまだ無いオーダーでは新しく作る。
 *
 * 「終了」だけは ServiceRequest にも終了日を書く。Task を completed にするだけでは
 * status=active のまま残り、部門一覧の `occurrence=le{基準日}` に永久にヒットし
 * 続けるため(docs/nutrition-guidance-order-design.md §3)。
 *
 * 逆に「終了を取消」では終了日を消さない。打ち切った期間まで巻き戻すと、その間に
 * 積んだ実施記録との整合が取れなくなるため。期間を延ばしたいときはオーダーを編集する。
 */
export function useUpdateNutritionGuidanceTaskStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      order,
      task,
      status,
      /** 終了日。status が completed のときだけ使う。 */
      endDate,
    }: {
      order: fhir4.ServiceRequest;
      task: fhir4.Task | undefined;
      status: NutritionGuidanceTaskStatus;
      endDate?: string;
    }) => {
      const entry: fhir4.BundleEntry[] = [
        taskBundleEntry(buildNutritionGuidanceTaskUpdate(task, order, status)),
      ];
      if (status === "completed" && endDate) {
        entry.push(buildNutritionGuidanceOrderCloseEntry(order, endDate));
      }
      return postBundle({ resourceType: "Bundle", type: "transaction", entry });
    },
    onSuccess: () => invalidateNutritionGuidance(queryClient),
  });
}

// ---- 他科依頼(コンサルテーション) ----
//
// 明細を持たないヘッダ 1 本 + 進捗 Task で、作りはリハビリと同じ。違うのは
// **進捗の変更で ServiceRequest.status も一緒に動かす**ところ
// (docs/consult-order-design.md §4)。他科依頼は日付軸を持たない(希望日は任意)ので、
// 部門一覧が「未回答だけ」をサーバー側で絞る手段が status しか無い。
//
// 書き込みの入口は useUpdateConsultTaskStatus と useSaveConsultReply の 2 つだけ。
// Task と status が食い違わないよう、どちらも 1 つの transaction で両方を書く。

export function useConsultOrderDetail(srId: string | undefined) {
  const params = new URLSearchParams();
  if (srId) {
    params.set("_id", srId);
    // 進捗を詳細パネル・回答モーダルで使うので同時に取る。
    params.set("_revinclude", "Task:focus");
  }

  // Task が混ざって返るので、要素の型は Resource で受ける。
  return useQuery({
    queryKey: ["ServiceRequest", "detail", "consult-order", srId],
    queryFn: () => searchResource<fhir4.Resource>("ServiceRequest", params),
    enabled: Boolean(srId),
  });
}

export function useUpdateConsultOrder() {
  const queryClient = useQueryClient();
  const withProvenance = useWithOrderProvenance();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(withProvenance(bundle)),
    onSuccess: () => {
      // 希望日が動くとカードの載る日も変わるので、まとめて読み直させる。
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
      // 依頼目的のテンプレート記入内容も同じ transaction で作り直している。
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse", "search"] });
      invalidateProvenance(queryClient);
    },
  });
}

/**
 * 依頼を消す。明細を持たないのでヘッダ 1 件だけだが、**回答済の依頼は消させない**。
 *
 * 回答は依頼先科の医師が書いた診療記録で、依頼を消しても消えない(消してよいもの
 * でもない)。消すと出どころの分からない記録だけが残るので、先に部門一覧の
 * 「回答取消」で紐付きを外してもらう(docs/consult-order-design.md §7)。
 *
 * useDeleteConsultOrder の本体(読み直しの指示を伴わない)。パスの取り消しがまとめて消すときにも使う。
 */
export const deleteConsultOrderRequest = async (srId: string) => {
  const { data: order } = await readResource<fhir4.ServiceRequest>("ServiceRequest", srId);
  if (consultReply(order).replyId) {
    throw new Error(
      "回答済の他科依頼は削除できません。先に他科依頼一覧で回答を取り消してください。",
    );
  }
  return postBundle(buildConsultOrderDeleteBundle(order));
};

export function useDeleteConsultOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteConsultOrderRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
      // 依頼目的のテンプレート記入内容も道連れで消えている。
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse", "search"] });
      invalidateConsult(queryClient);
    },
  });
}

// ---- 他科依頼一覧(部門ワークリスト) ----
//
// 他部門の一覧は「その日に実施予定のオーダー」を日付で引くが、他科依頼は日付軸を
// 持たない。代わりに status で切る(docs/consult-order-design.md §4.1)。
//
//   未回答 … status=active(依頼済・対応中)。いま溜まっている仕事なので有限。
//   回答済 … status=completed の直近ぶん(-authoredon)。
//
// 依頼先科は ServiceRequest.performer(Organization)に持ち、上流の performer 検索で絞る。

/** 一覧のビュー。未回答は「捌く」画面、回答済は「振り返る」画面。 */
export type ConsultWorklistView = "open" | "answered";

/** 他科依頼一覧の 1 行。依頼 1 件ぶん。 */
export interface ConsultWorklistRow {
  order: fhir4.ServiceRequest;
  patient?: fhir4.Patient;
  /** 進捗。依頼先科がまだ触っていない依頼には無い(= 依頼済)。 */
  task?: fhir4.Task;
}

export interface ConsultWorklistResult {
  rows: ConsultWorklistRow[];
  /** 上限まで読んでも読み切れなかった。 */
  truncated: boolean;
}

function consultWorklistParams(
  view: ConsultWorklistView,
  targetDepartmentId: string | undefined,
  page: number,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set("category", `${ORDER_TYPE_SYSTEM}|${CONSULT_ORDER_TYPE.code}`);
  // 未回答は取消(revoked)も拾う。依頼済・対応中・取消は「まだ閉じていない仕事」
  // として同じ画面で見るため(取消は行の進捗で分かる)。
  if (view === "open") params.set("status", "active,revoked");
  else params.set("status", "completed");
  if (targetDepartmentId) params.set("performer", `Organization/${targetDepartmentId}`);
  params.set("based-on:missing", "true");
  params.set("_count", String(WORKLIST_PAGE));
  params.set("_offset", String(page * WORKLIST_PAGE));
  params.set("_sort", "-authoredon");
  params.set("_include", "ServiceRequest:subject");
  params.set("_revinclude", "Task:focus");
  return params;
}

async function fetchConsultWorklist(
  view: ConsultWorklistView,
  targetDepartmentId: string | undefined,
): Promise<ConsultWorklistResult> {
  const orders: fhir4.ServiceRequest[] = [];

  const { patientsById, tasks, truncated } = await fetchWorklistBundles(
    (page) => consultWorklistParams(view, targetDepartmentId, page),
    (resource) => {
      if (resource.resourceType !== "ServiceRequest") return false;
      const request = resource as fhir4.ServiceRequest;
      if (!isConsultServiceRequest(request)) return false;
      orders.push(request);
      return true;
    },
  );

  const taskByOrderId = consultTasksByOrderId(tasks);

  const rows = orders.map((order) => ({
    order,
    patient: patientsById.get(order.subject?.reference?.split("/").pop() ?? ""),
    task: taskByOrderId.get(order.id ?? ""),
  }));

  return { rows, truncated };
}

/** 他科依頼一覧。targetDepartmentId を渡すとその科あての依頼だけを上流で絞る。 */
export function useConsultWorklist(view: ConsultWorklistView, targetDepartmentId?: string) {
  return useQuery({
    queryKey: ["ServiceRequest", "consult-worklist", view, targetDepartmentId ?? ""],
    queryFn: () => fetchConsultWorklist(view, targetDepartmentId || undefined),
    placeholderData: keepPreviousData,
  });
}

function invalidateConsult(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "consult-worklist"] });
  // カルテのオーダーカードも進捗と回答を出しているので読み直させる。
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
}

/**
 * 進捗の変更。Task と ServiceRequest.status を 1 つの transaction で両方書く
 * (docs/consult-order-design.md §4)。**片方だけを書く入口を増やさないこと** —
 * status だけが取り残されると、回答済の依頼が部門一覧の未回答に出続ける。
 *
 * 「回答取消」(completed → accepted)では回答への参照も外れる
 * (buildConsultOrderStatusEntry)。回答の診療記録そのものは消さない。
 */
export function useUpdateConsultTaskStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      order,
      task,
      status,
    }: {
      order: fhir4.ServiceRequest;
      task: fhir4.Task | undefined;
      status: ConsultTaskStatus;
    }) =>
      postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: [
          taskBundleEntry(buildConsultTaskUpdate(task, order, status)),
          buildConsultOrderStatusEntry(order, consultOrderStatusFor(status)),
        ],
      }),
    onSuccess: () => invalidateConsult(queryClient),
  });
}

/**
 * 回答の保存。診療記録(Composition)を書き、同じ transaction で進捗を回答済にし、
 * 依頼側に回答への参照と status=completed を書く。
 *
 * Composition は採番前なので fullUrl(urn:uuid)で POST し、依頼側からはその
 * urn:uuid を参照する。実 ID への書き換えは上流の transaction 処理が行う
 * (診療記録がテンプレート回答の QuestionnaireResponse を参照するのと同じやり方)。
 *
 * 画像・テンプレート回答のエントリ(entries)は Composition より前に積む
 * — 診療記録の単独保存(saveClinicalNote)と同じ理由で、本体を保存しなかったときに
 * 回答だけが孤児として残らないようにするため。
 */
export function useSaveConsultReply() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      order,
      task,
      composition,
      entries,
      replierName,
    }: {
      order: fhir4.ServiceRequest;
      task: fhir4.Task | undefined;
      composition: fhir4.Composition;
      entries: fhir4.BundleEntry[];
      replierName: string;
    }) => {
      const replyReference = `urn:uuid:${crypto.randomUUID()}`;
      // 記載を編集し直したときに前回の生成 Observation を消すのは単独保存と同じ。
      const stale = await staleObservationEntries(entries);
      return postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: [
          ...stale,
          ...entries,
          {
            fullUrl: replyReference,
            resource: composition,
            request: { method: "POST", url: "Composition" },
          },
          taskBundleEntry(buildConsultTaskUpdate(task, order, "completed")),
          buildConsultOrderReplyEntry(order, replyReference, replierName),
        ],
      });
    },
    onSuccess: () => {
      invalidateConsult(queryClient);
      // 回答は通常の診療記録としてもカルテのタイムラインに出る。
      queryClient.invalidateQueries({ queryKey: ["Composition", "search"] });
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse", "search"] });
      queryClient.invalidateQueries({ queryKey: ["Observation", "search"] });
    },
  });
}

// ---- 看護指示(指示簿) ----
//
// 1 指示行 = 1 ServiceRequest で、指示受けの Task を _revinclude で一緒に引く。
// 「指定日に効いている」は order-period で引く(食事・リハビリと同じ)。

export interface NursingOrderSet {
  orders: fhir4.ServiceRequest[];
  tasks: fhir4.Task[];
}

function nursingOrderSetOf(bundle: fhir4.Bundle | undefined): NursingOrderSet {
  const resources = (bundle?.entry ?? []).map((e) => e.resource).filter(Boolean) as fhir4.Resource[];
  return {
    orders: resources
      .filter((r): r is fhir4.ServiceRequest => r.resourceType === "ServiceRequest")
      .filter(isNursingServiceRequest),
    tasks: resources.filter((r): r is fhir4.Task => r.resourceType === "Task").filter(isNursingTask),
  };
}

function nursingOrderParams(patientId: string | undefined, status?: string): URLSearchParams {
  const params = new URLSearchParams();
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("category", `${ORDER_TYPE_SYSTEM}|${NURSING_ORDER_TYPE.code}`);
  if (status) params.set("status", status);
  params.set("_revinclude", "Task:focus");
  params.set("_sort", "-authoredon");
  params.set("_count", "200");
  return params;
}

/** 指定日に効いている看護指示(指示簿の「現在有効」)。 */
export function useActiveNursingOrders(patientId: string | undefined, at: string) {
  const params = nursingOrderParams(patientId, "active");
  setOrderPeriod(params, at, at);
  return useQuery({
    queryKey: ["ServiceRequest", "search", "nursing-active", patientId, at],
    queryFn: async () => {
      const { data: bundle } = await searchResource<fhir4.Resource>("ServiceRequest", params);
      return nursingOrderSetOf(bundle);
    },
    enabled: Boolean(patientId) && Boolean(at),
  });
}

/** その患者の看護指示すべて(中止・終了を含む)。履歴ビューと退院時の打ち切りに使う。 */
export function usePatientNursingOrders(patientId: string | undefined) {
  const params = nursingOrderParams(patientId);
  return useQuery({
    queryKey: ["ServiceRequest", "search", "nursing-patient", patientId],
    queryFn: async () => {
      const { data: bundle } = await searchResource<fhir4.Resource>("ServiceRequest", params);
      return nursingOrderSetOf(bundle);
    },
    enabled: Boolean(patientId),
  });
}

export function useNursingOrderDetail(srId: string | undefined) {
  const params = new URLSearchParams();
  if (srId) {
    params.set("_id", srId);
    params.set("_revinclude", "Task:focus");
  }
  return useQuery({
    queryKey: ["ServiceRequest", "detail", "nursing-order", srId],
    queryFn: async () => {
      const { data: bundle } = await searchResource<fhir4.Resource>("ServiceRequest", params);
      const set = nursingOrderSetOf(bundle);
      return { order: set.orders[0], task: set.tasks[0] };
    },
    enabled: Boolean(srId),
  });
}

function invalidateNursing(queryClient: ReturnType<typeof useQueryClient>) {
  // 病棟の指示簿一覧(と入院患者一覧の未指示受けバッジ)も同じ Task を見ているので
  // 一緒に読み直させる。これが無いと指示受けしても一覧の状態が変わらない。
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "nursing-worklist"] });
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
}

export function useUpdateNursingOrder() {
  const queryClient = useQueryClient();
  const withProvenance = useWithOrderProvenance();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(withProvenance(bundle)),
    onSuccess: () => {
      invalidateNursing(queryClient);
      invalidateProvenance(queryClient);
    },
  });
}

/** 中止。指示を revoked にし、指示受け Task も cancelled にする。 */
export function useRevokeNursingOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ order, task }: { order: fhir4.ServiceRequest; task: fhir4.Task | undefined }) =>
      postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: [
          buildNursingOrderRevokeEntry(order),
          nursingTaskEntry(buildNursingTaskUpdate(task, order, "cancelled")),
        ],
      }),
    onSuccess: () => invalidateNursing(queryClient),
  });
}

/** 指示受け。選んだ行の Task をまとめて accepted にし、受けた人を owner に入れる。 */
export function useAcceptNursingOrders() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      rows,
      owner,
    }: {
      rows: { order: fhir4.ServiceRequest; task: fhir4.Task | undefined }[];
      owner: { practitionerId: string; display: string };
    }) =>
      postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: rows.map(({ order, task }) =>
          nursingTaskEntry(withTaskOwner(buildNursingTaskUpdate(task, order, "accepted"), owner)),
        ),
      }),
    onSuccess: () => invalidateNursing(queryClient),
  });
}

// ---- 病棟の指示簿(看護指示のワークリスト) ----
//
// 他の部門一覧と違い、依頼を受けるのが部門ではなく **病棟**。そのため絞り込みの主軸が
// 病棟で、しかも上流の ward 検索(オーダーに焼き付けた order-ward 拡張)で **サーバー側で**
// 絞る。看護指示は退院まで status=active のまま残り続ける(締め処理を持たない、
// docs/nursing-order-design.md §7)ので、全病院ぶんを引いてから捨てる作りにすると
// 際限なく重くなるため。他の絞り込み(診療科・指示受け状態)は他のワークリストと同じく
// 手元のデータに対して画面側で行う。
//
// 軸はリハビリ一覧と同じで、基準日に **効いている**(始まっていて、まだ終わっていない)
// 指示を order-period で引いて並べる。

/** 病棟の指示簿の 1 行。指示 1 件ぶん。 */
export interface NursingWorklistRow {
  order: fhir4.ServiceRequest;
  patient?: fhir4.Patient;
  /** 指示受け。まだ誰も受けていなければ undefined(= 指示受け待ち)。 */
  task?: fhir4.Task;
}

export interface NursingWorklistResult {
  /** 患者番号順。 */
  rows: NursingWorklistRow[];
  /** 患者 id -> 未指示受けの件数。入院患者一覧のバッジと画面の見出しで使う。 */
  pendingByPatientId: Map<string, number>;
  truncated: boolean;
}

function nursingWorklistParams(
  date: string,
  wardId: string | undefined,
  page: number,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set("category", `${ORDER_TYPE_SYSTEM}|${NURSING_ORDER_TYPE.code}`);
  params.set("status", "active");
  setOrderPeriod(params, date, date);
  // 病棟はオーダー登録時に焼き付けた order-ward 拡張。上流の ward 検索で絞る。
  if (wardId) params.set("ward", `Location/${wardId}`);
  // 看護指示は 1 指示 = 1 ServiceRequest で basedOn を書かないので、他の部門一覧に
  // ある `based-on:missing=true`(明細を弾く)は要らない。
  params.set("_count", String(WORKLIST_PAGE));
  params.set("_offset", String(page * WORKLIST_PAGE));
  params.set("_include", "ServiceRequest:subject");
  params.set("_revinclude", "Task:focus");
  return params;
}

/** 未指示受けか(有効な指示で、まだ誰も受けていない)。 */
function isNursingPending(row: NursingWorklistRow): boolean {
  return row.order.status === "active" && nursingTaskStatus(row.task) === "requested";
}

async function fetchNursingWorklist(
  date: string,
  wardId: string | undefined,
): Promise<NursingWorklistResult> {
  const orders: fhir4.ServiceRequest[] = [];

  const { patientsById, tasks, truncated } = await fetchWorklistBundles(
    (page) => nursingWorklistParams(date, wardId, page),
    (resource) => {
      if (resource.resourceType !== "ServiceRequest") return false;
      const request = resource as fhir4.ServiceRequest;
      if (!isNursingServiceRequest(request)) return false;
      orders.push(request);
      return true;
    },
  );

  const taskByOrderId = nursingTasksByOrderId(tasks);

  const rows = orders
    .map((order) => ({
      order,
      patient: patientsById.get(order.subject?.reference?.split("/").pop() ?? ""),
      task: taskByOrderId.get(order.id ?? ""),
    }));

  rows.sort(comparePatientNumber);

  // 「未指示受け」の数え方をここに閉じ込める(画面とバッジで食い違わせない)。
  const pendingByPatientId = new Map<string, number>();
  for (const row of rows) {
    if (!isNursingPending(row)) continue;
    const patientId = row.order.subject?.reference?.split("/").pop();
    if (!patientId) continue;
    pendingByPatientId.set(patientId, (pendingByPatientId.get(patientId) ?? 0) + 1);
  }

  return { rows, pendingByPatientId, truncated };
}

/**
 * 基準日に効いている看護指示(病棟ぶん)。病棟を選んでいないうちは読みに行かない
 * (病棟なしで引くと全病院ぶんになるため)。
 */
export function useNursingWorklist(date: string, wardId: string | undefined) {
  return useQuery({
    queryKey: ["ServiceRequest", "nursing-worklist", date, wardId ?? ""],
    queryFn: () => fetchNursingWorklist(date, wardId),
    enabled: Boolean(date) && Boolean(wardId),
    placeholderData: keepPreviousData,
  });
}

/**
 * 患者ごとの未指示受け件数(入院患者一覧のバッジ用)。中で useNursingWorklist を
 * 呼ぶだけなので、指示簿一覧と同じキャッシュに乗る(行き来してもリクエストは 1 回)。
 */
export function useNursingPendingCounts(date: string, wardId: string | undefined) {
  const query = useNursingWorklist(date, wardId);
  return {
    countByPatientId: query.data?.pendingByPatientId ?? new Map<string, number>(),
    error: query.error,
  };
}

// ---- 看護指示の実施記録 ----
//
// 観察は Observation、行為は Procedure(fhir/nursingPerformHelpers.ts)。どちらも
// category が order-type の nursing で、指示(ServiceRequest)を basedOn で指す。
// 患者・日付・指示のいずれかで引き、basedOn で指示に振り分ける。指示受けの Task は実施では動かない。

function nursingPerformParams(): URLSearchParams {
  const params = new URLSearchParams();
  params.set("category", `${ORDER_TYPE_SYSTEM}|${NURSING_ORDER_TYPE.code}`);
  params.set("_sort", "-date");
  params.set("_count", "200");
  return params;
}

function resourcesOfType<T extends fhir4.Resource>(bundle: fhir4.Bundle, type: T["resourceType"]): T[] {
  return (bundle.entry ?? [])
    .map((e) => e.resource)
    .filter((r): r is T => r?.resourceType === type);
}

async function fetchNursingPerforms(
  setParams: (params: URLSearchParams) => void,
): Promise<Map<string, NursingPerformDisplay[]>> {
  const observationParams = nursingPerformParams();
  const procedureParams = nursingPerformParams();
  setParams(observationParams);
  setParams(procedureParams);
  const [observations, procedures] = await Promise.all([
    searchResource<fhir4.Observation>("Observation", observationParams),
    searchResource<fhir4.Procedure>("Procedure", procedureParams),
  ]);
  return nursingPerformsByOrderId(
    resourcesOfType<fhir4.Observation>(observations.data, "Observation"),
    resourcesOfType<fhir4.Procedure>(procedures.data, "Procedure"),
  );
}

/** その患者の実施記録(指示の id ごと、新しい順)。パスの画面が指示ごとの実施を見るのに使う。 */
export function useNursingPerformsOf(patientId: string | undefined) {
  return useQuery({
    // Procedure も含むが、無効化は Observation / Procedure の両方に投げるので片方のキーで足りる。
    queryKey: ["Observation", "search", "nursing-perform", patientId],
    queryFn: () =>
      fetchNursingPerforms((params) => params.set("patient", `Patient/${patientId}`)),
    enabled: Boolean(patientId),
  });
}

// 1 回の検索に載せる患者数。1 人 1 日の実施が 20 件を超えても _count(500)に収まる幅にする。
const NURSING_PERFORM_PATIENT_CHUNK = 20;

/**
 * 基準日 1 日ぶんの実施記録を、指示の id ごとにまとめる(病棟の指示簿の「本日」列)。
 * 画面の患者だけを、URL が長くなりすぎないよう分割して並列に引く。
 * 入院患者一覧のバッジ(useNursingPendingCounts)はこれを引かない(別クエリにしてある)。
 */
export function useNursingPerformsOn(date: string, patientIds: string[]) {
  const ids = [...new Set(patientIds)].sort();
  return useQuery({
    queryKey: ["Observation", "search", "nursing-perform-day", date, ids.join(",")],
    queryFn: async () => {
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += NURSING_PERFORM_PATIENT_CHUNK) {
        chunks.push(ids.slice(i, i + NURSING_PERFORM_PATIENT_CHUNK));
      }
      const maps = await Promise.all(
        chunks.map((chunk) =>
          fetchNursingPerforms((params) => {
            params.set("date", date);
            params.set("patient", chunk.map((id) => `Patient/${id}`).join(","));
            params.set("_count", "500");
          }),
        ),
      );
      const byOrderId = new Map<string, NursingPerformDisplay[]>();
      for (const map of maps) {
        for (const [orderId, performs] of map) {
          byOrderId.set(orderId, [...(byOrderId.get(orderId) ?? []), ...performs]);
        }
      }
      return byOrderId;
    },
    enabled: Boolean(date) && ids.length > 0,
    placeholderData: keepPreviousData,
  });
}

/** 1 つの指示の実施記録(新しい順)。指示の詳細の実施履歴に使う。 */
export function useNursingPerformsOfOrder(orderId: string | undefined) {
  return useQuery({
    queryKey: ["Observation", "search", "nursing-perform-order", orderId],
    queryFn: async () => {
      const byOrderId = await fetchNursingPerforms((params) =>
        params.set("based-on", `ServiceRequest/${orderId}`),
      );
      return byOrderId.get(orderId ?? "") ?? [];
    },
    enabled: Boolean(orderId),
  });
}

function invalidateNursingPerforms(queryClient: QueryClient) {
  // 経過表のバイタル・実施履歴・本日列はどれも Observation の検索に乗っている。
  queryClient.invalidateQueries({ queryKey: ["Observation", "search"] });
  queryClient.invalidateQueries({ queryKey: ["Procedure", "search"] });
  // 経過表の看護欄は指示と実施をまとめて 1 つのクエリにしてあり、キーが
  // ServiceRequest 側なので上の 2 つでは無効化されない。
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search", "flowsheet-nursing"] });
}

/** 実施登録。Observation / Procedure を POST するだけで Task は動かさない。 */
export function useRegisterNursingPerform() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => invalidateNursingPerforms(queryClient),
  });
}

/** 実施の取消。1 件消すだけ(進捗は実施で動いていないので戻す先が無い)。 */
export function useDeleteNursingPerform() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ resourceType, id }: { resourceType: "Observation" | "Procedure"; id: string }) =>
      deleteResource(resourceType, id),
    onSuccess: () => invalidateNursingPerforms(queryClient),
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
  const withProvenance = useWithOrderProvenance();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(withProvenance(bundle)),
    onSuccess: () => {
      // 予定日時が動くと手術一覧の当日ぶんも変わるので、ServiceRequest は
      // まとめて読み直させる。
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
      invalidateProvenance(queryClient);
    },
  });
}

/**
 * 手術オーダーも明細が独立した ServiceRequest なので、ヘッダだけ消すと明細が
 * 残ってしまう。消す直前に明細を引き直してからまとめて消す(処置と同じ)。
 * 術前指示をテンプレートから書いていれば、その回答も一緒に消す(孤児を残さない)。
 *
 * useDeleteSurgeryOrder の本体(読み直しの指示を伴わない)。パスの取り消しがまとめて消すときにも使う。
 */
export const deleteSurgeryOrderRequest = async (srId: string) => {
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
};

export function useDeleteSurgeryOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteSurgeryOrderRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
    },
  });
}


// ---- 麻酔チャート(docs/anesthesia-chart-design.md) ----

const PART_OF_PAGE = 500;
// ページ数の上限は暴走ガード(超えたら以降を捨てる。4 ページ = 2000 件)。
const PART_OF_MAX_PAGES = 4;

/**
 * part-of の子を全件読む。5 分毎の打点 × 数時間で 1 ページに収まらないことがあるので、
 * 1 ページ目の total から残りのページ数を決め、2 ページ目以降は並列に読む。
 */
async function fetchAllByPartOf<T extends fhir4.Resource>(
  resourceType: string,
  hubId: string,
): Promise<T[]> {
  const fetchPage = async (page: number) => {
    const params = new URLSearchParams();
    params.set("part-of", `Procedure/${hubId}`);
    params.set("_count", String(PART_OF_PAGE));
    params.set("_offset", String(page * PART_OF_PAGE));
    const { data: bundle } = await searchResource<T>(resourceType, params);
    return {
      total: bundle.total,
      resources: (bundle.entry ?? [])
        .filter((entry) => entry.search?.mode !== "include")
        .map((entry) => entry.resource)
        .filter((resource): resource is T => resource?.resourceType === resourceType),
    };
  };

  const first = await fetchPage(0);
  const total = first.total ?? first.resources.length;
  const pages = Math.min(Math.ceil(total / PART_OF_PAGE), PART_OF_MAX_PAGES);
  if (pages <= 1) return first.resources;

  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, (_, i) => fetchPage(i + 1).then((r) => r.resources)),
  );
  return [...first.resources, ...rest.flat()];
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

/**
 * 検体明細が独立した ServiceRequest なので、消す直前に明細を引き直してから
 * まとめて消す(検体検査・細菌検査と同じ)。
 *
 * useDeletePathoOrder の本体(読み直しの指示を伴わない)。パスの取り消しがまとめて消すときにも使う。
 */
export const deletePathoOrderRequest = async (srId: string) => {
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
};

export function useDeletePathoOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deletePathoOrderRequest,
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
  return fetchOrderCandidates(patientId, PATHO_ORDER_TYPE.code, pathoOrderLabel);
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
    mutationFn: async (bundle: fhir4.Bundle) =>
      postBundle(await withResultReviewTask(bundle, "patho", pathoReviewSummary)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "patho-worklist"] });
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_TASK_KEY });
    },
  });
}

export function useUpdatePathoResult() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (bundle: fhir4.Bundle) =>
      postBundle(await withResultReviewTask(bundle, "patho", pathoReviewSummary)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "search"] });
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "detail"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "patho-worklist"] });
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_TASK_KEY });
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
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_TASK_KEY });
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

/**
 * 製剤明細が独立した ServiceRequest なので、消す直前に明細を引き直してから
 * まとめて消す(病理・検体検査と同じ)。
 *
 * useDeleteTransfusionOrder の本体(読み直しの指示を伴わない)。パスの取り消しがまとめて消すときにも使う。
 */
export const deleteTransfusionOrderRequest = async (srId: string) => {
  const params = new URLSearchParams();
  params.set("_id", srId);
  params.set("_revinclude:iterate", "ServiceRequest:based-on");
  const { data: bundle } = await searchResource<fhir4.ServiceRequest>("ServiceRequest", params);
  const requests = serviceRequestsOf(bundle);
  const itemIds = transfusionOrderItemRequests(requests, srId)
    .map((request) => request.id)
    .filter((id): id is string => Boolean(id));
  return postBundle(buildTransfusionOrderDeleteBundle(srId, itemIds));
};

export function useDeleteTransfusionOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteTransfusionOrderRequest,
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

// ---- 輸血の実施記録 ----

function transfusionPerformSearchParams(orderId: string): URLSearchParams {
  const params = new URLSearchParams();
  params.set("based-on", `ServiceRequest/${orderId}`);
  params.append("_revinclude", "MedicationAdministration:part-of");
  params.append("_revinclude", "Observation:part-of");
  return params;
}

async function fetchTransfusionPerformResources(orderId: string) {
  const { data: bundle } = await searchResource<fhir4.Resource>(
    "Procedure",
    transfusionPerformSearchParams(orderId),
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
 * 輸血の実施記録(Procedure 一式)。オーダーとは別リソースでオーダーの検索から
 * 辿れないので別に引く。カルテカードの FHIR JSON 表示で使う。
 */
export function useTransfusionPerformDetail(orderId: string | undefined) {
  return useQuery({
    queryKey: ["Procedure", "search", "transfusion-perform", orderId],
    queryFn: () =>
      searchResource<fhir4.Resource>("Procedure", transfusionPerformSearchParams(orderId ?? "")),
    enabled: Boolean(orderId),
  });
}

/**
 * 受付・出庫・中止などの進捗を書き込む。Task がまだ無いオーダーでは新しく作る。
 * 実施済から戻す(実施取消)ときは、実施記録も同じ transaction で消す
 * (手術と同じ扱い。理由は transfusionResultHelpers の
 * buildTransfusionPerformDeleteEntries を参照)。
 */
export function useUpdateTransfusionTaskStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      order,
      task,
      status,
    }: {
      order: fhir4.ServiceRequest;
      task: fhir4.Task | undefined;
      status: TransfusionTaskStatus;
    }) => {
      const next = buildTransfusionTaskUpdate(task, order, status);
      const taskEntry: fhir4.BundleEntry = {
        resource: next,
        request: task?.id
          ? { method: "PUT", url: `Task/${task.id}` }
          : { method: "POST", url: "Task" },
      };

      const cancelsPerform = transfusionTaskStatus(task) === "completed" && status !== "completed";
      const performed = cancelsPerform
        ? await fetchTransfusionPerformResources(order.id ?? "")
        : { procedures: [], administrations: [], observations: [] };
      const performEntries = buildTransfusionPerformDeleteEntries(
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
    onSuccess: () => invalidateTransfusion(queryClient),
  });
}

/**
 * 輸血の実施登録。実施記録一式と Task の実施済を 1 つの transaction で書き込む。
 * Bundle の組み立ては transfusionResultHelpers を参照。
 */
export function useRegisterTransfusionPerform() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => invalidateTransfusion(queryClient),
  });
}

/** 輸血の進捗・実施記録が動いたときに読み直させるもの。 */
function invalidateTransfusion(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "transfusion-worklist"] });
  // カルテのオーダーカードも進捗と実施情報を出しているので読み直させる。
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
  // 取消では実施記録も消しているので、FHIR JSON 表示の実施記録も引き直させる。
  queryClient.invalidateQueries({ queryKey: ["Procedure", "search"] });
}

// ---- 化学療法レジメンオーダー(docs/chemo-regimen-design.md §7) ----

/**
 * 患者に適用されたレジメン(ヘッダ)。中止・完了も含めて全件返す(タブで切り替える)。
 * 1 患者のレジメン適用は多くても十数件なので 1 ページで足りる。
 */
export function useRegimenApplications(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("category", `${ORDER_TYPE_SYSTEM}|${REGIMEN_ORDER_TYPE.code}`);
  params.set("_sort", "-occurrence");
  params.set("_count", "100");

  return useQuery({
    queryKey: ["ServiceRequest", "search", "regimen-applications", patientId],
    queryFn: async () => {
      const { data: bundle } = await searchResource<fhir4.ServiceRequest>("ServiceRequest", params);
      const headers = serviceRequestsOf(bundle).filter(isRegimenServiceRequest);
      return {
        headers,
        applications: headers
          .map(parseRegimenApplication)
          .filter((a): a is RegimenApplication => a !== null),
      };
    },
    enabled: Boolean(patientId),
  });
}

/**
 * 外来化学療法室の予約(§7.6 D-3)。投与日の注射オーダーを `basedOn` にして日ごとに取る。
 * 予約タブと投与日パネルの両方から読み直させる。
 */
export function useBookChemoAppointment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      patient,
      selection,
      orderId,
    }: {
      patient: fhir4.Patient;
      selection: SlotSelection;
      orderId: string;
    }) => postBundle(buildChemoAppointmentBundle(patient, selection, orderId)),
    onSuccess: () => invalidateAppointments(queryClient),
  });
}

/** オーダー id → 有効な予約(1 件)。`basedOn` で引く。 */
async function fetchOrderAppointments(ids: string[]): Promise<Map<string, fhir4.Appointment>> {
  const result = new Map<string, fhir4.Appointment>();
  if (ids.length === 0) return result;
  const params = new URLSearchParams();
  params.set("based-on", ids.map((id) => `ServiceRequest/${id}`).join(","));
  setActiveAppointmentStatus(params);
  params.set("_count", String(ids.length * 2));
  const { data: bundle } = await searchResource<fhir4.Appointment>("Appointment", params);
  for (const appointment of resourcesOfType<fhir4.Appointment>(bundle, "Appointment")) {
    const orderId = appointmentOrderId(appointment);
    if (orderId) result.set(orderId, appointment);
  }
  return result;
}

/** 投与日の注射オーダーに紐づく予約(1 件)。投与日パネルで「予約済み」を出すのに使う。 */
export function useOrderAppointments(orderIds: string[]) {
  const ids = Array.from(new Set(orderIds.filter(Boolean))).sort();
  return useQuery({
    queryKey: ["Appointment", "search", "by-order", ids],
    queryFn: () => fetchOrderAppointments(ids),
    enabled: ids.length > 0,
  });
}

/**
 * オーダーに紐づく予約を取り消す entry(押さえていた枠は空きに戻す)。オーダーを消す・止める
 * ときに予約だけが残ると、枠が埋まったままになり患者も呼ばれてしまう。
 */
async function orderAppointmentCancelEntries(orderIds: string[]): Promise<fhir4.BundleEntry[]> {
  const appointments = await fetchOrderAppointments(Array.from(new Set(orderIds.filter(Boolean))));
  return buildCancelEntriesOf(Array.from(appointments.values()));
}

/**
 * 日オーダーに紐づく化学療法室の予約を取り消す entry。投与日の移動・中止、レジメンの
 * 中止・完了・クール取消に同梱する(§8.13 N-5)。予約が無ければ空。
 */
function chemoAppointmentCancelEntries(orders: RegimenDayOrder[]): Promise<fhir4.BundleEntry[]> {
  return orderAppointmentCancelEntries(orders.map((o) => o.serviceRequest.id ?? ""));
}

/**
 * レジメンの適用ヘッダを id で引く(薬剤部の監査。§7.6 E-1)。日オーダーの `regimen-order`
 * 拡張から得た id をまとめて 1 回で読む。患者単位の `useRegimenApplications` と違い、
 * 別々の患者のオーダーが並ぶワークリストから使える。
 */
export function useRegimenHeaders(regimenSrIds: string[]) {
  const ids = Array.from(new Set(regimenSrIds.filter(Boolean))).sort();
  return useQuery({
    queryKey: ["ServiceRequest", "detail", "regimen-headers", ids],
    queryFn: async (): Promise<Map<string, RegimenApplication>> => {
      const params = new URLSearchParams();
      params.set("_id", ids.join(","));
      params.set("_count", String(ids.length));
      const { data: bundle } = await searchResource<fhir4.ServiceRequest>("ServiceRequest", params);
      const result = new Map<string, RegimenApplication>();
      for (const sr of serviceRequestsOf(bundle)) {
        const application = parseRegimenApplication(sr);
        if (application) result.set(application.id, application);
      }
      return result;
    },
    enabled: ids.length > 0,
    staleTime: 60 * 1000,
  });
}

/**
 * レジメンから出た日オーダー(注射・処方)を、適用(instanceId = 日オーダーの requisition)
 * ごとにまとめて引く。requisition はカンマで OR にできるので患者の全適用を 1 検索で読める。
 * 進捗の Task と薬剤も同じレスポンスで受ける。1 患者の日オーダーは多くても数百件なので
 * 1 ページで足りる。
 */
export function useRegimenDayOrders(patientId: string | undefined, instanceIds: string[]) {
  const ids = [...new Set(instanceIds.filter(Boolean))].sort();
  return useQuery({
    queryKey: ["ServiceRequest", "search", "regimen-orders", patientId, ids.join(",")],
    queryFn: async (): Promise<RegimenDayOrder[]> => {
      const requests: fhir4.ServiceRequest[] = [];
      const medicationRequests: fhir4.MedicationRequest[] = [];
      const tasks: fhir4.Task[] = [];
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      params.set("requisition", ids.map((id) => `${REGIMEN_INSTANCE_SYSTEM}|${id}`).join(","));
      params.set("based-on:missing", "true");
      params.set("_sort", "occurrence");
      params.set("_count", "500");
      params.append("_revinclude", "MedicationRequest:based-on");
      params.append("_revinclude", "Task:focus");
      const { data: bundle } = await searchResource<fhir4.Resource>("ServiceRequest", params);
      for (const entry of bundle.entry ?? []) {
        const resource = entry.resource;
        if (!resource) continue;
        if (resource.resourceType === "ServiceRequest") {
          const sr = resource as fhir4.ServiceRequest;
          if (regimenOrderOf(sr)) requests.push(sr);
        } else if (resource.resourceType === "MedicationRequest") {
          medicationRequests.push(resource as fhir4.MedicationRequest);
        } else if (resource.resourceType === "Task") {
          tasks.push(resource as fhir4.Task);
        }
      }

      const mrsByOrderId = new Map<string, fhir4.MedicationRequest[]>();
      for (const mr of medicationRequests) {
        for (const reference of mr.basedOn ?? []) {
          const orderId = referenceId(reference.reference);
          if (!orderId) continue;
          mrsByOrderId.set(orderId, [...(mrsByOrderId.get(orderId) ?? []), mr]);
        }
      }
      const injectionTasks = injectionTasksByOrderId(tasks);
      const rxTasks = rxTasksByOrderId(tasks);

      return requests
        .map((sr): RegimenDayOrder | null => {
          const ref = regimenOrderOf(sr);
          if (!ref || !sr.id) return null;
          const kind = regimenDayOrderKind(sr);
          const task = kind === "injection" ? injectionTasks.get(sr.id) : rxTasks.get(sr.id);
          const status = (task?.status ?? "requested") as RegimenDayOrder["status"];
          return {
            kind,
            serviceRequest: sr,
            medicationRequests: sortByRp(mrsByOrderId.get(sr.id) ?? []),
            task,
            ref,
            date: orderDay(sr),
            status,
          };
        })
        .filter((o): o is RegimenDayOrder => o !== null)
        .sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
    },
    enabled: Boolean(patientId) && ids.length > 0,
  });
}

function regimenDayTaskEntry(
  order: RegimenDayOrder,
  status: InjectionTaskStatus,
  /** 中止の理由(Task.statusReason)。中止以外では消す(中止取消で古い理由が残らないように)。 */
  reason?: string,
): fhir4.BundleEntry {
  const task =
    order.kind === "injection"
      ? buildInjectionTaskUpdate(order.task, order.serviceRequest, status)
      : buildRxTaskUpdate(order.task, order.serviceRequest, status as RxTaskStatus);
  const { statusReason: _dropped, ...rest } = task;
  const next: fhir4.Task =
    status === "cancelled" && reason?.trim() ? { ...rest, statusReason: { text: reason.trim() } } : rest;
  return taskBundleEntry(next);
}

function invalidateRegimen(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "injection-worklist"] });
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "rx-worklist"] });
  // 移動・中止で化学療法室の予約も取り消すので、予約タブと投与日パネルにも読み直させる。
  invalidateAppointments(queryClient);
}

/** まだ止めていない(実施済でも中止でもない)日オーダー。 */
function pendingRegimenOrders(targets: RegimenDayOrder[]): RegimenDayOrder[] {
  return targets.filter((order) => order.status !== "completed" && order.status !== "cancelled");
}

/**
 * 投与日の移動(§7.4)。内容は変えず日付だけ差し替えて同じ id へ PUT する。その日に取ってあった
 * 化学療法室の予約は取り消す(日時が変わるので自動では取り直さない。§8.13 N-5)。
 * 来歴は注射・処方の更新と同じく付ける。
 */
export function useMoveRegimenDays() {
  const queryClient = useQueryClient();
  const withProvenance = useWithOrderProvenance();
  return useMutation({
    mutationFn: async ({
      targets,
      deltaDays,
      patientId,
    }: {
      targets: RegimenDayOrder[];
      deltaDays: number;
      patientId: string;
    }) => {
      const bundle = withProvenance(buildRegimenMoveBundle(targets, deltaDays, patientId));
      const cancels = await chemoAppointmentCancelEntries(targets);
      return postBundle({ ...bundle, entry: [...(bundle.entry ?? []), ...cancels] });
    },
    onSuccess: () => {
      invalidateRegimen(queryClient);
      invalidateProvenance(queryClient);
    },
  });
}

/**
 * レジメンの日オーダーの中止・中止取消。注射は注射の Task、処方は処方の Task に
 * 同じ状態を書く。複数日をまとめて 1 つの transaction で書く(半端に止まらない)。
 * 中止では化学療法室の予約も取り消す(中止取消で予約は戻さない。取り直す)。
 */
export function useUpdateRegimenDayStatus() {
  const queryClient = useQueryClient();
  const activityProvenance = useActivityProvenance();
  return useMutation({
    mutationFn: async ({
      targets,
      status,
      reason,
    }: {
      targets: RegimenDayOrder[];
      status: "cancelled" | "requested";
      reason?: string;
    }) =>
      postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: [
          ...targets.map((order) => regimenDayTaskEntry(order, status, reason)),
          ...(status === "cancelled" ? await chemoAppointmentCancelEntries(targets) : []),
          // 誰がどの投与日を止めたか(代行なら指示医師の承認待ちに並ぶ)。
          ...activityProvenance(
            targets.map((order) => order.serviceRequest),
            status === "cancelled" ? "CANCEL" : "REACTIVATE",
          ),
        ],
      }),
    onSuccess: () => {
      invalidateRegimen(queryClient);
      invalidateProvenance(queryClient);
    },
  });
}

/**
 * レジメンの中止。ヘッダを revoked にし、まだ実施していない日オーダーを中止にする
 * (実施済は事実なので触らない)。止める日の化学療法室の予約も取り消す。
 */
export function useRevokeRegimen() {
  const queryClient = useQueryClient();
  const activityProvenance = useActivityProvenance();
  return useMutation({
    mutationFn: async ({
      header,
      targets,
      discontinuation,
    }: {
      header: fhir4.ServiceRequest;
      targets: RegimenDayOrder[];
      discontinuation: Pick<RegimenDiscontinuation, "reason" | "note">;
    }) => {
      const pending = pendingRegimenOrders(targets);
      return postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: [
          revokeRegimenEntry(header, discontinuation),
          ...pending.map((order) =>
            regimenDayTaskEntry(order, "cancelled", discontinuationReasonLabel(discontinuation.reason)),
          ),
          ...(await chemoAppointmentCancelEntries(pending)),
          // 中止はレジメン全体への判断なので、対象はヘッダだけにする(日オーダーはヘッダから辿れる)。
          ...activityProvenance([header], "CANCEL"),
        ],
      });
    },
    onSuccess: () => {
      invalidateRegimen(queryClient);
      invalidateProvenance(queryClient);
    },
  });
}

/**
 * 外来化学療法室の当日一覧(§7.6 E-7)。その日の化学療法予約を、患者・注射オーダー・進捗と
 * 一緒に並べる。化学療法室は「予約の時間割」で回るので、注射一覧(オーダー軸)ではなく
 * **予約軸**の面にする。
 *
 * 予約 → 患者は `_include`、予約 → 注射オーダーは `basedOn` の id で引き直す
 * (進捗の Task も同じ応答で受ける)。
 */
export interface ChemoRoomRow {
  appointment: fhir4.Appointment;
  patient?: fhir4.Patient;
  order?: fhir4.ServiceRequest;
  medicationRequests: fhir4.MedicationRequest[];
  task?: fhir4.Task;
}

export function useChemoRoomList(date: string) {
  return useQuery({
    queryKey: ["Appointment", "search", "chemo-room", date],
    queryFn: async (): Promise<ChemoRoomRow[]> => {
      const params = new URLSearchParams();
      params.set("date", date);
      params.set("service-type", `${SCHEDULE_SERVICE_TYPE_SYSTEM}|chemo`);
      setActiveAppointmentStatus(params);
      params.set("_count", "200");
      params.set("_sort", "date");
      params.append("_include", "Appointment:patient");
      // 予約が指す日オーダーと、そのオーダーの進捗 Task・薬剤も同じ応答で揃える。
      params.append("_include", "Appointment:based-on");
      params.append("_revinclude:iterate", "Task:focus,MedicationRequest:based-on");
      const { data: bundle } = await searchResource<fhir4.Resource>("Appointment", params);

      const appointments: fhir4.Appointment[] = [];
      const patientsById = new Map<string, fhir4.Patient>();
      const ordersById = new Map<string, fhir4.ServiceRequest>();
      const tasks: fhir4.Task[] = [];
      const mrsByOrderId = new Map<string, fhir4.MedicationRequest[]>();
      for (const entry of bundle.entry ?? []) {
        const resource = entry.resource;
        if (resource?.resourceType === "Appointment") {
          appointments.push(resource as fhir4.Appointment);
        } else if (resource?.resourceType === "Patient" && resource.id) {
          patientsById.set(resource.id, resource as fhir4.Patient);
        } else if (resource?.resourceType === "ServiceRequest" && resource.id) {
          ordersById.set(resource.id, resource as fhir4.ServiceRequest);
        } else if (resource?.resourceType === "Task") {
          tasks.push(resource as fhir4.Task);
        } else if (resource?.resourceType === "MedicationRequest") {
          const mr = resource as fhir4.MedicationRequest;
          for (const reference of mr.basedOn ?? []) {
            const id = referenceId(reference.reference);
            if (id) mrsByOrderId.set(id, [...(mrsByOrderId.get(id) ?? []), mr]);
          }
        }
      }
      const tasksByOrderId = injectionTasksByOrderId(tasks);

      return appointments
        .map((appointment) => {
          const orderId = appointmentOrderId(appointment);
          const patientId = appointmentActorId(appointment, "Patient");
          return {
            appointment,
            patient: patientId ? patientsById.get(patientId) : undefined,
            order: orderId ? ordersById.get(orderId) : undefined,
            medicationRequests: orderId ? sortByRp(mrsByOrderId.get(orderId) ?? []) : [],
            task: orderId ? tasksByOrderId.get(orderId) : undefined,
          };
        })
        .sort((a, b) => (a.appointment.start ?? "").localeCompare(b.appointment.start ?? ""));
    },
    enabled: Boolean(date),
  });
}

// ---- 有害事象(CTCAE Grade。§7.6 C-3) ----

/** 患者の有害事象の記録。適用・クールでの絞り込みは画面側(1 患者で多くても数十件)。 */
export function useRegimenAdverseEvents(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("patient", `Patient/${patientId}`);
  params.set("category", ADVERSE_EVENT_CATEGORY.code);
  params.set("_count", "200");
  params.set("_sort", "-date");

  return useQuery({
    queryKey: ["Observation", "search", patientId, "adverse-event"],
    queryFn: async (): Promise<AdverseEventRecord[]> => {
      const { data: bundle } = await searchResource<fhir4.Observation>("Observation", params);
      return (bundle.entry ?? [])
        .map((e) => e.resource)
        .filter((r): r is fhir4.Observation => r?.resourceType === "Observation")
        .map(parseAdverseEvent)
        .filter((r): r is AdverseEventRecord => r !== null);
    },
    enabled: Boolean(patientId),
  });
}

function invalidateAdverseEvents(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["Observation", "search"] });
}

/**
 * 有害事象の登録・更新(id があれば PUT)。楽観ロックは使わない(同時編集する場面がない)。
 * 記録者(performer)が入っていなければログイン中の医療従事者を入れる(§8.14 N-10)。
 */
export function useSaveAdverseEvent() {
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
            resource: observation,
            request: observation.id
              ? { method: "PUT", url: `Observation/${observation.id}` }
              : { method: "POST", url: "Observation" },
          },
        ],
      });
    },
    onSuccess: () => invalidateAdverseEvents(queryClient),
  });
}

export function useDeleteAdverseEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteResource("Observation", id),
    onSuccess: () => invalidateAdverseEvents(queryClient),
  });
}

/**
 * クールごと取り消す(§7.6 C-7)。登録した日オーダーを薬剤・進捗ごと消し、化学療法室の予約も
 * 取り消す。誤って登録したクールを片付けるための操作なので、部門が動き出した日を含むクールは
 * 呼ぶ側(`canDeleteCycle`)が弾く。
 *
 * ［決定］中止(Task を cancelled にする)ではなく**削除**にする。中止だと暦に打ち消し線の行が
 * 残り続け、「予定していたが止めた」と「そもそも登録が誤りだった」が区別できなくなる。
 */
export function useDeleteRegimenCycle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (targets: RegimenDayOrder[]) =>
      postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: [
          ...targets.flatMap((order) => [
            { request: { method: "DELETE" as const, url: `ServiceRequest/${order.serviceRequest.id}` } },
            {
              request: {
                method: "DELETE" as const,
                url: `MedicationRequest?based-on=ServiceRequest/${order.serviceRequest.id}`,
              },
            },
            // 進捗の Task は残すと孤児になる(他種別の削除では残っている既知の課題)。
            // ここは対象が手元にあるので一緒に消す。
            ...(order.task?.id
              ? [{ request: { method: "DELETE" as const, url: `Task/${order.task.id}` } }]
              : []),
          ]),
          ...(await chemoAppointmentCancelEntries(targets)),
        ],
      }),
    onSuccess: () => invalidateRegimen(queryClient),
  });
}

/**
 * ヘッダの編集(§7.6 C-6)。予定クール数の延長・入外区分・プロブレム・コメントを直す。
 * 登録・編集と同じ来歴(UPDATE)が付くよう `useUpdatePrescription` を通す。
 */

/**
 * レジメンの完了・休止・再開(§7.6 C-1)。完了は中止と同じく未実施の日オーダーを止め、
 * その日の化学療法室の予約も取り消す(完了したのに予定が残るのは矛盾)。
 * 休止・再開はヘッダの状態だけを変える(可逆)。
 */
export function useUpdateRegimenStatus() {
  const queryClient = useQueryClient();
  const activityProvenance = useActivityProvenance();
  return useMutation({
    mutationFn: async ({
      header,
      status,
      targets,
    }: {
      header: fhir4.ServiceRequest;
      status: "completed" | "on-hold" | "active";
      targets: RegimenDayOrder[];
    }) => {
      const pending = status === "completed" ? pendingRegimenOrders(targets) : [];
      const activity: OrderActivity =
        status === "completed" ? "COMPLETE" : status === "on-hold" ? "SUSPEND" : "RESUME";
      return postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: [
          ...(status === "completed"
            ? [
                completeRegimenEntry(header),
                ...pending.map((order) => regimenDayTaskEntry(order, "cancelled", "レジメン完了")),
                ...(await chemoAppointmentCancelEntries(pending)),
              ]
            : [holdRegimenEntry(header, status === "on-hold")]),
          ...activityProvenance([header], activity),
        ],
      });
    },
    onSuccess: () => {
      invalidateRegimen(queryClient);
      invalidateProvenance(queryClient);
    },
  });
}

// ---- クリニカルパスの適用(docs/clinical-pathway-design.md §7) ----

function invalidatePathway(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["CarePlan"] });
  queryClient.invalidateQueries({ queryKey: ["Procedure"] });
}

/** 患者のパス適用(木の根)の一覧に出す要約。 */
export interface PathwayApplicationSummary {
  id: string;
  applyId: string;
  title: string;
  status: string;
  pathwayCode: string;
  encounterId: string;
  periodStart: string;
  periodEnd: string;
}

function summarizePathwayApplication(carePlan: fhir4.CarePlan): PathwayApplicationSummary {
  const prefix = pathwayInstantiatesUri("");
  const uri = carePlan.instantiatesUri?.find((u) => u.startsWith(prefix)) ?? "";
  return {
    id: carePlan.id ?? "",
    applyId: carePlan.identifier?.find((i) => i.system === PATHWAY_APPLY_ID_SYSTEM)?.value ?? "",
    title: carePlan.title ?? "",
    status: carePlan.status,
    pathwayCode: uri.slice(prefix.length),
    encounterId: carePlan.encounter?.reference?.split("/").pop() ?? "",
    periodStart: carePlan.period?.start ?? "",
    periodEnd: carePlan.period?.end ?? "",
  };
}

/**
 * 患者に適用したクリニカルパス(木の根だけ)。子孫は partOf に根を持つので
 * `part-of:missing=true` で根だけが引ける。開始日の新しい順。
 */
export function usePathwayApplications(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("patient", `Patient/${patientId}`);
  params.set("category", `${PATHWAY_MARKER_SYSTEM}|${PATHWAY_MARKER_CODE}`);
  params.set("part-of:missing", "true");
  params.set("_sort", "-date");
  params.set("_count", "50");

  return useQuery({
    queryKey: ["CarePlan", "search", "pathway-applications", patientId],
    queryFn: async () => {
      const { data: bundle } = await searchResource<fhir4.CarePlan>("CarePlan", params);
      const roots =
        bundle.entry
          ?.map((e) => e.resource)
          .filter((r): r is fhir4.CarePlan => r?.resourceType === "CarePlan") ?? [];
      return { roots, applications: roots.map(summarizePathwayApplication) };
    },
    enabled: Boolean(patientId),
  });
}

/**
 * パス適用の Goal(終了・中止)。適用の識別子と同じ値を apply-goal-id で持つので、
 * identifier の 1 回の検索で引ける(木の検索には根が入らないため別に引く)。
 */
export function usePathwayApplyGoal(applyId: string | undefined) {
  const params = new URLSearchParams();
  if (applyId) params.set("identifier", `${PATHWAY_APPLY_GOAL_ID_SYSTEM}|${applyId}`);

  return useQuery({
    queryKey: ["Goal", "search", "pathway-apply", applyId],
    queryFn: async () => {
      const { data: bundle } = await searchResource<fhir4.Goal>("Goal", params);
      return (
        bundle.entry?.map((e) => e.resource).find((r): r is fhir4.Goal => r?.resourceType === "Goal") ?? null
      );
    },
    enabled: Boolean(applyId),
  });
}

/** パスの終了・中止(適用の CarePlan と Goal)。 */
export function useClosePathway() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      invalidatePathway(queryClient);
      queryClient.invalidateQueries({ queryKey: ["Goal"] });
    },
  });
}

/** 1 回の子孫の検索で引く病日の数(1 病日あたり子孫が数十件あるので、_count に収まるように分ける)。 */
const PATHWAY_WARD_EVENT_CHUNK = 10;

/**
 * 病棟の指示簿の「パスのタスク」(docs/clinical-pathway-design.md §6)。基準日の病日に置かれた、
 * オーダーを持たないタスクを患者ぶんまとめて引く。
 *
 * 1. `CarePlan?category=病日&date=基準日&subject=患者(カンマ OR)&_include=CarePlan:part-of` で
 *    その日の病日と、partOf の先頭(適用の根)を 1 回で引く。
 * 2. 病日の id を `part-of`(カンマ OR)に渡し、子孫(OAT ユニット・観察項目)とタスクの Procedure
 *    (`_revinclude=Procedure:based-on`)を引く。子孫は partOf に祖先すべてを持つので病日から直接引ける。
 */
export function usePathwayWardTasks(date: string, patientIds: string[]) {
  const ids = [...new Set(patientIds.filter(Boolean))].sort();
  return useQuery({
    // 実施の記録(invalidatePathway)で読み直されるよう CarePlan 配下のキーにする。
    queryKey: ["CarePlan", "search", "pathway-ward-tasks", date, ids.join(",")],
    queryFn: async (): Promise<PathwayWardTask[]> => {
      const eventParams = new URLSearchParams();
      eventParams.set("category", `${PATHWAY_LEVEL_SYSTEM}|event`);
      eventParams.set("date", date);
      eventParams.set("subject", ids.map((id) => `Patient/${id}`).join(","));
      eventParams.set("_include", "CarePlan:part-of");
      eventParams.set("_count", "500");
      const { data: eventBundle } = await searchResource<fhir4.Resource>("CarePlan", eventParams);
      const heads = (eventBundle.entry ?? [])
        .map((e) => e.resource)
        .filter((r): r is fhir4.CarePlan => r?.resourceType === "CarePlan");
      const events = heads.filter((cp) =>
        cp.category?.some((c) => c.coding?.some((x) => x.system === PATHWAY_LEVEL_SYSTEM && x.code === "event")),
      );
      if (events.length === 0) return [];

      const chunks: fhir4.CarePlan[][] = [];
      for (let i = 0; i < events.length; i += PATHWAY_WARD_EVENT_CHUNK) {
        chunks.push(events.slice(i, i + PATHWAY_WARD_EVENT_CHUNK));
      }
      const bundles = await Promise.all(
        chunks.map((chunk) => {
          const params = new URLSearchParams();
          params.set("part-of", chunk.map((event) => `CarePlan/${event.id}`).join(","));
          params.append("_revinclude", "Procedure:based-on");
          params.set("_count", "500");
          return searchResource<fhir4.Resource>("CarePlan", params);
        }),
      );
      const resources: fhir4.Resource[] = [...heads];
      for (const { data: bundle } of bundles) {
        for (const entry of bundle.entry ?? []) if (entry.resource) resources.push(entry.resource);
      }
      return parsePathwayWardTasks(resources);
    },
    enabled: Boolean(date) && ids.length > 0,
    placeholderData: keepPreviousData,
  });
}

/**
 * 患者ごとの進行中のパス(病棟の一覧の「パス」列。docs/clinical-pathway-design.md §6)。
 * `CarePlan?subject=患者(カンマ OR)&category=パスの印&part-of:missing=true&status=active` の 1 回で適用の根だけを引く。
 */
export function useActivePathwaysByPatient(patientIds: string[]) {
  const ids = [...new Set(patientIds.filter(Boolean))].sort();
  return useQuery({
    // 終了・中止・取り消し(invalidatePathway)で読み直されるよう CarePlan 配下のキーにする。
    queryKey: ["CarePlan", "search", "pathway-active-by-patient", ids.join(",")],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("subject", ids.map((id) => `Patient/${id}`).join(","));
      params.set("category", `${PATHWAY_MARKER_SYSTEM}|${PATHWAY_MARKER_CODE}`);
      params.set("part-of:missing", "true");
      params.set("status", "active");
      params.set("_sort", "date");
      params.set("_count", "500");
      const { data: bundle } = await searchResource<fhir4.CarePlan>("CarePlan", params);
      const byPatientId = new Map<string, PathwayApplicationSummary[]>();
      for (const root of resourcesOfType<fhir4.CarePlan>(bundle, "CarePlan")) {
        const patientId = root.subject?.reference?.split("/").pop() ?? "";
        byPatientId.set(patientId, [...(byPatientId.get(patientId) ?? []), summarizePathwayApplication(root)]);
      }
      return byPatientId;
    },
    enabled: ids.length > 0,
    placeholderData: keepPreviousData,
  });
}

/**
 * 日程の変更(docs/clinical-pathway-design.md §7.8)。病日・タスクと、自動でずらす看護指示・食事を
 * 1 transaction で PUT する。オーダーを書き換えるので、オーダーの来歴(代行なら承認待ちの通知も)を付ける。
 */
export function useShiftPathwaySchedule() {
  const queryClient = useQueryClient();
  const withOrderProvenance = useWithOrderProvenance();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(withOrderProvenance(bundle)),
    onSuccess: () => {
      invalidatePathway(queryClient);
      invalidateProvenance(queryClient);
      invalidateNursing(queryClient);
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
    },
  });
}

// 1 回の検索に載せるオーダー数(URL の長さの目安)。
const ORDER_TASK_CHUNK = 50;

/**
 * オーダーを指す Task。部門の受付・指示受けは focus で、承認は basedOn でオーダーを指すので、
 * 両方で引いて重複を除く。パスの取り消しで受け付け済みのオーダーを見分け、実施入力で
 * 受付の Task を探すのに使う。
 */
export function useOrderTasks(orderIds: string[]) {
  const ids = [...new Set(orderIds.filter(Boolean))].sort();
  return useQuery({
    queryKey: ["Task", "search", "order", ids.join(",")],
    queryFn: async () => {
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += ORDER_TASK_CHUNK) chunks.push(ids.slice(i, i + ORDER_TASK_CHUNK));
      const bundles = await Promise.all(
        chunks.flatMap((chunk) =>
          ["focus", "based-on"].map((param) => {
            const params = new URLSearchParams();
            params.set(param, chunk.map((id) => `ServiceRequest/${id}`).join(","));
            params.set("_count", "500");
            return searchResource<fhir4.Task>("Task", params);
          }),
        ),
      );
      const tasksById = new Map<string, fhir4.Task>();
      for (const { data: bundle } of bundles) {
        for (const task of resourcesOfType<fhir4.Task>(bundle, "Task")) {
          if (task.id) tasksById.set(task.id, task);
        }
      }
      return [...tasksById.values()];
    },
    enabled: ids.length > 0,
  });
}

/** 看護指示と指示受けの Task を消す(パスの取り消し用。普段の看護指示は中止で残す)。 */
function deleteNursingOrderRequest(order: fhir4.ServiceRequest, tasks: fhir4.Task[]) {
  const reference = `ServiceRequest/${order.id}`;
  const taskIds = tasks
    .filter((t) => t.focus?.reference === reference || t.basedOn?.some((b) => b.reference === reference))
    .map((t) => t.id)
    .filter((id): id is string => Boolean(id));
  return postBundle({
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      ...taskIds.map((id) => ({ request: { method: "DELETE" as const, url: `Task/${id}` } })),
      { request: { method: "DELETE", url: reference } },
    ],
  });
}

/** パスの取り消しで消すオーダー 1 件(種別はカルテのカードと同じ振り分け)。 */
export interface PathwayCancelOrder {
  order: fhir4.ServiceRequest;
  kind: string | null;
}

/**
 * 誤って適用したパスの取り消し(docs/clinical-pathway-design.md §7.9)。オーダーをカルテのカードの削除と
 * 同じ種別ごとの処理で 1 件ずつ消し(明細・予約・部門の Task・テンプレートの記入の後始末は各種別に任せる)、
 * 最後に計画の木を 1 transaction で消す。
 *
 * ［決定］種別ごとの削除の hook は 1 件ごとに一覧を読み直させるので、続けて呼ぶと開いている画面の読み直しが
 * 積み重なり上流の回数制限(1 分あたり)に当たる。ここでは hook の本体だけを順に呼び、読み直しは最後に 1 回にする。
 * 途中で失敗したら木は残す(もう一度開けば、残っているオーダーから続けられる)。
 */
export function useCancelPathwayApplication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      orders,
      tasks,
      treeBundle,
      onProgress,
    }: {
      orders: PathwayCancelOrder[];
      tasks: fhir4.Task[];
      treeBundle: fhir4.Bundle;
      onProgress: (done: number) => void;
    }) => {
      for (const [index, { order, kind }] of orders.entries()) {
        const id = order.id ?? "";
        switch (kind) {
          case "prescription":
            await deletePrescriptionRequest(id);
            break;
          case "injection":
            await deleteInjectionSeriesRequest([id]);
            break;
          case "lab-order":
            await deleteLabOrderRequest(id);
            break;
          case "micro-order":
            await deleteMicroOrderRequest(id);
            break;
          case "patho-order":
            await deletePathoOrderRequest(id);
            break;
          case "rad-order":
            await deleteRadOrderRequest(id);
            break;
          case "physio-order":
            await deletePhysioOrderRequest(id);
            break;
          case "endoscopy-order":
            await deleteEndoscopyOrderRequest(id);
            break;
          case "treatment-order":
            await deleteTreatmentOrderRequest(id);
            break;
          case "surgery-order":
            await deleteSurgeryOrderRequest(id);
            break;
          case "meal-order":
            await deleteMealOrderRequest(id);
            break;
          case "transfusion-order":
            await deleteTransfusionOrderRequest(id);
            break;
          case "rehab-order":
            await deleteRehabOrderRequest(id);
            break;
          case "radiotherapy-order":
            await deleteRadiotherapyOrderRequest(id);
            break;
          case "nutrition-guidance-order":
            await deleteNutritionGuidanceOrderRequest(id);
            break;
          case "consult-order":
            await deleteConsultOrderRequest(id);
            break;
          case "nursing-order":
            await deleteNursingOrderRequest(order, tasks);
            break;
          default:
            throw new Error(`この種別のオーダーは取り消せません(${kind ?? "不明"})`);
        }
        onProgress(index + 1);
      }
      return postBundle(treeBundle);
    },
    // 失敗しても途中まで消えているので、どちらでも読み直す。
    onSettled: () => {
      invalidatePathway(queryClient);
      invalidateNursing(queryClient);
      invalidateAppointments(queryClient);
      invalidateConsult(queryClient);
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
      queryClient.invalidateQueries({ queryKey: ["Goal"] });
      queryClient.invalidateQueries({ queryKey: ["Task"] });
      queryClient.invalidateQueries({ queryKey: ["Slot"] });
      queryClient.invalidateQueries({ queryKey: ["QuestionnaireResponse", "search"] });
    },
  });
}

/**
 * 予定外の OAT ユニットの追加(適用の木に足す)。タスクにオーダーを付けたときは同じ
 * Bundle に入るので、適用と同じくオーダーの来歴(代行なら承認待ちの通知も)を付ける。
 */
export function useAddUnplannedUnit() {
  const queryClient = useQueryClient();
  const withOrderProvenance = useWithOrderProvenance();
  return useMutation({
    mutationFn: ({ bundle }: { bundle: fhir4.Bundle; invalidate?: QueryKey[] }) =>
      postBundle(withOrderProvenance(bundle)),
    onSuccess: (_result, variables) => {
      invalidatePathway(queryClient);
      invalidateProvenance(queryClient);
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      for (const key of variables.invalidate ?? []) queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

/** 患者の入院予定(status=planned)。パスの適用先の候補にする(日付未定のものも含む)。 */
export function usePatientPlannedAdmissions(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("status", PLANNED_STATUS);
  params.set("class", ADMISSION_CLASS_CODE);
  params.set("_count", "10");

  return useQuery({
    queryKey: ["Encounter", "patient-planned-admissions", patientId],
    queryFn: async () => {
      const { data: bundle } = await searchResource<fhir4.Encounter>("Encounter", params);
      return sortPlannedAdmissions(
        bundle.entry
          ?.map((e) => e.resource)
          .filter((r): r is fhir4.Encounter => r?.resourceType === "Encounter") ?? [],
      );
    },
    enabled: Boolean(patientId),
  });
}

/**
 * パスを適用する(CarePlan の木と未実施のタスクを 1 transaction で登録)。来歴は適用の
 * CarePlan(木の根)を対象に 1 件。指示医師はオーダーのヘッダが無いので呼ぶ側が渡す。
 */
export function useApplyPathway() {
  const queryClient = useQueryClient();
  const enterer = useOrderEnterer();
  // 雛形から出したオーダーが同じ Bundle に入るので、オーダーの来歴(代行なら承認待ちの通知も)
  // を先に付ける。パスの来歴はその後ろ。
  const withOrderProvenance = useWithOrderProvenance();
  return useMutation({
    mutationFn: ({
      bundle,
      applyFullUrl,
      requesterId,
    }: {
      bundle: fhir4.Bundle;
      applyFullUrl: string;
      requesterId: string;
      /** 雛形から出したオーダーの種別が読み直すキー。 */
      invalidate?: QueryKey[];
    }) => {
      const withOrders = withOrderProvenance(bundle);
      const provenance =
        enterer && requesterId
          ? buildPathwayApplyProvenanceEntry(applyFullUrl, { reference: `Practitioner/${requesterId}` }, enterer)
          : null;
      const withProvenance = provenance
        ? { ...withOrders, entry: [...(withOrders.entry ?? []), provenance] }
        : withOrders;
      return postBundle(withProvenance);
    },
    onSuccess: (_result, variables) => {
      invalidatePathway(queryClient);
      invalidateProvenance(queryClient);
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
      for (const key of variables.invalidate ?? []) queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

/**
 * 適用 1 件の木(病日・OAT ユニット・観察項目)と、そのタスク(Procedure)、タスクが指す
 * オーダーのヘッダ(ServiceRequest)を 1 回の検索で読む。子孫は partOf に根を持つので
 * `part-of=根` で全部引け、タスクは _revinclude、オーダーは :iterate でその先を辿る。
 */
export interface PathwayApplicationTree {
  application: PathwayApplicationRecord | null;
  /** タスクが指すオーダーのヘッダ(id → ServiceRequest)。 */
  orders: Map<string, fhir4.ServiceRequest>;
  /** OAT ユニットの Goal(id → Goal)。 */
  goals: Map<string, fhir4.Goal>;
  /** 木の CarePlan(id → CarePlan)。評価の保存で OAT ユニットに goal を足すときに使う。 */
  carePlans: Map<string, fhir4.CarePlan>;
  /** タスクの Procedure(id → Procedure)。実施の記録で status を書き換える。 */
  procedures: Map<string, fhir4.Procedure>;
  /** オーダーのヘッダの id → 進み具合(進捗の Task から。カルテのカードと同じ判定)。 */
  orderProgress: Map<string, OrderProgress>;
}

/** 適用の木の検索のキーの先頭。オーダーの実施入力などを閉じたときに読み直させるのに使う。 */
export const PATHWAY_TREE_KEY_PREFIX: string[] = ["CarePlan", "search", "pathway-tree"];

/** 適用の木の検索の 1 ページ(上流の _count の上限)。 */
const PATHWAY_TREE_PAGE = 500;

export function usePathwayApplicationTree(applyId: string | undefined) {
  const params = new URLSearchParams();
  if (applyId) params.set("part-of", `CarePlan/${applyId}`);
  params.append("_revinclude", "Procedure:based-on");
  params.append("_include:iterate", "Procedure:based-on");
  // OAT ユニットの Goal(評価)と観察項目の Goal(適正値)も同じ応答で揃える。
  params.append("_include", "CarePlan:goal");
  // オーダーの進み具合は ServiceRequest ではなく focus で指す進捗の Task にあるので、それも辿る。
  // リハビリ・栄養指導は日ごとの実施記録(オーダーを basedOn で指す Procedure)で実施を見るので、それも辿る。
  // 上流は同じ名前の _revinclude:iterate を並べると最後の 1 つしか効かないので、カンマで 1 つにまとめる。
  params.append("_revinclude:iterate", "Task:focus,Procedure:based-on");
  params.set("_count", String(PATHWAY_TREE_PAGE));

  return useQuery({
    queryKey: PATHWAY_TREE_KEY_PREFIX.concat(applyId ?? ""),
    queryFn: async (): Promise<PathwayApplicationTree> => {
      const [{ data: apply }, { data: bundle }] = await Promise.all([
        readResource<fhir4.CarePlan>("CarePlan", applyId as string),
        searchResource<fhir4.Resource>("CarePlan", params),
      ]);
      // フェーズを重ねた長いパスは木の CarePlan が 1 ページ(500 件)を超えるので、残りのページも読む。
      const pageCount = Math.ceil((bundle.total ?? 0) / PATHWAY_TREE_PAGE);
      const rest = await Promise.all(
        Array.from({ length: Math.max(pageCount - 1, 0) }, (_, i) => {
          const pageParams = new URLSearchParams(params);
          pageParams.set("_offset", String((i + 1) * PATHWAY_TREE_PAGE));
          return searchResource<fhir4.Resource>("CarePlan", pageParams).then((r) => r.data);
        }),
      );
      const resources = [bundle, ...rest]
        .flatMap((page) => page.entry ?? [])
        .map((e) => e.resource)
        .filter((r): r is fhir4.Resource => Boolean(r));
      const orders = new Map<string, fhir4.ServiceRequest>();
      const goals = new Map<string, fhir4.Goal>();
      const carePlans = new Map<string, fhir4.CarePlan>();
      const procedures = new Map<string, fhir4.Procedure>();
      const tasks: fhir4.Task[] = [];
      // オーダーの実施記録。パスのタスク(CarePlan を basedOn で指す Procedure)とは分けて持つ。
      const performs: fhir4.Procedure[] = [];
      for (const r of resources) {
        if (!r.id) continue;
        if (r.resourceType === "Task") tasks.push(r as fhir4.Task);
        if (r.resourceType === "ServiceRequest") orders.set(r.id, r as fhir4.ServiceRequest);
        if (r.resourceType === "Goal") goals.set(r.id, r as fhir4.Goal);
        if (r.resourceType === "CarePlan") carePlans.set(r.id, r as fhir4.CarePlan);
        if (r.resourceType === "Procedure") {
          const procedure = r as fhir4.Procedure;
          if (procedure.basedOn?.some((ref) => ref.reference?.startsWith("CarePlan/"))) procedures.set(r.id, procedure);
          else performs.push(procedure);
        }
      }
      if (apply.id) carePlans.set(apply.id, apply);
      const tree = [...carePlans.values(), ...procedures.values()].filter((r) => r.id !== apply.id);
      return {
        application: parsePathwayApplication([apply, ...tree], goals),
        orders,
        goals,
        carePlans,
        procedures,
        orderProgress: orderProgressByOrderId(orders.values(), tasks, performs),
      };
    },
    enabled: Boolean(applyId),
  });
}

/**
 * 患者のパスの評価と観察項目の実績(Observation)。category の先頭がパスの印なので
 * 患者 + category の 1 回で全部引ける(上流は category の先頭しか索引しない)。
 */
export function usePathwayObservations(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("patient", `Patient/${patientId}`);
  params.set("category", `${PATHWAY_MARKER_SYSTEM}|${PATHWAY_MARKER_CODE}`);
  params.set("_count", "500");

  return useQuery({
    queryKey: ["Observation", "search", "pathway", patientId],
    queryFn: async () => {
      const { data: bundle } = await searchResource<fhir4.Observation>("Observation", params);
      return (
        bundle.entry
          ?.map((e) => e.resource)
          .filter((r): r is fhir4.Observation => r?.resourceType === "Observation") ?? []
      );
    },
    enabled: Boolean(patientId),
  });
}

/** 1 病日 × 1 OAT ユニットの評価(Goal・Observation・タスクの実施)を 1 transaction で書く。 */
export function useRecordPathwayEvaluation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => {
      invalidatePathway(queryClient);
      queryClient.invalidateQueries({ queryKey: ["Observation", "search", "pathway"] });
      queryClient.invalidateQueries({ queryKey: ["Goal"] });
      // バリアンスの通知を作る・取り下げることがあるので、通知の一覧・件数も読み直させる。
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_TASK_KEY });
    },
  });
}

/**
 * 患者のパスのバリアンスの通知(対応済み・取り下げも含む)。評価を記録するときに、同じアウトカムの
 * 通知を出し直すか・取り下げるかを決めるのに使う(docs/clinical-pathway-design.md §7.10)。
 * OAT ユニットとの突き合わせは basedOn で画面側が行う。
 */
export function usePathwayVarianceTasks(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("patient", `Patient/${patientId}`);
  params.set("code", `${TASK_CODE_SYSTEM}|${PATHWAY_VARIANCE_TASK_CODE.code}`);
  params.set("_count", "500");
  return useQuery({
    queryKey: [...NOTIFICATION_TASK_KEY, "pathway-variance", patientId],
    queryFn: async () => {
      const { data: bundle } = await searchResource<fhir4.Task>("Task", params);
      return resourcesOfType<fhir4.Task>(bundle, "Task");
    },
    enabled: Boolean(patientId),
  });
}

// --- カルテに取り込んだファイル(docs/patient-file-design.md) ------------------

const PATIENT_FILE_COUNT = 20;
const PATIENT_FILE_KEY = ["DocumentReference", "search"];

/**
 * 患者のファイル一覧。並びは診療日(DocumentReference.date)の降順で、カテゴリは
 * 上流の category 検索で絞る(クライアント側で振り分けるとページングと両立しない)。
 */
export function usePatientFileSearch(
  patientId: string | undefined,
  categoryCode: string,
  offset: number,
) {
  const params = new URLSearchParams();
  if (patientId) params.set("patient", `Patient/${patientId}`);
  if (categoryCode) params.set("category", `${PATIENT_FILE_CATEGORY_SYSTEM}|${categoryCode}`);
  params.set("_count", String(PATIENT_FILE_COUNT));
  params.set("_offset", String(offset));
  params.set("_sort", "-date");

  const query = useQuery({
    queryKey: [...PATIENT_FILE_KEY, patientId, categoryCode, offset],
    queryFn: () => searchResource<fhir4.DocumentReference>("DocumentReference", params),
    placeholderData: keepPreviousData,
    enabled: Boolean(patientId),
  });

  return {
    ...query,
    bundle: query.data?.data,
    total: query.data?.data.total ?? 0,
    count: PATIENT_FILE_COUNT,
    hasPrevious: hasRelation(query.data?.data, "previous"),
    hasNext: hasRelation(query.data?.data, "next"),
  };
}

export function usePatientFileDocument(id: string | undefined) {
  return useQuery({
    queryKey: ["DocumentReference", id],
    queryFn: () => readResource<fhir4.DocumentReference>("DocumentReference", id as string),
    enabled: Boolean(id),
  });
}

/** ファイル 1 件ぶんの中身。Binary は書き換わらないので長くキャッシュする。 */
export function usePatientFileBlob(binaryId: string | null | undefined) {
  return useQuery({
    queryKey: ["Binary", "blob", binaryId],
    queryFn: () => fetchBinaryBlob(binaryId as string),
    enabled: Boolean(binaryId),
    staleTime: Infinity,
  });
}

export interface PatientFileUploadResult {
  saved: number;
  /** 保存できなかったファイルの key(取込フォームに残すため)。 */
  failedKeys: string[];
  /** 保存できなかったファイルの理由(表示名付き)。 */
  errors: string[];
}

/**
 * 取り込んだファイルを 1 件ずつ保存する。ファイルごとに transaction Bundle を分けるので、
 * 1 件が大きすぎて弾かれても他のファイルは残る。結果は件数と失敗の理由でまとめて返す。
 */
export function useCreatePatientFiles() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      drafts,
      ...options
    }: {
      drafts: PatientFileDraft[];
      patientId: string;
      date: string;
      category: PatientFileCategory | null;
      practitionerId?: string;
      practitionerName?: string;
    }): Promise<PatientFileUploadResult> => {
      let saved = 0;
      const failedKeys: string[] = [];
      const errors: string[] = [];
      for (const draft of drafts) {
        try {
          await postBundle(buildPatientFileBundle(draft, options));
          saved += 1;
        } catch (err) {
          failedKeys.push(draft.key);
          errors.push(`${draft.title}: ${errorMessages(err)
            .map((message) => message.text)
            .join(" ")}`);
        }
      }
      return { saved, failedKeys, errors };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PATIENT_FILE_KEY });
    },
  });
}

export function useUpdatePatientFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ doc, etag }: { doc: fhir4.DocumentReference; etag: string }) =>
      updateResource(doc, etag),
    onSuccess: (result: FhirResult<fhir4.DocumentReference>) => {
      queryClient.invalidateQueries({ queryKey: PATIENT_FILE_KEY });
      queryClient.invalidateQueries({ queryKey: ["DocumentReference", result.data.id] });
    },
  });
}

/**
 * ファイルの削除。消すのは DocumentReference だけで、本体の Binary は残す
 * (旧バージョンがその Binary を参照しているため。シェーマ画像と同じ方針)。
 */
export function useDeletePatientFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteResource("DocumentReference", id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PATIENT_FILE_KEY });
    },
  });
}

// --- 取り込んだ DICOM(docs/imaging-design.md) --------------------------------

const IMAGING_STUDY_COUNT = 20;
export const IMAGING_STUDY_KEY = ["ImagingStudy"];
const IMAGING_STORED_KEY = ["imaging", "stored"];

/**
 * 患者のスタディ一覧。並びは検査日の降順。series(インスタンスの一覧)は数百件に
 * なるので、一覧では _elements で落とす。
 */
export function useImagingStudySearch(patientId: string | undefined, offset: number) {
  const params = new URLSearchParams();
  if (patientId) params.set("patient", `Patient/${patientId}`);
  params.set("_count", String(IMAGING_STUDY_COUNT));
  params.set("_offset", String(offset));
  params.set("_sort", "-started");
  params.set("_elements", IMAGING_STUDY_SUMMARY_ELEMENTS);

  const query = useQuery({
    queryKey: [...IMAGING_STUDY_KEY, "search", patientId, offset],
    queryFn: () => searchResource<fhir4.ImagingStudy>("ImagingStudy", params),
    placeholderData: keepPreviousData,
    enabled: Boolean(patientId),
  });

  return {
    ...query,
    bundle: query.data?.data,
    total: query.data?.data.total ?? 0,
    count: IMAGING_STUDY_COUNT,
    hasPrevious: hasRelation(query.data?.data, "previous"),
    hasNext: hasRelation(query.data?.data, "next"),
  };
}

export function useImagingStudy(id: string | undefined) {
  return useQuery({
    queryKey: [...IMAGING_STUDY_KEY, id],
    queryFn: () => readResource<fhir4.ImagingStudy>("ImagingStudy", id as string),
    enabled: Boolean(id),
  });
}

/** backend が実体を持っているスタディと枚数。取込フォームが取込済みの判定に使う。 */
export function useStoredImagingStudies(patientId: string | undefined) {
  return useQuery({
    queryKey: [...IMAGING_STORED_KEY, patientId],
    queryFn: () => fetchStoredStudies(patientId as string),
    enabled: Boolean(patientId),
  });
}

/** スタディの保存済みインスタンス(フレーム数など、ImagingStudy に無い属性を持つ)。 */
export function useImagingStudyInstances(patientId: string | undefined, studyUid: string | undefined) {
  return useQuery({
    queryKey: [...IMAGING_STORED_KEY, patientId, studyUid],
    queryFn: () => fetchStudyInstances(patientId as string, studyUid as string),
    enabled: Boolean(patientId && studyUid),
  });
}

/** 取込・削除のあとに、スタディの一覧と保存済みの枚数を読み直す。 */
export function useInvalidateImaging() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: IMAGING_STUDY_KEY });
    queryClient.invalidateQueries({ queryKey: IMAGING_STORED_KEY });
  };
}

/** スタディを実体ごと消す(上流の ImagingStudy も backend が消す)。 */
export function useDeleteImagingStudy(patientId: string) {
  const invalidate = useInvalidateImaging();
  return useMutation({
    mutationFn: (studyUid: string) => deleteImagingStudy(patientId, studyUid),
    onSuccess: invalidate,
  });
}

// ---- 放射線治療(治療処方) ----
//
// 明細を持たないヘッダ 1 本 + 進捗 Task で、作りは他科依頼と同じ。**進捗の変更で
// ServiceRequest.status も一緒に動かす**(docs/radiotherapy-order-design.md §4)。
// 書き込みの入口は useUpdateRadiotherapyTaskStatus だけ。

export function useRadiotherapyOrderDetail(srId: string | undefined) {
  const params = new URLSearchParams();
  if (srId) {
    params.set("_id", srId);
    // 進捗と照射記録(後続フェーズ。§6)を同時に取る。
    params.set("_revinclude", "Task:focus");
    params.append("_revinclude", "Procedure:based-on");
  }

  return useQuery({
    queryKey: ["ServiceRequest", "detail", "radiotherapy-order", srId],
    queryFn: () => searchResource<fhir4.Resource>("ServiceRequest", params),
    enabled: Boolean(srId),
  });
}

/**
 * その患者の放射線治療コース(進行中・終了・中止のすべて)。治療処方の安全確認
 * (過去の照射歴)とコース番号の既定値に使う。
 */
export function usePatientRadiotherapyOrders(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("category", `${ORDER_TYPE_SYSTEM}|${RADIOTHERAPY_ORDER_TYPE.code}`);
  params.set("status", "active,on-hold,completed,revoked");
  params.set("_sort", "-authoredon");
  params.set("_count", "50");

  return useQuery({
    queryKey: ["ServiceRequest", "search", "radiotherapy-patient", patientId],
    queryFn: async () => {
      const { data: bundle } = await searchResource<fhir4.ServiceRequest>("ServiceRequest", params);
      return serviceRequestsOf(bundle).filter(isRadiotherapyServiceRequest);
    },
    enabled: Boolean(patientId),
  });
}

/**
 * その患者の他科依頼(新しい順)。治療処方が「どの依頼を受けたものか」を選ぶ候補。
 * 取消(revoked)は候補にしない。
 */
export function usePatientConsultOrders(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("subject", `Patient/${patientId}`);
  params.set("category", `${ORDER_TYPE_SYSTEM}|${CONSULT_ORDER_TYPE.code}`);
  params.set("status", "active,completed");
  params.set("based-on:missing", "true");
  params.set("_sort", "-authoredon");
  params.set("_count", "20");

  return useQuery({
    queryKey: ["ServiceRequest", "search", "consult-patient", patientId],
    queryFn: async () => {
      const { data: bundle } = await searchResource<fhir4.ServiceRequest>("ServiceRequest", params);
      return serviceRequestsOf(bundle).filter(isConsultServiceRequest);
    },
    enabled: Boolean(patientId),
  });
}

function invalidateRadiotherapy(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "radiotherapy-worklist"] });
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "search"] });
  queryClient.invalidateQueries({ queryKey: ["ServiceRequest", "detail"] });
  // 照射記録(部門一覧の回数と累積線量、カルテのカード)。
  queryClient.invalidateQueries({ queryKey: ["Procedure", "search"] });
}

export function useUpdateRadiotherapyOrder() {
  const queryClient = useQueryClient();
  const withProvenance = useWithOrderProvenance();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(withProvenance(bundle)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ServiceRequest"] });
      invalidateProvenance(queryClient);
    },
  });
}

/**
 * 治療処方を消す。**部門が受け付けた後(計画中以降)は消させない** — 計画や照射が
 * 進んでいる処方が消えると、何に基づいて照射したのかが辿れなくなる。受付後にやめる
 * ときは部門一覧の「中止」を使う(§4)。
 *
 * useDeleteRadiotherapyOrder の本体(読み直しの指示を伴わない)。パスの取り消しがまとめて
 * 消すときにも使う。
 */
export const deleteRadiotherapyOrderRequest = async (srId: string) => {
  const params = new URLSearchParams();
  params.set("_id", srId);
  params.set("_revinclude", "Task:focus");
  const { data: bundle } = await searchResource<fhir4.Resource>("ServiceRequest", params);
  const tasks = (bundle.entry ?? [])
    .map((e) => e.resource)
    .filter((r): r is fhir4.Task => r?.resourceType === "Task");
  const status = radiotherapyTaskStatus(radiotherapyTasksByOrderId(tasks).get(srId));
  if (status !== "requested") {
    throw new Error(
      "受付後の放射線治療は削除できません。放射線治療一覧で中止するか、受付を取り消してください。",
    );
  }
  return postBundle(buildRadiotherapyOrderDeleteBundle(srId));
};

export function useDeleteRadiotherapyOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteRadiotherapyOrderRequest,
    onSuccess: () => invalidateRadiotherapy(queryClient),
  });
}

// ---- 放射線治療一覧(部門ワークリスト) ----
//
// 治療コースは数週間続くので、他科依頼と同じく日付ではなく status で切る(§4.1)。
//
//   進行中     … status=active(処方済・計画中・治療中)。いま抱えているコースなので有限。
//   終了・中止 … status=completed,revoked の直近ぶん(-authoredon)。

export type RadiotherapyWorklistView = "open" | "closed";

export interface RadiotherapyWorklistRow {
  order: fhir4.ServiceRequest;
  patient?: fhir4.Patient;
  task?: fhir4.Task;
}

export interface RadiotherapyWorklistResult {
  rows: RadiotherapyWorklistRow[];
  truncated: boolean;
}

function radiotherapyWorklistParams(view: RadiotherapyWorklistView, page: number): URLSearchParams {
  const params = new URLSearchParams();
  params.set("category", `${ORDER_TYPE_SYSTEM}|${RADIOTHERAPY_ORDER_TYPE.code}`);
  params.set("status", view === "open" ? "active,on-hold" : "completed,revoked");
  params.set("based-on:missing", "true");
  params.set("_count", String(WORKLIST_PAGE));
  params.set("_offset", String(page * WORKLIST_PAGE));
  params.set("_sort", "-authoredon");
  params.set("_include", "ServiceRequest:subject");
  params.set("_revinclude", "Task:focus");
  return params;
}

async function fetchRadiotherapyWorklist(
  view: RadiotherapyWorklistView,
): Promise<RadiotherapyWorklistResult> {
  const orders: fhir4.ServiceRequest[] = [];

  const { patientsById, tasks, truncated } = await fetchWorklistBundles(
    (page) => radiotherapyWorklistParams(view, page),
    (resource) => {
      if (resource.resourceType !== "ServiceRequest") return false;
      const request = resource as fhir4.ServiceRequest;
      if (!isRadiotherapyServiceRequest(request)) return false;
      orders.push(request);
      return true;
    },
  );

  const taskByOrderId = radiotherapyTasksByOrderId(tasks);
  const rows = orders.map((order) => ({
    order,
    patient: patientsById.get(order.subject?.reference?.split("/").pop() ?? ""),
    task: taskByOrderId.get(order.id ?? ""),
  }));

  return { rows, truncated };
}

export function useRadiotherapyWorklist(view: RadiotherapyWorklistView) {
  return useQuery({
    queryKey: ["ServiceRequest", "radiotherapy-worklist", view],
    queryFn: () => fetchRadiotherapyWorklist(view),
    placeholderData: keepPreviousData,
  });
}

/**
 * 進捗の変更。Task と ServiceRequest.status を 1 つの transaction で両方書く(§4)。
 * **片方だけを書く入口を増やさないこと** — status だけが取り残されると、終了した
 * コースが部門一覧の進行中に出続ける。終了・中止では終了日と理由も同じ PUT で書く。
 */
export function useUpdateRadiotherapyTaskStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      order,
      task,
      status,
      termination,
    }: {
      order: fhir4.ServiceRequest;
      task: fhir4.Task | undefined;
      status: RadiotherapyTaskStatus;
      termination?: RadiotherapyTermination;
    }) =>
      postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: [
          taskBundleEntry(buildRadiotherapyTaskUpdate(task, order, status)),
          buildRadiotherapyOrderStatusEntry(order, radiotherapyOrderStatusFor(status), termination),
        ],
      }),
    onSuccess: () => invalidateRadiotherapy(queryClient),
  });
}

// ---- 照射記録(docs/radiotherapy-order-design.md §6.1) ----
//
// 1 回の照射 = Procedure 1 件。リハビリと同じく**照射しても進捗 Task は動かさない**ので、
// 登録は Procedure を 1 件 POST するだけ。取消は消さずに entered-in-error にする
// (照射録は保存の対象)。

export function useRegisterRadiotherapyFraction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => invalidateRadiotherapy(queryClient),
  });
}

export function useCancelRadiotherapyFraction() {
  const queryClient = useQueryClient();

  return useMutation({
    // 取り消す前に読み直すのは、PUT が全置換なので手元の写しでは古い版を書き戻しうるため。
    mutationFn: async (procedureId: string) => {
      const { data: procedure } = await readResource<fhir4.Procedure>("Procedure", procedureId);
      return postBundle(buildRadiotherapyFractionCancelBundle(procedure));
    },
    onSuccess: () => invalidateRadiotherapy(queryClient),
  });
}

/** 30 回のコースが 300 本ぶん。それ以上は読まない(一覧の回数が欠ける)。 */
const RADIOTHERAPY_PROCEDURE_MAX_PAGES = 20;

export interface RadiotherapyProcedures {
  /** オーダー id → 照射記録(新しい順)。 */
  fractions: Map<string, RadiotherapyFractionDisplay[]>;
  /** オーダー id → 治療終了サマリー(1 コースに 1 件)。 */
  summaries: Map<string, fhir4.Procedure>;
}

/**
 * 部門一覧に出すオーダーの照射記録と治療終了サマリー。一覧は 1 画面に数十コースなので、
 * オーダーごとに引かず患者をまたいで category でまとめて引き、オーダー id で振り分ける。
 */
async function fetchRadiotherapyProcedures(): Promise<RadiotherapyProcedures> {
  // 照射予定を一括登録すると 1 コースで数十件になるので、ページを送って読み切る。
  const procedures: fhir4.Procedure[] = [];
  for (let page = 0; page < RADIOTHERAPY_PROCEDURE_MAX_PAGES; page += 1) {
    const params = new URLSearchParams();
    params.set("category", `${ORDER_TYPE_SYSTEM}|${RADIOTHERAPY_ORDER_TYPE.code}`);
    params.set("status:not", "entered-in-error");
    params.set("_sort", "-date");
    params.set("_count", String(WORKLIST_PAGE));
    params.set("_offset", String(page * WORKLIST_PAGE));
    const { data: bundle } = await searchResource<fhir4.Procedure>("Procedure", params);
    const found = resourcesOfType<fhir4.Procedure>(bundle, "Procedure");
    procedures.push(...found);
    if (found.length < WORKLIST_PAGE) break;
  }
  return {
    fractions: radiotherapyFractionsByOrderId(procedures.filter(isRadiotherapyFraction)),
    summaries: radiotherapyCourseSummariesByOrderId(procedures),
  };
}

export function useRadiotherapyProcedures(enabled = true) {
  return useQuery({
    queryKey: ["Procedure", "search", "radiotherapy-procedures"],
    queryFn: fetchRadiotherapyProcedures,
    enabled,
  });
}

/** 治療終了サマリーの保存。初回は POST、書き直しは同じ Procedure への PUT。 */
export function useSaveRadiotherapyCourseSummary() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => invalidateRadiotherapy(queryClient),
  });
}

// ---- 放射線治療カレンダー(docs/radiotherapy-order-design.md §7) ----
//
// 格子に載せるのは照射の Procedure(予定・実績・未実施)。期間を date で切り、患者と治療処方を
// _include で一緒に取る。コースの一覧(右のパネル)は部門一覧と同じ useRadiotherapyWorklist。

export interface RadiotherapyCalendarEntry {
  fraction: RadiotherapyFractionDisplay;
  order?: fhir4.ServiceRequest;
  patient?: fhir4.Patient;
}

async function fetchRadiotherapyCalendar(from: string, to: string): Promise<RadiotherapyCalendarEntry[]> {
  const params = new URLSearchParams();
  params.set("category", `${ORDER_TYPE_SYSTEM}|${RADIOTHERAPY_ORDER_TYPE.code}`);
  params.set("status:not", "entered-in-error");
  params.append("date", `ge${from}`);
  params.append("date", `le${to}`);
  params.set("_count", String(WORKLIST_PAGE));
  params.append("_include", "Procedure:subject");
  params.append("_include", "Procedure:based-on");

  const { data: bundle } = await searchResource<fhir4.Resource>("Procedure", params);
  const procedures = resourcesOfType<fhir4.Procedure>(bundle, "Procedure").filter(isRadiotherapyFraction);
  const patients = new Map(
    resourcesOfType<fhir4.Patient>(bundle, "Patient").map((patient) => [patient.id ?? "", patient]),
  );
  const orders = new Map(
    resourcesOfType<fhir4.ServiceRequest>(bundle, "ServiceRequest").map((sr) => [sr.id ?? "", sr]),
  );

  const entries: RadiotherapyCalendarEntry[] = [];
  for (const [orderId, fractions] of radiotherapyFractionsByOrderId(procedures)) {
    const order = orders.get(orderId);
    const patient = patients.get(order?.subject?.reference?.split("/").pop() ?? "");
    for (const fraction of fractions) entries.push({ fraction, order, patient });
  }
  return entries;
}

export function useRadiotherapyCalendar(from: string, to: string) {
  return useQuery({
    queryKey: ["Procedure", "search", "radiotherapy-calendar", from, to],
    queryFn: () => fetchRadiotherapyCalendar(from, to),
    placeholderData: keepPreviousData,
  });
}

/** 照射予定の一括登録(処方の回数ぶんの Procedure を 1 つの transaction で作る)。 */
export function useRegisterRadiotherapyPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => invalidateRadiotherapy(queryClient),
  });
}

/** 照射予定の日時・装置の変更。読み直してから PUT する(全置換なので古い版を書き戻さない)。 */
export function useRescheduleRadiotherapyFraction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      procedureId,
      ...change
    }: {
      procedureId: string;
      date: string;
      startTime: string;
      endTime: string;
      device?: { code: string; name: string };
    }) => {
      const { data: procedure } = await readResource<fhir4.Procedure>("Procedure", procedureId);
      if (procedure.status !== "preparation") {
        throw new Error("照射済みの記録の日時は変更できません。");
      }
      const next = rescheduleRadiotherapyFraction(procedure, change);
      return postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: [{ resource: next, request: { method: "PUT", url: `Procedure/${procedureId}` } }],
      });
    },
    onSuccess: () => invalidateRadiotherapy(queryClient),
  });
}

/**
 * 照射予定の削除。**予定(preparation)は照射録ではない**ので物理削除でよい
 * (照射した記録の取消は entered-in-error。useCancelRadiotherapyFraction)。
 */
export function useDeleteRadiotherapyPlanned() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (procedureIds: string[]) =>
      postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: procedureIds.map((id) => ({
          request: { method: "DELETE" as const, url: `Procedure/${id}` },
        })),
      }),
    onSuccess: () => invalidateRadiotherapy(queryClient),
  });
}

/**
 * 照射予定を「照射しなかった回」にする(体調不良・休診など)。実施の入力とは別の操作で、
 * 線量も実施者も持たない(docs/radiotherapy-order-design.md §6.1)。
 */
export function useMarkRadiotherapyFractionNotDone() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      procedureId,
      reason,
      note,
    }: {
      procedureId: string;
      reason: { code: string; name: string };
      note: string;
    }) => {
      // PUT は全置換なので、手元の写しではなく読み直したものを土台にする。
      const { data: procedure } = await readResource<fhir4.Procedure>("Procedure", procedureId);
      if (procedure.status !== "preparation") {
        throw new Error("照射予定だけを中止にできます(実施済みの記録は取消してください)。");
      }
      return postBundle(buildRadiotherapyFractionNotDoneBundle(procedure, reason, note));
    },
    onSuccess: () => invalidateRadiotherapy(queryClient),
  });
}

/** 中止を取り消して予定に戻す。 */
export function useRestoreRadiotherapyFraction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (procedureId: string) => {
      const { data: procedure } = await readResource<fhir4.Procedure>("Procedure", procedureId);
      if (procedure.status !== "not-done") {
        throw new Error("中止した回だけを予定に戻せます。");
      }
      return postBundle(buildRadiotherapyFractionRestoreBundle(procedure));
    },
    onSuccess: () => invalidateRadiotherapy(queryClient),
  });
}
