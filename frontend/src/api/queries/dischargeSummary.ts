import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { buildClinicalNoteDeleteBundle, DISCHARGE_SUMMARY_TYPE_SEARCH } from "../../fhir/clinicalNoteHelpers";
import type { DischargeSummarySources } from "../../fhir/dischargeSummaryHelpers";
import { buildCompletedDocumentDueEntries, cancelDocumentDueEntries, DOCUMENT_DUE_TASK_CODE } from "../../fhir/documentDueHelpers";
import { today } from "../../lib/dates";
import {
  ADMISSION_CLASS_CODE,
  ADMISSION_STATUS,
  DISCHARGED_STATUS,
  encounterEvents,
  withEventWards,
} from "../../fhir/encounterHelpers";
import { TASK_CODE_SYSTEM } from "../../fhir/taskHelpers";
import { ORDER_TYPE_SYSTEM } from "../../fhir/orderHeader";
import { PRESCRIPTION_CATEGORY_SYSTEM } from "../../fhir/prescriptionHelpers";
import {
  createResource,
  deleteResource,
  type FhirResult,
  postBundle,
  readResource,
  searchResource,
  updateResource,
} from "../fhirClient";
import { NOTIFICATION_TASK_KEY, resourcesOfType } from "./core";
import { fetchWardNameByBed } from "./encounter";
import { KARTE_CONDITION_COUNT, saveClinicalNote, staleObservationEntries } from "./micro";
import { hasRelation } from "./patient";
import { useOrderEnterer } from "./provenance";

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
 * 上流の Composition は encounter 検索に対応している。
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
