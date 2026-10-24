import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ANTIMICROBIAL_YAKKO_PREFIXES,
  BLOOD_CULTURE_SPECIMEN_CODES,
  antimicrobialCourses,
  antimicrobialIngredient,
  isAntimicrobialMedicine,
  type AntimicrobialCourse,
  type AntimicrobialSpan,
} from "../../fhir/antimicrobialHelpers";
import {
  ANTIMICROBIAL_NOTIFICATION_TASK_CODE,
  antimicrobialApproveEntry,
  antimicrobialNotificationEntries,
  bundleMedicineCodes,
  bundlePatientIds,
} from "../../fhir/antimicrobialNotificationHelpers";
import { INJECTION_ORDER_TYPE } from "../../fhir/injectionHelpers";
import { injectionTaskStatus, injectionTasksByOrderId } from "../../fhir/injectionTaskHelpers";
import type { AntimicrobialAdministration } from "../../fhir/antimicrobialUsageHelpers";
import { observationIdsFromReport, RESULT_ITEM_SYSTEM } from "../../fhir/labResultHelpers";
import { rpEndDate } from "../../fhir/medicationScheduleHelpers";
import { parseMicroResultForm } from "../../fhir/microResultHelpers";
import { ORDER_TYPE_SYSTEM } from "../../fhir/orderHeader";
import {
  codingBySystem,
  groupByRp,
  isPrescriptionServiceRequest,
  MEDICINE_CODE_SYSTEM,
  PRESCRIPTION_ORDER_TYPE,
  YJ_CODE_SYSTEM,
} from "../../fhir/prescriptionHelpers";
import { rxTaskStatus, rxTasksByOrderId } from "../../fhir/rxTaskHelpers";
import { TASK_CODE_SYSTEM } from "../../fhir/taskHelpers";
import { addDays, localDay } from "../../lib/dates";
import { postBundle } from "../fhirClient";
import { fetchMedicineCodesByClass, lookupMedicineAttributes, searchLabResultItems } from "../masterClient";
import { NOTIFICATION_TASK_KEY, ORAL_LOOKBACK_DAYS, resourcesOfType, searchAllPages } from "./core";
import { fetchOrdersWithPerforms, type OrdersWithPerforms } from "./encounter";
import { useOrderEnterer } from "./provenance";

// 抗菌薬適正使用支援(AST)。設計は docs/antimicrobial-stewardship-design.md。

/** 注射の連続投与を遡る日数(処方は内服の重複チェックと同じ 92 日)。 */
export const INJECTION_LOOKBACK_DAYS = 30;

const EMPTY_CODES: ReadonlySet<string> = new Set();

/**
 * 抗菌薬の医薬品コードの集合(薬効分類 61・622・624)。YJ コードも薬効分類も持たない行
 * (編集・DO で開いた行、保存済みのオーダー)の判定に使う。マスタの改定でしか変わらないので長く持つ。
 */
export function useAntimicrobialMedicineCodes(enabled = true): ReadonlySet<string> {
  const { data } = useQuery({
    queryKey: ["master", "medicines", "antimicrobial-codes"],
    queryFn: async () => new Set(await fetchMedicineCodesByClass(ANTIMICROBIAL_YAKKO_PREFIXES)) as ReadonlySet<string>,
    enabled,
    staleTime: 60 * 60 * 1000,
  });
  return data ?? EMPTY_CODES;
}

function subjectId(resource: { subject?: fhir4.Reference }): string {
  return resource.subject?.reference?.match(/^Patient\/(.+)$/)?.[1] ?? "";
}

/** MedicationRequest の薬(医薬品コード・YJ コード・名前)。 */
export function medicationOfRequest(mr: fhir4.MedicationRequest): {
  medicine_code: string;
  yj_code: string | null;
  name: string;
} | null {
  const coding = mr.medicationCodeableConcept?.coding;
  const code = codingBySystem(coding, MEDICINE_CODE_SYSTEM)?.code;
  if (!code) return null;
  return {
    medicine_code: code,
    yj_code: codingBySystem(coding, YJ_CODE_SYSTEM)?.code ?? null,
    name: mr.medicationCodeableConcept?.text ?? coding?.[0]?.display ?? code,
  };
}

/** 注射のオーダー一式から、抗菌薬を施行した(する)日。中止した日は除く。 */
export function injectionAntimicrobialSpans(
  data: Pick<OrdersWithPerforms, "orders" | "medicationRequests" | "tasks">,
  antimicrobialCodes: ReadonlySet<string>,
): AntimicrobialSpan[] {
  const tasks = injectionTasksByOrderId(data.tasks);
  const spans: AntimicrobialSpan[] = [];
  for (const order of data.orders) {
    if (!order.id || injectionTaskStatus(tasks.get(order.id)) === "cancelled") continue;
    const day = (order.occurrenceDateTime ?? "").slice(0, 10);
    if (!day) continue;
    for (const mr of data.medicationRequests) {
      if (!mr.basedOn?.some((ref) => ref.reference === `ServiceRequest/${order.id}`)) continue;
      const medicine = medicationOfRequest(mr);
      if (!medicine || !isAntimicrobialMedicine(medicine, antimicrobialCodes)) continue;
      spans.push({
        patientId: subjectId(order),
        ingredient: antimicrobialIngredient(medicine),
        medicineCode: medicine.medicine_code,
        name: medicine.name,
        start: day,
        end: day,
        orderId: order.id,
      });
    }
  }
  return spans;
}

/** 処方のオーダー一式から、抗菌薬の RP の開始〜終了。中止した処方は除く。 */
export function prescriptionAntimicrobialSpans(
  orders: fhir4.ServiceRequest[],
  medicationRequests: fhir4.MedicationRequest[],
  tasks: fhir4.Task[],
  antimicrobialCodes: ReadonlySet<string>,
): AntimicrobialSpan[] {
  const tasksByOrder = rxTasksByOrderId(tasks);
  const spans: AntimicrobialSpan[] = [];
  for (const order of orders) {
    if (!order.id || rxTaskStatus(tasksByOrder.get(order.id)) === "cancelled") continue;
    const start = (order.occurrenceDateTime ?? "").slice(0, 10);
    if (!start) continue;
    const mrs = medicationRequests.filter((mr) =>
      mr.basedOn?.some((ref) => ref.reference === `ServiceRequest/${order.id}`),
    );
    for (const rp of groupByRp(mrs)) {
      const end = rpEndDate(start, rp) ?? start;
      for (const line of rp.medicines) {
        const medicine = { medicine_code: line.code, yj_code: line.yjCode ?? null, generic: line.generic };
        if (!isAntimicrobialMedicine(medicine, antimicrobialCodes)) continue;
        spans.push({
          patientId: subjectId(order),
          ingredient: antimicrobialIngredient(medicine),
          medicineCode: line.code,
          name: line.name,
          start,
          end,
          orderId: order.id,
        });
      }
    }
  }
  return spans;
}

async function fetchPatientPrescriptions(patientId: string, from: string, to: string) {
  const params = new URLSearchParams();
  params.set("patient", `Patient/${patientId}`);
  params.set("category", `${ORDER_TYPE_SYSTEM}|${PRESCRIPTION_ORDER_TYPE.code}`);
  params.append("occurrence", `ge${from}`);
  params.append("occurrence", `le${to}`);
  params.append("_revinclude", "MedicationRequest:based-on");
  params.append("_revinclude", "Task:focus");
  const { matches, bundles } = await searchAllPages<fhir4.ServiceRequest>("ServiceRequest", params, {
    page: 500,
    maxPages: 2,
  });
  const of = <T extends fhir4.Resource>(type: T["resourceType"]) =>
    bundles.flatMap((bundle) => resourcesOfType<T>(bundle, type));
  return {
    orders: matches.filter(isPrescriptionServiceRequest),
    medicationRequests: of<fhir4.MedicationRequest>("MedicationRequest"),
    tasks: of<fhir4.Task>("Task"),
  };
}

/**
 * 患者の抗菌薬の連続投与(処方 + 注射)。基準日までの投与をつなぐ。処方・注射フォームの長期投与の警告が読む。
 */
export function useAntimicrobialCourses(patientId: string | undefined, onDate: string) {
  const antimicrobialCodes = useAntimicrobialMedicineCodes(Boolean(patientId));
  const query = useQuery({
    queryKey: ["ServiceRequest", "search", "antimicrobial-courses", patientId, onDate, antimicrobialCodes.size],
    queryFn: async (): Promise<AntimicrobialCourse[]> => {
      const injectionParams = new URLSearchParams();
      injectionParams.set("patient", `Patient/${patientId}`);
      injectionParams.set("category", `${ORDER_TYPE_SYSTEM}|${INJECTION_ORDER_TYPE.code}`);
      injectionParams.set("based-on:missing", "true");
      injectionParams.append("occurrence", `ge${addDays(onDate, -INJECTION_LOOKBACK_DAYS)}`);
      injectionParams.append("occurrence", `le${onDate}`);
      const [injections, prescriptions] = await Promise.all([
        fetchOrdersWithPerforms(injectionParams),
        fetchPatientPrescriptions(patientId as string, addDays(onDate, -ORAL_LOOKBACK_DAYS), onDate),
      ]);
      return antimicrobialCourses([
        ...injectionAntimicrobialSpans(injections, antimicrobialCodes),
        ...prescriptionAntimicrobialSpans(
          prescriptions.orders,
          prescriptions.medicationRequests,
          prescriptions.tasks,
          antimicrobialCodes,
        ),
      ]);
    },
    enabled: Boolean(patientId) && Boolean(onDate),
    staleTime: 30 * 1000,
  });
  return { ...query, courses: query.data ?? [] };
}

// ---- 特定抗菌薬の届出の通知 ----

const NOTIFICATION_CODE_PARAM = `${TASK_CODE_SYSTEM}|${ANTIMICROBIAL_NOTIFICATION_TASK_CODE.code}`;

/** 患者のこれまでの届出の通知(状態を問わない)。同じ束・同じ処方に二重に作らないために引く。 */
async function fetchPatientAntimicrobialNotifications(patientIds: string[]): Promise<fhir4.Task[]> {
  if (patientIds.length === 0) return [];
  const params = new URLSearchParams();
  params.set("code", NOTIFICATION_CODE_PARAM);
  params.set("subject", patientIds.map((id) => `Patient/${id}`).join(","));
  const { matches } = await searchAllPages<fhir4.Task>("Task", params, { page: 500, maxPages: 2 });
  return matches;
}

/**
 * オーダーの登録・編集 Bundle に、特定抗菌薬の届出の通知を足す。処方・注射の薬剤が無ければ何も引かない。
 * 区分は薬剤付加情報(antimicrobial_category)で決める。
 */
export async function withAntimicrobialNotifications(bundle: fhir4.Bundle): Promise<fhir4.Bundle> {
  const codes = bundleMedicineCodes(bundle);
  if (codes.length === 0) return bundle;
  const attributes = await lookupMedicineAttributes(codes);
  if (![...attributes.values()].some((flags) => flags.antimicrobial_category && flags.antimicrobial_category !== "none")) {
    return bundle;
  }
  const existing = await fetchPatientAntimicrobialNotifications(bundlePatientIds(bundle));
  const entries = antimicrobialNotificationEntries(bundle, attributes, existing);
  return entries.length === 0 ? bundle : { ...bundle, entry: [...(bundle.entry ?? []), ...entries] };
}

// ---- 抗菌薬適正使用の一覧(/ast-worklist) ----

/** 一覧が遡る日数。抗菌薬の使用は 30 日、血液培養は 14 日。 */
export const AST_USAGE_DAYS = 30;
export const AST_BLOOD_CULTURE_DAYS = 14;

/**
 * 院内の抗菌薬の連続投与(処方 + 注射、直近 30 日)。患者 × 成分ごと。入院かどうかは画面が入院一覧で絞る。
 * 注射は院内全体で取得の上限(2000 オーダー)があり、欠けたら truncated。
 */
export function useHospitalAntimicrobialCourses(onDate: string) {
  const antimicrobialCodes = useAntimicrobialMedicineCodes();
  const query = useQuery({
    queryKey: ["ServiceRequest", "search", "ast-courses", onDate, antimicrobialCodes.size],
    queryFn: async (): Promise<{ courses: AntimicrobialCourse[]; truncated: boolean }> => {
      const from = addDays(onDate, -AST_USAGE_DAYS);
      const injectionParams = new URLSearchParams();
      injectionParams.set("category", `${ORDER_TYPE_SYSTEM}|${INJECTION_ORDER_TYPE.code}`);
      injectionParams.set("based-on:missing", "true");
      injectionParams.append("occurrence", `ge${from}`);
      injectionParams.append("occurrence", `le${onDate}`);
      const prescriptionParams = new URLSearchParams();
      prescriptionParams.set("category", `${ORDER_TYPE_SYSTEM}|${PRESCRIPTION_ORDER_TYPE.code}`);
      prescriptionParams.append("occurrence", `ge${from}`);
      prescriptionParams.append("occurrence", `le${onDate}`);
      prescriptionParams.append("_revinclude", "MedicationRequest:based-on");
      prescriptionParams.append("_revinclude", "Task:focus");
      const [injections, prescriptions] = await Promise.all([
        fetchOrdersWithPerforms(injectionParams),
        searchAllPages<fhir4.ServiceRequest>("ServiceRequest", prescriptionParams, { page: 500, maxPages: 4 }),
      ]);
      const of = <T extends fhir4.Resource>(type: T["resourceType"]) =>
        prescriptions.bundles.flatMap((bundle) => resourcesOfType<T>(bundle, type));
      const courses = antimicrobialCourses([
        ...injectionAntimicrobialSpans(injections, antimicrobialCodes),
        ...prescriptionAntimicrobialSpans(
          prescriptions.matches.filter(isPrescriptionServiceRequest),
          of<fhir4.MedicationRequest>("MedicationRequest"),
          of<fhir4.Task>("Task"),
          antimicrobialCodes,
        ),
      ]);
      return { courses, truncated: injections.truncated || prescriptions.truncated };
    },
    enabled: Boolean(onDate) && antimicrobialCodes.size > 0,
    staleTime: 60 * 1000,
  });
  return { ...query, courses: query.data?.courses ?? [], truncated: query.data?.truncated ?? false };
}

/** 血液培養で陽性になった報告 1 件。 */
export interface BloodCultureResult {
  reportId: string;
  patientId: string;
  specimenDate: string;
  reportedAt: string;
  specimenName: string;
  organisms: string[];
  final: boolean;
}

/** 採取日が直近 14 日の細菌検査のうち、血液培養(材料 401・402)で陽性(培養陽性か分離菌あり)のもの。 */
export function useRecentPositiveBloodCultures(onDate: string) {
  const query = useQuery({
    queryKey: ["DiagnosticReport", "search", "ast-blood-cultures", onDate],
    queryFn: async (): Promise<{ results: BloodCultureResult[]; truncated: boolean }> => {
      const params = new URLSearchParams();
      params.set("category", "MB");
      params.append("date", `ge${addDays(onDate, -AST_BLOOD_CULTURE_DAYS)}`);
      params.set("status:not", "entered-in-error,cancelled");
      params.append("_include", "DiagnosticReport:result");
      params.append("_include", "DiagnosticReport:specimen");
      params.set("_sort", "-date");
      const { matches, bundles, truncated } = await searchAllPages<fhir4.DiagnosticReport>("DiagnosticReport", params, {
        page: 100,
        maxPages: 10,
      });
      const observations = new Map(
        bundles.flatMap((b) => resourcesOfType<fhir4.Observation>(b, "Observation")).map((o) => [o.id ?? "", o]),
      );
      const specimens = new Map(
        bundles.flatMap((b) => resourcesOfType<fhir4.Specimen>(b, "Specimen")).map((s) => [s.id ?? "", s]),
      );
      const results: BloodCultureResult[] = [];
      for (const report of matches) {
        const reportObservations = observationIdsFromReport(report).flatMap((id) => {
          const observation = observations.get(id);
          return observation ? [observation] : [];
        });
        const reportSpecimens = (report.specimen ?? []).flatMap((ref) => {
          const specimen = specimens.get(ref.reference?.split("/").pop() ?? "");
          return specimen ? [specimen] : [];
        });
        const values = parseMicroResultForm(report, reportObservations, reportSpecimens);
        if (!BLOOD_CULTURE_SPECIMEN_CODES.includes(values.specimenTypeCode)) continue;
        const organisms = values.isolates.map((isolate) => isolate.organismName).filter(Boolean);
        if (values.culture !== "positive" && organisms.length === 0) continue;
        results.push({
          reportId: report.id ?? "",
          patientId: subjectId(report),
          specimenDate: values.specimenDate,
          reportedAt: (report.issued ?? report.effectiveDateTime ?? "").slice(0, 10),
          specimenName: values.specimenTypeName,
          organisms,
          final: report.status === "final" || report.status === "corrected" || report.status === "amended",
        });
      }
      return { results, truncated };
    },
    enabled: Boolean(onDate),
    staleTime: 60 * 1000,
  });
  return { ...query, results: query.data?.results ?? [], truncated: query.data?.truncated ?? false };
}

/** 届出の通知(状態を問わない、患者を渡したぶん)と、未対応の通知の患者。 */
export function useAntimicrobialNotifications(patientIds: string[]) {
  const ids = [...new Set(patientIds)].sort();
  return useQuery({
    queryKey: ["Task", "search", "antimicrobial-notifications", ids],
    queryFn: () => fetchPatientAntimicrobialNotifications(ids),
    enabled: ids.length > 0,
  });
}

/** 未対応(届出未提出・許可待ち)の届出の通知を院内全体で。患者は _include で付く。 */
export function useOpenAntimicrobialNotifications() {
  return useQuery({
    queryKey: [...NOTIFICATION_TASK_KEY, "antimicrobial-open"],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("code", NOTIFICATION_CODE_PARAM);
      params.set("status", "requested");
      params.set("_include", "Task:subject");
      params.set("_sort", "-authored-on");
      const { matches, bundles, truncated } = await searchAllPages<fhir4.Task>("Task", params, { page: 200, maxPages: 5 });
      const patients = new Map(
        bundles.flatMap((b) => resourcesOfType<fhir4.Patient>(b, "Patient")).map((p) => [p.id ?? "", p]),
      );
      return { tasks: matches, patients, truncated };
    },
  });
}

/** 許可制の届出を許可する(AST チームのメンバー)。 */
export function useApproveAntimicrobialNotification() {
  const queryClient = useQueryClient();
  const enterer = useOrderEnterer();
  return useMutation({
    mutationFn: async (task: fhir4.Task) => {
      if (!enterer) throw new Error("ログイン中の医療従事者が分からないため許可できません。");
      return postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: [antimicrobialApproveEntry(task, { practitionerId: enterer.practitionerId, display: enterer.display })],
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_TASK_KEY });
      queryClient.invalidateQueries({ queryKey: ["Task", "search"] });
    },
  });
}

/** TDM(血中濃度)の結果項目とみなす LOINC。バンコマイシン・テイコプラニン・アミカシン・ゲンタマイシン・トブラマイシン・アルベカシン。 */
export const TDM_LOINC_CODES = ["4092-3", "4090-7", "20578-1", "4091-5", "35669-1", "3509-7", "3510-5", "35668-3", "4059-2", "4057-6", "31012-8"];

/** 血中濃度の直近の結果(患者 id → 「項目 値 単位(日付)」の並び)。結果項目マスタに該当が無ければ items は空。 */
export function useTdmResults(patientIds: string[], onDate: string) {
  const items = useQuery({
    queryKey: ["master", "lab-result-items", "tdm"],
    queryFn: async () =>
      (await searchLabResultItems({ per: 1000 })).items.filter(
        (item) => item.loinc_code && TDM_LOINC_CODES.includes(item.loinc_code),
      ),
    staleTime: 60 * 60 * 1000,
  });
  const codes = (items.data ?? []).map((item) => item.result_item_code);
  const ids = [...new Set(patientIds)].sort();
  const results = useQuery({
    queryKey: ["Observation", "search", "ast-tdm", ids, codes, onDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("patient", ids.map((id) => `Patient/${id}`).join(","));
      params.set("code", codes.map((code) => `${RESULT_ITEM_SYSTEM}|${code}`).join(","));
      params.append("date", `ge${addDays(onDate, -AST_USAGE_DAYS)}`);
      params.set("_sort", "-date");
      const { matches } = await searchAllPages<fhir4.Observation>("Observation", params, { page: 500, maxPages: 2 });
      const byPatient = new Map<string, string[]>();
      for (const observation of matches) {
        const patientId = subjectId(observation);
        const code = codingBySystem(observation.code?.coding, RESULT_ITEM_SYSTEM)?.code;
        const item = (items.data ?? []).find((i) => i.result_item_code === code);
        const list = byPatient.get(patientId) ?? [];
        // 項目ごとに最新の 1 件(新しい順に並んでいる)。
        if (!item || list.some((text) => text.startsWith(`${item.short_name || item.name} `))) continue;
        const value = observation.valueQuantity?.value;
        list.push(
          `${item.short_name || item.name} ${value ?? "-"}${observation.valueQuantity?.unit ?? ""}(${(observation.effectiveDateTime ?? "").slice(5, 10)})`,
        );
        byPatient.set(patientId, list);
      }
      return byPatient;
    },
    enabled: ids.length > 0 && codes.length > 0,
  });
  return { hasItems: codes.length > 0, byPatient: results.data ?? new Map<string, string[]>() };
}

/**
 * 期間の注射の抗菌薬の実施(AUD・DOT の分子)。実施記録はハブの Procedure(施行日時を持つ)から
 * MedicationAdministration を辿って引く(注射の MA は effectivePeriod なので上流の effective-time に当たらない)。
 */
export function useAntimicrobialAdministrations(from: string, to: string) {
  const antimicrobialCodes = useAntimicrobialMedicineCodes();
  const query = useQuery({
    queryKey: ["Procedure", "search", "ast-administrations", from, to, antimicrobialCodes.size],
    queryFn: async (): Promise<{ administrations: AntimicrobialAdministration[]; truncated: boolean }> => {
      const params = new URLSearchParams();
      params.set("category", `${ORDER_TYPE_SYSTEM}|${INJECTION_ORDER_TYPE.code}`);
      params.set("part-of:missing", "true");
      params.set("status:not", "entered-in-error");
      params.append("date", `ge${from}`);
      params.append("date", `le${to}`);
      params.append("_revinclude", "MedicationAdministration:part-of");
      const { bundles, truncated } = await searchAllPages<fhir4.Procedure>("Procedure", params, {
        page: 200,
        maxPages: 25,
      });
      const administrations: AntimicrobialAdministration[] = [];
      for (const administration of bundles.flatMap((b) =>
        resourcesOfType<fhir4.MedicationAdministration>(b, "MedicationAdministration"),
      )) {
        if (administration.status !== "completed" && administration.status !== "stopped") continue;
        const coding = administration.medicationCodeableConcept?.coding;
        const code = codingBySystem(coding, MEDICINE_CODE_SYSTEM)?.code;
        if (!code) continue;
        const medicine = { medicine_code: code, yj_code: codingBySystem(coding, YJ_CODE_SYSTEM)?.code ?? null };
        if (!isAntimicrobialMedicine(medicine, antimicrobialCodes)) continue;
        const start = administration.effectivePeriod?.start ?? administration.effectiveDateTime;
        const day = start ? localDay(start) : "";
        if (!day || day < from || day > to) continue;
        administrations.push({
          patientId: subjectId(administration),
          day,
          medicineCode: code,
          ingredient: antimicrobialIngredient(medicine),
          name: administration.medicationCodeableConcept?.text ?? coding?.[0]?.display ?? code,
          dose: administration.dosage?.dose?.value ?? null,
          unit: administration.dosage?.dose?.unit ?? null,
        });
      }
      return { administrations, truncated };
    },
    enabled: Boolean(from) && Boolean(to) && antimicrobialCodes.size > 0,
  });
  return { ...query, administrations: query.data?.administrations ?? [], truncated: query.data?.truncated ?? false };
}
