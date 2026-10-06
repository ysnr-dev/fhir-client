import { buildError, masterFetch } from "./core";

// 薬剤付加情報(施設独自の薬剤の設定)。docs/lot-number-design.md
// 項目は backend の Master::MedicineAttribute::ATTRIBUTES が正典で、画面は definitions から列を組む。

export type MedicineAttributeValue = boolean | null;

export interface MedicineAttributeDefinition {
  key: string;
  label: string;
  /** JsonShape の葉の型。いまは boolean だけ。 */
  type: string;
}

export interface MedicineAttribute {
  /** 行が無く既定で対象になっている薬は null。 */
  id: number | null;
  medicine_code: string;
  medicine_name: string | null;
  medicine_unit_name: string | null;
  /** 行に保存した値(未設定の項目は持たない)。 */
  settings: Record<string, MedicineAttributeValue>;
  /** 既定を含む実効値。 */
  effective: Record<string, MedicineAttributeValue>;
  note: string | null;
  registered: boolean;
}

export interface MedicineAttributeList {
  definitions: MedicineAttributeDefinition[];
  items: MedicineAttribute[];
}

export interface MedicineAttributePayload {
  medicine_code?: string;
  settings?: Record<string, MedicineAttributeValue>;
  note?: string | null;
}

/** 実施入力が参照する項目の実効値。 */
export interface MedicineAttributeFlags {
  lot_required: boolean;
}

const PATH = "/master/medicine_attributes";
const JSON_HEADERS = { "Content-Type": "application/json" };
const LOOKUP_CHUNK = 100;

/** includeDefaults で、行が無くても既定で項目が真になる薬(生物学的製剤の印がある薬)も並べる。 */
export async function fetchMedicineAttributes(includeDefaults: boolean): Promise<MedicineAttributeList> {
  const res = await masterFetch(`${PATH}${includeDefaults ? "?default=true" : ""}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MedicineAttributeList;
}

export async function createMedicineAttribute(payload: MedicineAttributePayload): Promise<MedicineAttribute> {
  const res = await masterFetch(PATH, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(payload) });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MedicineAttribute;
}

export async function updateMedicineAttribute(id: number, payload: MedicineAttributePayload): Promise<MedicineAttribute> {
  const res = await masterFetch(`${PATH}/${id}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MedicineAttribute;
}

export async function deleteMedicineAttribute(id: number): Promise<void> {
  const res = await masterFetch(`${PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

/** 医薬品コード → 項目の実効値。マスタに無いコードも既定(偽)で返る。 */
export async function lookupMedicineAttributes(
  medicineCodes: string[],
): Promise<Map<string, MedicineAttributeFlags>> {
  const codes = Array.from(new Set(medicineCodes.filter(Boolean)));
  const map = new Map<string, MedicineAttributeFlags>();
  for (let i = 0; i < codes.length; i += LOOKUP_CHUNK) {
    const chunk = codes.slice(i, i + LOOKUP_CHUNK);
    const res = await masterFetch(`${PATH}/lookup?medicine_code=${encodeURIComponent(chunk.join(","))}`);
    if (!res.ok) throw await buildError(res);
    const body = (await res.json()) as Record<string, MedicineAttributeFlags>;
    for (const [code, flags] of Object.entries(body)) map.set(code, flags);
  }
  return map;
}
