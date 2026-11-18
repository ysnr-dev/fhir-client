import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { parsePatientFile, type PatientFile } from "../../fhir/patientFileHelpers";
import {
  buildReferralBundle,
  buildReferralReplyBundle,
  buildReferralReplyUndoBundle,
  buildReferralStatusBundle,
  buildReferralUpdateBundle,
  buildReferralVisitBundle,
  REFERRAL_DIRECTION_SYSTEM,
  REFERRAL_ORDER_TYPE_TOKEN,
  referralRowOf,
  type ReferralDirection,
  type ReferralFormValues,
  type ReferralReplyInput,
  type ReferralRow,
} from "../../fhir/referralHelpers";
import { referenceId, resourcesOfType } from "../../fhir/shared";
import { postBundle, searchResource } from "../fhirClient";
import { searchAllPages, WORKLIST_PAGE } from "./core";
import { useOrderEnterer } from "./provenance";

// 地域連携の紹介台帳(docs/referral-design.md)。

const REFERRAL_KEY = ["ServiceRequest", "search", "referral"];

/** 一覧は並べて見せるだけなので、上限で欠けたら知らせる。 */
const REFERRAL_LIST_MAX_PAGES = 2;
/** 集計は合計を出すので全件が要る。 */
const REFERRAL_STATS_MAX_PAGES = 10;

export type ReferralStatusFilter = "active" | "completed" | "revoked" | "";

export interface ReferralSearch {
  direction: ReferralDirection;
  /** 紹介日の範囲。 */
  from: string;
  to: string;
  status: ReferralStatusFilter;
  partnerOrganizationId: string;
  departmentId: string;
}

function directionToken(direction: ReferralDirection): string {
  return `${REFERRAL_DIRECTION_SYSTEM}|${direction}`;
}

function referralParams(search: ReferralSearch): URLSearchParams {
  const params = new URLSearchParams();
  // category を 2 回渡すと AND になる(種別 = 紹介、かつ向き)。
  params.append("category", REFERRAL_ORDER_TYPE_TOKEN);
  params.append("category", directionToken(search.direction));
  if (search.from) params.append("authoredon", `ge${search.from}`);
  if (search.to) params.append("authoredon", `le${search.to}`);
  if (search.status) params.set("status", search.status);
  if (search.partnerOrganizationId) {
    params.set(
      search.direction === "inbound" ? "requester" : "performer",
      `Organization/${search.partnerOrganizationId}`,
    );
  }
  if (search.departmentId) params.set("department", `Organization/${search.departmentId}`);
  return params;
}

function rowsOf(matches: fhir4.ServiceRequest[], bundles: fhir4.Bundle[]): ReferralRow[] {
  const patients = new Map<string, fhir4.Patient>();
  for (const bundle of bundles) {
    for (const patient of resourcesOfType<fhir4.Patient>(bundle, "Patient")) {
      if (patient.id) patients.set(patient.id, patient);
    }
  }
  return matches.map((sr) => referralRowOf(sr, patients.get(referenceId(sr.subject?.reference) ?? "")));
}

/** 紹介の一覧(紹介日の新しい順)。 */
export function useReferralRows(search: ReferralSearch) {
  return useQuery({
    queryKey: [...REFERRAL_KEY, "list", search],
    queryFn: async () => {
      const params = referralParams(search);
      params.set("_include", "ServiceRequest:subject");
      params.set("_sort", "-authoredon");
      const result = await searchAllPages<fhir4.ServiceRequest>("ServiceRequest", params, {
        page: WORKLIST_PAGE,
        maxPages: REFERRAL_LIST_MAX_PAGES,
        strict: true,
      });
      return { rows: rowsOf(result.matches, result.bundles), truncated: result.truncated };
    },
  });
}

/** 期間内の紹介受と紹介の全件(集計用)。 */
export function useReferralStatsRows(from: string, to: string, departmentId: string) {
  return useQuery({
    queryKey: [...REFERRAL_KEY, "stats", from, to, departmentId],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("category", REFERRAL_ORDER_TYPE_TOKEN);
      params.append("authoredon", `ge${from}`);
      params.append("authoredon", `le${to}`);
      params.set("status:not", "revoked");
      if (departmentId) params.set("department", `Organization/${departmentId}`);
      params.set("_elements", "status,category,subject,authoredOn,requester,performer,extension");
      const result = await searchAllPages<fhir4.ServiceRequest>("ServiceRequest", params, {
        page: WORKLIST_PAGE,
        maxPages: REFERRAL_STATS_MAX_PAGES,
        complete: true,
        strict: true,
      });
      return result.matches.map((sr) => referralRowOf(sr));
    },
    enabled: Boolean(from && to),
  });
}

/** 患者の紹介(紹介受・紹介とも、紹介日の新しい順)。 */
export function usePatientReferrals(patientId: string | undefined) {
  return useQuery({
    queryKey: [...REFERRAL_KEY, "patient", patientId],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      params.set("category", REFERRAL_ORDER_TYPE_TOKEN);
      params.set("_sort", "-authoredon");
      const result = await searchAllPages<fhir4.ServiceRequest>("ServiceRequest", params, {
        page: WORKLIST_PAGE,
        maxPages: 1,
        strict: true,
      });
      return { rows: result.matches.map((sr) => referralRowOf(sr)), truncated: result.truncated };
    },
    enabled: Boolean(patientId),
  });
}

const DOCUMENT_CANDIDATE_COUNT = 50;

/** 紹介状・提供書・返書として結び付ける候補(患者のファイルの新しい順)。 */
export function useReferralDocumentCandidates(patientId: string | undefined) {
  return useQuery({
    queryKey: ["DocumentReference", "search", "referral-candidates", patientId],
    queryFn: async (): Promise<PatientFile[]> => {
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      params.set("_sort", "-date");
      params.set("_count", String(DOCUMENT_CANDIDATE_COUNT));
      const { data } = await searchResource<fhir4.DocumentReference>("DocumentReference", params);
      return resourcesOfType<fhir4.DocumentReference>(data, "DocumentReference").map(parsePatientFile);
    },
    enabled: Boolean(patientId),
  });
}

function useReferralMutation<T>(build: (input: T) => fhir4.Bundle) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: T) => postBundle(build(input)),
    retry: false,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: REFERRAL_KEY }),
  });
}

export function useSaveReferral() {
  return useReferralMutation(
    ({ values, patientId, existing }: { values: ReferralFormValues; patientId: string; existing?: fhir4.ServiceRequest }) =>
      existing ? buildReferralUpdateBundle(values, patientId, existing) : buildReferralBundle(values, patientId),
  );
}

export function useRecordReferralVisit() {
  return useReferralMutation(({ row, visitDate }: { row: ReferralRow; visitDate: string }) =>
    buildReferralVisitBundle(row.serviceRequest, visitDate),
  );
}

export function useRecordReferralReply() {
  const enterer = useOrderEnterer();
  return useReferralMutation(({ row, input }: { row: ReferralRow; input: ReferralReplyInput }) =>
    buildReferralReplyBundle(row.serviceRequest, input, enterer),
  );
}

export function useUndoReferralReply() {
  return useReferralMutation((row: ReferralRow) => buildReferralReplyUndoBundle(row.serviceRequest));
}

export function useChangeReferralStatus() {
  return useReferralMutation(({ row, status }: { row: ReferralRow; status: "active" | "revoked" | "completed" }) =>
    buildReferralStatusBundle(row.serviceRequest, status),
  );
}
