import { buildError, masterFetch } from "./core";

// 指導医グループ(研修医の記録・オーダーのカウンターサイン)。docs/countersign-design.md

export type SupervisorRole = "supervisor" | "trainee";

export interface SupervisorGroupMember {
  id: number;
  supervisor_group_id: number;
  /** 上流 Practitioner の id。 */
  practitioner_fhir_id: string;
  /** 保存時点の表示名(一覧は Practitioner を引き直さない)。 */
  display_name: string;
  role: SupervisorRole;
}

export interface SupervisorGroup {
  id: number;
  name: string;
  note: string | null;
  members: SupervisorGroupMember[];
}

export interface SupervisorGroupPayload {
  name?: string;
  note?: string | null;
}

export interface SupervisorGroupMemberPayload {
  supervisor_group_id?: number;
  practitioner_fhir_id?: string;
  display_name?: string;
  role?: SupervisorRole;
}

/** ログイン中の医療従事者から見た関係。研修医として仰ぐ指導医と、指導医として受け持つ研修医。 */
export interface MySupervision {
  supervisors: SupervisorGroupMember[];
  trainees: SupervisorGroupMember[];
}

const GROUPS_PATH = "/master/supervisor_groups";
const MEMBERS_PATH = "/master/supervisor_group_members";
const JSON_HEADERS = { "Content-Type": "application/json" };

export async function fetchSupervisorGroups(): Promise<SupervisorGroup[]> {
  const res = await masterFetch(GROUPS_PATH);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as SupervisorGroup[];
}

export async function createSupervisorGroup(payload: SupervisorGroupPayload): Promise<SupervisorGroup> {
  const res = await masterFetch(GROUPS_PATH, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(payload) });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as SupervisorGroup;
}

export async function updateSupervisorGroup(id: number, payload: SupervisorGroupPayload): Promise<SupervisorGroup> {
  const res = await masterFetch(`${GROUPS_PATH}/${id}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as SupervisorGroup;
}

export async function deleteSupervisorGroup(id: number): Promise<void> {
  const res = await masterFetch(`${GROUPS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

export async function createSupervisorGroupMember(
  payload: SupervisorGroupMemberPayload,
): Promise<SupervisorGroupMember> {
  const res = await masterFetch(MEMBERS_PATH, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(payload) });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as SupervisorGroupMember;
}

export async function updateSupervisorGroupMember(
  id: number,
  payload: SupervisorGroupMemberPayload,
): Promise<SupervisorGroupMember> {
  const res = await masterFetch(`${MEMBERS_PATH}/${id}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as SupervisorGroupMember;
}

export async function deleteSupervisorGroupMember(id: number): Promise<void> {
  const res = await masterFetch(`${MEMBERS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

/** セッションに医療従事者が無い経路(認証なし・ヘッダ認証)では practitionerId で本人を伝える。 */
export async function fetchMySupervision(practitionerId?: string): Promise<MySupervision> {
  const search = new URLSearchParams();
  if (practitionerId) search.set("practitioner_id", practitionerId);
  const res = await masterFetch(`${GROUPS_PATH}/mine?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MySupervision;
}
