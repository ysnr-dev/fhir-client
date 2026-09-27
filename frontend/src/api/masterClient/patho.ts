import { buildError, masterFetch, type MasterSearchResult } from "./core";

// ---- 病理検査オーダーのマスタ ----

// 臓器・検査材料(JAHIS テーブル LPATHO003)。規約付録由来の標準コード(official)は
// seed で投入するため、画面から書けるのは施設追加分(local)と頻用臓器の印だけ。
export interface PathoOrgan {
  id: number;
  code: string;
  name: string;
  /** 対応する ICD-10 コード。 */
  icd10: string | null;
  /** オーダー画面に直接並べる頻用臓器の印。 */
  frequent: boolean;
  source: "official" | "local";
  display_order: number | null;
}

export interface PathoOrganPayload {
  code?: string;
  name?: string;
  icd10?: string | null;
  frequent?: boolean;
  display_order?: number | null;
}

// 採取法(JAHIS テーブル LPATHO004)。
export interface PathoCollectionMethod {
  id: number;
  code: string;
  name: string;
  display_order: number | null;
}

export interface PathoCollectionMethodPayload {
  code?: string;
  name?: string;
  display_order?: number | null;
}

// 患者の診療上の注意の区分。実体の注意は上流の FHIR Flag が患者ごとに持ち、
// このマスタは選択肢と患者帯のピクトグラムを決める。pictogram が null の
// 区分は患者帯に出さない。
export interface PatientCaution {
  id: number;
  code: string;
  name: string;
  /** safety / clinical / advance-directive / administrative */
  category: string;
  /** 患者帯のアイコンキー(cautionPictograms.tsx)。null なら帯に出さない。 */
  pictogram: string | null;
  display_order: number | null;
}

export interface PatientCautionPayload {
  code?: string;
  name?: string;
  category?: string;
  pictogram?: string | null;
  display_order?: number | null;
}

const PATHO_ORGANS_PATH = "/master/patho_organs";

export async function searchPathoOrgans(params: {
  name?: string;
  frequent?: boolean;
  source?: string;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<PathoOrgan>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.frequent) search.set("frequent", "true");
  if (params.source) search.set("source", params.source);
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`${PATHO_ORGANS_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<PathoOrgan>;
}

export async function createPathoOrgan(payload: PathoOrganPayload): Promise<PathoOrgan> {
  const res = await masterFetch(PATHO_ORGANS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as PathoOrgan;
}

export async function updatePathoOrgan(
  id: number,
  payload: PathoOrganPayload,
): Promise<PathoOrgan> {
  const res = await masterFetch(`${PATHO_ORGANS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as PathoOrgan;
}

export async function deletePathoOrgan(id: number): Promise<void> {
  const res = await masterFetch(`${PATHO_ORGANS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

const PATHO_COLLECTION_METHODS_PATH = "/master/patho_collection_methods";

export async function fetchPathoCollectionMethods(): Promise<
  MasterSearchResult<PathoCollectionMethod>
> {
  const res = await masterFetch(`${PATHO_COLLECTION_METHODS_PATH}?per=100`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<PathoCollectionMethod>;
}

export async function createPathoCollectionMethod(
  payload: PathoCollectionMethodPayload,
): Promise<PathoCollectionMethod> {
  const res = await masterFetch(PATHO_COLLECTION_METHODS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as PathoCollectionMethod;
}

export async function updatePathoCollectionMethod(
  id: number,
  payload: PathoCollectionMethodPayload,
): Promise<PathoCollectionMethod> {
  const res = await masterFetch(`${PATHO_COLLECTION_METHODS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as PathoCollectionMethod;
}

export async function deletePathoCollectionMethod(id: number): Promise<void> {
  const res = await masterFetch(`${PATHO_COLLECTION_METHODS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

const PATIENT_CAUTIONS_PATH = "/master/patient_cautions";

export async function fetchPatientCautions(): Promise<MasterSearchResult<PatientCaution>> {
  const res = await masterFetch(`${PATIENT_CAUTIONS_PATH}?per=100`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<PatientCaution>;
}

export async function createPatientCaution(payload: PatientCautionPayload): Promise<PatientCaution> {
  const res = await masterFetch(PATIENT_CAUTIONS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as PatientCaution;
}

export async function updatePatientCaution(
  id: number,
  payload: PatientCautionPayload,
): Promise<PatientCaution> {
  const res = await masterFetch(`${PATIENT_CAUTIONS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as PatientCaution;
}

export async function deletePatientCaution(id: number): Promise<void> {
  const res = await masterFetch(`${PATIENT_CAUTIONS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}
