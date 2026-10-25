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
  /** そのレポートの診断のテンプレート回答(シノプティックレポート)とテンプレート。無ければ undefined。 */
  pathoSynoptic?: { response: fhir4.QuestionnaireResponse; questionnaire?: fhir4.Questionnaire };
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
  "pathologyHistologicType",
  "pathologyMorphology",
  "pathologyPT",
  "pathologyPN",
  "pathologyPM",
  "pathologyPStage",
  "pathologyExtent",
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

// ---- シノプティックレポート(病理の診断テンプレート)からの病期 ----

/** シノプティックレポートのテンプレートの項目コード(docs/report-mappings/patho-synoptic.md)。 */
export const SYNOPTIC_ITEM_SYSTEM = "http://fhir-client.local/CodeSystem/pathology-synoptic";
export const SYNOPTIC_ITEM_CODES = {
  histologicType: "histologic-type",
  morphologyCode: "morphology-code",
  grade: "grade",
  pT: "pt",
  pN: "pn",
  pM: "pm",
  pStage: "pstage",
  neoadjuvant: "neoadjuvant",
} as const;

/** 標準登録様式の術後病理学的分類のコード。pT「T3a」のような表記(p 無し)→ 4 桁。 */
export const HBCR_PT_CODES: Record<string, string> = {
  TX: "1500", T0: "1000", Ta: "1050", Tis: "1010", "Tis(DCIS)": "1021", "Tis(LCIS)": "1022", "Tis(Paget)": "1023",
  "Tis pu": "1031", "Tis pd": "1032", "Tis(LAMN)": "1033", "Tis, NOS": "1090",
  T1: "1100", T1Mi: "1106", T1a: "1110", T1a1: "1111", T1a2: "1112", T1b: "1120", T1b1: "1121", T1b2: "1122",
  T1c: "1130", T1c1: "1131", T1c2: "1132", T1c3: "1133", T1d: "1140", "T1, NOS": "1190",
  T2: "1200", T2a: "1210", T2a1: "1211", T2a2: "1212", T2b: "1220", T2c: "1230", T2d: "1240", "T2, NOS": "1290",
  T3: "1300", T3a: "1310", T3b: "1320", T3c: "1330", T3d: "1340", T3e: "1350", "T3, NOS": "1390",
  T4: "1400", T4a: "1410", T4b: "1420", T4c: "1430", T4d: "1440", T4e: "1450", "T4, NOS": "1490",
};
export const HBCR_PN_CODES: Record<string, string> = {
  NX: "2500", N0: "2000", N1: "2100", N1Mi: "2106", N1a: "2110", "N1a(sN)": "2111", N1b: "2120", N1c: "2130",
  "N1, NOS": "2190", N2: "2200", N2a: "2210", N2b: "2220", N2c: "2230", "N2, NOS": "2290",
  N3: "2300", N3a: "2310", N3b: "2320", N3c: "2330", "N3, NOS": "2390", N4: "2400", "N4, NOS": "2490",
};
export const HBCR_PM_CODES: Record<string, string> = {
  MX: "3500", M0: "3000", M1: "3100", M1a: "3110", M1b: "3120", M1c: "3130", M1d: "3140", M1e: "3150", "M1, NOS": "3190",
};
export const HBCR_STAGE_CODES: Record<string, string> = {
  "潜伏期": "4800", "0": "4000", "0a": "4050", "0is": "4010",
  I: "4100", IA: "4110", IA1: "4111", IA2: "4112", IA3: "4113", IB: "4130", IB1: "4131", IB2: "4132",
  IC: "4140", IC1: "4141", IC2: "4142", IC3: "4143", IS: "4171", IE: "4172", "I, NOS": "4190",
  II: "4200", IIA: "4210", IIA1: "4211", IIA2: "4212", IIB: "4230", IIC: "4240", IIE: "4271", "Bulky II": "4272", "II, NOS": "4290",
  III: "4300", IIIA: "4310", IIIA1: "4311", "IIIA1(i)": "4317", "IIIA1(ii)": "4318", IIIA2: "4312", IIIB: "4320",
  IIIC: "4330", IIIC1: "4331", IIIC2: "4332", IIID: "4340", IIIE: "4371", IIIS: "4372", "IIIE＋S": "4373", "III, NOS": "4390",
  IV: "4400", IVA: "4410", IVB: "4420", IVC: "4430", "IV, NOS": "4490",
};
/** 術前治療後の術後病理学的分類(様式は yp の値を書かずこのコードにする)。 */
const HBCR_AFTER_NEOADJUVANT = "6620";
const HBCR_EXTENT_AFTER_NEOADJUVANT = "660";

/** シノプティックレポートから読んだ値(テンプレートの項目コードで引く)。 */
export interface SynopticValues {
  /** 組織型(選択肢の表示名)。 */
  histologicType: string;
  /** ICD-O-3 の形態コード「8211/3」(選択肢のコードか、形態コードの入力欄)。 */
  morphology: string;
  /** グレード G1〜G4 / GX。 */
  grade: string;
  /** T3a のような表記(p 無し)。 */
  pT: string;
  pN: string;
  pM: string;
  /** IIIA のような表記。 */
  pStage: string;
  neoadjuvant: boolean;
}

/** 回答から項目コードごとの最初の答えを拾う(linkId → 項目コードはテンプレートで引く)。 */
export function synopticValuesOf(
  response: fhir4.QuestionnaireResponse,
  questionnaire: fhir4.Questionnaire | undefined,
): SynopticValues {
  const codeByLinkId = new Map<string, string>();
  for (const item of questionnaireLeafItems(questionnaire)) {
    const code = item.code?.find((c) => c.system === SYNOPTIC_ITEM_SYSTEM)?.code;
    if (code) codeByLinkId.set(item.linkId, code);
  }
  const answers = new Map<string, fhir4.QuestionnaireResponseItemAnswer>();
  const walk = (items: fhir4.QuestionnaireResponseItem[] | undefined) => {
    for (const item of items ?? []) {
      const code = codeByLinkId.get(item.linkId);
      if (code && item.answer?.[0] && !answers.has(code)) answers.set(code, item.answer[0]);
      walk(item.item);
      for (const answer of item.answer ?? []) walk(answer.item);
    }
  };
  walk(response.item);
  const codeOf = (key: string) => answers.get(key)?.valueCoding?.code ?? "";
  const textOf = (key: string) => (answers.has(key) ? plainAnswerText(answers.get(key) ?? {}) : "");
  const histology = answers.get(SYNOPTIC_ITEM_CODES.histologicType);
  const morphologyFromOption = /^\d{4}\/\d$/.test(histology?.valueCoding?.code ?? "") ? (histology?.valueCoding?.code ?? "") : "";
  return {
    histologicType: histology ? plainAnswerText(histology) : "",
    morphology: morphologyFromOption || textOf(SYNOPTIC_ITEM_CODES.morphologyCode).trim(),
    grade: codeOf(SYNOPTIC_ITEM_CODES.grade),
    pT: codeOf(SYNOPTIC_ITEM_CODES.pT),
    pN: codeOf(SYNOPTIC_ITEM_CODES.pN),
    pM: codeOf(SYNOPTIC_ITEM_CODES.pM),
    pStage: codeOf(SYNOPTIC_ITEM_CODES.pStage),
    neoadjuvant: codeOf(SYNOPTIC_ITEM_CODES.neoadjuvant) === "yes",
  };
}

/** 様式 [329] 病理診断《テキスト》(128 字まで)に写す要約。「管状腺癌(tub) G2 pT3 pN1a pM0 IIIB 期」。 */
export function synopticSummary(values: SynopticValues): string {
  return [
    values.histologicType,
    values.grade,
    values.neoadjuvant ? "ypTNM" : "",
    values.pT ? `p${values.pT}` : "",
    values.pN ? `p${values.pN}` : "",
    values.pM ? `p${values.pM}` : "",
    values.pStage ? `${values.pStage} 期` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** 様式 [320] 病理診断《形態コード》(6 桁 = 細胞型 4 桁 + 性状 1 桁 + 分化度 1 桁)。分化度はグレードから、無ければ 9。 */
export function hbcrMorphologyCode(morphology: string, grade: string): string {
  const match = /^(\d{4})\/(\d)$/.exec(morphology);
  if (!match) return "";
  const gradeDigit = /^G([1-4])$/.exec(grade)?.[1] ?? "9";
  return `${match[1]}${match[2]}${gradeDigit}`;
}

/**
 * 様式 [680] 進展度・術後病理学的。pTNM からの機械的な読み替え(遠隔転移 > 領域リンパ節転移 > 上皮内 >
 * 隣接臓器浸潤(T4) > 限局)。部位ごとの規約の進展度とは一致しないことがあるので初期値にとどめる。
 */
export function hbcrExtentCode(values: SynopticValues): string {
  if (values.neoadjuvant) return HBCR_EXTENT_AFTER_NEOADJUVANT;
  if (/^M1/.test(values.pM)) return "440";
  if (/^N[1-4]/.test(values.pN)) return "420";
  if (/^Tis/.test(values.pT)) return "400";
  if (/^T4/.test(values.pT)) return "430";
  if (/^T[0-3]/.test(values.pT) || values.pT === "Ta") return "410";
  return "";
}

/** 様式 [600]〜[630] のコード。術前治療後はすべて 6620。 */
export function hbcrStagingCodes(values: SynopticValues): { pT: string; pN: string; pM: string; pStage: string } {
  if (values.neoadjuvant) {
    const code = HBCR_AFTER_NEOADJUVANT;
    return { pT: code, pN: code, pM: code, pStage: code };
  }
  return {
    pT: HBCR_PT_CODES[values.pT] ?? "",
    pN: HBCR_PN_CODES[values.pN] ?? "",
    pM: HBCR_PM_CODES[values.pM] ?? "",
    pStage: HBCR_STAGE_CODES[values.pStage] ?? "",
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
  const synoptic = sources?.pathoSynoptic
    ? synopticValuesOf(sources.pathoSynoptic.response, sources.pathoSynoptic.questionnaire)
    : undefined;
  const staging = synoptic ? hbcrStagingCodes(synoptic) : { pT: "", pN: "", pM: "", pStage: "" };
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
    // シノプティックレポートの平文は長い(様式のテキストは 128 字まで)ので、要約に置き換える。
    pathologyDiagnosis: synoptic ? synopticSummary(synoptic) : (pathology?.diagnosis ?? ""),
    pathologyDate: pathology?.date ?? "",
    pathologyHistologicType: synoptic?.histologicType ?? "",
    pathologyMorphology: synoptic ? hbcrMorphologyCode(synoptic.morphology, synoptic.grade) : "",
    pathologyPT: staging.pT,
    pathologyPN: staging.pN,
    pathologyPM: staging.pM,
    pathologyPStage: staging.pStage,
    pathologyExtent: synoptic ? hbcrExtentCode(synoptic) : "",
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
