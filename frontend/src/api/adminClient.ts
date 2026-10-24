// 管理API(/admin/*)のクライアント。
//
// 認証は HttpOnly のセッション Cookie で、ブラウザ側にトークンを保持しない。
// 非 GET には CSRF トークン(ログイン応答で受け取る値)を X-CSRF-Token で付ける
// (トークンの実体はアプリ本体のログインと共有 -- api/session.ts)。
//
// 秘密は書込専用: client_secret / FHIR 管理トークンはサーバーから返らず
// (`*_set` で有無のみ)、入力があったときだけ送信する。

import type { MealScheduleSettings } from "../fhir/mealOrderHelpers";
import type { NursingScheduleSettings } from "../fhir/nursingScheduleHelpers";
import type { VitalThresholdSettings } from "../fhir/vitalHelpers";
import type { WaterBalanceSettings } from "../fhir/flowsheetWaterBalanceHelpers";
import type { MedicationScheduleSettings } from "../fhir/medicationScheduleHelpers";
import type { DocumentReminderSettings } from "../fhir/documentDueHelpers";
import type { AdmissionDocumentSettings } from "../fhir/admissionDocumentHelpers";
import type { PressureUlcerSettings } from "../fhir/pressureUlcerHelpers";
import type { NursingAcuitySettings } from "../fhir/nursingAcuityHelpers";
import type { PrescriptionCategoryDefaults } from "../fhir/prescriptionHelpers";
import type { RadiotherapyReviewSettings } from "../fhir/radiotherapyReviewHelpers";
import type { ReceiptCodeSettings } from "../fhir/receiptCodeSettingsHelpers";
import type { NursingProfileSettings } from "../fhir/nursingProfileHelpers";
import type { BulkVitalEntrySettings } from "../fhir/bulkVitalHelpers";
import type { DocumentFormLayout, DocumentFormPageMeta } from "../fhir/documentFormLayout";
import { notifyUnauthorized, setCsrfToken, withCsrfHeaders } from "./session";
import type { AdvisorySeveritySettings } from "../fhir/advisoryHelpers";
import type { EarlyWarningSettings } from "../fhir/earlyWarningHelpers";
import type { IntakeSettings } from "../fhir/intakeHelpers";
import type { KarteCardOrderSettings } from "../fhir/karteCardOrderHelpers";

export interface ConnectionSettings {
  base_url: string | null;
  /** ブラウザから見た上流の URL(SMART の iss、起こしボタンの宛先)。空なら base_url と同じ。 */
  public_base_url: string | null;
  client_id: string | null;
  token_path: string;
  host_header: string | null;
  client_secret_set: boolean;
  fhir_admin_token_set: boolean;
  admin_api_available: boolean;
  auth_enabled: boolean;
  effective_base_url: string;
  effective_public_base_url: string;
  effective_auth_source: "db" | "env" | "none";
}

export interface ConnectionSettingsUpdate {
  base_url?: string;
  public_base_url?: string;
  client_id?: string;
  client_secret?: string;
  token_path?: string;
  host_header?: string;
  fhir_admin_token?: string;
}

/** 「自院」がどの Organization か。未設定なら null。看護指示の既定時刻も同じ行。 */
export interface FacilitySettings {
  self_organization_id: string | null;
  nursing_schedule: NursingScheduleSettings;
  meal_schedule: MealScheduleSettings;
  /** 経過表でバイタルを異常値として強調するしきい値(LOINC コード → 下限・上限)。 */
  vital_thresholds: VitalThresholdSettings;
  /** 経過表の水分出納に数える看護観察(MEDIS の管理番号)。 */
  water_balance: WaterBalanceSettings;
  medication_schedule: MedicationScheduleSettings;
  /** 文書作成の督促(退院時サマリーの期限までの日数)。 */
  document_reminder: DocumentReminderSettings;
  /** 処方区分の初期値(入外区分ごと。空なら未選択で開く)。 */
  prescription_category: PrescriptionCategoryDefaults;
  /** 他科依頼の依頼目的テンプレートの既定(依頼先の診療科 Organization.id → canonical)。 */
  consult_default_templates: Record<string, string>;
  /** 放射線治療の治療中の診察(週次レビュー)の間隔。 */
  radiotherapy_review: RadiotherapyReviewSettings;
  /** 医事会計へ送るレセプト電算コードのうち、施設基準で決まるもの。 */
  receipt_codes: ReceiptCodeSettings;
  /** 看護プロファイルの区画(テンプレートの url を並べた順)。 */
  nursing_profile: NursingProfileSettings;
  /** 経過表の一括入力に出す列(並べた順)。 */
  bulk_vital_entry: BulkVitalEntrySettings;
  /** DPC の医療機関別係数(適用開始日 YYYY-MM-DD → 係数)。 */
  dpc_coefficients: Record<string, string>;
  /** 入退院文書の作成状況の対象と期限。 */
  admission_documents: AdmissionDocumentSettings;
  /** 看護必要度の評価票の版と該当患者の基準。 */
  nursing_acuity: NursingAcuitySettings;
  /** 褥瘡管理(DESIGN-R 評価のテンプレート)。 */
  pressure_ulcer: PressureUlcerSettings;
  /** 早期警告スコア(NEWS2)の算出と通知。 */
  early_warning: EarlyWarningSettings;
  /** Web 問診(既定の質問票・診療科ごとの質問票・有効時間)。 */
  intake: IntakeSettings;
  /** カルテのカードの同じ日の中での並び(時系列か種別順か、種別の順)。 */
  karte_card_order: KarteCardOrderSettings;
  /** 警告(判断支援)の種別ごとの重さの調整(下げる・出さない)。 */
  advisory_severity: AdvisorySeveritySettings;
}

export type FacilitySettingsPayload = Partial<{
  self_organization_id: string;
  nursing_schedule: NursingScheduleSettings;
  meal_schedule: MealScheduleSettings;
  vital_thresholds: VitalThresholdSettings;
  water_balance: WaterBalanceSettings;
  medication_schedule: MedicationScheduleSettings;
  document_reminder: DocumentReminderSettings;
  prescription_category: PrescriptionCategoryDefaults;
  consult_default_templates: Record<string, string>;
  radiotherapy_review: RadiotherapyReviewSettings;
  receipt_codes: ReceiptCodeSettings;
  nursing_profile: NursingProfileSettings;
  bulk_vital_entry: BulkVitalEntrySettings;
  dpc_coefficients: Record<string, string>;
  admission_documents: AdmissionDocumentSettings;
  nursing_acuity: NursingAcuitySettings;
  pressure_ulcer: PressureUlcerSettings;
  early_warning: EarlyWarningSettings;
  intake: IntakeSettings;
  karte_card_order: KarteCardOrderSettings;
  advisory_severity: AdvisorySeveritySettings;
}>;

export interface ConnectionTestResult {
  ok: boolean;
  auth?: "backend_services" | "none";
  error?: string;
}

export interface AdminSession {
  authenticated: boolean;
  /** ADMIN_TOKEN が設定されているか。false ならログイン画面を出さない。 */
  auth_required: boolean;
  csrf_token: string | null;
}

/** delegated は CDS Hooks のサービス(user/ スコープでリダイレクト URI なし。トークンは EHR が発行して渡す)。 */
export type OauthClientKind = "backend" | "launch" | "delegated";
export type OauthClientAuthMethod = "client_secret" | "private_key_jwt" | "none";

export interface OauthClientSummary {
  client_id: string;
  name: string;
  client_type: "confidential" | "public";
  scopes: string[];
  redirect_uris: string[];
  kind: OauthClientKind;
  /** カルテから EHR launch で起動できる(launch スコープを登録した)クライアント。 */
  ehr_launchable: boolean;
  auth_method: OauthClientAuthMethod;
  jwks_key_count: number;
  active_access_token_count: number;
  active_refresh_token_count: number;
  created_at: string;
  updated_at: string;
}

/** 登録直後のレスポンス。client_secret は「キーが存在するときだけ」現れる。 */
export interface OauthClientCreated extends Omit<
  OauthClientSummary,
  "active_access_token_count" | "active_refresh_token_count"
> {
  client_secret?: string;
}

export interface NewOauthClient {
  name: string;
  scopes: string[];
  redirect_uris?: string[];
  client_type?: "confidential" | "public";
  jwks?: unknown;
}

export interface OauthClientDeleted {
  client_id: string;
  name: string;
  deleted: {
    access_tokens: number;
    refresh_tokens: number;
    authorization_codes: number;
    client_assertion_jtis: number;
    bulk_exports_detached: number;
  };
}

export interface ScopeOptions {
  resource_types: { type: string; label: string }[];
  system_access: { value: string; label: string }[];
  patient_access: { value: string; label: string }[];
  user_access: { value: string; label: string }[];
  context_scopes: { scope: string; label: string }[];
}

export class AdminApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
  }
}

async function buildError(res: Response): Promise<AdminApiError> {
  let message = `サーバーエラーが発生しました (HTTP ${res.status})`;
  try {
    const body = (await res.json()) as { error?: string; errors?: string[] };
    if (body.error) message = body.error;
    else if (body.errors?.length) message = body.errors.join(" / ");
  } catch {
    // 非JSONレスポンスはデフォルトメッセージのまま
  }
  return new AdminApiError(message, res.status);
}

async function adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();

  const res = await fetch(path, { ...init, headers: withCsrfHeaders(method, init.headers) });
  // 401 はこのアプリ自身のセッション失効だけを意味する。上流 FHIR サーバーの
  // 401 は backend が 502 に読み替えるので、設定ミスでログアウトさせられない。
  if (res.status === 401) notifyUnauthorized();
  return res;
}

async function adminJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await adminFetch(path, init);
  if (!res.ok) throw await buildError(res);
  return (await res.json()) as T;
}

function jsonBody(payload: unknown): RequestInit {
  return { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}

// --- ログインセッション ------------------------------------------------------

const SESSION = "/admin/session";

function rememberCsrf(session: AdminSession): AdminSession {
  setCsrfToken(session.csrf_token);
  return session;
}

export async function fetchAdminSession(): Promise<AdminSession> {
  return rememberCsrf(await adminJson<AdminSession>(SESSION));
}

export async function login(token: string): Promise<AdminSession> {
  return rememberCsrf(
    await adminJson<AdminSession>(SESSION, { method: "POST", ...jsonBody({ token }) }),
  );
}

export async function logout(): Promise<AdminSession> {
  return rememberCsrf(await adminJson<AdminSession>(SESSION, { method: "DELETE" }));
}

// --- 接続設定 ----------------------------------------------------------------

const SETTINGS = "/admin/fhir_connection_settings";

export async function fetchConnectionSettings(): Promise<ConnectionSettings> {
  return adminJson<ConnectionSettings>(SETTINGS);
}

export async function updateConnectionSettings(
  payload: ConnectionSettingsUpdate,
): Promise<ConnectionSettings> {
  return adminJson<ConnectionSettings>(SETTINGS, { method: "PATCH", ...jsonBody(payload) });
}

export async function testConnection(): Promise<ConnectionTestResult> {
  return adminJson<ConnectionTestResult>(`${SETTINGS}/test`, { method: "POST" });
}

// --- OAuth クライアント ------------------------------------------------------

const OAUTH_CLIENTS = "/admin/oauth_clients";

export async function fetchOauthClients(): Promise<OauthClientSummary[]> {
  const body = await adminJson<{ total: number; items: OauthClientSummary[] }>(OAUTH_CLIENTS);
  return body.items;
}

export async function createOauthClient(payload: NewOauthClient): Promise<OauthClientCreated> {
  return adminJson<OauthClientCreated>(OAUTH_CLIENTS, { method: "POST", ...jsonBody(payload) });
}

export async function deleteOauthClient(clientId: string): Promise<OauthClientDeleted> {
  return adminJson<OauthClientDeleted>(`${OAUTH_CLIENTS}/${encodeURIComponent(clientId)}`, {
    method: "DELETE",
  });
}

export async function fetchScopeOptions(): Promise<ScopeOptions> {
  return adminJson<ScopeOptions>("/admin/scopes");
}

// --- 帳票レイアウト ----------------------------------------------------------

export interface ReportLayoutSummary {
  id: number;
  name: string;
  questionnaire_url: string;
  questionnaire_version: string;
  canonical: string;
  tlf_bytesize: number;
  /** マッピング定義が登録されているか(本文は show でのみ返る)。 */
  mapping_set: boolean;
  updated_at: string;
}

/** show のみ tlf・mapping 本文(JSON テキスト)を含む。 */
export interface ReportLayoutDetail extends ReportLayoutSummary {
  tlf: string;
  mapping: string;
}

export interface ReportLayoutPayload {
  name: string;
  questionnaire_url: string;
  questionnaire_version: string;
  /** .tlf ファイルの中身(JSON テキスト)。FileReader で読んだ文字列をそのまま送る。 */
  tlf: string;
  /** マッピング定義(JSON 配列のテキスト)。空文字はマッピングなし。 */
  mapping?: string;
}

const REPORT_LAYOUTS = "/admin/report_layouts";

// canonical("url|version")を渡すと該当テンプレート分だけに絞り込む。
export async function fetchReportLayouts(canonical?: string): Promise<ReportLayoutSummary[]> {
  const query = canonical ? `?canonical=${encodeURIComponent(canonical)}` : "";
  const body = await adminJson<{ total: number; items: ReportLayoutSummary[] }>(
    `${REPORT_LAYOUTS}${query}`,
  );
  return body.items;
}

export async function fetchReportLayout(id: number): Promise<ReportLayoutDetail> {
  return adminJson<ReportLayoutDetail>(`${REPORT_LAYOUTS}/${id}`);
}

export async function createReportLayout(
  payload: ReportLayoutPayload,
): Promise<ReportLayoutSummary> {
  return adminJson<ReportLayoutSummary>(REPORT_LAYOUTS, { method: "POST", ...jsonBody(payload) });
}

export async function updateReportLayout(
  id: number,
  payload: Partial<ReportLayoutPayload>,
): Promise<ReportLayoutSummary> {
  return adminJson<ReportLayoutSummary>(`${REPORT_LAYOUTS}/${id}`, {
    method: "PATCH",
    ...jsonBody(payload),
  });
}

export async function deleteReportLayout(id: number): Promise<void> {
  const res = await adminFetch(`${REPORT_LAYOUTS}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

// --- テンプレートカテゴリ ----------------------------------------------------

export interface QuestionnaireCategorySummary {
  id: number;
  /** Questionnaire の拡張から参照される不変のコード(UUID)。 */
  code: string;
  name: string;
  display_order: number;
  updated_at: string;
}

export interface QuestionnaireCategoryPayload {
  name?: string;
  display_order?: number;
}

const QUESTIONNAIRE_CATEGORIES = "/admin/questionnaire_categories";

export async function fetchQuestionnaireCategories(): Promise<QuestionnaireCategorySummary[]> {
  const body = await adminJson<{ total: number; items: QuestionnaireCategorySummary[] }>(
    QUESTIONNAIRE_CATEGORIES,
  );
  return body.items;
}

export async function createQuestionnaireCategory(
  payload: QuestionnaireCategoryPayload,
): Promise<QuestionnaireCategorySummary> {
  return adminJson<QuestionnaireCategorySummary>(QUESTIONNAIRE_CATEGORIES, {
    method: "POST",
    ...jsonBody(payload),
  });
}

export async function updateQuestionnaireCategory(
  id: number,
  payload: QuestionnaireCategoryPayload,
): Promise<QuestionnaireCategorySummary> {
  return adminJson<QuestionnaireCategorySummary>(`${QUESTIONNAIRE_CATEGORIES}/${id}`, {
    method: "PATCH",
    ...jsonBody(payload),
  });
}

export async function deleteQuestionnaireCategory(id: number): Promise<void> {
  const res = await adminFetch(`${QUESTIONNAIRE_CATEGORIES}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

// --- ファイルカテゴリ --------------------------------------------------------

export interface FileCategorySummary {
  id: number;
  /** DocumentReference.category の coding から参照される不変のコード(UUID)。 */
  code: string;
  name: string;
  display_order: number;
  updated_at: string;
}

export interface FileCategoryPayload {
  name?: string;
  display_order?: number;
}

const FILE_CATEGORIES = "/admin/file_categories";

export async function fetchFileCategories(): Promise<FileCategorySummary[]> {
  const body = await adminJson<{ total: number; items: FileCategorySummary[] }>(FILE_CATEGORIES);
  return body.items;
}

export async function createFileCategory(
  payload: FileCategoryPayload,
): Promise<FileCategorySummary> {
  return adminJson<FileCategorySummary>(FILE_CATEGORIES, { method: "POST", ...jsonBody(payload) });
}

export async function updateFileCategory(
  id: number,
  payload: FileCategoryPayload,
): Promise<FileCategorySummary> {
  return adminJson<FileCategorySummary>(`${FILE_CATEGORIES}/${id}`, {
    method: "PATCH",
    ...jsonBody(payload),
  });
}

export async function deleteFileCategory(id: number): Promise<void> {
  const res = await adminFetch(`${FILE_CATEGORIES}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

// --- 文書テンプレート --------------------------------------------------------
// Word / Excel の様式ファイル(office)と、PDF / 画像の様式に項目を置いたもの(form)
// (docs/document-template-design.md)。一覧は本体(ファイル・ページ画像)を含まない。

export type DocumentTemplateKind = "office" | "form";

export interface DocumentTemplateSummary {
  id: number;
  /** 作成した文書の DocumentReference.type の coding から参照される不変のコード(UUID)。 */
  code: string;
  kind: DocumentTemplateKind;
  name: string;
  /** 作成した文書を入れるファイルカテゴリ。未設定は null。 */
  file_category_id: number | null;
  file_category_code: string | null;
  file_category_name: string | null;
  file_name: string;
  content_type: string;
  byte_size: number;
  display_order: number;
  active: boolean;
  /** form のフィールド配置(fhir/documentFormLayout.ts)。office は null。 */
  layout: DocumentFormLayout | null;
  /** form の回答を保存する Questionnaire の canonical。office は null。 */
  questionnaire_url: string | null;
  questionnaire_version: string | null;
  /** form のページ画像のメタ。本体は documentTemplatePageUrl で取る。 */
  pages: DocumentFormPageMeta[];
  updated_at: string;
}

export interface DocumentTemplatePagePayload extends DocumentFormPageMeta {
  /** 本体(base64)。 */
  data: string;
}

export interface DocumentTemplatePayload {
  kind?: DocumentTemplateKind;
  /** form は Questionnaire の url に使うため、登録時にフロントが採番して送る。 */
  code?: string;
  name?: string;
  file_category_id?: number | null;
  file_name?: string;
  content_type?: string;
  /** 本体(base64)。更新で省くと本体は差し替えない。 */
  file_data?: string;
  display_order?: number;
  active?: boolean;
  layout?: DocumentFormLayout;
  questionnaire_url?: string;
  questionnaire_version?: string;
  /** ページ画像。更新で省くと差し替えない。 */
  pages?: DocumentTemplatePagePayload[];
}

const DOCUMENT_TEMPLATES = "/admin/document_templates";

export async function fetchDocumentTemplates(activeOnly = false): Promise<DocumentTemplateSummary[]> {
  const body = await adminJson<{ total: number; items: DocumentTemplateSummary[] }>(
    activeOnly ? `${DOCUMENT_TEMPLATES}?active=true` : DOCUMENT_TEMPLATES,
  );
  return body.items;
}

export async function createDocumentTemplate(
  payload: DocumentTemplatePayload,
): Promise<DocumentTemplateSummary> {
  return adminJson<DocumentTemplateSummary>(DOCUMENT_TEMPLATES, {
    method: "POST",
    ...jsonBody(payload),
  });
}

export async function updateDocumentTemplate(
  id: number,
  payload: DocumentTemplatePayload,
): Promise<DocumentTemplateSummary> {
  return adminJson<DocumentTemplateSummary>(`${DOCUMENT_TEMPLATES}/${id}`, {
    method: "PATCH",
    ...jsonBody(payload),
  });
}

/** 様式の複製。ページ画像と配置を写した無効のテンプレートを作る。Questionnaire は呼び出し側が先に作る。 */
export async function copyDocumentTemplate(
  id: number,
  payload: { code: string; name: string; questionnaire_url: string; questionnaire_version: string },
): Promise<DocumentTemplateSummary> {
  return adminJson<DocumentTemplateSummary>(`${DOCUMENT_TEMPLATES}/${id}/copy`, {
    method: "POST",
    ...jsonBody(payload),
  });
}

export async function deleteDocumentTemplate(id: number): Promise<void> {
  const res = await adminFetch(`${DOCUMENT_TEMPLATES}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

/** 様式のページ画像の URL。差し替えで updated_at が変わるので、それをキャッシュの鍵にする。 */
export function documentTemplatePageUrl(template: DocumentTemplateSummary, pageNumber: number): string {
  return `${DOCUMENT_TEMPLATES}/${template.id}/pages/${pageNumber}?v=${encodeURIComponent(template.updated_at)}`;
}

export async function fetchDocumentTemplateFile(id: number): Promise<Uint8Array> {
  const res = await adminFetch(`${DOCUMENT_TEMPLATES}/${id}/file`);
  if (!res.ok) throw await buildError(res);
  return new Uint8Array(await res.arrayBuffer());
}

// --- 外部システム連携 ---------------------------------------------------------
// システム(レセコン等)ごとに 1 件の設定。項目を宣言するのは backend の定義。

const EXTERNAL_SYSTEMS = "/admin/external_systems";

/** 設定ページに出す区画。 */
export type ExternalSystemSection = "connection" | "inbound_token" | "code_mappings";

/** 定義が宣言する設定項目。値は options に入る。 */
export interface ExternalSystemField {
  key: string;
  label: string;
  /** 既定は "text"。 */
  type?: "text" | "boolean" | "select";
  /** type が "select" のときの選択肢。 */
  choices?: { value: string; label: string }[];
  default?: string;
  required?: boolean;
}

/** アダプタが宣言する製品固有の設定項目。値は options に入る。 */
export interface ExternalOptionField {
  key: string;
  label: string;
  default?: string;
}

/** アダプタが宣言する対応表の種別。 */
export interface ExternalCodeKind {
  key: string;
  label: string;
  /** カルテ側が何のコードか。"ssmix2_department" / "practitioner"。 */
  local: string;
  /** 対応が無いときの扱い。"identity" ならそのまま使う。 */
  fallback?: string | null;
}

export interface ExternalSystemSummary {
  key: string;
  label: string;
  description: string | null;
  sections: ExternalSystemSection[];
  system_types: string[];
  fields: ExternalSystemField[];
  enabled: boolean;
  /** どの製品と繋ぐか。"orca" など。API で繋がないシステムは空。 */
  system_type: string | null;
  usable: boolean;
}

export interface ExternalSystemDetail extends ExternalSystemSummary {
  base_url: string | null;
  username: string | null;
  options: Record<string, string>;
  /** パスワードは返らない。設定済みかどうかだけ。 */
  password_set: boolean;
  /** 受信エンドポイントのトークンが発行済みか。 */
  inbound_token_set: boolean;
  effective_base_url: string | null;
  option_fields: ExternalOptionField[];
  code_kinds: ExternalCodeKind[];
}

export interface ExternalSystemUpdate {
  enabled?: boolean;
  system_type?: string;
  base_url?: string;
  username?: string;
  /** 空文字なら既存のパスワードを変更しない。 */
  password?: string;
  options?: Record<string, string>;
}

export interface ExternalConnectionTestResult {
  ok: boolean;
  error?: string;
  facility_name?: string | null;
  /** 保険医療機関番号 10 桁。自院 Organization の identifier と突き合わせる。 */
  facility_number?: string | null;
  message?: string;
}

export interface ExternalCodeMapping {
  id?: number;
  system_type?: string;
  kind: string;
  local_key: string;
  external_code: string;
  label?: string | null;
}

export interface ExternalCodeCandidate {
  code: string;
  label: string;
}

function systemPath(systemKey: string) {
  return `${EXTERNAL_SYSTEMS}/${encodeURIComponent(systemKey)}`;
}

export async function fetchExternalSystems(): Promise<{ items: ExternalSystemSummary[] }> {
  return adminJson<{ items: ExternalSystemSummary[] }>(EXTERNAL_SYSTEMS);
}

export async function fetchExternalSystem(systemKey: string): Promise<ExternalSystemDetail> {
  return adminJson<ExternalSystemDetail>(systemPath(systemKey));
}

export async function updateExternalSystem(
  systemKey: string,
  payload: ExternalSystemUpdate,
): Promise<ExternalSystemDetail> {
  return adminJson<ExternalSystemDetail>(systemPath(systemKey), {
    method: "PATCH",
    ...jsonBody(payload),
  });
}

export async function testExternalSystem(systemKey: string): Promise<ExternalConnectionTestResult> {
  return adminJson<ExternalConnectionTestResult>(`${systemPath(systemKey)}/test`, {
    method: "POST",
  });
}

/** 受信エンドポイントのトークンを作り直す。院内エージェントに配るので平文で返る。 */
export async function regenerateInboundToken(systemKey: string): Promise<{ inbound_token: string }> {
  return adminJson<{ inbound_token: string }>(`${systemPath(systemKey)}/regenerate_inbound_token`, {
    method: "POST",
  });
}

export async function fetchExternalCodeMappings(systemKey: string): Promise<{
  items: ExternalCodeMapping[];
  kinds: ExternalCodeKind[];
}> {
  return adminJson<{ items: ExternalCodeMapping[]; kinds: ExternalCodeKind[] }>(
    `${systemPath(systemKey)}/code_mappings`,
  );
}

/** 種別ごとに丸ごと置き換える。部分更新にすると「消したのに残る」が起きやすい。 */
export async function updateExternalCodeMappings(
  systemKey: string,
  kind: string,
  items: { local_key: string; external_code: string; label?: string }[],
): Promise<{ items: ExternalCodeMapping[] }> {
  return adminJson<{ items: ExternalCodeMapping[] }>(`${systemPath(systemKey)}/code_mappings`, {
    method: "PATCH",
    ...jsonBody({ kind, items }),
  });
}

export async function fetchExternalCodeCandidates(
  systemKey: string,
  kind: string,
): Promise<{ items: ExternalCodeCandidate[] }> {
  return adminJson<{ items: ExternalCodeCandidate[] }>(
    `${systemPath(systemKey)}/code_mappings/candidates?kind=${encodeURIComponent(kind)}`,
  );
}

// --- SMART アプリ(カルテから起動する外部アプリ) --------------------------------

export type SmartAppDisplay = "embed" | "window";

export interface SmartAppSummary {
  id: number;
  name: string;
  /** 上流 OAuth クライアントの client_id(launch 形)。 */
  client_id: string;
  launch_url: string;
  display: SmartAppDisplay;
  enabled: boolean;
  position: number;
  updated_at: string;
}

export interface SmartAppPayload {
  name?: string;
  client_id?: string;
  launch_url?: string;
  display?: SmartAppDisplay;
  enabled?: boolean;
  position?: number | null;
}

const SMART_APPS = "/admin/smart_apps";

export async function fetchSmartApps(): Promise<SmartAppSummary[]> {
  const body = await adminJson<{ total: number; items: SmartAppSummary[] }>(SMART_APPS);
  return body.items;
}

export async function createSmartApp(payload: SmartAppPayload): Promise<SmartAppSummary> {
  return adminJson<SmartAppSummary>(SMART_APPS, { method: "POST", ...jsonBody(payload) });
}

export async function updateSmartApp(id: number, payload: SmartAppPayload): Promise<SmartAppSummary> {
  return adminJson<SmartAppSummary>(`${SMART_APPS}/${id}`, { method: "PATCH", ...jsonBody(payload) });
}

export async function deleteSmartApp(id: number): Promise<void> {
  const res = await adminFetch(`${SMART_APPS}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

// --- CDS サービス(CDS Hooks の提供元) ----------------------------------------

export interface CdsServiceSummary {
  id: number;
  name: string;
  base_url: string;
  auth_token_set: boolean;
  /** 上流の委任クライアント。あれば hook のたびに短命トークンを fhirAuthorization で渡す。 */
  client_id: string | null;
  enabled: boolean;
  position: number;
  updated_at: string;
}

export interface CdsServicePayload {
  name?: string;
  base_url?: string;
  /** 書き込み専用。空なら既存の値を保持する。 */
  auth_token?: string;
  client_id?: string | null;
  enabled?: boolean;
  position?: number | null;
}

/** discovery(GET /cds-services)の 1 サービス。 */
export interface CdsDiscoveredService {
  id: string;
  hook: string | null;
  title: string | null;
  description: string | null;
  prefetch: string[];
}

const CDS_SERVICES = "/admin/cds_services";

export async function fetchCdsServices(): Promise<CdsServiceSummary[]> {
  const body = await adminJson<{ total: number; items: CdsServiceSummary[] }>(CDS_SERVICES);
  return body.items;
}

export async function createCdsService(payload: CdsServicePayload): Promise<CdsServiceSummary> {
  return adminJson<CdsServiceSummary>(CDS_SERVICES, { method: "POST", ...jsonBody(payload) });
}

export async function updateCdsService(id: number, payload: CdsServicePayload): Promise<CdsServiceSummary> {
  return adminJson<CdsServiceSummary>(`${CDS_SERVICES}/${id}`, { method: "PATCH", ...jsonBody(payload) });
}

export async function deleteCdsService(id: number): Promise<void> {
  const res = await adminFetch(`${CDS_SERVICES}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await buildError(res);
}

export async function discoverCdsServices(id: number): Promise<CdsDiscoveredService[]> {
  const body = await adminJson<{ services: CdsDiscoveredService[] }>(`${CDS_SERVICES}/${id}/discover`);
  return body.services;
}

// --- 警告の集計と設定(docs/advisory-design.md §3.3) --------------------------------

export interface AdvisoryStatRow {
  kind: string;
  /** YYYY-MM(日本時間)。 */
  month: string;
  fired: number;
  overridden: number;
  /** 無視理由のコード → 件数。 */
  reasons: Record<string, number>;
}

export interface AdvisoryStats {
  from: string;
  to: string;
  rows: AdvisoryStatRow[];
}

export async function fetchAdvisoryStats(range: { from: string; to: string }): Promise<AdvisoryStats> {
  const search = new URLSearchParams(range);
  return adminJson<AdvisoryStats>(`/admin/advisory_stats?${search.toString()}`);
}
