import type { DashboardBody } from "../../fhir/dashboardLayout";
import { buildError, masterFetch } from "./core";
import type { OrderSetScope } from "./orderSet";

// ---- ダッシュボード(データ抽出の保存した条件をタイルで並べる。docs/dashboard-design.md) ----

export interface Dashboard {
  id: number;
  /** uuid。複製と環境間の移送に使う。 */
  code: string;
  scope: OrderSetScope;
  owner_id: string | null;
  owner_name: string | null;
  name: string;
  display_order: number | null;
  active: boolean;
  /** 形は fhir/dashboardLayout.ts の DashboardBody。 */
  definition: DashboardBody;
  updated_at: string;
}

export interface DashboardPayload {
  scope?: OrderSetScope;
  owner_id?: string | null;
  owner_name?: string | null;
  name?: string;
  display_order?: number | null;
  active?: boolean;
  definition?: DashboardBody;
}

const PATH = "/master/dashboards";
const JSON_HEADERS = { "Content-Type": "application/json" };

/** 院内共通 + 指定した診療科 + 指定した医師 + チームのダッシュボードを全件(definition 込み)。 */
export async function fetchDashboards(params: {
  department_id?: string;
  practitioner_id?: string;
  team_ids?: string[];
}): Promise<{ total: number; items: Dashboard[] }> {
  const search = new URLSearchParams();
  if (params.department_id) search.set("department_id", params.department_id);
  if (params.practitioner_id) search.set("practitioner_id", params.practitioner_id);
  if (params.team_ids?.length) search.set("team_id", params.team_ids.join(","));
  const res = await masterFetch(`${PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as { total: number; items: Dashboard[] };
}

export async function createDashboard(payload: DashboardPayload): Promise<Dashboard> {
  const res = await masterFetch(PATH, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(payload) });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as Dashboard;
}

export async function updateDashboard(id: number, payload: DashboardPayload): Promise<Dashboard> {
  const res = await masterFetch(`${PATH}/${id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(payload) });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as Dashboard;
}

export async function deleteDashboard(id: number): Promise<void> {
  const res = await masterFetch(`${PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}
