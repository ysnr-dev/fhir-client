import type { ShiftCode } from "../../fhir/nursingScheduleHelpers";
import { buildError, masterFetch } from "./core";

// ---- 看護の業務分担 ----

// 病棟・日・勤務帯ごとに、患者 1 人を受け持つ看護師 1 人(backend の nursing_assignments)。
export interface NursingAssignment {
  id: number;
  ward_id: string;
  assigned_on: string;
  shift: ShiftCode;
  patient_id: string;
  practitioner_id: string;
  practitioner_name: string | null;
  assigned_by_id: string | null;
  assigned_by_name: string | null;
  updated_at: string;
}

export interface NursingAssignmentItem {
  shift: ShiftCode;
  patient_id: string;
  practitioner_id: string;
  practitioner_name?: string;
}

const NURSING_ASSIGNMENTS_PATH = "/master/nursing_assignments";

/** その日の割り付け。病棟(全勤務帯)か看護師(病棟をまたぐ)のどちらかで引く。 */
export async function searchNursingAssignments(params: {
  assigned_on: string;
  ward_id?: string;
  practitioner_id?: string;
}): Promise<NursingAssignment[]> {
  const search = new URLSearchParams();
  search.set("assigned_on", params.assigned_on);
  if (params.ward_id) search.set("ward_id", params.ward_id);
  if (params.practitioner_id) search.set("practitioner_id", params.practitioner_id);

  const res = await masterFetch(`${NURSING_ASSIGNMENTS_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return ((await res.json()) as { items: NursingAssignment[] }).items;
}

/** 病棟 × 日の指定した勤務帯を items でまるごと置き換える。 */
export async function replaceNursingAssignments(payload: {
  ward_id: string;
  assigned_on: string;
  shifts: ShiftCode[];
  items: NursingAssignmentItem[];
  assigned_by_name?: string;
}): Promise<NursingAssignment[]> {
  const res = await masterFetch(`${NURSING_ASSIGNMENTS_PATH}/replace`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return ((await res.json()) as { items: NursingAssignment[] }).items;
}
