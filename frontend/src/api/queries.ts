import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  buildLabResultDeleteBundle,
  observationIdsFromReport,
} from "../fhir/labResultHelpers";
import {
  buildPrescriptionDeleteBundle,
  splitPrescriptionDetailBundle,
} from "../fhir/prescriptionHelpers";
import {
  createResource,
  deleteResource,
  postBundle,
  readResource,
  searchResource,
  updateResource,
  type FhirResult,
} from "./fhirClient";

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
  params.set("_include", "DiagnosticReport:result");

  return useQuery({
    queryKey: ["DiagnosticReport", "detail", reportId],
    queryFn: () => searchResource<fhir4.Resource>("DiagnosticReport", params),
    enabled: Boolean(reportId),
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
      // 削除対象の Observation は DiagnosticReport.result の参照から辿る。
      const { data: report } = await readResource<fhir4.DiagnosticReport>(
        "DiagnosticReport",
        reportId,
      );
      return postBundle(buildLabResultDeleteBundle(reportId, observationIdsFromReport(report)));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["DiagnosticReport", "search"] });
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
