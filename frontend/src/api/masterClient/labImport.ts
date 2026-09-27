import { buildError, masterFetch, type MasterSearchResult } from "./core";

// ---- 検体検査結果の取込(JAHIS 臨床検査データ交換規約 / HL7 v2.5) ----
//
// backend は取込の台帳まで(ファイルの解析・JLAC での引き当て・行の状態)。
// 上流 FHIR への登録は取込画面が既存の結果登録経路で行う
// (docs/lab-result-import-design.md §2)。

/** 行の状態。pending は人の手が要る、ready は登録待ち。 */
export type LabResultImportRowStatus = "pending" | "ready" | "skipped" | "registered";

/** どの手掛かりで結果項目に当たったか。manual は人が選んだもの。 */
export type LabResultImportResolution =
  | "jlac10"
  | "jlac11"
  | "jlac10_prefix"
  | "jlac11_prefix"
  | "manual";

/** 保留の理由。item_ambiguous は前方一致で複数当たった状態。 */
export type LabResultImportPendingReason =
  | "item_unresolved"
  | "item_ambiguous"
  | "value_unmatched"
  | "value_not_numeric";

export interface LabResultImport {
  id: number;
  /** 取込元(MSH-4、空なら MSH-3)。 */
  source: string | null;
  format: string;
  /** "ORU^R01" / "OUL^R22"。 */
  message_type: string | null;
  /** 実際に使った文字コードと、その判定根拠。ずれたときに原因を追うために出す。 */
  encoding: string | null;
  encoding_reason: string | null;
  file_name: string | null;
  message_control_id: string | null;
  message_datetime: string | null;
  imported_by_login_id: string | null;
  imported_by_practitioner_id: string | null;
  row_count: number;
  /** OBX-11 が X(結果なし)・D(削除)で読み飛ばした数。 */
  skipped_count: number;
  note: string | null;
  created_at: string;
  status_counts: Partial<Record<LabResultImportRowStatus, number>>;
}

export interface LabResultImportRow {
  id: number;
  lab_result_import_id: number;
  /** 候補のまとまり(ORC/OBR 群)。1 群 = 上流の DiagnosticReport 1 件。 */
  group_no: number;
  sequence: number;
  patient_number: string | null;
  patient_name: string | null;
  patient_birth_date: string | null;
  patient_sex: string | null;
  setting: string | null;
  placer_order_number: string | null;
  filler_order_number: string | null;
  specimen_ids: string[];
  /** 検体ラベル番号(11 桁 + チェックデジット)。オーダー特定の第一候補。 */
  label_number: string | null;
  specimen_material_code: string | null;
  specimen_material_name: string | null;
  collected_at: string | null;
  reported_at: string | null;
  /** OBR-25(F 最終 / P 中間 / C 訂正)。 */
  report_status: string | null;
  report_comment: string | null;
  external_code: string | null;
  external_name: string | null;
  external_code_system: string | null;
  jlac10_code: string | null;
  jlac11_code: string | null;
  value_type: string | null;
  value: string | null;
  value_text: string | null;
  value_code_system: string | null;
  unit: string | null;
  /** ファイル側の基準範囲(OBX-7)。参考表示だけで保存しない。 */
  reference_range: string | null;
  /** ファイル側の異常フラグ(OBX-8)。施設の基準値が無いときだけ使う。 */
  abnormal_flag: string | null;
  observation_status: string | null;
  observed_at: string | null;
  note: string | null;
  result_item_code: string | null;
  resolution: LabResultImportResolution | null;
  status: LabResultImportRowStatus;
  pending_reason: LabResultImportPendingReason | null;
  candidate_item_codes: string[];
  patient_fhir_id: string | null;
  order_fhir_id: string | null;
  report_fhir_id: string | null;
  registered_at: string | null;
  registered_by_practitioner_id: string | null;
}

export interface LabResultImportDetail extends LabResultImport {
  rows: LabResultImportRow[];
  /** 同じメッセージ ID の他のバッチ。訂正版が同じ ID で来ることがある。 */
  duplicate_ids: number[];
}

export interface LabResultImportCreated {
  import: LabResultImport;
  /** 同じメッセージ ID の既存バッチ。取込は止めず画面で知らせるだけ。 */
  duplicate_ids: number[];
}

export interface LabResultImportRowPayload {
  result_item_code?: string;
  status?: LabResultImportRowStatus;
  value?: string;
  patient_fhir_id?: string;
  order_fhir_id?: string;
  report_fhir_id?: string;
  registered_by_practitioner_id?: string;
  /** 結果項目マスタの空の JLAC を行のコードで埋める(取込元コード対応表の代わり)。 */
  write_to_master?: boolean;
  /** 同じバッチの同じ外部コードの保留行にも同じ結果項目を入れる。 */
  apply_to_same_code?: boolean;
}

export interface LabResultImportRowsUpdated {
  rows: LabResultImportRow[];
  /** マスタの JLAC が既に別の値で、書き込まなかったとき。 */
  master_conflict?: boolean;
}

export async function createLabResultImport(
  file: File,
  encoding: string,
  format = "hl7_v25",
): Promise<LabResultImportCreated> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("encoding", encoding);
  formData.append("format", format);
  // Content-Type は指定しない（ブラウザが multipart boundary 付きで設定する）
  const res = await masterFetch("/master/lab_result_imports", { method: "POST", body: formData });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as LabResultImportCreated;
}

export async function fetchLabResultImports(
  page = 1,
  per = 20,
): Promise<MasterSearchResult<LabResultImport>> {
  const search = new URLSearchParams({ page: String(page), per: String(per) });
  const res = await masterFetch(`/master/lab_result_imports?${search}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as MasterSearchResult<LabResultImport>;
}

export async function fetchLabResultImport(id: number): Promise<LabResultImportDetail> {
  const res = await masterFetch(`/master/lab_result_imports/${id}`);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as LabResultImportDetail;
}

export async function deleteLabResultImport(id: number): Promise<void> {
  const res = await masterFetch(`/master/lab_result_imports/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

/** 結果項目マスタを直した後の再引き当て。人が手で選んだ行は上書きしない。 */
export async function resolveLabResultImport(
  id: number,
): Promise<{ resolved: number; rows: LabResultImportRow[] }> {
  const res = await masterFetch(`/master/lab_result_imports/${id}/resolve`, { method: "POST" });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as { resolved: number; rows: LabResultImportRow[] };
}

export async function updateLabResultImportRow(
  id: number,
  payload: LabResultImportRowPayload,
): Promise<LabResultImportRowsUpdated> {
  const res = await masterFetch(`/master/lab_result_import_rows/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as LabResultImportRowsUpdated;
}

export async function bulkUpdateLabResultImportRows(
  ids: number[],
  payload: LabResultImportRowPayload,
): Promise<LabResultImportRowsUpdated> {
  const res = await masterFetch("/master/lab_result_import_rows/bulk_update", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, ...payload }),
  });
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as LabResultImportRowsUpdated;
}
