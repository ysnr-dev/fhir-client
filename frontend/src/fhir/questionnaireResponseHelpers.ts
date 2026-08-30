// JASPEHR 実装ガイド v1.0.0 の QuestionnaireResponse プロファイルに準拠した
// テンプレート回答リソースの組み立て・復元。
// https://jaspehr.jp/wp-content/docs/full-ig_v1.0.0/site/index.html
import { problemRefFromReference, type ProblemRef } from "./conditionHelpers";
import { annotationOf, binaryIdFromAttachment } from "./schemaImage";

export const JASPEHR_QUESTIONNAIRE_RESPONSE_PROFILE_URL =
  "http://www.hosp.ncgm.go.jp/JASPEHR/fhir/StructureDefinition/jaspehr-questionnaireresponse";

// 保険医療機関番号(10桁: 都道府県2桁 + 点数表1桁 + 医療機関コード7桁)。
// 初期値は自院(管理 > 施設設定)の Organization が持つ番号。自院が未設定か、
// 自院に番号を登録していない環境では仮の番号を初期値にする。
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

// 表示用ラベルは summarizeQuestionnaireResponse 経由で使う。
function qrStatusLabel(code: string | undefined): string {
  return QR_STATUS_LABELS[code ?? ""] ?? code ?? "";
}

// QuestionnaireResponse.questionnaire に入れる canonical("<url>|<version>")。
export function questionnaireCanonical(questionnaire: fhir4.Questionnaire): string {
  const url = questionnaire.url ?? "";
  return questionnaire.version ? `${url}|${questionnaire.version}` : url;
}

// フォームで編集する QuestionnaireResponse のメタ情報。
export interface QuestionnaireResponseMetaValues {
  status: QuestionnaireResponseStatus;
  authorName: string;
  institutionNumber: string;
}

export function emptyQuestionnaireResponseMeta(
  institutionNumber?: string,
): QuestionnaireResponseMetaValues {
  return {
    status: "completed",
    authorName: "",
    institutionNumber: institutionNumber || DEFAULT_INSTITUTION_NUMBER,
  };
}

// 記入者は JASPEHR プロファイルの contained:practitioner スライスに合わせて
// contained で持つ(上流の Practitioner を参照するのではなく氏名を埋め込む)。
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

/**
 * 回答が対象とするプロブレム(POMR)。アプリローカル拡張で持つ。QuestionnaireResponse には
 * 対象疾患を表す標準要素が無く(basedOn は ServiceRequest/CarePlan、partOf は
 * Observation/Procedure しか指せない)、診療記録の problems_section(LOINC 11450-4)に
 * あたる受け皿も無いため。
 *
 * display には保存時点の「#番号 名称」を入れておき、参照解決なしでも描画できるようにする
 * (表示側はプロブレム一覧が引けるなら最新の名称で上書きする)。
 */
export const QR_PROBLEM_EXT_URL =
  "http://fhir-client.local/StructureDefinition/questionnaire-response-problem";

export function questionnaireResponseProblem(
  response: fhir4.QuestionnaireResponse | undefined,
): ProblemRef | null {
  const reference = response?.extension?.find((e) => e.url === QR_PROBLEM_EXT_URL)?.valueReference;
  return problemRefFromReference(reference);
}

export interface BuildQuestionnaireResponseArgs {
  questionnaire: fhir4.Questionnaire;
  patient: fhir4.Patient;
  items: fhir4.QuestionnaireResponseItem[];
  meta: QuestionnaireResponseMetaValues;
  /**
   * 対象プロブレム。診療記録のセクションに貼る回答では指定しない
   * (どのプロブレムの記載かは記録側の紐付けで表すため)。
   */
  problem?: ProblemRef | null;
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
  const { questionnaire, patient, items, meta, problem, existing } = args;

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
  if (problem) {
    response.extension = [
      {
        url: QR_PROBLEM_EXT_URL,
        valueReference: {
          reference: `Condition/${problem.conditionId}`,
          display: problem.display,
        },
      },
    ];
  }

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

// ---- 平文表示 ----

const UNIT_EXT_URL = "http://hl7.org/fhir/StructureDefinition/questionnaire-unit";

function plainAnswerText(answer: fhir4.QuestionnaireResponseItemAnswer): string {
  return (
    answer.valueCoding?.display ??
    answer.valueCoding?.code ??
    answer.valueString ??
    answer.valueDate ??
    answer.valueDateTime ??
    answer.valueTime ??
    (answer.valueInteger !== undefined ? String(answer.valueInteger) : undefined) ??
    (answer.valueDecimal !== undefined ? String(answer.valueDecimal) : undefined) ??
    ""
  );
}

// 平文にできないシェーマ画像の存在を示す印。画像そのものを併せて描くカルテの
// カードでは、この印を取り除いてから行を出す。
export const SCHEMA_IMAGE_NOTE = "(シェーマ画像あり)";

export interface SchemaImageRef {
  /** 繰り返し項目でも重複しない描画用のキー。 */
  key: string;
  /** 画像に添える項目名。 */
  label: string;
  /** 保存済み画像。未保存(Bundle 内プレースホルダ)なら null。 */
  binaryId: string | null;
  /** 未保存画像の dataURL(同じ Bundle に積む Binary から取り出したもの)。 */
  dataUrl: string | null;
}

// 回答に含まれる描き込み済みシェーマ画像(合成済み PNG の Binary)を列挙する。
// 元テンプレートは要らない — 描き込み画像は元画像を含んだ合成結果だけを持つため。
//
// imageEntries を渡すと、まだ保存していない記入内容(TemplateDraft)にも使える。
// 未保存の画像は attachment.url が Bundle 内のプレースホルダ("urn:uuid:...")で、
// 実体は同梱の Binary エントリにあるため、そこから dataURL を組み立てる。
export function schemaImageRefs(
  response: fhir4.QuestionnaireResponse,
  imageEntries: fhir4.BundleEntry[] = [],
): SchemaImageRef[] {
  const pendingByPlaceholder = new Map<string, string>();
  for (const entry of imageEntries) {
    const binary = entry.resource as fhir4.Binary | undefined;
    if (!entry.fullUrl || binary?.resourceType !== "Binary" || !binary.data) continue;
    pendingByPlaceholder.set(
      entry.fullUrl,
      `data:${binary.contentType ?? "image/png"};base64,${binary.data}`,
    );
  }

  const refs: SchemaImageRef[] = [];
  (function walk(items: fhir4.QuestionnaireResponseItem[] | undefined, path: string) {
    (items ?? []).forEach((item, index) => {
      const key = `${path}${item.linkId}#${index}`;
      const attachment = annotationOf(item);
      const binaryId = binaryIdFromAttachment(attachment);
      const dataUrl = attachment?.url ? (pendingByPlaceholder.get(attachment.url) ?? null) : null;
      if (binaryId || dataUrl) {
        refs.push({ key, label: item.text ?? item.linkId, binaryId, dataUrl });
      }
      walk(item.item, `${key}/`);
    });
  })(response.item, "");
  return refs;
}

// シェーマ画像を実物で並べる場所向けに、平文を行に割って「あり」の印を落とす。
// 印だけになる行(答えがシェーマ画像しかない項目)は、項目名が画像側のキャプションに
// 出るので捨てる。
export function schemaAnnotatedLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(SCHEMA_IMAGE_NOTE, "").trimEnd())
    .filter((line) => line.trim() && !/[:：]$/.test(line.trim()));
}

// 記入内容を平文にする(カルテ等への貼り付け用)。項目名は
// QuestionnaireResponse.item.text、単位は元 Questionnaire から引く。
//
// テンプレート名は含めない。診療記録のセクション本文や放射線オーダーの検査目的の
// ように、貼り付け先に見出しが別にある(あるいは要らない)場所で使うため。
// テンプレート名まで要る「平文表示」は questionnaireResponseDocumentText を使う。
export function questionnaireResponsePlainText(
  questionnaire: fhir4.Questionnaire,
  response: fhir4.QuestionnaireResponse,
): string {
  // linkId はテンプレート全体で一意(jsp-4)のためフラットな対応表でよい。
  const units = new Map<string, string>();
  (function collectUnits(items: fhir4.QuestionnaireItem[] | undefined) {
    for (const item of items ?? []) {
      const unit = item.extension?.find((e) => e.url === UNIT_EXT_URL)?.valueCoding;
      if (unit) units.set(item.linkId, unit.display ?? unit.code ?? "");
      collectUnits(item.item);
    }
  })(questionnaire.item);

  const lines: string[] = [];

  (function walk(items: fhir4.QuestionnaireResponseItem[] | undefined, depth: number) {
    for (const item of items ?? []) {
      const indent = "  ".repeat(depth);
      const label = item.text ?? item.linkId;
      // シェーマ画像への描き込みは平文にできないため存在だけ示す。
      const annotationNote = annotationOf(item) ? SCHEMA_IMAGE_NOTE : "";
      // choice 配下に条件付きグループがある場合は answer と item の両方を持つ。
      if (item.answer?.length) {
        const unit = units.get(item.linkId);
        const values = item.answer
          .map((answer) => (unit ? `${plainAnswerText(answer)} ${unit}` : plainAnswerText(answer)))
          .join("、");
        lines.push(`${indent}${label}: ${values}${annotationNote}`);
      } else if (item.item?.length) {
        lines.push(`${indent}【${label}】${annotationNote}`);
      } else if (annotationNote) {
        lines.push(`${indent}${label}: ${annotationNote}`);
      }
      if (item.item?.length) walk(item.item, depth + 1);
    }
  })(response.item, 0);

  return lines.join("\n");
}

// モーダルで記入したテンプレート内容(未保存)。診療記録・放射線オーダーとも、
// 本体の保存と同じ transaction Bundle で QuestionnaireResponse として送る
// (先に単独 POST しない — 本体を保存しなかったときに回答だけ残る孤児を防ぐ)。
export interface TemplateDraft {
  questionnaire: fhir4.Questionnaire;
  response: fhir4.QuestionnaireResponse;
  // シェーマ画像描き込みの Binary 作成エントリ(QR と同じ Bundle に同梱)。
  imageEntries: fhir4.BundleEntry[];
}

// テンプレートから記載した箇所と、その回答の紐付け。
export interface TemplateBinding {
  // 保存済み QR の id。新規記入でまだ保存していなければ null。
  responseId: string | null;
  // 直近のモーダル記入内容。保存済みで再編集していなければ null。
  draft: TemplateDraft | null;
}

/** テンプレート名を見出しに付けた平文。単独の文書として見せる「平文表示」用。 */
export function questionnaireResponseDocumentText(
  questionnaire: fhir4.Questionnaire,
  response: fhir4.QuestionnaireResponse,
): string {
  const title = questionnaire.title ?? questionnaire.name ?? "";
  return [title, "", questionnaireResponsePlainText(questionnaire, response)].join("\n");
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
