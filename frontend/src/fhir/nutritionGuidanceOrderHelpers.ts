import { today } from "../lib/dates";
import { orderProblem, type ProblemRef } from "./conditionHelpers";
import { MEAL_TYPE_SYSTEM, type MealItemRef } from "./mealOrderHelpers";
import type { TemplateBinding } from "./questionnaireResponseHelpers";
import { categoryCoding, codingBySystem, displayOf, orderComment } from "./shared";
import {
  ORDER_TYPE_SYSTEM,
  SETTING_OPTIONS,
  SETTING_SYSTEM,
  applyOrderContext,
  type OrderAttribution,
  type PrescriptionSetting,
} from "./prescriptionHelpers";

// 栄養指導オーダー。リハビリ(rehabOrderHelpers.ts)と同じ「期間継続型」で、1 つの
// オーダーが数週間〜数か月続き、その間に指導(実施)が何度も積み上がる
// (docs/nutrition-guidance-order-design.md)。
//
// リハビリと同じところ:
// - オーダーは ServiceRequest 1 本だけ。明細は持たない。
// - 進捗 Task は「部門の受け入れ状態」(受付 → 期間中ずっと accepted → 終了)。
//   日々の指導は Task を動かさず Procedure を足すだけ。
// - カルテカードは受付済のまま実施が積み上がるので、実施情報を常に出す。
//
// リハビリと違うところ:
// - 療法種別・単位数・起算日・週頻度を持たない。栄養指導は療法の種類で作業が分かれず、
//   算定は「回数と指導時間」で決まり、日数上限を数える起算日も無い。
// - 対象疾患名に加えて「指示食種」を持つ(特別食加算の指導内容)。
//
// 載せ方:
//
//   code        = 指導形態(個別 / 集団)
//   occurrenceDateTime = 開始日(指導希望日)
//   reasonCode  = 指導目的(テンプレートからも書ける)
//   extension[nutrition-guidance-order-end]      = 終了日(無ければ継続中)
//   extension[nutrition-guidance-target-disease] = 対象疾患名
//   extension[nutrition-guidance-target-condition] = 対象疾患名の元にした登録病名
//   extension[nutrition-guidance-target-diet]    = 指示食種(食種マスタのコード)
//
// 命名の注意: `meal` は食事オーダーが使用済みで、FHIR R4 の標準リソース
// `NutritionOrder` は食事箋(何を食べさせるか)を指す。栄養指導(何を教えるか)は
// `nutrition-guidance` で一意にする(設計書 §1.1)。

/** 他のオーダー種別の ServiceRequest と区別するオーダー種別。 */
export const NUTRITION_GUIDANCE_ORDER_TYPE = {
  code: "nutrition-guidance",
  display: "栄養指導",
};

/**
 * 指導形態(個別 / 集団)。栄養食事指導料の体制区分そのもので、施設ごとに増減しない
 * ため DB マスタを持たずここに置く(docs/nutrition-guidance-order-design.md §2.3)。
 */
export const GUIDANCE_FORMAT_SYSTEM =
  "http://fhir-client.local/CodeSystem/nutrition-guidance-format";

/**
 * 終了日(いつまでの指導か)。occurrencePeriod を使わないのは、上流が
 * occurrenceDateTime しか索引しないため(リハビリの rehab-order-end と同じ判断)。
 * この拡張が無いオーダーは「継続中」。
 */
const ORDER_END_EXT_URL =
  "http://fhir-client.local/StructureDefinition/nutrition-guidance-order-end";

/**
 * 対象疾患名。特別食加算の算定要件そのものなので必須入力にしている。
 * 対象プロブレム(reasonReference)とは別に、指導の対象として何を挙げたかを文字列で
 * 残す(算定上の対象疾患は登録病名と一致しないことがあるため)。
 */
const TARGET_DISEASE_EXT_URL =
  "http://fhir-client.local/StructureDefinition/nutrition-guidance-target-disease";

/**
 * 対象疾患名を「登録病名から選んだ」ときの元の Condition。放射線の依頼病名と同じで、
 * 手で書き換えたら外れる(別の文言になるため)。
 *
 * 放射線は同じ紐付けを reasonReference に載せているが、こちらは reasonReference を
 * 対象プロブレム(カルテのプロブレム絞り込みが読む)に使っているので拡張に分ける。
 */
const TARGET_CONDITION_EXT_URL =
  "http://fhir-client.local/StructureDefinition/nutrition-guidance-target-condition";

/**
 * 指示食種。食種マスタ(食事オーダーと同じ master_meal_diets)のコードで持つ。
 * 施設の食種名を手で打ち直すと表記が揺れて、あとから「どの食種で指導したか」を
 * 数えられなくなるため(docs/nutrition-guidance-order-design.md §2.2)。
 */
const TARGET_DIET_EXT_URL =
  "http://fhir-client.local/StructureDefinition/nutrition-guidance-target-diet";

/**
 * 指導目的をテンプレート(Questionnaire)から書いたときの記入内容への参照。
 * 平文は reasonCode に入れてあるので、これは「どのテンプレートにどう記入したか」を
 * 後から開くための参照(放射線の検査目的・他科依頼の依頼目的と同じ作り)。
 */
const PURPOSE_TEMPLATE_EXT_URL =
  "http://fhir-client.local/StructureDefinition/nutrition-guidance-purpose-questionnaire-response";

// ---- 固定の分類 ----

export type NutritionGuidanceFormat = "individual" | "group";

export const GUIDANCE_FORMAT_OPTIONS: { code: NutritionGuidanceFormat; display: string }[] = [
  { code: "individual", display: "個別指導" },
  { code: "group", display: "集団指導" },
];

export function guidanceFormatDisplay(code: string): string {
  return displayOf(GUIDANCE_FORMAT_OPTIONS, code);
}

/** 一覧・カードの狭い場所で使う短い表示(「個別」「集団」)。 */
export const GUIDANCE_FORMAT_SHORT: Record<NutritionGuidanceFormat, string> = {
  individual: "個別",
  group: "集団",
};

export function guidanceFormatShort(code: string): string {
  return GUIDANCE_FORMAT_SHORT[code as NutritionGuidanceFormat] ?? guidanceFormatDisplay(code);
}

// ---- フォームの値 ----

export interface NutritionGuidanceOrderFormValues {
  setting: PrescriptionSetting;
  authoredDate: string;
  /** 指導形態(必須)。 */
  format: NutritionGuidanceFormat | "";
  startDate: string;
  /** 終了日。空なら継続(終了を決めずにオーダーする)。 */
  endDate: string;
  /** 対象疾患名(必須)。 */
  targetDisease: string;
  /** 対象疾患名を登録病名から選んだときの、その病名の Condition id。手入力なら空。 */
  targetConditionId: string;
  /** 指示食種(任意)。食種マスタから選ぶ。 */
  targetDiet: MealItemRef | null;
  /** 指導目的(任意)。テンプレートから書いた場合も平文はここに入る。 */
  purpose: string;
  /** 指導目的のテンプレート記入内容。 */
  purposeTemplate: TemplateBinding | null;
  comment: string;
  problem: ProblemRef | null;
}

export function emptyNutritionGuidanceOrderForm(
  setting: PrescriptionSetting,
): NutritionGuidanceOrderFormValues {
  return {
    setting,
    authoredDate: today(),
    format: "individual",
    startDate: today(),
    endDate: "",
    targetDisease: "",
    targetConditionId: "",
    targetDiet: null,
    purpose: "",
    purposeTemplate: null,
    comment: "",
    problem: null,
  };
}

/**
 * 入力の検証。空文字なら妥当。フォームとパネルの双方から呼べるようにヘルパー側に置く
 * (リハビリと同じ)。
 */
export function validateNutritionGuidanceOrderForm(
  values: NutritionGuidanceOrderFormValues,
): string {
  if (!values.format) return "指導形態を選んでください。";
  if (!values.startDate) return "開始日を入れてください。";
  if (values.endDate && values.endDate < values.startDate) {
    return "終了日は開始日と同じか、それより後にしてください。";
  }
  if (!values.targetDisease.trim()) return "対象疾患名を入れてください。";
  return "";
}

// ---- FHIR リソースの組み立て ----

/** 栄養指導オーダーの ServiceRequest か。他オーダーとの振り分けに使う。 */
export function isNutritionGuidanceServiceRequest(sr: fhir4.ServiceRequest): boolean {
  return categoryCoding(sr, ORDER_TYPE_SYSTEM)?.code === NUTRITION_GUIDANCE_ORDER_TYPE.code;
}

function buildNutritionGuidanceServiceRequest(
  values: NutritionGuidanceOrderFormValues,
  patientId: string,
  requester: OrderAttribution,
  purposeTemplateRef: string,
  serviceRequestId?: string,
): fhir4.ServiceRequest {
  const resource: fhir4.ServiceRequest = {
    resourceType: "ServiceRequest",
    status: "active",
    intent: "order",
    category: [
      { coding: [{ system: ORDER_TYPE_SYSTEM, ...NUTRITION_GUIDANCE_ORDER_TYPE }] },
      ...(values.setting
        ? [
            {
              coding: [
                {
                  system: SETTING_SYSTEM,
                  code: values.setting,
                  display: displayOf(SETTING_OPTIONS, values.setting),
                },
              ],
            },
          ]
        : []),
    ],
    subject: { reference: `Patient/${patientId}` },
    authoredOn: values.authoredDate,
    // 開始日。部門一覧はこの日付でオーダーを拾い、カルテカードもこの日に置く。
    // 時刻は持たない(何時に指導するかは予約 Appointment / 実施 Procedure の担当)。
    occurrenceDateTime: values.startDate,
  };

  if (serviceRequestId) resource.id = serviceRequestId;

  // 指導形態。栄養部門の受け入れ体制と算定区分がこれで決まる。
  if (values.format) {
    const display = guidanceFormatDisplay(values.format);
    resource.code = {
      coding: [{ system: GUIDANCE_FORMAT_SYSTEM, code: values.format, display }],
      text: display,
    };
  }

  // 指導目的。何を指導してほしいかそのものなので、コード化はせず平文で持つ
  // (テンプレートから書いた場合も、平文はここに入れて読む側の作りを変えない)。
  if (values.purpose.trim()) resource.reasonCode = [{ text: values.purpose.trim() }];

  const extension: fhir4.Extension[] = [];
  if (values.endDate) {
    extension.push({ url: ORDER_END_EXT_URL, valueDate: values.endDate });
  }
  if (values.targetDisease.trim()) {
    extension.push({ url: TARGET_DISEASE_EXT_URL, valueString: values.targetDisease.trim() });
    // どの登録病名から写したか。手で書き換えたときは画面側で外れている。
    if (values.targetConditionId) {
      extension.push({
        url: TARGET_CONDITION_EXT_URL,
        valueReference: {
          reference: `Condition/${values.targetConditionId}`,
          display: values.targetDisease.trim(),
        },
      });
    }
  }
  if (values.targetDiet) {
    extension.push({
      url: TARGET_DIET_EXT_URL,
      valueCoding: {
        system: MEAL_TYPE_SYSTEM,
        code: values.targetDiet.code,
        display: values.targetDiet.name,
      },
    });
  }
  if (purposeTemplateRef) {
    extension.push({
      url: PURPOSE_TEMPLATE_EXT_URL,
      valueReference: { reference: purposeTemplateRef },
    });
  }
  if (extension.length > 0) resource.extension = extension;

  if (values.comment.trim()) resource.note = [{ text: values.comment.trim() }];

  if (values.problem) {
    resource.reasonReference = [
      {
        reference: `Condition/${values.problem.conditionId}`,
        display: values.problem.display,
      },
    ];
  }

  // 依頼医師・依頼科・入院病棟のローカル拡張。上で拡張を積んであるので、
  // applyOrderContext は既存の extension に足す形で効く。
  applyOrderContext(resource, requester);

  return resource;
}

function transactionBundle(entry: fhir4.BundleEntry[]): fhir4.Bundle {
  return { resourceType: "Bundle", type: "transaction", entry };
}

/**
 * 指導目的のテンプレート記入内容を Bundle に積み、オーダーから指す参照を返す。
 *
 * オーダー本体と同じ transaction に載せるのは、先に単独で保存すると「オーダーを
 * 保存しなかったときに回答だけが残る」ため(他科依頼・放射線と同じ)。
 * 参照が外れた回答は呼び出し側が DELETE する。
 */
function pushPurposeTemplateEntry(
  entries: fhir4.BundleEntry[],
  binding: TemplateBinding | null,
): { reference: string; keptResponseId: string } {
  if (!binding) return { reference: "", keptResponseId: "" };
  const { responseId, draft } = binding;
  if (!draft) {
    // 再編集していない保存済みの回答 → 参照だけ引き継ぐ。
    return responseId
      ? { reference: `QuestionnaireResponse/${responseId}`, keptResponseId: responseId }
      : { reference: "", keptResponseId: "" };
  }
  // 保存済みの再編集は同じ id へ PUT、新規記入は urn:uuid で POST し、
  // 実 ID への解決は上流の transaction 処理に任せる。
  const reference = responseId
    ? `QuestionnaireResponse/${responseId}`
    : `urn:uuid:${crypto.randomUUID()}`;
  if (responseId) {
    entries.push({
      resource: { ...draft.response, id: responseId },
      request: { method: "PUT", url: reference },
    });
  } else {
    entries.push({
      fullUrl: reference,
      resource: draft.response,
      request: { method: "POST", url: "QuestionnaireResponse" },
    });
  }
  entries.push(...draft.imageEntries);
  return { reference, keptResponseId: responseId ?? "" };
}

/** 新規登録。明細は無いが、指導目的をテンプレートから書いていれば回答も同梱する。 */
export function buildNutritionGuidanceOrderBundle(
  values: NutritionGuidanceOrderFormValues,
  patientId: string,
  requester: OrderAttribution,
): fhir4.Bundle {
  // 記入内容はオーダーより先に置く(オーダーがプレースホルダで指すため)。
  const entries: fhir4.BundleEntry[] = [];
  const template = pushPurposeTemplateEntry(entries, values.purposeTemplate);
  entries.push({
    resource: buildNutritionGuidanceServiceRequest(
      values,
      patientId,
      requester,
      template.reference,
    ),
    request: { method: "POST", url: "ServiceRequest" },
  });
  return transactionBundle(entries);
}

/** 更新。既存ヘッダへの PUT と、テンプレートを解除した回答の後始末。 */
export function buildNutritionGuidanceOrderUpdateBundle(
  values: NutritionGuidanceOrderFormValues,
  patientId: string,
  existing: fhir4.ServiceRequest,
  requester: OrderAttribution,
): fhir4.Bundle {
  const serviceRequestId = existing.id ?? "";

  const entries: fhir4.BundleEntry[] = [];
  const template = pushPurposeTemplateEntry(entries, values.purposeTemplate);

  entries.push({
    resource: buildNutritionGuidanceServiceRequest(
      values,
      patientId,
      requester,
      template.reference,
      serviceRequestId,
    ),
    request: { method: "PUT", url: `ServiceRequest/${serviceRequestId}` },
  });

  // テンプレートを解除した(参照が外れた)記入内容も同じ transaction で消す。
  for (const id of nutritionGuidanceOrderResponseIds([existing])) {
    if (id !== template.keptResponseId) {
      entries.push({ request: { method: "DELETE", url: `QuestionnaireResponse/${id}` } });
    }
  }

  return transactionBundle(entries);
}

/**
 * 継続中のオーダーに終了日を書き足す PUT エントリ。
 *
 * 部門一覧の「終了」と退院時の打ち切りで使う。オーダー全体を置き換える PUT なので、
 * 元のリソースを基に拡張だけ差し替える(リハビリの buildRehabOrderCloseEntry と同じ)。
 *
 * 終了で Task を completed にするだけでなく ServiceRequest にも終了日を書くのは、
 * status=active のまま残ると部門一覧の `occurrence=le{基準日}` に永久にヒットし
 * 続けるため(docs/nutrition-guidance-order-design.md §3)。
 */
export function buildNutritionGuidanceOrderCloseEntry(
  sr: fhir4.ServiceRequest,
  endDate: string,
): fhir4.BundleEntry {
  const next: fhir4.ServiceRequest = {
    ...sr,
    extension: [
      ...(sr.extension ?? []).filter((e) => e.url !== ORDER_END_EXT_URL),
      { url: ORDER_END_EXT_URL, valueDate: endDate },
    ],
  };
  return { resource: next, request: { method: "PUT", url: `ServiceRequest/${sr.id}` } };
}

/**
 * 退院などで栄養指導を打ち切る PUT エントリ。指定の日までで終わっていないオーダー
 * だけを対象にするので、退院の transaction にそのまま足せる(対象が無ければ空配列)。
 */
export function buildNutritionGuidanceOrderStopEntries(
  orders: fhir4.ServiceRequest[],
  endDate: string,
): fhir4.BundleEntry[] {
  return orders
    .filter((sr) => nutritionGuidanceOrderNeedsStop(sr, endDate))
    .map((sr) => buildNutritionGuidanceOrderCloseEntry(sr, endDate));
}

/**
 * 既存のオーダーを DO(流用)して新規登録するためのフォーム値。開始を当日に戻し、
 * 終了は引き継がない(前のオーダーの終了日をそのまま持ってくると過去日になる)。
 * 対象疾患・指示食種は患者の状態なのでそのまま引き継ぐ。
 *
 * 指導目的のテンプレート紐付けは捨てる(平文は残す)。引き継ぐと DO 元のオーダーと
 * 同じ記入内容を 2 件のオーダーが指すことになり、片方を消すともう片方から辿れなく
 * なるため(他科依頼の DO と同じ)。
 */
export function buildDoNutritionGuidanceOrderForm(
  values: NutritionGuidanceOrderFormValues,
  setting: PrescriptionSetting,
): NutritionGuidanceOrderFormValues {
  return {
    ...values,
    setting,
    authoredDate: today(),
    startDate: today(),
    endDate: "",
    purposeTemplate: null,
  };
}

// ---- 一覧・カルテ表示のための parse ----

export function nutritionGuidanceOrderEnd(sr: fhir4.ServiceRequest): string {
  const extension = sr.extension?.find((e) => e.url === ORDER_END_EXT_URL);
  return extension?.valueDate ?? extension?.valueDateTime?.slice(0, 10) ?? "";
}

export function nutritionGuidanceTargetDisease(sr: fhir4.ServiceRequest): string {
  return sr.extension?.find((e) => e.url === TARGET_DISEASE_EXT_URL)?.valueString ?? "";
}

/** 対象疾患名の元にした登録病名の id。手入力で書いたオーダーでは空。 */
export function nutritionGuidanceTargetConditionId(sr: fhir4.ServiceRequest): string {
  const reference = sr.extension?.find((e) => e.url === TARGET_CONDITION_EXT_URL)?.valueReference
    ?.reference;
  return reference?.startsWith("Condition/") ? reference.split("/")[1] : "";
}

/** 指示食種(食種マスタのコードと名称)。指定が無ければ null。 */
export function nutritionGuidanceTargetDiet(sr: fhir4.ServiceRequest): MealItemRef | null {
  const coding = sr.extension?.find((e) => e.url === TARGET_DIET_EXT_URL)?.valueCoding;
  return coding?.code ? { code: coding.code, name: coding.display || coding.code } : null;
}

/** 指導目的。コード化していないので text をそのまま読む。 */
export function nutritionGuidancePurpose(sr: fhir4.ServiceRequest): string {
  return sr.reasonCode?.[0]?.text ?? "";
}

function purposeResponseIdOf(sr: fhir4.ServiceRequest): string {
  const reference = sr.extension?.find((e) => e.url === PURPOSE_TEMPLATE_EXT_URL)?.valueReference
    ?.reference;
  return reference?.startsWith("QuestionnaireResponse/") ? reference.split("/")[1] : "";
}

/**
 * オーダーから参照されているテンプレート記入内容の id。カルテのタイムラインが
 * 「オーダーのカードに描くので単独のテンプレートカードにはしない」判定に使う。
 */
export function nutritionGuidanceOrderResponseIds(
  serviceRequests: fhir4.ServiceRequest[],
): string[] {
  return serviceRequests.map(purposeResponseIdOf).filter(Boolean);
}

/** 指導目的がテンプレート由来なら、その回答への紐付け。 */
export function nutritionGuidancePurposeTemplate(
  sr: fhir4.ServiceRequest,
): TemplateBinding | null {
  const responseId = purposeResponseIdOf(sr);
  return responseId ? { responseId, draft: null } : null;
}

export function nutritionGuidanceFormat(sr: fhir4.ServiceRequest): string {
  return codingBySystem(sr.code?.coding, GUIDANCE_FORMAT_SYSTEM)?.code ?? "";
}

/** 「8/29」形式の短い日付。 */
function shortDate(date: string): string {
  const [, month, day] = date.split("-");
  return month && day ? `${Number(month)}/${Number(day)}` : date;
}

export interface NutritionGuidanceOrderSummary {
  settingDisplay: string;
  /** 指導形態の表示(「個別指導」)。 */
  formatDisplay: string;
  /** 狭い場所用の短い表示(「個別」)。 */
  formatShort: string;
  format: string;
  /** 「8/29〜継続中」「8/29〜9/30」。 */
  periodLabel: string;
  /** 終了を決めていないオーダーか。 */
  continuing: boolean;
  startDate: string;
  endDate: string;
  targetDisease: string;
  /** 指示食種の名称。指定が無ければ空。 */
  targetDiet: string;
  purpose: string;
  comment: string;
}

export function summarizeNutritionGuidanceOrder(
  sr: fhir4.ServiceRequest,
): NutritionGuidanceOrderSummary {
  const format = nutritionGuidanceFormat(sr);
  const startDate = (sr.occurrenceDateTime ?? "").slice(0, 10);
  const endDate = nutritionGuidanceOrderEnd(sr);

  return {
    settingDisplay: categoryCoding(sr, SETTING_SYSTEM)?.display ?? "",
    formatDisplay: sr.code?.text || guidanceFormatDisplay(format),
    formatShort: guidanceFormatShort(format),
    format,
    periodLabel: startDate
      ? `${shortDate(startDate)}〜${endDate ? shortDate(endDate) : "継続中"}`
      : "",
    continuing: !endDate,
    startDate,
    endDate,
    targetDisease: nutritionGuidanceTargetDisease(sr),
    targetDiet: nutritionGuidanceTargetDiet(sr)?.name ?? "",
    purpose: nutritionGuidancePurpose(sr),
    comment: orderComment(sr),
  };
}

/**
 * 指定の日以降まで続くオーダーか(終了日を持たないオーダーは常に true)。
 * 上流に「終了拡張が未来か」を問い合わせる術が無いので、候補を引いてからここで絞る
 * (リハビリの rehabOrderEndsOnOrAfter と同じ)。
 */
export function nutritionGuidanceOrderEndsOnOrAfter(
  sr: fhir4.ServiceRequest,
  at: string,
): boolean {
  const end = nutritionGuidanceOrderEnd(sr);
  return !end || end >= at;
}

/** 指定の日に効いている栄養指導オーダーか(その日までに始まり、まだ終わっていない)。 */
export function isNutritionGuidanceOrderRunningOn(
  sr: fhir4.ServiceRequest,
  at: string,
): boolean {
  const start = (sr.occurrenceDateTime ?? "").slice(0, 10);
  if (!start || start > at) return false;
  return nutritionGuidanceOrderEndsOnOrAfter(sr, at);
}

/**
 * 指定の日より後まで続いてしまうオーダーか(= 退院・終了で打ち切る必要があるか)。
 * すでにその日以前で終わっているオーダーは触らない(終了を後ろへ動かさない)。
 */
export function nutritionGuidanceOrderNeedsStop(
  sr: fhir4.ServiceRequest,
  endDate: string,
): boolean {
  const end = nutritionGuidanceOrderEnd(sr);
  return !end || end > endDate;
}

export const nutritionGuidanceOrderComment = orderComment;
export const nutritionGuidanceOrderProblem = orderProblem;

/**
 * 「2026-09-01 個別 糖尿病」のような 1 行要約。実施入力の対象表示など、オーダーを
 * 1 行で指すところで使う。
 */
export function nutritionGuidanceOrderLabel(sr: fhir4.ServiceRequest): string {
  const summary = summarizeNutritionGuidanceOrder(sr);
  return [summary.startDate, summary.formatShort, summary.targetDisease]
    .filter(Boolean)
    .join(" ");
}

// ---- 編集フォームへの復元 ----

export function parseNutritionGuidanceOrderForm(
  sr: fhir4.ServiceRequest,
): NutritionGuidanceOrderFormValues {
  return {
    setting: (categoryCoding(sr, SETTING_SYSTEM)?.code ?? "") as PrescriptionSetting,
    authoredDate: sr.authoredOn?.slice(0, 10) ?? today(),
    format: nutritionGuidanceFormat(sr) as NutritionGuidanceFormat | "",
    startDate: (sr.occurrenceDateTime ?? "").slice(0, 10) || today(),
    endDate: nutritionGuidanceOrderEnd(sr),
    targetDisease: nutritionGuidanceTargetDisease(sr),
    targetConditionId: nutritionGuidanceTargetConditionId(sr),
    targetDiet: nutritionGuidanceTargetDiet(sr),
    purpose: nutritionGuidancePurpose(sr),
    purposeTemplate: nutritionGuidancePurposeTemplate(sr),
    comment: nutritionGuidanceOrderComment(sr),
    problem: nutritionGuidanceOrderProblem(sr),
  };
}
