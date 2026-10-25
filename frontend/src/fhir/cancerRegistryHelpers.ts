import { addDays } from "../lib/dates";
import { ICD10_SYSTEM, summarizeCondition } from "./conditionHelpers";
import { CODE_DIAGNOSIS, REPORT_CATEGORY_SYSTEM, splitPathoResultDetailBundle } from "./pathoResultHelpers";
import { parseRegimenApplication } from "./regimenOrderHelpers";
import { isRadiotherapyFraction } from "./radiotherapyResultHelpers";
import { plainAnswerText, questionnaireResponseProblem } from "./questionnaireResponseHelpers";
import { codingBySystem, LOINC_SYSTEM } from "./shared";

// 院内がん登録(docs/cancer-registry-design.md)。登録は施設設定のテンプレート(標準登録様式 HBCR_01)への
// 回答 1 件 = 1 腫瘍で、対象の腫瘍(Condition)は回答の対象プロブレムの拡張で持つ。
// ここには登録対象(がんの病名)の判定と検索トークン、初期値変数の組み立て、一覧の行の突き合わせ、CSV を置く。

/** 施設設定 cancer_registry(backend の DEFAULT_CANCER_REGISTRY と同じ形)。 */
export interface CancerRegistrySettings {
  /** 登録(標準登録様式)のテンプレートの url(版を問わない)。 */
  template: string;
}

export const DEFAULT_CANCER_REGISTRY: CancerRegistrySettings = {
  template: "http://fhir-client.local/Questionnaire/hbcr-01",
};

// ---- 登録対象の病名 ----

/**
 * 登録対象の ICD-10(ピリオド無し)の前方一致。悪性新生物(C00〜C97。登録は原発ごとなので続発性の C77〜C79 は除く)・
 * 上皮内癌(D00〜D09)・中枢神経系の良性/性状不詳の腫瘍(D32〜D33・D42〜D43・D35.2〜4・D44.3〜5)・
 * 骨髄異形成症候群等(D45・D46・D47.1・D47.3〜5)。
 */
export const CANCER_REGISTRY_ICD10_PREFIXES: string[] = [
  ...Array.from({ length: 98 }, (_, i) => `C${String(i).padStart(2, "0")}`).filter(
    (code) => !["C77", "C78", "C79"].includes(code),
  ),
  ...Array.from({ length: 10 }, (_, i) => `D0${i}`),
  "D32",
  "D33",
  "D42",
  "D43",
  "D352",
  "D353",
  "D354",
  "D443",
  "D444",
  "D445",
  "D45",
  "D46",
  "D471",
  "D473",
  "D474",
  "D475",
];

/** Condition の ICD-10(ピリオド無し。無ければ空)。 */
export function conditionIcd10(condition: fhir4.Condition): string {
  return codingBySystem(condition.code?.coding, ICD10_SYSTEM)?.code?.replace(".", "").toUpperCase() ?? "";
}

export function isCancerRegistryIcd10(code: string): boolean {
  const normalized = code.replace(".", "").toUpperCase();
  return Boolean(normalized) && CANCER_REGISTRY_ICD10_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function isCancerRegistryCondition(condition: fhir4.Condition): boolean {
  return isCancerRegistryIcd10(conditionIcd10(condition));
}

/**
 * 登録対象の病名を引く `code=` のトークン。上流の token 検索は完全一致なので、3 桁は 4 桁の細分類
 * (末尾 0〜9)まで広げる(データ抽出の expandIcd10 と同じ手)。
 */
export function cancerRegistryIcd10Tokens(): string[] {
  return CANCER_REGISTRY_ICD10_PREFIXES.flatMap((prefix) =>
    prefix.length === 3 ? [prefix, ...Array.from({ length: 10 }, (_, i) => `${prefix}${i}`)] : [prefix],
  ).map((code) => `${ICD10_SYSTEM}|${code}`);
}

/** 「C187」→「C18.7」。3 桁はそのまま。 */
export function formatIcd10(code: string): string {
  return code.length > 3 ? `${code.slice(0, 3)}.${code.slice(3)}` : code;
}

/**
 * ICD-O-3 の局在コードの候補(様式の形式はピリオド無しの 4 桁「C187」)。固形がん(C00〜C80)は ICD-10 の
 * 4 桁と局在コードが一致するのでそれを使い、続発性(C77〜C79)・血液腫瘍(C81〜C96)・上皮内癌(D 系)は
 * 部位を ICD-10 から決められないので空。3 桁しか無い ICD-10 も空(亜部位が決まらない)。
 */
export function cancerTopographyOf(icd10: string): string {
  const match = /^C(\d{2})\d$/.exec(icd10);
  if (!match) return "";
  const chapter = Number(match[1]);
  if (chapter > 80 || (chapter >= 77 && chapter <= 79)) return "";
  return icd10;
}

// ---- 都道府県コード ----

const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県",
  "埼玉県", "千葉県", "東京都", "神奈川県", "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県",
  "岐阜県", "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
  "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県", "香川県", "愛媛県", "高知県", "福岡県",
  "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
];

/** 住所の都道府県(「東京都」「東京」)→ JIS X 0401 の 2 桁コード。決められなければ空。 */
export function prefectureCodeOf(state: string | undefined): string {
  const text = state?.trim() ?? "";
  if (!text) return "";
  const index = PREFECTURES.findIndex((name) => name === text || name.replace(/[都道府県]$/, "") === text);
  return index < 0 ? "" : String(index + 1).padStart(2, "0");
}

// ---- 初期値変数 ----

/** 初期値式が参照できる元データ(api/queries/populate.ts が読む)。式がこれらの変数を使うときだけ揃う。 */
export interface CancerPopulateSources {
  /** 記入を始めたときの対象プロブレムの Condition id。 */
  focusConditionId?: string;
  /** 確定した病理レポートの検索結果(_include=DiagnosticReport:result 付き、新しい順)。 */
  pathoDetail?: fhir4.Bundle;
  /** 手術の実施記録(ハブ Procedure、古い順)。 */
  surgeries: fhir4.Procedure[];
  /** レジメン適用のヘッダ。 */
  regimens: fhir4.ServiceRequest[];
  /** 放射線治療のコース(ServiceRequest)と照射の実施記録(Procedure)。 */
  radiotherapy: fhir4.Resource[];
  /** 最新の受診・入院。 */
  lastEncounter?: fhir4.Encounter;
  /** 同じテンプレートのこの患者の登録(腫瘍番号の採番)。 */
  registrations: fhir4.QuestionnaireResponse[];
}

/** 初期値式から参照できる変数名(% なし)。テンプレートの式がどれかを含むときだけ元データを読む。 */
export const CANCER_POPULATE_VARIABLES = [
  "cancerName",
  "cancerIcd10",
  "cancerTopography",
  "cancerDiagnosisDate",
  "cancerDiagnosisBasis",
  "pathologyDiagnosis",
  "pathologyDate",
  "surgeryDate",
  "chemoStartDate",
  "radiotherapyStartDate",
  "deathDate",
  "lastVisitDate",
  "prefectureCode",
  "cancerRegistrationNumber",
] as const;

export function usesCancerVariables(expressions: Iterable<string | undefined>): boolean {
  for (const expression of expressions) {
    if (expression && CANCER_POPULATE_VARIABLES.some((name) => expression.includes(`%${name}`))) return true;
  }
  return false;
}

/**
 * 記入の対象の腫瘍。対象プロブレムが登録対象の病名ならそれ、そうでなければ登録対象の病名のうち
 * 開始日が最も新しいもの(conditions は開始日の新しい順)。
 */
export function focusCancerCondition(
  conditions: fhir4.Condition[],
  focusConditionId: string | undefined,
): fhir4.Condition | undefined {
  const focused = focusConditionId ? conditions.find((c) => c.id === focusConditionId) : undefined;
  if (focused && isCancerRegistryCondition(focused)) return focused;
  return conditions.find(isCancerRegistryCondition);
}

function dayOf(value: string | undefined): string {
  return value?.slice(0, 10) ?? "";
}

/** 診断日以後(診断日が無ければすべて)の日付のうち最も早いもの。 */
function earliestOnOrAfter(dates: string[], since: string): string {
  return dates
    .filter((d) => d && (!since || d >= since))
    .sort()[0] ?? "";
}

function regimenStartDates(regimens: fhir4.ServiceRequest[]): string[] {
  return regimens
    .filter((sr) => sr.status !== "entered-in-error" && sr.status !== "revoked")
    .map((sr) => parseRegimenApplication(sr)?.startDate ?? "")
    .filter(Boolean);
}

function radiotherapyDates(resources: fhir4.Resource[]): { fractions: string[]; courses: string[] } {
  const fractions: string[] = [];
  const courses: string[] = [];
  for (const resource of resources) {
    if (resource.resourceType === "Procedure") {
      const procedure = resource as fhir4.Procedure;
      if (!isRadiotherapyFraction(procedure) || procedure.status !== "completed") continue;
      fractions.push(dayOf(procedure.performedDateTime ?? procedure.performedPeriod?.start));
    } else if (resource.resourceType === "ServiceRequest") {
      const sr = resource as fhir4.ServiceRequest;
      if (sr.status === "entered-in-error" || sr.status === "revoked") continue;
      courses.push(dayOf(sr.occurrenceDateTime ?? sr.occurrencePeriod?.start));
    }
  }
  return { fractions, courses };
}

/** 確定した病理レポートのうち最新のものの診断(LOINC 22637-3)と日付・区分(SP 組織診 / CP 細胞診)。 */
function latestPathology(bundle: fhir4.Bundle | undefined): { diagnosis: string; date: string; category: string } | null {
  if (!bundle) return null;
  const { report, observations } = splitPathoResultDetailBundle(bundle);
  if (!report) return null;
  const ids = new Set((report.result ?? []).map((r) => r.reference?.split("/").pop()));
  const diagnosis = observations.find(
    (obs) => ids.has(obs.id) && codingBySystem(obs.code.coding, LOINC_SYSTEM)?.code === CODE_DIAGNOSIS,
  );
  return {
    diagnosis: diagnosis?.valueString ?? diagnosis?.valueCodeableConcept?.text ?? "",
    date: dayOf(report.effectiveDateTime ?? report.issued),
    category: report.category?.flatMap((c) => c.coding ?? []).find((c) => c.system === REPORT_CATEGORY_SYSTEM)?.code ?? "",
  };
}

/** 初期値式の環境に足す「がん登録」の変数。元データが無いときも変数名は必ず置く。 */
export function cancerPopulateValues(
  patient: fhir4.Patient,
  conditions: fhir4.Condition[],
  sources: CancerPopulateSources | undefined,
): Record<string, string | number | undefined> {
  const condition = focusCancerCondition(conditions, sources?.focusConditionId);
  const icd10 = condition ? conditionIcd10(condition) : "";
  const diagnosisDate = condition ? summarizeCondition(condition).startDate : "";
  const pathology = latestPathology(sources?.pathoDetail);
  const surgeryDate = earliestOnOrAfter(
    (sources?.surgeries ?? []).map((p) => dayOf(p.performedPeriod?.start ?? p.performedDateTime)),
    diagnosisDate,
  );
  const radiotherapy = radiotherapyDates(sources?.radiotherapy ?? []);
  const radiotherapyStartDate =
    earliestOnOrAfter(radiotherapy.fractions, diagnosisDate) || earliestOnOrAfter(radiotherapy.courses, diagnosisDate);
  const lastEncounter = sources?.lastEncounter;
  const registrations = (sources?.registrations ?? []).filter(
    (r) => r.status !== "entered-in-error" && r.status !== "stopped",
  );
  return {
    cancerName: condition ? summarizeCondition(condition).name : "",
    cancerIcd10: icd10 ? formatIcd10(icd10) : "",
    cancerTopography: cancerTopographyOf(icd10),
    cancerDiagnosisDate: diagnosisDate,
    cancerDiagnosisBasis: pathology ? (pathology.category === "CP" ? "3" : "1") : "",
    pathologyDiagnosis: pathology?.diagnosis ?? "",
    pathologyDate: pathology?.date ?? "",
    surgeryDate,
    chemoStartDate: earliestOnOrAfter(regimenStartDates(sources?.regimens ?? []), diagnosisDate),
    radiotherapyStartDate,
    deathDate: dayOf(patient.deceasedDateTime),
    lastVisitDate: dayOf(lastEncounter?.period?.start),
    prefectureCode: prefectureCodeOf(patient.address?.[0]?.state),
    cancerRegistrationNumber: sources ? registrations.length + 1 : undefined,
  };
}

// ---- 一覧の行 ----

/** 都道府県届出状況([920])と最新届出日([921])の linkId。 */
export const HBCR_REPORT_STATUS_LINK_ID = "hbcr_920";
export const HBCR_REPORT_DATE_LINK_ID = "hbcr_921";

export type CancerRegistrationState = "missing" | "draft" | "done";

export const CANCER_REGISTRATION_STATE_LABELS: Record<CancerRegistrationState, string> = {
  missing: "未登録",
  draft: "登録中",
  done: "登録済",
};

export interface CancerRegistryRow {
  condition: fhir4.Condition;
  patientId: string;
  /** 病名の開始日(診断日)。 */
  diagnosisDate: string;
  icd10: string;
  state: CancerRegistrationState;
  response?: fhir4.QuestionnaireResponse;
  /** 回答の [920] の表示名(「未届出」)。未記入は空。 */
  reportStatus: string;
  /** 回答の [920] のコード。 */
  reportStatusCode: string;
  reportDate: string;
}

/** 届出が済んでいない [920] のコード(未届出・準備中。未記入も含めて扱う)。 */
export function isUnreportedStatus(code: string): boolean {
  return !code || /^[1-4][01]$/.test(code);
}

export function responseAnswer(
  response: fhir4.QuestionnaireResponse | undefined,
  linkId: string,
): fhir4.QuestionnaireResponseItemAnswer | undefined {
  const walk = (items: fhir4.QuestionnaireResponseItem[] | undefined): fhir4.QuestionnaireResponseItemAnswer | undefined => {
    for (const item of items ?? []) {
      if (item.linkId === linkId) return item.answer?.[0];
      const found = walk(item.item) ?? walk(item.answer?.flatMap((a) => a.item ?? []));
      if (found) return found;
    }
    return undefined;
  };
  return walk(response?.item);
}

function stateOf(response: fhir4.QuestionnaireResponse | undefined): CancerRegistrationState {
  if (!response) return "missing";
  return response.status === "completed" || response.status === "amended" ? "done" : "draft";
}

/** 同じ行に当たる回答のうち採るもの。確定を優先し、同じ状態なら新しい方。 */
function pickResponse(responses: fhir4.QuestionnaireResponse[]): fhir4.QuestionnaireResponse | undefined {
  return [...responses].sort((a, b) => {
    const rank = (r: fhir4.QuestionnaireResponse) => (stateOf(r) === "done" ? 0 : 1);
    return rank(a) - rank(b) || (b.authored ?? "").localeCompare(a.authored ?? "");
  })[0];
}

/**
 * 登録対象の病名と回答を突き合わせて行にする。回答の対象プロブレムがその病名を指していればその行、
 * 対象を持たない回答はその患者の行のうち診断日が最も古い行に当てる。
 */
export function cancerRegistryRows(
  conditions: fhir4.Condition[],
  responses: fhir4.QuestionnaireResponse[],
): CancerRegistryRow[] {
  const live = responses.filter((r) => r.status !== "entered-in-error" && r.status !== "stopped");
  const byCondition = new Map<string, fhir4.QuestionnaireResponse[]>();
  const unlinkedByPatient = new Map<string, fhir4.QuestionnaireResponse[]>();
  for (const response of live) {
    const conditionId = questionnaireResponseProblem(response)?.conditionId;
    const patientId = response.subject?.reference?.split("/").pop() ?? "";
    const key = conditionId && conditions.some((c) => c.id === conditionId) ? conditionId : "";
    const map = key ? byCondition : unlinkedByPatient;
    const id = key || patientId;
    map.set(id, [...(map.get(id) ?? []), response]);
  }

  const sorted = [...conditions].sort(
    (a, b) =>
      (a.subject?.reference ?? "").localeCompare(b.subject?.reference ?? "") ||
      summarizeCondition(a).startDate.localeCompare(summarizeCondition(b).startDate),
  );
  const firstRowOfPatient = new Set<string>();
  return sorted.map((condition) => {
    const patientId = condition.subject?.reference?.split("/").pop() ?? "";
    const candidates = [...(byCondition.get(condition.id ?? "") ?? [])];
    if (!firstRowOfPatient.has(patientId)) {
      firstRowOfPatient.add(patientId);
      candidates.push(...(unlinkedByPatient.get(patientId) ?? []));
    }
    const response = pickResponse(candidates);
    const status = responseAnswer(response, HBCR_REPORT_STATUS_LINK_ID);
    return {
      condition,
      patientId,
      diagnosisDate: summarizeCondition(condition).startDate,
      icd10: formatIcd10(conditionIcd10(condition)),
      state: stateOf(response),
      response,
      reportStatus: status ? plainAnswerText(status) : "",
      reportStatusCode: status?.valueCoding?.code ?? "",
      reportDate: plainAnswerText(responseAnswer(response, HBCR_REPORT_DATE_LINK_ID) ?? {}),
    };
  });
}

/** 一覧の既定の期間(今日までの 1 年)。 */
export function defaultCancerRegistryFrom(today: string): string {
  return addDays(today, -365);
}

// ---- CSV ----

/** テンプレートの入力項目(group・display を除く)を並び順に。 */
export function questionnaireLeafItems(questionnaire: fhir4.Questionnaire | undefined): fhir4.QuestionnaireItem[] {
  const leaves: fhir4.QuestionnaireItem[] = [];
  const walk = (items: fhir4.QuestionnaireItem[] | undefined) => {
    for (const item of items ?? []) {
      if (item.type !== "group" && item.type !== "display") leaves.push(item);
      walk(item.item);
    }
  };
  walk(questionnaire?.item);
  return leaves;
}

/** 回答の値。選択肢はコード、それ以外は入力値(日付・数値は文字列)。 */
export function csvAnswerValue(answer: fhir4.QuestionnaireResponseItemAnswer | undefined): string {
  if (!answer) return "";
  if (answer.valueCoding) return answer.valueCoding.code ?? answer.valueCoding.display ?? "";
  if (answer.valueBoolean !== undefined) return answer.valueBoolean ? "1" : "0";
  return plainAnswerText(answer);
}

/**
 * 登録済の回答を標準登録様式の項目順に 1 行 1 腫瘍で並べる。見出しは項目の質問文(「[900] 病院等の名称」)。
 * 項目は回答が指す版のテンプレートから採り、版が見つからなければ最初の版の項目で出す。
 */
export function cancerRegistryCsv(
  questionnaires: fhir4.Questionnaire[],
  responses: fhir4.QuestionnaireResponse[],
): { header: string[]; rows: string[][] } {
  const base = questionnaireLeafItems(questionnaires[0]);
  const header = base.map((item) => item.text ?? item.linkId);
  const rows = responses.map((response) => {
    const own = questionnaires.find((q) => `${q.url}|${q.version}` === response.questionnaire || q.url === response.questionnaire);
    const items = own ? questionnaireLeafItems(own) : base;
    const byLinkId = new Map(items.map((item) => [item.linkId, item]));
    return base.map((item) => (byLinkId.has(item.linkId) ? csvAnswerValue(responseAnswer(response, item.linkId)) : ""));
  });
  return { header, rows };
}
