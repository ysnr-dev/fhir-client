import { searchResource } from "../fhirClient";
import { searchAllPages } from "./core";

// データ抽出で記録を表にするタブ(テンプレート・検査結果)の共通の読み込み。患者で絞るときは
// 患者を subject= に 100 人ずつ並べて同じ検索を繰り返し、患者は _include で添える。

export const EXTRACT_RECORD_PAGE = 500;
/** 1 検索で読むページの上限(1 万件)。超えた分は読まずに truncated を立てる。 */
export const EXTRACT_RECORD_MAX_PAGES = 20;
/** subject= に 1 回で並べる患者の数(URL の長さ)。 */
const SUBJECT_CHUNK = 100;
const PATIENT_CHUNK = 100;

export interface ExtractRecordSearch<T extends fhir4.Resource> {
  matches: T[];
  patients: Map<string, fhir4.Patient>;
  /** params の _include で添った患者以外のリソース(id ごとに 1 件)。 */
  included: fhir4.Resource[];
  truncated: boolean;
}

export interface ExtractRecordPaging {
  /** 1 ページの件数。_include で添う行が多い検索は小さくする。 */
  page: number;
  maxPages: number;
}

const DEFAULT_PAGING: ExtractRecordPaging = { page: EXTRACT_RECORD_PAGE, maxPages: EXTRACT_RECORD_MAX_PAGES };

/** 記録の subject の患者 id。 */
export function subjectIdOf(resource: fhir4.Resource): string {
  const subject = (resource as { subject?: fhir4.Reference }).subject;
  return subject?.reference?.split("/").pop() ?? "";
}

/**
 * params の検索を strict で全ページ読む。patientIds を渡したらその患者の記録だけを読む
 * (0 人なら何も読まない)。同じ記録が 2 度当たったら 1 件にする。
 */
export async function searchExtractRecords<T extends fhir4.Resource>(
  type: T["resourceType"],
  params: URLSearchParams,
  patientIds: string[] | undefined,
  signal: AbortSignal,
  paging: ExtractRecordPaging = DEFAULT_PAGING,
): Promise<ExtractRecordSearch<T>> {
  const chunks: (string[] | null)[] = [];
  if (patientIds) {
    for (let i = 0; i < patientIds.length; i += SUBJECT_CHUNK) chunks.push(patientIds.slice(i, i + SUBJECT_CHUNK));
  } else {
    chunks.push(null);
  }
  const matches = new Map<string, T>();
  const patients = new Map<string, fhir4.Patient>();
  const included = new Map<string, fhir4.Resource>();
  let truncated = false;
  for (const chunk of chunks) {
    const chunkParams = new URLSearchParams(params);
    chunkParams.append("_include", `${type}:subject`);
    if (chunk) chunkParams.set("subject", chunk.map((id) => `Patient/${id}`).join(","));
    const page = await searchAllPages<T>(type, chunkParams, {
      page: paging.page,
      maxPages: paging.maxPages,
      strict: true,
      signal,
    });
    for (const match of page.matches) matches.set(match.id ?? `${matches.size}`, match);
    truncated ||= page.truncated;
    for (const bundle of page.bundles) {
      for (const entry of bundle.entry ?? []) {
        const resource = entry.resource;
        if (!resource?.id || entry.search?.mode !== "include") continue;
        if (resource.resourceType === "Patient") patients.set(resource.id, resource as fhir4.Patient);
        else included.set(`${resource.resourceType}/${resource.id}`, resource);
      }
    }
  }
  return { matches: [...matches.values()], patients, included: [...included.values()], truncated };
}

/** _include で添わなかった患者(上流が読めない患者など)を id で補う。 */
export async function fetchMissingPatients(
  ids: string[],
  patients: Map<string, fhir4.Patient>,
  signal: AbortSignal,
): Promise<void> {
  const missing = [...new Set(ids)].filter((id) => id && !patients.has(id));
  for (let i = 0; i < missing.length; i += PATIENT_CHUNK) {
    const chunk = missing.slice(i, i + PATIENT_CHUNK);
    const params = new URLSearchParams({ _id: chunk.join(","), _count: String(PATIENT_CHUNK) });
    const { data } = await searchResource<fhir4.Patient>("Patient", params, { strict: true, signal });
    for (const entry of data.entry ?? []) {
      const patient = entry.resource;
      if (patient?.resourceType === "Patient" && patient.id) patients.set(patient.id, patient);
    }
  }
}
