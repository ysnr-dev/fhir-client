import type { ExtractQueryBody } from "../../fhir/extractQueryHelpers";
import type { ExtractRecordDefinition, ExtractTab } from "../../fhir/extractRecordQuery";
import { buildError, masterFetch } from "./core";
import type { OrderSetScope } from "./orderSet";

// データ抽出の条件(docs/data-extract-design.md)。患者を持たない条件の雛形で、持ち主は
// チャート定義と同じ 3 段階。抽出の実行は画面が上流を引いて行う。条件はタブ(tab)ごとに形が違い、
// 「患者」タブは ExtractQueryBody、記録を表にするタブはタブごとの入力欄の値(ExtractRecordDefinition)。

export interface ExtractQuery {
  id: number;
  code: string;
  scope: OrderSetScope;
  owner_id: string | null;
  owner_name: string | null;
  name: string;
  display_order: number | null;
  active: boolean;
  tab: ExtractTab;
  /** 「患者」タブの形。記録を表にするタブの条件は recordDefinitionOf で読む。 */
  definition: ExtractQueryBody;
  updated_at: string;
}

export interface ExtractQueryPayload {
  scope?: OrderSetScope;
  owner_id?: string | null;
  owner_name?: string | null;
  name?: string;
  /** 作るときだけ送る(保存した後は変わらない)。 */
  tab?: ExtractTab;
  definition?: ExtractQueryBody | ExtractRecordDefinition;
}

const PATH = "/master/extract_queries";
const JSON_HEADERS = { "Content-Type": "application/json" };

/** 院内共通 + 指定した診療科 + 指定した医師の条件を全件(definition 込み)。 */
export async function fetchExtractQueries(params: {
  department_id?: string;
  practitioner_id?: string;
  tab?: ExtractTab;
}): Promise<{ total: number; items: ExtractQuery[] }> {
  const search = new URLSearchParams();
  if (params.tab) search.set("tab", params.tab);
  if (params.department_id) search.set("department_id", params.department_id);
  if (params.practitioner_id) search.set("practitioner_id", params.practitioner_id);
  const res = await masterFetch(`${PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as { total: number; items: ExtractQuery[] };
}

export async function createExtractQuery(payload: ExtractQueryPayload): Promise<ExtractQuery> {
  const res = await masterFetch(PATH, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(payload) });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as ExtractQuery;
}

export async function updateExtractQuery(id: number, payload: ExtractQueryPayload): Promise<ExtractQuery> {
  const res = await masterFetch(`${PATH}/${id}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as ExtractQuery;
}

export async function deleteExtractQuery(id: number): Promise<void> {
  const res = await masterFetch(`${PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

/** 実行の記録 1 件(定点観測の推移)。患者は持たない。 */
export interface ExtractQueryRun {
  id: number;
  extract_query_id: number;
  ran_at: string;
  patient_count: number;
  /** 条件の key → その条件だけで当たった人数。 */
  leaf_counts: Record<string, number>;
  ran_by_id: string | null;
  ran_by_name: string | null;
}

export async function fetchExtractQueryRuns(queryId: number): Promise<ExtractQueryRun[]> {
  const res = await masterFetch(`${PATH}/${queryId}/runs`);
  if (!res.ok) throw await buildError(res);
  return ((await res.json()) as { items: ExtractQueryRun[] }).items;
}

export async function createExtractQueryRun(
  queryId: number,
  payload: { patient_count: number; leaf_counts: Record<string, number>; ran_by_id?: string; ran_by_name?: string },
): Promise<ExtractQueryRun> {
  const res = await masterFetch(`${PATH}/${queryId}/runs`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as ExtractQueryRun;
}
