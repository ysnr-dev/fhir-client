import { buildError, masterFetch, type MasterSearchResult } from "./core";

// 約束処方(院内で決めた組み合わせと量に名前を付けたもの)。構成薬はヘッダと一緒に読み書きする。

export interface PromisedPrescriptionItem {
  id: number;
  medicine_code: string;
  /** 基準量あたりの量。 */
  amount: string;
  unit_name: string | null;
  // 一覧 API が医薬品マスタから JOIN で付与する。取込で消えた薬は null。
  medicine_name: string | null;
}

export interface PromisedPrescription {
  id: number;
  code: string;
  name: string;
  name_kana: string | null;
  /** 構成薬の量が成り立つ基準の量。処方ではこの量に対する比で構成薬の量を出す。 */
  base_amount: string;
  unit_name: string;
  /** 選んだ Rp の調剤指示に「混合」を付ける。 */
  mix: boolean;
  display_order: number | null;
  valid_from: string | null;
  valid_to: string | null;
  note: string | null;
  items: PromisedPrescriptionItem[];
}

export interface PromisedPrescriptionPayload {
  code?: string;
  name?: string;
  name_kana?: string | null;
  base_amount?: string;
  unit_name?: string;
  mix?: boolean;
  display_order?: number | null;
  valid_from?: string | null;
  valid_to?: string | null;
  note?: string | null;
  /** 渡すと構成薬をこの並びに差し替える。 */
  items?: { medicine_code: string; amount: string; unit_name: string | null }[];
}

const PATH = "/master/promised_prescriptions";
const JSON_HEADERS = { "Content-Type": "application/json" };

export async function searchPromisedPrescriptions(
  params: { name?: string; active?: boolean; page?: number; per?: number } = {},
): Promise<MasterSearchResult<PromisedPrescription>> {
  const search = new URLSearchParams();
  if (params.name) search.set("name", params.name);
  if (params.active) search.set("active", "true");
  if (params.page) search.set("page", String(params.page));
  if (params.per) search.set("per", String(params.per));

  const res = await masterFetch(`${PATH}?${search.toString()}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<PromisedPrescription>;
}

export async function fetchPromisedPrescription(id: number): Promise<PromisedPrescription> {
  const res = await masterFetch(`${PATH}/${id}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as PromisedPrescription;
}

export async function createPromisedPrescription(
  payload: PromisedPrescriptionPayload,
): Promise<PromisedPrescription> {
  const res = await masterFetch(PATH, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(payload) });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as PromisedPrescription;
}

export async function updatePromisedPrescription(
  id: number,
  payload: PromisedPrescriptionPayload,
): Promise<PromisedPrescription> {
  const res = await masterFetch(`${PATH}/${id}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as PromisedPrescription;
}

export async function deletePromisedPrescription(id: number): Promise<void> {
  const res = await masterFetch(`${PATH}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}
