import { today } from "../lib/dates";
import { orderProblem, type ProblemRef } from "./conditionHelpers";
import { categoryCoding, codingBySystem, displayOf, orderComment } from "./shared";
import {
  ORDER_TYPE_SYSTEM,
  SETTING_OPTIONS,
  SETTING_SYSTEM,
  applyOrderContext,
  type OrderAttribution,
  type PrescriptionSetting,
} from "./prescriptionHelpers";

// リハビリオーダー。食事オーダー(mealOrderHelpers.ts)と同じ「期間継続型」で、
// 1 つのオーダーが数週間〜数か月続き、その間に実施が何度も積み上がる
// (docs/rehab-order-design.md)。
//
// 検査・処置の「1 オーダー 1 実施」と違うところ:
// - オーダーは ServiceRequest 1 本だけ。明細は持たない。療法種別(PT/OT/ST)は
//   種別ごとに量が分かれないので、明細 ServiceRequest を作らず orderDetail に並べる。
// - 進捗 Task は「部門の受け入れ状態」を表す(受付 → 期間中ずっと accepted → 終了)。
//   日々の実施は Task を動かさず Procedure を足すだけ(rehabResultHelpers.ts)。
// - カルテカードは受付済のまま実施が積み上がるので、実施情報の表示条件が他部門と違う
//   (karteTimeline.ts の rehab 分岐)。
//
// 載せ方:
//
//   code        = 疾患別リハ区分(脳血管疾患等・運動器 など。算定区分そのもの)
//   orderDetail = 療法種別 ×N(PT/OT/ST。1 人に PT と OT を併せて出すことは普通にある)
//   quantityQuantity   = 1 回あたりの単位数
//   occurrenceDateTime = 開始日
//   extension[rehab-order-end]          = 終了日(無ければ継続中)
//   extension[rehab-onset-date]         = 起算日(発症日・手術日)
//   extension[rehab-target-disease]     = 対象疾患名
//   extension[rehab-frequency-per-week] = 週あたり実施回数
//
// 命名の注意: `physio` は生理検査(physiological examination)のオーダー種別として
// 既に使われている。理学療法(physiotherapy)の意味では使えないので、リハビリは
// `rehab`、療法種別は pt/ot/st を使う。なお practitionerRoleHelpers.ts の職種
// `physio` は「理学療法士」で、こちらとはまた別のコンテキスト。

/** 他のオーダー種別の ServiceRequest と区別するオーダー種別。 */
export const REHAB_ORDER_TYPE = { code: "rehab", display: "リハビリ" };

/**
 * 疾患別リハビリテーション料の区分。診療報酬上の固定の分類で施設ごとに増減しない
 * ため、DB マスタを持たずここに置く(docs/rehab-order-design.md §3)。
 */
export const DISEASE_CATEGORY_SYSTEM =
  "http://fhir-client.local/CodeSystem/rehab-disease-category";

/** 療法種別。PT/OT/ST の 3 種。 */
export const THERAPY_TYPE_SYSTEM = "http://fhir-client.local/CodeSystem/rehab-therapy-type";

/**
 * 終了日(いつまでのリハビリか)。occurrencePeriod を使わないのは、上流が
 * occurrenceDateTime しか索引しないため(食事の meal-order-end と同じ判断)。
 * この拡張が無いオーダーは「継続中」。
 */
const REHAB_ORDER_END_EXT_URL = "http://fhir-client.local/StructureDefinition/rehab-order-end";

/**
 * 起算日(発症日・手術日)。疾患別リハの算定日数上限はこの日から数えるので、
 * 上限警告を後から足せるようにオーダーに持たせておく(警告そのものは未実装)。
 */
const REHAB_ONSET_DATE_EXT_URL = "http://fhir-client.local/StructureDefinition/rehab-onset-date";

/**
 * 対象疾患名。疾患別リハの算定要件そのものなので必須入力にしている。
 * 登録病名への参照(reasonReference)とは別に、リハビリの対象として何を挙げたかを
 * 文字列で残す(算定上の対象疾患は登録病名と一致しないことがあるため)。
 */
const REHAB_TARGET_DISEASE_EXT_URL =
  "http://fhir-client.local/StructureDefinition/rehab-target-disease";

/**
 * 週あたりの実施回数。ServiceRequest.occurrence[x] は choice なので、開始日を
 * occurrenceDateTime に使うと occurrenceTiming は併用できない。厳密な曜日指定は
 * 要件に無く、実施の正本は Procedure(実際に行った日)なので目安の回数だけ持つ。
 */
const REHAB_FREQUENCY_EXT_URL =
  "http://fhir-client.local/StructureDefinition/rehab-frequency-per-week";

/** 単位数の単位。診療報酬の「単位」(1 単位 = 20 分)。UCUM に無いので表示名だけ持つ。 */
export const REHAB_UNIT_LABEL = "単位";

// ---- 固定の分類 ----

export type RehabDiseaseCategory =
  | "cerebrovascular"
  | "musculoskeletal"
  | "respiratory"
  | "cardiovascular"
  | "disuse";

/**
 * 疾患別リハビリテーション料の区分。並びは診療報酬の区分番号(H000〜H003)順。
 * 算定コードそのもの(点数表)は持たない。算定は全部門で未実装なので、
 * 対応付けが要るようになったら Master::MedicalProcedure から引く。
 */
export const DISEASE_CATEGORY_OPTIONS: { code: RehabDiseaseCategory; display: string }[] = [
  { code: "cardiovascular", display: "心大血管疾患リハビリテーション" },
  { code: "cerebrovascular", display: "脳血管疾患等リハビリテーション" },
  { code: "disuse", display: "廃用症候群リハビリテーション" },
  { code: "musculoskeletal", display: "運動器リハビリテーション" },
  { code: "respiratory", display: "呼吸器リハビリテーション" },
];

export function diseaseCategoryDisplay(code: string): string {
  return displayOf(DISEASE_CATEGORY_OPTIONS, code);
}

/** 一覧・カードの狭い場所で使う短い表示(「脳血管」「運動器」)。 */
export const DISEASE_CATEGORY_SHORT: Record<RehabDiseaseCategory, string> = {
  cardiovascular: "心大血管",
  cerebrovascular: "脳血管",
  disuse: "廃用症候群",
  musculoskeletal: "運動器",
  respiratory: "呼吸器",
};

export function diseaseCategoryShort(code: string): string {
  return DISEASE_CATEGORY_SHORT[code as RehabDiseaseCategory] ?? diseaseCategoryDisplay(code);
}

export type RehabTherapyType = "pt" | "ot" | "st";

export const THERAPY_TYPE_OPTIONS: { code: RehabTherapyType; display: string }[] = [
  { code: "pt", display: "理学療法(PT)" },
  { code: "ot", display: "作業療法(OT)" },
  { code: "st", display: "言語聴覚療法(ST)" },
];

export function therapyTypeDisplay(code: string): string {
  return displayOf(THERAPY_TYPE_OPTIONS, code);
}

/** 一覧・カードで使う短い表示(「PT」「OT」)。 */
export const THERAPY_TYPE_SHORT: Record<RehabTherapyType, string> = {
  pt: "PT",
  ot: "OT",
  st: "ST",
};

export function therapyTypeShort(code: string): string {
  return THERAPY_TYPE_SHORT[code as RehabTherapyType] ?? therapyTypeDisplay(code);
}

/** 「PT・OT」の 1 行表示。 */
export function therapyTypesLabel(types: readonly string[]): string {
  return types.map(therapyTypeShort).join("・");
}

/** 選択肢に載っている療法種別だけを、選択肢の並び順にそろえる。 */
function normalizeTherapyTypes(types: readonly string[]): RehabTherapyType[] {
  return THERAPY_TYPE_OPTIONS.map((o) => o.code).filter((code) => types.includes(code));
}

// ---- フォームの値 ----

export interface RehabOrderFormValues {
  setting: PrescriptionSetting;
  authoredDate: string;
  /** 疾患別リハ区分(必須)。 */
  diseaseCategory: RehabDiseaseCategory | "";
  /** 療法種別(1 つ以上必須)。PT と OT の併用がありうるので配列。 */
  therapyTypes: RehabTherapyType[];
  /** 1 回あたりの単位数。入力欄で扱うので文字列で持つ。 */
  unitsPerSession: string;
  /** 週あたりの実施回数(任意)。 */
  frequencyPerWeek: string;
  startDate: string;
  /** 終了日。空なら継続(終了を決めずにオーダーする)。 */
  endDate: string;
  /** 起算日(発症日・手術日)。任意。 */
  onsetDate: string;
  /** 対象疾患名(必須)。 */
  targetDisease: string;
  comment: string;
  problem: ProblemRef | null;
}

export function emptyRehabOrderForm(setting: PrescriptionSetting): RehabOrderFormValues {
  return {
    setting,
    authoredDate: today(),
    diseaseCategory: "",
    therapyTypes: [],
    unitsPerSession: "",
    frequencyPerWeek: "",
    startDate: today(),
    endDate: "",
    onsetDate: "",
    targetDisease: "",
    comment: "",
    problem: null,
  };
}

/**
 * 入力の検証。空文字なら妥当。フォームとパネルの双方から呼べるように
 * ヘルパー側に置く(他のオーダーはフォーム内の関数だが、リハビリは項目が多い)。
 */
export function validateRehabOrderForm(values: RehabOrderFormValues): string {
  if (!values.diseaseCategory) return "疾患別リハ区分を選んでください。";
  if (values.therapyTypes.length === 0) return "療法種別を 1 つ以上選んでください。";

  const units = Number(values.unitsPerSession);
  if (!values.unitsPerSession) return "1 回あたりの単位数を入れてください。";
  if (!Number.isInteger(units) || units < 1 || units > 24) {
    return "1 回あたりの単位数は 1〜24 の整数で入れてください。";
  }

  if (values.frequencyPerWeek) {
    const frequency = Number(values.frequencyPerWeek);
    if (!Number.isInteger(frequency) || frequency < 1 || frequency > 7) {
      return "週あたりの回数は 1〜7 の整数で入れてください。";
    }
  }

  if (!values.startDate) return "開始日を入れてください。";
  if (values.endDate && values.endDate < values.startDate) {
    return "終了日は開始日と同じか、それより後にしてください。";
  }
  if (values.onsetDate && values.onsetDate > values.startDate) {
    return "起算日は開始日より前の日付にしてください。";
  }
  if (!values.targetDisease.trim()) return "対象疾患名を入れてください。";

  return "";
}

// ---- FHIR リソースの組み立て ----

/** リハビリオーダーの ServiceRequest か。他オーダーとの振り分けに使う。 */
export function isRehabServiceRequest(sr: fhir4.ServiceRequest): boolean {
  return categoryCoding(sr, ORDER_TYPE_SYSTEM)?.code === REHAB_ORDER_TYPE.code;
}

function buildRehabOrderServiceRequest(
  values: RehabOrderFormValues,
  patientId: string,
  requester: OrderAttribution,
  serviceRequestId?: string,
): fhir4.ServiceRequest {
  const resource: fhir4.ServiceRequest = {
    resourceType: "ServiceRequest",
    status: "active",
    intent: "order",
    category: [
      { coding: [{ system: ORDER_TYPE_SYSTEM, ...REHAB_ORDER_TYPE }] },
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
    // 時刻は持たない(何時に行うかは予約 Appointment / 実施 Procedure の担当)。
    occurrenceDateTime: values.startDate,
  };

  if (serviceRequestId) resource.id = serviceRequestId;

  // 疾患別リハ区分。リハ部門の作業と算定区分がこれで決まる。
  if (values.diseaseCategory) {
    const display = diseaseCategoryDisplay(values.diseaseCategory);
    resource.code = {
      coding: [{ system: DISEASE_CATEGORY_SYSTEM, code: values.diseaseCategory, display }],
      text: display,
    };
  }

  // 療法種別。種別ごとに量が分かれないので明細を作らず orderDetail に並べる。
  if (values.therapyTypes.length > 0) {
    resource.orderDetail = normalizeTherapyTypes(values.therapyTypes).map((code) => ({
      coding: [{ system: THERAPY_TYPE_SYSTEM, code, display: therapyTypeDisplay(code) }],
      text: therapyTypeDisplay(code),
    }));
  }

  // 1 回あたりの単位数。UCUM に無い数え方なので system/code は載せず表示名だけ持つ。
  const units = Number(values.unitsPerSession);
  if (Number.isFinite(units) && units > 0) {
    resource.quantityQuantity = { value: units, unit: REHAB_UNIT_LABEL };
  }

  const extension: fhir4.Extension[] = [];
  if (values.endDate) {
    extension.push({ url: REHAB_ORDER_END_EXT_URL, valueDate: values.endDate });
  }
  if (values.onsetDate) {
    extension.push({ url: REHAB_ONSET_DATE_EXT_URL, valueDate: values.onsetDate });
  }
  if (values.targetDisease.trim()) {
    extension.push({
      url: REHAB_TARGET_DISEASE_EXT_URL,
      valueString: values.targetDisease.trim(),
    });
  }
  if (values.frequencyPerWeek) {
    const frequency = Number(values.frequencyPerWeek);
    if (Number.isInteger(frequency) && frequency > 0) {
      extension.push({ url: REHAB_FREQUENCY_EXT_URL, valueInteger: frequency });
    }
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

/** 新規登録。明細が無いのでヘッダ 1 件の POST だけ。 */
export function buildRehabOrderBundle(
  values: RehabOrderFormValues,
  patientId: string,
  requester: OrderAttribution,
): fhir4.Bundle {
  return transactionBundle([
    {
      resource: buildRehabOrderServiceRequest(values, patientId, requester),
      request: { method: "POST", url: "ServiceRequest" },
    },
  ]);
}

/** 更新。明細が無いので既存ヘッダ 1 件への PUT だけ。 */
export function buildRehabOrderUpdateBundle(
  values: RehabOrderFormValues,
  patientId: string,
  serviceRequestId: string,
  requester: OrderAttribution,
): fhir4.Bundle {
  return transactionBundle([
    {
      resource: buildRehabOrderServiceRequest(values, patientId, requester, serviceRequestId),
      request: { method: "PUT", url: `ServiceRequest/${serviceRequestId}` },
    },
  ]);
}

/**
 * 継続中のオーダーに終了日を書き足す PUT エントリ。
 *
 * 部門一覧の「終了」と退院時の打ち切りで使う。オーダー全体を置き換える PUT なので、
 * 元のリソースを基に拡張だけ差し替える(食事の buildMealOrderCloseEntry と同じ形)。
 *
 * 終了で Task を completed にするだけでなく ServiceRequest にも終了日を書くのは、
 * status=active のまま残ると部門一覧の `occurrence=le{基準日}` に永久にヒットし
 * 続けるため(docs/rehab-order-design.md)。
 */
export function buildRehabOrderCloseEntry(
  sr: fhir4.ServiceRequest,
  endDate: string,
): fhir4.BundleEntry {
  const next: fhir4.ServiceRequest = {
    ...sr,
    extension: [
      ...(sr.extension ?? []).filter((e) => e.url !== REHAB_ORDER_END_EXT_URL),
      { url: REHAB_ORDER_END_EXT_URL, valueDate: endDate },
    ],
  };
  return { resource: next, request: { method: "PUT", url: `ServiceRequest/${sr.id}` } };
}

/**
 * 退院などでリハビリを打ち切る PUT エントリ。指定の日までで終わっていないオーダー
 * だけを対象にするので、退院の transaction にそのまま足せる(対象が無ければ空配列)。
 */
export function buildRehabOrderStopEntries(
  orders: fhir4.ServiceRequest[],
  endDate: string,
): fhir4.BundleEntry[] {
  return orders
    .filter((sr) => rehabOrderNeedsStop(sr, endDate))
    .map((sr) => buildRehabOrderCloseEntry(sr, endDate));
}

/** オーダーを消す Bundle。明細が無いのでヘッダ 1 件だけ(予約はフェーズ 3 で足す)。 */
export function buildRehabOrderDeleteBundle(serviceRequestId: string): fhir4.Bundle {
  return transactionBundle([
    { request: { method: "DELETE", url: `ServiceRequest/${serviceRequestId}` } },
  ]);
}

/**
 * 既存のオーダーを DO(流用)して新規登録するためのフォーム値。開始を当日に戻し、
 * 終了は引き継がない(前のオーダーの終了日をそのまま持ってくると過去日になる)。
 * 起算日・対象疾患は患者の状態なのでそのまま引き継ぐ。
 */
export function buildDoRehabOrderForm(
  values: RehabOrderFormValues,
  setting: PrescriptionSetting,
): RehabOrderFormValues {
  return {
    ...values,
    setting,
    authoredDate: today(),
    startDate: today(),
    endDate: "",
  };
}

// ---- 一覧・カルテ表示のための parse ----

export function rehabOrderEnd(sr: fhir4.ServiceRequest): string {
  const extension = sr.extension?.find((e) => e.url === REHAB_ORDER_END_EXT_URL);
  return extension?.valueDate ?? extension?.valueDateTime?.slice(0, 10) ?? "";
}

export function rehabOrderOnsetDate(sr: fhir4.ServiceRequest): string {
  const extension = sr.extension?.find((e) => e.url === REHAB_ONSET_DATE_EXT_URL);
  return extension?.valueDate ?? extension?.valueDateTime?.slice(0, 10) ?? "";
}

export function rehabOrderTargetDisease(sr: fhir4.ServiceRequest): string {
  return sr.extension?.find((e) => e.url === REHAB_TARGET_DISEASE_EXT_URL)?.valueString ?? "";
}

export function rehabOrderFrequency(sr: fhir4.ServiceRequest): number | undefined {
  return sr.extension?.find((e) => e.url === REHAB_FREQUENCY_EXT_URL)?.valueInteger;
}

export function rehabOrderDiseaseCategory(sr: fhir4.ServiceRequest): string {
  return codingBySystem(sr.code?.coding, DISEASE_CATEGORY_SYSTEM)?.code ?? "";
}

/** オーダーに載っている療法種別(選択肢の並び順)。 */
export function rehabOrderTherapyTypes(sr: fhir4.ServiceRequest): RehabTherapyType[] {
  const codes: string[] = [];
  for (const detail of sr.orderDetail ?? []) {
    const code = codingBySystem(detail.coding, THERAPY_TYPE_SYSTEM)?.code;
    if (code) codes.push(code);
  }
  return normalizeTherapyTypes(codes);
}

/** 1 回あたりの単位数。 */
export function rehabOrderUnits(sr: fhir4.ServiceRequest): number | undefined {
  const value = sr.quantityQuantity?.value;
  return typeof value === "number" ? value : undefined;
}

/** 「8/29」形式の短い日付。 */
function shortDate(date: string): string {
  const [, month, day] = date.split("-");
  return month && day ? `${Number(month)}/${Number(day)}` : date;
}

export interface RehabOrderSummary {
  settingDisplay: string;
  /** 疾患別リハ区分の表示(「脳血管疾患等リハビリテーション」)。 */
  diseaseCategoryDisplay: string;
  /** 狭い場所用の短い表示(「脳血管」)。 */
  diseaseCategoryShort: string;
  diseaseCategory: string;
  therapyTypes: RehabTherapyType[];
  /** 「PT・OT」。 */
  therapyTypesLabel: string;
  /** 「8/29〜継続中」「8/29〜9/30」。 */
  periodLabel: string;
  /** 終了を決めていないオーダーか。 */
  continuing: boolean;
  startDate: string;
  endDate: string;
  onsetDate: string;
  targetDisease: string;
  /** 「週3回・1回2単位」。どちらも未入力なら空。 */
  scheduleLabel: string;
  unitsPerSession?: number;
  frequencyPerWeek?: number;
  comment: string;
}

export function summarizeRehabOrder(sr: fhir4.ServiceRequest): RehabOrderSummary {
  const diseaseCategory = rehabOrderDiseaseCategory(sr);
  const therapyTypes = rehabOrderTherapyTypes(sr);
  const startDate = (sr.occurrenceDateTime ?? "").slice(0, 10);
  const endDate = rehabOrderEnd(sr);
  const units = rehabOrderUnits(sr);
  const frequency = rehabOrderFrequency(sr);

  return {
    settingDisplay: categoryCoding(sr, SETTING_SYSTEM)?.display ?? "",
    diseaseCategoryDisplay: sr.code?.text || diseaseCategoryDisplay(diseaseCategory),
    diseaseCategoryShort: diseaseCategoryShort(diseaseCategory),
    diseaseCategory,
    therapyTypes,
    therapyTypesLabel: therapyTypesLabel(therapyTypes),
    periodLabel: startDate
      ? `${shortDate(startDate)}〜${endDate ? shortDate(endDate) : "継続中"}`
      : "",
    continuing: !endDate,
    startDate,
    endDate,
    onsetDate: rehabOrderOnsetDate(sr),
    targetDisease: rehabOrderTargetDisease(sr),
    scheduleLabel: [
      frequency ? `週${frequency}回` : "",
      units ? `1回${units}${REHAB_UNIT_LABEL}` : "",
    ]
      .filter(Boolean)
      .join("・"),
    unitsPerSession: units,
    frequencyPerWeek: frequency,
    comment: orderComment(sr),
  };
}

/**
 * 起算日からの経過日数(起算日当日を 1 日目とする)。疾患別リハの算定日数上限
 * (150 日・180 日)を数える起点になる。起算日が無ければ undefined。
 * 上限そのものの警告は未実装(docs/rehab-order-design.md §8)。
 */
export function rehabElapsedDays(onsetDate: string, at: string = today()): number | undefined {
  if (!onsetDate) return undefined;
  const from = new Date(`${onsetDate}T00:00:00`);
  const to = new Date(`${at}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return undefined;
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
}

/**
 * 指定の日以降まで続くオーダーか(終了日を持たないオーダーは常に true)。
 * 上流に「終了拡張が未来か」を問い合わせる術が無いので、候補を引いてからここで絞る
 * (食事の mealOrderEndsOnOrAfter と同じ)。
 */
export function rehabOrderEndsOnOrAfter(sr: fhir4.ServiceRequest, at: string): boolean {
  const end = rehabOrderEnd(sr);
  return !end || end >= at;
}

/** 指定の日に効いているリハビリオーダーか(その日までに始まり、まだ終わっていない)。 */
export function isRehabOrderRunningOn(sr: fhir4.ServiceRequest, at: string): boolean {
  const start = (sr.occurrenceDateTime ?? "").slice(0, 10);
  if (!start || start > at) return false;
  return rehabOrderEndsOnOrAfter(sr, at);
}

/**
 * 指定の日より後まで続いてしまうオーダーか(= 退院・終了で打ち切る必要があるか)。
 * すでにその日以前で終わっているオーダーは触らない(終了を後ろへ動かさない)。
 */
export function rehabOrderNeedsStop(sr: fhir4.ServiceRequest, endDate: string): boolean {
  const end = rehabOrderEnd(sr);
  return !end || end > endDate;
}

export const rehabOrderComment = orderComment;
export const rehabOrderProblem = orderProblem;

/**
 * 「2026-08-29 脳血管 PT・OT」のような 1 行要約。実施入力の対象表示など、
 * オーダーを 1 行で指すところで使う。
 */
export function rehabOrderLabel(sr: fhir4.ServiceRequest): string {
  const summary = summarizeRehabOrder(sr);
  return [summary.startDate, summary.diseaseCategoryShort, summary.therapyTypesLabel]
    .filter(Boolean)
    .join(" ");
}

// ---- 編集フォームへの復元 ----

export function parseRehabOrderForm(sr: fhir4.ServiceRequest): RehabOrderFormValues {
  const units = rehabOrderUnits(sr);
  const frequency = rehabOrderFrequency(sr);

  return {
    setting: (categoryCoding(sr, SETTING_SYSTEM)?.code ?? "") as PrescriptionSetting,
    authoredDate: sr.authoredOn?.slice(0, 10) ?? today(),
    diseaseCategory: rehabOrderDiseaseCategory(sr) as RehabDiseaseCategory | "",
    therapyTypes: rehabOrderTherapyTypes(sr),
    unitsPerSession: units == null ? "" : String(units),
    frequencyPerWeek: frequency == null ? "" : String(frequency),
    startDate: (sr.occurrenceDateTime ?? "").slice(0, 10) || today(),
    endDate: rehabOrderEnd(sr),
    onsetDate: rehabOrderOnsetDate(sr),
    targetDisease: rehabOrderTargetDisease(sr),
    comment: rehabOrderComment(sr),
    problem: rehabOrderProblem(sr),
  };
}
