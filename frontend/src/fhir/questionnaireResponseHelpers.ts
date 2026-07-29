// JASPEHR 実装ガイド v1.0.0 の QuestionnaireResponse プロファイルに準拠した
// テンプレート回答リソースの組み立て・復元。
// https://jaspehr.jp/wp-content/docs/full-ig_v1.0.0/site/index.html
export const JASPEHR_QUESTIONNAIRE_RESPONSE_PROFILE_URL =
  "http://www.hosp.ncgm.go.jp/JASPEHR/fhir/StructureDefinition/jaspehr-questionnaireresponse";

// 保険医療機関番号(10桁: 都道府県2桁 + 点数表1桁 + 医療機関コード7桁)。
// 本アプリは施設マスタを持たないため、フォーム初期値として仮の番号を使う。
export const INSTITUTION_NUMBER_PATTERN = /^[0-4][0-9][1-3][0-9]{7}$/;
export const DEFAULT_INSTITUTION_NUMBER = "1310000001";

export const QR_STATUS_OPTIONS = [
  { code: "in-progress", label: "入力中" },
  { code: "completed", label: "完了" },
  { code: "amended", label: "修正済" },
] as const;

export type QuestionnaireResponseStatus = (typeof QR_STATUS_OPTIONS)[number]["code"];

const QR_STATUS_LABELS: Record<string, string> = {
  "in-progress": "入力中",
  completed: "完了",
  amended: "修正済",
  "entered-in-error": "誤登録",
  stopped: "中止",
};

export function qrStatusLabel(code: string | undefined): string {
  return QR_STATUS_LABELS[code ?? ""] ?? code ?? "";
}

// QuestionnaireResponse.questionnaire に入れる canonical("<url>|<version>")。
export function questionnaireCanonical(questionnaire: fhir4.Questionnaire): string {
  const url = questionnaire.url ?? "";
  return questionnaire.version ? `${url}|${questionnaire.version}` : url;
}

export function splitCanonical(canonical: string): { url: string; version?: string } {
  const [url, version] = canonical.split("|");
  return version ? { url, version } : { url };
}

// フォームで編集する QuestionnaireResponse のメタ情報。
export interface QuestionnaireResponseMetaValues {
  status: QuestionnaireResponseStatus;
  authorName: string;
  institutionNumber: string;
}

export function emptyQuestionnaireResponseMeta(): QuestionnaireResponseMetaValues {
  return {
    status: "completed",
    authorName: "",
    institutionNumber: DEFAULT_INSTITUTION_NUMBER,
  };
}

// 記入者は本アプリに Practitioner リソースが無いため contained で持つ
// (JASPEHR プロファイルの contained:practitioner スライス)。
const CONTAINED_PRACTITIONER_ID = "practitioner";

function containedPractitionerName(qr: fhir4.QuestionnaireResponse): string {
  const practitioner = qr.contained?.find(
    (r): r is fhir4.Practitioner => r.resourceType === "Practitioner",
  );
  return practitioner?.name?.[0]?.text ?? "";
}

export function parseQuestionnaireResponseMeta(
  qr: fhir4.QuestionnaireResponse,
): QuestionnaireResponseMetaValues {
  const status = QR_STATUS_OPTIONS.some((s) => s.code === qr.status)
    ? (qr.status as QuestionnaireResponseStatus)
    : "completed";
  return {
    status,
    authorName: containedPractitionerName(qr),
    institutionNumber: qr.identifier?.value?.split("^")[0] ?? DEFAULT_INSTITUTION_NUMBER,
  };
}

export interface BuildQuestionnaireResponseArgs {
  questionnaire: fhir4.Questionnaire;
  patient: fhir4.Patient;
  items: fhir4.QuestionnaireResponseItem[];
  meta: QuestionnaireResponseMetaValues;
  // 更新時は id と identifier(報告単位ID)を引き継ぐ。
  existing?: fhir4.QuestionnaireResponse;
}

// identifier は IG の記法「保険医療機関番号^患者ID^報告単位ID」で組み立てる。
function buildIdentifierValue(
  meta: QuestionnaireResponseMetaValues,
  patient: fhir4.Patient,
): string {
  const patientKey = patient.identifier?.[0]?.value ?? patient.id ?? "";
  return `${meta.institutionNumber}^${patientKey}^${crypto.randomUUID()}`;
}

export function buildQuestionnaireResponse(
  args: BuildQuestionnaireResponseArgs,
): fhir4.QuestionnaireResponse {
  const { questionnaire, patient, items, meta, existing } = args;

  // contained の型は基底 Resource のため、いったん Practitioner として組み立てる。
  const author: fhir4.Practitioner = {
    resourceType: "Practitioner",
    id: CONTAINED_PRACTITIONER_ID,
    name: [{ text: meta.authorName }],
  };

  const response: fhir4.QuestionnaireResponse = {
    resourceType: "QuestionnaireResponse",
    meta: { profile: [JASPEHR_QUESTIONNAIRE_RESPONSE_PROFILE_URL] },
    contained: [author],
    identifier: {
      value: existing?.identifier?.value ?? buildIdentifierValue(meta, patient),
    },
    questionnaire: questionnaireCanonical(questionnaire),
    status: meta.status,
    subject: { reference: `Patient/${patient.id}` },
    authored: new Date().toISOString(),
    author: { reference: `#${CONTAINED_PRACTITIONER_ID}` },
  };

  if (existing?.id) response.id = existing.id;
  if (items.length) response.item = items;

  return response;
}

// ---- 一覧表示用 ----

export interface QuestionnaireResponseSummary {
  id: string;
  questionnaire: string;
  statusLabel: string;
  authored: string;
  authorName: string;
  lastUpdated: string;
}

export function summarizeQuestionnaireResponse(
  qr: fhir4.QuestionnaireResponse,
): QuestionnaireResponseSummary {
  const lastUpdated = qr.meta?.lastUpdated;
  return {
    id: qr.id ?? "",
    questionnaire: qr.questionnaire ?? "",
    statusLabel: qrStatusLabel(qr.status),
    authored: qr.authored ? new Date(qr.authored).toLocaleString("ja-JP") : "",
    authorName: containedPractitionerName(qr),
    lastUpdated: lastUpdated ? new Date(lastUpdated).toLocaleString("ja-JP") : "",
  };
}

// ---- バリデーション ----

export function validateQuestionnaireResponseMeta(
  meta: QuestionnaireResponseMetaValues,
): string | null {
  if (!meta.authorName) return "記入者名を入力してください。";
  if (!INSTITUTION_NUMBER_PATTERN.test(meta.institutionNumber)) {
    return "保険医療機関番号は10桁の数字(都道府県2桁 + 点数表1桁 + 医療機関コード7桁)で入力してください。";
  }
  return null;
}
