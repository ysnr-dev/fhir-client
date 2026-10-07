import { buildError, masterFetch } from "./core";

// ---- 患者フォルダ(患者を任意の階層の分類に仕分ける) ----

// フォルダは parent_id の隣接リストで積み、持ち主(scope / owner_id)ごとに木が独立している
// (オーダーセットと同じ形)。本人のフォルダは本人しか読めない。設計は docs/patient-folder-design.md。
export type PatientFolderScope = "facility" | "department" | "practitioner";

export interface PatientFolder {
  id: number;
  parent_id: number | null;
  scope: PatientFolderScope;
  /** 診療科 Organization.id / Practitioner.id。院内共通は null。 */
  owner_id: string | null;
  owner_name: string | null;
  name: string;
  display_order: number | null;
  /** そのフォルダ直下の患者数。 */
  member_count: number;
  updated_at: string;
}

export interface PatientFolderPayload {
  scope?: PatientFolderScope;
  owner_id?: string | null;
  owner_name?: string | null;
  parent_id?: number | null;
  name?: string;
  display_order?: number | null;
}

export interface PatientFolderMember {
  id: number;
  patient_folder_id: number;
  /** 上流の Patient.id。 */
  patient_id: string;
  note: string | null;
  added_by_id: string | null;
  added_by_name: string | null;
  created_at: string;
}

export interface PatientFolderMembersPayload {
  patient_folder_id: number;
  patient_ids: string[];
  note?: string | null;
  added_by_name?: string | null;
}

const FOLDERS_PATH = "/master/patient_folders";
const MEMBERS_PATH = "/master/patient_folder_members";

async function sendJson<T>(path: string, method: string, payload: unknown): Promise<T> {
  const res = await masterFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as T;
}

/** 院内共通 + 指定した診療科 + 本人のフォルダをフラットに全件。 */
export async function fetchPatientFolders(params: {
  department_id?: string;
  practitioner_id?: string;
}): Promise<{ total: number; items: PatientFolder[] }> {
  const search = new URLSearchParams();
  if (params.department_id) search.set("department_id", params.department_id);
  if (params.practitioner_id) search.set("practitioner_id", params.practitioner_id);
  const res = await masterFetch(`${FOLDERS_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as { total: number; items: PatientFolder[] };
}

export function createPatientFolder(payload: PatientFolderPayload): Promise<PatientFolder> {
  return sendJson(FOLDERS_PATH, "POST", payload);
}

export function updatePatientFolder(id: number, payload: PatientFolderPayload): Promise<PatientFolder> {
  return sendJson(`${FOLDERS_PATH}/${id}`, "PATCH", payload);
}

export async function deletePatientFolder(id: number): Promise<void> {
  const res = await masterFetch(`${FOLDERS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

/**
 * フォルダの中の患者(includeDescendants なら下位フォルダの分も)か、ある患者が入っている
 * 見えるフォルダの登録のどちらか。
 */
export async function fetchPatientFolderMembers(
  params:
    | { patient_folder_id: number; include_descendants?: boolean }
    | { patient_id: string; department_id?: string; practitioner_id?: string },
): Promise<{ total: number; items: PatientFolderMember[] }> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "" && value !== false) search.set(key, String(value));
  }
  const res = await masterFetch(`${MEMBERS_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as { total: number; items: PatientFolderMember[] };
}

/** 患者をまとめて入れる。すでに入っている患者は飛ばす。 */
export function addPatientFolderMembers(
  payload: PatientFolderMembersPayload,
): Promise<{ created: number; skipped: number; items: PatientFolderMember[] }> {
  return sendJson(MEMBERS_PATH, "POST", payload);
}

/** メモの書き換えと、別のフォルダへの移動。 */
export function updatePatientFolderMember(
  id: number,
  payload: { patient_folder_id?: number; note?: string | null },
): Promise<PatientFolderMember> {
  return sendJson(`${MEMBERS_PATH}/${id}`, "PATCH", payload);
}

export async function deletePatientFolderMember(id: number): Promise<void> {
  const res = await masterFetch(`${MEMBERS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}
