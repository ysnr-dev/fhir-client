import { buildError, masterFetch, type MasterSearchResult } from "./core";

// ---- 放射線治療の施設固有マスタ ----
//
// 保有する装置・実施できる照射技法・定型の線量分割は施設ごとに違うので、治療処方の
// 選択肢はマスタで持つ(docs/radiotherapy-order-design.md §3)。5 つとも同じ形の
// 単純編集型なので、CRUD は 1 つの組み立て関数から作る。

interface RadiotherapyMasterBase {
  id: number;
  code: string;
  name: string;
  enabled: boolean;
  display_order: number | null;
}

export interface RadiotherapyModality extends RadiotherapyMasterBase {
  /** 線量の単位。体外照射・小線源は Gy。 */
  dose_unit: string;
  /** 標準コードとの対応(参考。mCODE の値セットは SNOMED CT)。オーダーには焼かない。 */
  reference_system: string | null;
  reference_code: string | null;
  note: string | null;
}

export interface RadiotherapyTechnique extends RadiotherapyMasterBase {
  abbreviation: string | null;
  /** この技法を選べるモダリティのコード。空ならどのモダリティでも選べる。 */
  modality_codes: string[];
  reference_system: string | null;
  reference_code: string | null;
  /** 医事会計へ送る体外照射のレセプト電算コード(同じ日の 1 回目 / 2 回目)と放射線治療管理料。 */
  receipt_code: string | null;
  receipt_code_second: string | null;
  management_receipt_code: string | null;
  note: string | null;
}

export interface RadiotherapyDevice extends RadiotherapyMasterBase {
  /** linac / tomotherapy / stereotactic / particle / brachytherapy / other */
  device_type: string;
  modality_codes: string[];
  note: string | null;
}

export interface RadiotherapyStopReason extends RadiotherapyMasterBase {
  /** suspend = 休止 / terminate = 中止 / both = どちらにも出す */
  kind: string;
}

/** 治療プロトコルの標的。key は Phase の線量行が指す、プロトコル内の識別子。 */
export interface RadiotherapyProtocolVolume {
  key: string;
  label: string;
  volume_type?: string | null;
  body_part_code?: string | null;
  body_part_name?: string | null;
  laterality_code?: string | null;
  laterality_name?: string | null;
}

export interface RadiotherapyProtocolPhase {
  label?: string | null;
  modality_code?: string | null;
  technique_code?: string | null;
  device_code?: string | null;
  fractions: number;
  fractions_per_week?: number | null;
  doses: { volume_key: string; fraction_dose: number }[];
}

/** 治療プロトコル(定型処方)。処方フォームで選ぶと標的と Phase が展開される。 */
export interface RadiotherapyProtocol extends RadiotherapyMasterBase {
  name_kana: string | null;
  intent: string | null;
  volumes: RadiotherapyProtocolVolume[];
  phases: RadiotherapyProtocolPhase[];
  note: string | null;
}

export interface RadiotherapyMasterSearchParams {
  name?: string;
  /** コード。カンマ区切りで複数指定できる。 */
  code?: string;
  enabled?: boolean;
  /** 休止・中止理由だけ。terminate なら中止に出す理由(both を含む)。 */
  kind?: string;
  page?: number;
  per?: number;
}

function radiotherapyMasterClient<T extends RadiotherapyMasterBase>(path: string) {
  type Payload = Partial<Omit<T, "id">>;

  async function send(url: string, method: string, payload: Payload): Promise<T> {
    const res = await masterFetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw await buildError(res);
    return (await res.json()) as T;
  }

  return {
    async search(params: RadiotherapyMasterSearchParams): Promise<MasterSearchResult<T>> {
      const search = new URLSearchParams();
      if (params.name) search.set("name", params.name);
      if (params.code) search.set("code", params.code);
      if (params.enabled) search.set("enabled", "true");
      if (params.kind) search.set("kind", params.kind);
      if (params.page) search.set("page", String(params.page));
      if (params.per) search.set("per", String(params.per));

      const res = await masterFetch(`${path}?${search.toString()}`);
      if (!res.ok) throw await buildError(res);
      return (await res.json()) as MasterSearchResult<T>;
    },
    create: (payload: Payload) => send(path, "POST", payload),
    update: (id: number, payload: Payload) => send(`${path}/${id}`, "PATCH", payload),
    async remove(id: number): Promise<void> {
      const res = await masterFetch(`${path}/${id}`, { method: "DELETE" });
      if (!res.ok) throw await buildError(res);
    },
  };
}

export const radiotherapyModalityClient = radiotherapyMasterClient<RadiotherapyModality>(
  "/master/radiotherapy_modalities",
);
export const radiotherapyTechniqueClient = radiotherapyMasterClient<RadiotherapyTechnique>(
  "/master/radiotherapy_techniques",
);
export const radiotherapyDeviceClient = radiotherapyMasterClient<RadiotherapyDevice>(
  "/master/radiotherapy_devices",
);
export const radiotherapyStopReasonClient = radiotherapyMasterClient<RadiotherapyStopReason>(
  "/master/radiotherapy_stop_reasons",
);
export const radiotherapyProtocolClient = radiotherapyMasterClient<RadiotherapyProtocol>(
  "/master/radiotherapy_protocols",
);
