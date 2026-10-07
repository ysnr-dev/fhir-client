import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toKatakana } from "../../lib/kana";
import { DEFAULT_IDENTIFIER_SYSTEM, patientNumberOf } from "../../fhir/patientHelpers";
import {
  createResource,
  deleteResource,
  type FhirResult,
  readResource,
  searchResource,
  typeOperation,
  updateResource,
} from "../fhirClient";
import { hasRelation } from "./core";

export interface PatientSearchParams {
  name?: string;
  gender?: string;
  birthDateFrom?: string;
  birthDateTo?: string;
  identifier?: string;
  address?: string;
  /** 固定電話・携帯電話のどちらにも当てる。 */
  phone?: string;
}

const PATIENT_COUNT = 20;

// カナ氏名はカタカナで持つので、ひらがなで入力されたらカタカナに直した値でも探す。
// 漢字氏名にひらがなが含まれることもあるため、入力どおりの値はそのまま残して OR にする。
function patientNameSearchValue(name: string): string {
  const katakana = toKatakana(name);
  return katakana === name ? name : `${name},${katakana}`;
}

function buildSearchParams(search: PatientSearchParams, offset: number): URLSearchParams {
  const params = new URLSearchParams();
  if (search.name) params.set("name", patientNameSearchValue(search.name));
  if (search.gender) params.set("gender", search.gender);
  if (search.identifier) params.set("identifier", search.identifier);
  // 住所は区切りなしで続けて書かれ、電話番号は末尾だけで探すこともあるので部分一致にする。
  // 電話番号のハイフンの有無は上流が数字だけに揃えて比べる。
  if (search.address) params.set("address:contains", search.address);
  if (search.phone) params.set("phone:contains", search.phone);
  if (search.birthDateFrom) params.append("birthdate", `ge${search.birthDateFrom}`);
  if (search.birthDateTo) params.append("birthdate", `le${search.birthDateTo}`);
  params.set("_count", String(PATIENT_COUNT));
  params.set("_offset", String(offset));
  return params;
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

const PATIENTS_BY_ID_CHUNK = 100;

/**
 * 患者を id でまとめて引く(患者フォルダのように、患者の id だけを持つ一覧に並べるため)。
 * 見つからなかった id(削除された患者)は Map に入らない。
 */
export function usePatientsByIds(ids: string[]) {
  const sorted = [...new Set(ids)].sort();
  return useQuery({
    queryKey: ["Patient", "by-ids", sorted],
    queryFn: async () => {
      const chunks: string[][] = [];
      for (let i = 0; i < sorted.length; i += PATIENTS_BY_ID_CHUNK) {
        chunks.push(sorted.slice(i, i + PATIENTS_BY_ID_CHUNK));
      }
      const bundles = await Promise.all(
        chunks.map((chunk) => {
          const params = new URLSearchParams();
          params.set("_id", chunk.join(","));
          params.set("_count", String(chunk.length));
          return searchResource<fhir4.Patient>("Patient", params);
        }),
      );
      const byId = new Map<string, fhir4.Patient>();
      for (const { data } of bundles) {
        for (const entry of data.entry ?? []) {
          const patient = entry.resource;
          if (patient?.resourceType === "Patient" && patient.id) byId.set(patient.id, patient);
        }
      }
      return byId;
    },
    enabled: sorted.length > 0,
    placeholderData: keepPreviousData,
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
