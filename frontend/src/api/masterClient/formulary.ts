import { buildError, masterFetch } from "./core";

// 院内フォーミュラリ(薬効群と推奨順位)。docs/formulary-design.md

export interface FormularyEntry {
  id: number;
  formulary_group_id: number;
  medicine_code: string;
  // 推奨順位。1 が第一選択。
  rank: number;
  // 推奨理由・使い分け。
  note: string | null;
  // 以下は一覧APIが医薬品マスタから JOIN で付与する。取込で消えた薬は null。
  medicine_name: string | null;
  medicine_unit_name: string | null;
  medicine_dosage_form: string | null;
  generic_name: string | null;
  yakko_code: string | null;
  yakko_name: string | null;
  yj_code: string | null;
}

export interface FormularyGroup {
  id: number;
  code: string;
  name: string;
  // この群が受け持つ薬効分類番号(YJ 上 4 桁)。マスタ画面で群の範囲を示す。
  yakko_codes: string[];
  dosage_form: string | null;
  display_order: number | null;
  note: string | null;
  entries: FormularyEntry[];
}

export interface FormularyGroupPayload {
  code?: string;
  name?: string;
  yakko_codes?: string[];
  dosage_form?: string | null;
  display_order?: number | null;
  note?: string | null;
}

export interface FormularyEntryPayload {
  formulary_group_id?: number;
  medicine_code?: string;
  rank?: number;
  note?: string | null;
}

const GROUPS_PATH = "/master/formulary_groups";
const ENTRIES_PATH = "/master/formulary_entries";

const JSON_HEADERS = { "Content-Type": "application/json" };

export async function fetchFormularyGroups(params: {
  dosage_form?: string;
  name?: string;
} = {}): Promise<FormularyGroup[]> {
  const search = new URLSearchParams();
  if (params.dosage_form) search.set("dosage_form", params.dosage_form);
  if (params.name) search.set("name", params.name);

  const res = await masterFetch(`${GROUPS_PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as FormularyGroup[];
}

export async function createFormularyGroup(payload: FormularyGroupPayload): Promise<FormularyGroup> {
  const res = await masterFetch(GROUPS_PATH, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as FormularyGroup;
}

export async function updateFormularyGroup(
  id: number,
  payload: FormularyGroupPayload,
): Promise<FormularyGroup> {
  const res = await masterFetch(`${GROUPS_PATH}/${id}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as FormularyGroup;
}

export async function deleteFormularyGroup(id: number): Promise<void> {
  const res = await masterFetch(`${GROUPS_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

export async function createFormularyEntry(payload: FormularyEntryPayload): Promise<FormularyEntry> {
  const res = await masterFetch(ENTRIES_PATH, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as FormularyEntry;
}

export async function updateFormularyEntry(
  id: number,
  payload: FormularyEntryPayload,
): Promise<FormularyEntry> {
  const res = await masterFetch(`${ENTRIES_PATH}/${id}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as FormularyEntry;
}

export async function deleteFormularyEntry(id: number): Promise<void> {
  const res = await masterFetch(`${ENTRIES_PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

/** ids の並び順で順位を 1 から振り直す。 */
export async function reorderFormularyEntries(ids: number[]): Promise<void> {
  const res = await masterFetch(`${ENTRIES_PATH}/reorder`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw await buildError(res);
}
