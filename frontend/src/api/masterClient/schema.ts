import { buildError, masterFetch, type MasterSearchResult } from "./core";

// ---- シェーマ(診療記録に描き込む台紙画像) ----

// カテゴリは parent_id の隣接リストで任意の深さの階層を持つ。
// ツリーの組み立てはフロント側(schemaCategoryTree.ts)で行う。
export interface SchemaCategory {
  id: number;
  name: string;
  parent_id: number | null;
  display_order: number | null;
}

export interface SchemaCategoryPayload {
  name?: string;
  parent_id?: number | null;
  display_order?: number | null;
}

// 一覧は image(台紙本体の dataURL)を含まない。選択グリッドは thumbnail で描き、
// 台紙本体はペイントを開くときに fetchSchema で単発取得する。
export interface SchemaSummary {
  id: number;
  name: string;
  category_id: number | null;
  thumbnail: string;
  display_order: number | null;
  note: string | null;
}

export interface SchemaDetail extends SchemaSummary {
  image: string;
}

export interface SchemaPayload {
  name?: string;
  category_id?: number | null;
  image?: string;
  thumbnail?: string;
  display_order?: number | null;
  note?: string | null;
}

const SCHEMA_CATEGORIES_PATH = "/master/schema_categories";

export async function fetchSchemaCategories(): Promise<{ total: number; items: SchemaCategory[] }> {
  const res = await masterFetch(SCHEMA_CATEGORIES_PATH);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as { total: number; items: SchemaCategory[] };
}

export async function createSchemaCategory(payload: SchemaCategoryPayload): Promise<SchemaCategory> {
  const res = await masterFetch(SCHEMA_CATEGORIES_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as SchemaCategory;
}

export async function updateSchemaCategory(
  id: number,
  payload: SchemaCategoryPayload,
): Promise<SchemaCategory> {
  const res = await masterFetch(`${SCHEMA_CATEGORIES_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as SchemaCategory;
}

export async function deleteSchemaCategory(id: number): Promise<void> {
  const res = await masterFetch(`${SCHEMA_CATEGORIES_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

const SCHEMAS_PATH = "/master/schemas";

export async function searchSchemas(params: {
  /** null は未分類(カテゴリなし)での絞り込み。undefined は全件。 */
  category_id?: number | null;
  name?: string;
  page?: number;
  per?: number;
}): Promise<MasterSearchResult<SchemaSummary>> {
  const search = new URLSearchParams();
  if (params.category_id !== undefined) {
    search.set("category_id", params.category_id === null ? "" : String(params.category_id));
  }
  if (params.name) search.set("name", params.name);
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`${SCHEMAS_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<SchemaSummary>;
}

export async function fetchSchema(id: number): Promise<SchemaDetail> {
  const res = await masterFetch(`${SCHEMAS_PATH}/${id}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as SchemaDetail;
}

export async function createSchema(payload: SchemaPayload): Promise<SchemaDetail> {
  const res = await masterFetch(SCHEMAS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as SchemaDetail;
}

export async function updateSchema(id: number, payload: SchemaPayload): Promise<SchemaDetail> {
  const res = await masterFetch(`${SCHEMAS_PATH}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as SchemaDetail;
}

export async function deleteSchema(id: number): Promise<void> {
  const res = await masterFetch(`${SCHEMAS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}
