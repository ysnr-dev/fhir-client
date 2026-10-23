import type { ClinicalDashboardBody } from "../../fhir/clinicalDashboardLayout";
import { buildError, masterFetch } from "./core";
import type { OrderSetScope } from "./orderSet";

// ---- 診療ダッシュボード(カルテ左ペインのタブをカードとして並べる。docs/clinical-dashboard-design.md) ----

export interface ClinicalDashboard {
  id: number;
  /** uuid。複製と環境間の移送に使う。 */
  code: string;
  /** 院内共通 / 診療科 / 医師(チームは持たない)。 */
  scope: OrderSetScope;
  owner_id: string | null;
  owner_name: string | null;
  name: string;
  display_order: number | null;
  active: boolean;
  /** 形は fhir/clinicalDashboardLayout.ts の ClinicalDashboardBody。 */
  definition: ClinicalDashboardBody;
  updated_at: string;
}

export interface ClinicalDashboardPayload {
  scope?: OrderSetScope;
  owner_id?: string | null;
  owner_name?: string | null;
  name?: string;
  display_order?: number | null;
  active?: boolean;
  definition?: ClinicalDashboardBody;
}

const PATH = "/master/clinical_dashboards";
const JSON_HEADERS = { "Content-Type": "application/json" };

/** 院内共通 + 指定した診療科 + 指定した医師の診療ダッシュボードを全件(definition 込み)。 */
export async function fetchClinicalDashboards(params: {
  department_id?: string;
  practitioner_id?: string;
}): Promise<{ total: number; items: ClinicalDashboard[] }> {
  const search = new URLSearchParams();
  if (params.department_id) search.set("department_id", params.department_id);
  if (params.practitioner_id) search.set("practitioner_id", params.practitioner_id);
  const res = await masterFetch(`${PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as { total: number; items: ClinicalDashboard[] };
}

export async function createClinicalDashboard(payload: ClinicalDashboardPayload): Promise<ClinicalDashboard> {
  const res = await masterFetch(PATH, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(payload) });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as ClinicalDashboard;
}

export async function updateClinicalDashboard(id: number, payload: ClinicalDashboardPayload): Promise<ClinicalDashboard> {
  const res = await masterFetch(`${PATH}/${id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(payload) });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as ClinicalDashboard;
}

export async function deleteClinicalDashboard(id: number): Promise<void> {
  const res = await masterFetch(`${PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}
