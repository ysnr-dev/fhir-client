import type { Disease, Modifier } from "../api/masterClient";

// JP Core / 電子カルテ情報共有サービス(eCS)で定義されている正式な URI 群。
const PROFILE_URL = "http://jpfhir.jp/fhir/core/StructureDefinition/JP_Condition";
// 病名: MEDIS ICD10対応標準病名マスター
const DISEASE_KEY_NUMBER_SYSTEM = "http://medis.or.jp/CodeSystem/master-disease-keyNumber"; // 病名管理番号
const DISEASE_EXCHANGE_SYSTEM = "http://medis.or.jp/CodeSystem/master-disease-exCode"; // 病名交換用コード
const DISEASE_RECEIPT_SYSTEM = "http://jpfhir.jp/fhir/core/mhlw/CodeSystem/masterB-disease"; // レセ電算用傷病名コード
const ICD10_SYSTEM = "http://jpfhir.jp/fhir/core/mhlw/CodeSystem/ICD10-2013-full";
// 修飾語: MEDIS 修飾語テーブル
const MODIFIER_KEY_NUMBER_SYSTEM = "http://medis.or.jp/CodeSystem/master-disease-modKeyNumber"; // 修飾語管理番号
const MODIFIER_EXCHANGE_SYSTEM = "http://medis.or.jp/CodeSystem/master-disease-modExCode"; // 修飾語交換用コード
const MODIFIER_RECEIPT_SYSTEM = "http://jpfhir.jp/fhir/core/mhlw/CodeSystem/masterZ-disease-modifier"; // レセ電算用修飾語コード
// 修飾語を格納する JP Core 拡張(接頭語・接尾語とも 0..*)
const PREFIX_MODIFIER_EXT_URL =
  "http://jpfhir.jp/fhir/core/Extension/StructureDefinition/JP_Condition_DiseasePrefixModifier";
const POSTFIX_MODIFIER_EXT_URL =
  "http://jpfhir.jp/fhir/core/Extension/StructureDefinition/JP_Condition_DiseasePostfixModifier";

const CLINICAL_STATUS_SYSTEM = "http://terminology.hl7.org/CodeSystem/condition-clinical";
const VERIFICATION_STATUS_SYSTEM = "http://terminology.hl7.org/CodeSystem/condition-ver-status";
const CATEGORY_SYSTEM = "http://terminology.hl7.org/CodeSystem/condition-category";

// プロブレム番号(#1, #2...)を保持するアプリローカル拡張。
// 表示順から動的に採番すると、削除や日付修正のたびに番号がずれて過去の診療記録が
// 指すプロブレムが変わってしまうため、登録時に採番した番号をリソースに永続化する
// (clinicalNoteHelpers.ts の SECTION_QR_EXT_URL と同じ URL 規約)。
const PROBLEM_NUMBER_EXT_URL = "http://fhir-client.local/StructureDefinition/problem-number";

// 病名の区分。POMR のプロブレムリストと、レセプト用の保険病名を同じ Condition で
// 区分管理する。category が無い既存データは保険病名として扱う(移行不要)。
export type ConditionCategory = "problem" | "billing";

const CATEGORY_CODES: Record<ConditionCategory, { code: string; display: string }> = {
  problem: { code: "problem-list-item", display: "Problem List Item" },
  billing: { code: "encounter-diagnosis", display: "Encounter Diagnosis" },
};

export const CATEGORY_LABELS: Record<ConditionCategory, string> = {
  problem: "プロブレム",
  billing: "保険病名",
};

export function conditionCategoryOf(condition: fhir4.Condition): ConditionCategory {
  const isProblem = (condition.category ?? []).some((c) =>
    c.coding?.some((coding) => coding.code === CATEGORY_CODES.problem.code),
  );
  return isProblem ? "problem" : "billing";
}

export function problemNumberOf(condition: fhir4.Condition): number | undefined {
  const value = condition.extension?.find((e) => e.url === PROBLEM_NUMBER_EXT_URL)
    ?.valuePositiveInt;
  return typeof value === "number" ? value : undefined;
}

// 番号順の比較。番号の無いプロブレム(区分を付ける前の既存データ)は末尾へ回し、
// 番号なし同士は元の順序(取得順)を保つ。
function compareProblemNumber(a: fhir4.Condition, b: fhir4.Condition): number {
  const left = problemNumberOf(a);
  const right = problemNumberOf(b);
  if (left === undefined) return right === undefined ? 0 : 1;
  if (right === undefined) return -1;
  return left - right;
}

// プロブレムと保険病名の振り分け。上流 fhir-server は未知の検索パラメータを黙って
// 無視して全件返すことがあるため、category での絞り込みはサーバーに任せずここで行う。
// プロブレムは常に番号順にそろえる(取得は -onset-date 順なので、そのまま並べると
// #3 #1 #2 のようになり、番号を永続化している意味が無くなるため)。
export function splitConditions(conditions: fhir4.Condition[]): {
  problems: fhir4.Condition[];
  billings: fhir4.Condition[];
} {
  const problems: fhir4.Condition[] = [];
  const billings: fhir4.Condition[] = [];
  for (const condition of conditions) {
    (conditionCategoryOf(condition) === "problem" ? problems : billings).push(condition);
  }
  problems.sort(compareProblemNumber);
  return { problems, billings };
}

// 次に採番するプロブレム番号。欠番は再利用しない(番号の指す先を変えないため)。
export function nextProblemNumber(problems: fhir4.Condition[]): number {
  return problems.reduce((max, c) => Math.max(max, problemNumberOf(c) ?? 0), 0) + 1;
}

// 「#1 2型糖尿病」形式の表示名。番号が無いプロブレムは名称のみ。
export function problemLabel(condition: fhir4.Condition): string {
  const name = summarizeCondition(condition).name;
  const number = problemNumberOf(condition);
  return number === undefined ? name : `#${number} ${name}`;
}

// 転帰区分。Condition.clinicalStatus(required binding)のコードへ直接対応させる。
// 終了日(abatement)を入れる場合は active 以外でなければならない(FHIR con-4)。
export const OUTCOME_OPTIONS = [
  { code: "active", display: "継続" },
  { code: "remission", display: "軽快" },
  { code: "resolved", display: "治癒" },
  { code: "inactive", display: "中止" },
] as const;

export type OutcomeCode = (typeof OUTCOME_OPTIONS)[number]["code"];

export function outcomeDisplay(code: string | undefined): string {
  return OUTCOME_OPTIONS.find((o) => o.code === code)?.display ?? "";
}

// 修飾語区分(前から2桁目)の分類ラベル。
const MODIFIER_CATEGORY_LABELS: Record<string, string> = {
  "1": "部位",
  "2": "位置",
  "3": "病因",
  "4": "経過表現",
  "5": "状態表現",
  "6": "患者帰属",
  "7": "その他",
  "8": "接尾語",
  "9": "歯科",
};

export function modifierCategoryLabel(category: string | null | undefined): string {
  return MODIFIER_CATEGORY_LABELS[category?.charAt(1) ?? ""] ?? "";
}

export interface ConditionFormValues {
  category: ConditionCategory;
  disease: Disease | null;
  prefixModifiers: Modifier[];
  postfixModifiers: Modifier[];
  startDate: string;
  endDate: string;
  outcome: OutcomeCode;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function emptyConditionForm(): ConditionFormValues {
  return {
    category: "billing",
    disease: null,
    prefixModifiers: [],
    postfixModifiers: [],
    startDate: today(),
    endDate: "",
    outcome: "active",
  };
}

// 接頭語+病名+接尾語 を連結した表示用名称(レセプト表記と同じ並び)。
export function conditionDisplayName(values: {
  disease: Disease | null;
  prefixModifiers: Modifier[];
  postfixModifiers: Modifier[];
}): string {
  return [
    ...values.prefixModifiers.map((m) => m.name),
    values.disease?.name ?? "",
    ...values.postfixModifiers.map((m) => m.name),
  ].join("");
}

function diseaseCodings(disease: Disease): fhir4.Coding[] {
  const codings: fhir4.Coding[] = [
    { system: DISEASE_KEY_NUMBER_SYSTEM, code: disease.management_number, display: disease.name },
  ];
  if (disease.exchange_code) {
    codings.push({ system: DISEASE_EXCHANGE_SYSTEM, code: disease.exchange_code, display: disease.name });
  }
  if (disease.receipt_code) {
    codings.push({ system: DISEASE_RECEIPT_SYSTEM, code: disease.receipt_code, display: disease.name });
  }
  if (disease.icd10_2013) {
    codings.push({ system: ICD10_SYSTEM, code: disease.icd10_2013 });
  }
  return codings;
}

function modifierConcept(modifier: Modifier): fhir4.CodeableConcept {
  const codings: fhir4.Coding[] = [
    { system: MODIFIER_KEY_NUMBER_SYSTEM, code: modifier.management_number, display: modifier.name },
  ];
  if (modifier.exchange_code) {
    codings.push({ system: MODIFIER_EXCHANGE_SYSTEM, code: modifier.exchange_code, display: modifier.name });
  }
  if (modifier.receipt_code) {
    codings.push({ system: MODIFIER_RECEIPT_SYSTEM, code: modifier.receipt_code, display: modifier.name });
  }
  return { coding: codings, text: modifier.name };
}

// problemNumber: プロブレム区分のときに付与する番号。新規は nextProblemNumber()、
// 編集は problemNumberOf() で引き継いだ値を渡す。
export function buildCondition(
  values: ConditionFormValues,
  patientId: string,
  conditionId?: string,
  problemNumber?: number,
): fhir4.Condition {
  const modifierExtensions: fhir4.Extension[] = [
    ...values.prefixModifiers.map((m) => ({
      url: PREFIX_MODIFIER_EXT_URL,
      valueCodeableConcept: modifierConcept(m),
    })),
    ...values.postfixModifiers.map((m) => ({
      url: POSTFIX_MODIFIER_EXT_URL,
      valueCodeableConcept: modifierConcept(m),
    })),
  ];

  const condition: fhir4.Condition = {
    resourceType: "Condition",
    meta: { profile: [PROFILE_URL] },
    clinicalStatus: {
      coding: [
        { system: CLINICAL_STATUS_SYSTEM, code: values.outcome, display: outcomeDisplay(values.outcome) },
      ],
    },
    verificationStatus: {
      coding: [{ system: VERIFICATION_STATUS_SYSTEM, code: "confirmed" }],
    },
    // 区分は常に明示して保存する。category が無い既存データも、編集保存された時点で
    // 保険病名(encounter-diagnosis)として正規化される。
    category: [{ coding: [{ system: CATEGORY_SYSTEM, ...CATEGORY_CODES[values.category] }] }],
    code: values.disease
      ? {
          extension: modifierExtensions.length ? modifierExtensions : undefined,
          coding: diseaseCodings(values.disease),
          text: conditionDisplayName(values),
        }
      : undefined,
    subject: { reference: `Patient/${patientId}` },
  };

  if (conditionId) condition.id = conditionId;
  if (values.category === "problem" && problemNumber !== undefined) {
    condition.extension = [{ url: PROBLEM_NUMBER_EXT_URL, valuePositiveInt: problemNumber }];
  }
  // FHIR の dateTime は日付のみ(YYYY-MM-DD)を許容し、fhir-server もそのまま受理する。
  if (values.startDate) condition.onsetDateTime = values.startDate;
  if (values.endDate) condition.abatementDateTime = values.endDate;

  return condition;
}

// ---- 一覧・詳細表示のための parse ----

function codingBySystem(
  codings: fhir4.Coding[] | undefined,
  system: string,
): fhir4.Coding | undefined {
  return codings?.find((c) => c.system === system);
}

export interface ConditionSummary {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  outcomeDisplay: string;
  category: ConditionCategory;
  problemNumber?: number;
}

export function summarizeCondition(condition: fhir4.Condition): ConditionSummary {
  return {
    id: condition.id ?? "",
    name: condition.code?.text ?? codingBySystem(condition.code?.coding, DISEASE_KEY_NUMBER_SYSTEM)?.display ?? "",
    startDate: condition.onsetDateTime?.slice(0, 10) ?? "",
    endDate: condition.abatementDateTime?.slice(0, 10) ?? "",
    outcomeDisplay: outcomeDisplay(condition.clinicalStatus?.coding?.[0]?.code),
    category: conditionCategoryOf(condition),
    problemNumber: problemNumberOf(condition),
  };
}

// ---- 編集フォームへの復元 ----
//
// FHIR リソースにはマスタの全項目(id, カナなど)は保存されていないため、フォーム上で
// 再選択されない限り、コード・名称など保存済みの項目のみを持つ簡易オブジェクトとして復元する。

function diseaseFromCode(code: fhir4.CodeableConcept | undefined): Disease | null {
  const keyNumber = codingBySystem(code?.coding, DISEASE_KEY_NUMBER_SYSTEM);
  if (!keyNumber) return null;
  return {
    id: 0,
    management_number: keyNumber.code ?? "",
    name: keyNumber.display ?? code?.text ?? "",
    name_kana: null,
    adoption_category: null,
    exchange_code: codingBySystem(code?.coding, DISEASE_EXCHANGE_SYSTEM)?.code ?? null,
    icd10_2013: codingBySystem(code?.coding, ICD10_SYSTEM)?.code ?? null,
    receipt_code: codingBySystem(code?.coding, DISEASE_RECEIPT_SYSTEM)?.code ?? null,
    single_use_prohibited_category: null,
  };
}

function modifiersFromExtensions(
  code: fhir4.CodeableConcept | undefined,
  extensionUrl: string,
): Modifier[] {
  return (code?.extension ?? [])
    .filter((ext) => ext.url === extensionUrl)
    .map((ext) => {
      const concept = ext.valueCodeableConcept;
      const keyNumber = codingBySystem(concept?.coding, MODIFIER_KEY_NUMBER_SYSTEM);
      return {
        id: 0,
        management_number: keyNumber?.code ?? "",
        name: keyNumber?.display ?? concept?.text ?? "",
        name_kana: null,
        exchange_code: codingBySystem(concept?.coding, MODIFIER_EXCHANGE_SYSTEM)?.code ?? null,
        connection_position_category: null,
        modifier_category: null,
        receipt_code: codingBySystem(concept?.coding, MODIFIER_RECEIPT_SYSTEM)?.code ?? null,
      };
    });
}

export function parseConditionForm(condition: fhir4.Condition): ConditionFormValues {
  const clinicalStatus = condition.clinicalStatus?.coding?.[0]?.code;
  const outcome = OUTCOME_OPTIONS.some((o) => o.code === clinicalStatus)
    ? (clinicalStatus as OutcomeCode)
    : "active";

  return {
    category: conditionCategoryOf(condition),
    disease: diseaseFromCode(condition.code),
    prefixModifiers: modifiersFromExtensions(condition.code, PREFIX_MODIFIER_EXT_URL),
    postfixModifiers: modifiersFromExtensions(condition.code, POSTFIX_MODIFIER_EXT_URL),
    startDate: condition.onsetDateTime?.slice(0, 10) ?? "",
    endDate: condition.abatementDateTime?.slice(0, 10) ?? "",
    outcome,
  };
}
