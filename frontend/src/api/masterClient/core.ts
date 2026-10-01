import { notifyUnauthorized, withCsrfHeaders } from "../session";

export type MasterType =
  | "hot_codes"
  | "medicines"
  | "medicine_usages"
  | "jlac_items"
  | "diseases"
  | "modifiers"
  | "disease_indexes"
  | "jfagy_allergens"
  | "jfagy_drugs"
  | "lab_specimens"
  | "rad_jj1017_codes"
  | "rad_frequent_codes"
  | "medical_materials"
  | "medical_procedures"
  | "comments"
  | "comment_relations"
  | "micro_specimen_types"
  | "micro_organisms"
  | "micro_antimicrobials"
  | "micro_susceptibility_methods"
  | "nursing_acts"
  | "nursing_observations"
  | "nursing_observation_results"
  | "nursing_units"
  | "postal_codes"
  | "ctcae_terms"
  | "dpc_icd_codes";

export interface MasterImportResult {
  imported: number;
  /** 取り込めなかった行数。配布ファイルの欠番・桁不足・重複を数えるマスタだけが返す。 */
  skipped?: number;
  /** JJ1017 部品コード: 取り込んだ要素ごとの件数。 */
  elements?: Record<string, number>;
  /** JJ1017 頻用コード: 取り込んだ区分ごとの件数。 */
  categories?: Record<string, number>;
  /** JANIS 病原体コード: 実際に読んだ版シート名(最新版だけを読むため)。 */
  sheet?: string;
}

export interface MasterSearchResult<T> {
  total: number;
  page: number;
  per: number;
  items: T[];
}

// ログインセッションは same-origin fetch に自動で載る。非 GET への CSRF
// トークン付与と 401(セッション失効)の通知だけを行う(fhirClient と同じ)。
export async function masterFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const res = await fetch(url, { ...init, headers: withCsrfHeaders(method, init.headers) });
  if (res.status === 401) notifyUnauthorized();
  return res;
}

export class MasterApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "MasterApiError";
    this.status = status;
  }
}

export async function buildError(res: Response): Promise<MasterApiError> {
  let message = `サーバーエラーが発生しました (HTTP ${res.status})`;
  try {
    const body = (await res.json()) as { error?: string; errors?: string[] };
    if (body.error) message = body.error;
    else if (body.errors?.length) message = body.errors.join(" / ");
  } catch {
    // 非JSONレスポンスはデフォルトメッセージのまま
  }
  return new MasterApiError(message, res.status);
}
