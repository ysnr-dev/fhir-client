import { addDays, today } from "../lib/dates";
// FHIR dateTime へのタイムゾーン付与は診療記録と同じ変換でよいので共用する。
import { toFhirDateTime } from "./clinicalNoteHelpers";
import { orderProblem, type ProblemRef } from "./conditionHelpers";
import { categoryCoding, codingBySystem, displayOf, orderComment } from "./shared";
import {
  ORDER_TYPE_SYSTEM,
  SETTING_OPTIONS,
  SETTING_SYSTEM,
  applyOrderContext,
  prescriptionRequester,
  type OrderAttribution,
} from "./prescriptionHelpers";

// 食事(給食)オーダー。SS-MIX2 標準化ストレージの給食オーダメッセージ
// (OMD^O03)を参考仕様にしている。
//
// 他の部門オーダーと違い、オーダーは ServiceRequest 1 本だけ。明細も進捗 Task も
// 実施記録も予約も持たない:
// - 明細が無いのは、オーダー 1 件が指すのが食種 1 つ(+主食 1 つ)だからで、
//   検体検査のように複数項目を 1 伝票にまとめる概念が無い。
// - Task が無いのは、給食部門のワークリストを今回作らないため。作るときは
//   createTaskHelpers に taskCode を渡すだけで足せる(docs/meal-order-design.md)。
//
// SS-MIX2 との対応:
//
//   ODS-1 = T (食種、食止めを含む)  → ServiceRequest.code
//   ODS-1 = D (主食)                → ServiceRequest.orderDetail
//   ODS-2 サービス時間帯            → orderDetail[].extension[meal-timing]
//   ODS-1 = T + ODS-2 (時間帯の食止め) → extension[meal-skipped-timing] (= 欠食)
//   ODS-4 テキスト指示              → ServiceRequest.note
//   TQ1-7 開始日時 YYYYMMDDHH       → occurrenceDateTime (HH = 08/12/18)
//   TQ1-8 終了日時 YYYYMMDDHH       → extension[meal-order-end]
//
// 嗜好品(ODS-1 = P)・補助食(ODS-1 = S)は今回扱わない。
//
// SS-MIX2 に対応する項目が無く、参考仕様(名古屋第二赤十字病院「食種選択による
// オーダエントリ」)から採った項目:
//
//   欠食理由     → extension[meal-fasting-reason]   (§5)
//   副食形態     → orderDetail(system = meal-side-dish-form)(§2)
//   塩分制限(g)  → extension[meal-salt-limit]        (§2)

// 他のオーダー種別の ServiceRequest と区別するオーダー種別。
export const MEAL_ORDER_TYPE = { code: "meal", display: "食事" };

// 食種(食止めを含む)。SS-MIX2 の例でいうローカルコード表 99SKS / SSMIXTF01 にあたる。
const MEAL_TYPE_SYSTEM = "http://fhir-client.local/CodeSystem/meal-type";
// 主食。SS-MIX2 の例でいうローカルコード表 99SSK にあたる。
const STAPLE_FOOD_SYSTEM = "http://fhir-client.local/CodeSystem/meal-staple-food";
/**
 * 副食形態(きざみ・ミキサー・一口大 など)。主食と同じく orderDetail に入れ、
 * Coding の system で主食と区別する。SS-MIX2 に副食形態の ODS-1 区分は無く、
 * 参考仕様(名古屋第二赤十字病院「食種選択によるオーダエントリ」§2)の入力項目。
 */
const SIDE_DISH_FORM_SYSTEM = "http://fhir-client.local/CodeSystem/meal-side-dish-form";

/**
 * 終了(いつまでその食事か)。occurrencePeriod を使わないのは、上流が
 * occurrenceDateTime しか索引しないため(手術の surgery-duration と同じ判断)。
 * この拡張が無いオーダーは「継続中」。
 */
const MEAL_ORDER_END_EXT_URL = "http://fhir-client.local/StructureDefinition/meal-order-end";

/**
 * 主食がどの食事のものかを表す(SS-MIX2 の ODS-2 サービス時間帯)。orderDetail の
 * CodeableConcept に付ける。この拡張を持たない主食は「全食共通」で、SS-MIX2 で
 * ODS-2 をブランクにしたものと同じ意味になる(この拡張を入れる前のデータもこれ)。
 */
const MEAL_TIMING_EXT_URL = "http://fhir-client.local/StructureDefinition/meal-timing";

/**
 * 欠食(その食事だけ出さない)。SS-MIX2 では時間帯を指定した食止め
 * (`ODS|T|3^昼食|NPO^食止め^SSMIXTF01`)にあたるので、主食ではなく食種の側の情報。
 * orderDetail に混ぜず独立した拡張にしてある。1 日 3 食ぶん繰り返せる。
 */
const MEAL_SKIPPED_TIMING_EXT_URL =
  "http://fhir-client.local/StructureDefinition/meal-skipped-timing";

/**
 * 欠食理由(なぜ食事を出さないか)。SS-MIX2 に対応する項目は無く、参考仕様
 * (名古屋第二赤十字病院「食種選択によるオーダエントリ」§5 欠食)の欠食理由を
 * ローカル拡張にした。給食部門のはい膳表に出す前提の項目なので、食事が出るだけの
 * オーダーには付けない(食止めの食種か、1 食でも欠食があるオーダーだけ)。
 *
 * 理由はオーダー 1 件に 1 つ。朝は検査絶食・夕は手術絶食のように食事ごとに理由が
 * 分かれるときは、期間を分けて 2 本のオーダーにする(参考仕様も欠食は期間単位)。
 */
const MEAL_FASTING_REASON_EXT_URL =
  "http://fhir-client.local/StructureDefinition/meal-fasting-reason";

/**
 * 塩分制限(g/日)。`valueQuantity`(UCUM の g)。副食形態と違って値が連続量なので
 * orderDetail(CodeableConcept)には入らず、拡張になる。参考仕様 §2 の入力項目。
 */
const MEAL_SALT_LIMIT_EXT_URL = "http://fhir-client.local/StructureDefinition/meal-salt-limit";

const UCUM_SYSTEM = "http://unitsofmeasure.org";

/**
 * オーダーの種別と由来(入退院との結びつき)。種別は手で選ばせず、登録の文脈から決める:
 *   start         食事開始(その時点に出ている食事が無い)
 *   change        食事変更(前のオーダーを終了させて始めた)。source = 終了させたオーダー
 *   resume        再開(期限付きの食事のあとに元の食事へ戻す)。source = 写し元
 *   leave-fasting 外出泊中の食止め。leave = 外出泊 id
 * 退院食止めはオーダーではなく、既存オーダーの終了に付く理由(meal-order-end-reason)で表す
 * (SS-MIX2 と同じく食止めは食種側の情報で、退院では新しい食事を出さないため)。
 */
const MEAL_ORDER_LINK_EXT_URL = "http://fhir-client.local/StructureDefinition/meal-order-link";

/**
 * 終了が入退院の連動で書かれたものであることと、戻すための情報。手で入れた終了は
 * この拡張を持たない(それ以前のデータもそのまま)。
 *   reason      change / discharge-plan / discharge / leave
 *   leave       外出泊 id(reason=leave のとき)
 *   previousEnd 上書き前の終了。無ければ「継続だった」
 * 退院予定の取消・退院取消・外出泊取消は、この理由が一致するオーダーだけを previousEnd に戻す。
 */
const MEAL_ORDER_END_REASON_EXT_URL =
  "http://fhir-client.local/StructureDefinition/meal-order-end-reason";

export type MealOrderKind = "start" | "change" | "resume" | "leave-fasting";

export interface MealOrderLink {
  kind: MealOrderKind;
  /** change: 終了させた前オーダー、resume: 写し元のオーダーの id。 */
  sourceId?: string;
  /** 外出泊 id(外泊食止め・外泊後の再開)。 */
  leaveId?: string;
}

export type MealOrderEndReason = "change" | "discharge-plan" | "discharge" | "leave";

export interface MealOrderEndCause {
  reason: MealOrderEndReason;
  leaveId?: string;
  /** 上書き前の終了(FHIR dateTime)。空なら継続だった。 */
  previousEnd: string;
}

const MEAL_ORDER_KIND_LABELS: Record<MealOrderKind, string> = {
  start: "開始",
  change: "変更",
  resume: "再開",
  "leave-fasting": "外泊食止め",
};

const MEAL_ORDER_END_REASON_LABELS: Record<MealOrderEndReason, string> = {
  change: "変更",
  "discharge-plan": "退院食止め(予定)",
  discharge: "退院食止め",
  leave: "外泊",
};

/**
 * 食事のタイミング。SS-MIX2 が TQ1-7 / TQ1-8 の時刻に使うことを推奨している値
 * (08:朝食 / 12:昼食 / 18:夕食)をそのまま occurrenceDateTime の時刻に入れる。
 * 拡張を作らずに済み、上流の occurrence 検索にも載るため。
 */
export const MEAL_TIMING_OPTIONS = [
  { code: "breakfast", hour: "08", display: "朝" },
  { code: "lunch", hour: "12", display: "昼" },
  { code: "dinner", hour: "18", display: "夕" },
] as const;

export type MealTiming = (typeof MEAL_TIMING_OPTIONS)[number]["code"];

export const DEFAULT_MEAL_TIMING: MealTiming = "breakfast";
/** 終了の既定。「その日の夕まで」が業務上いちばん多い。 */
export const DEFAULT_MEAL_END_TIMING: MealTiming = "dinner";

/**
 * 退院に合わせて食事を止めるときの既定。退院は午前が多く、退院日は朝食までを
 * 出して昼から止めるのがふつうなので「朝まで」にしてある(画面で変えられる)。
 */
export const DEFAULT_MEAL_STOP_TIMING: MealTiming = "breakfast";

function timingHour(timing: MealTiming): string {
  return MEAL_TIMING_OPTIONS.find((t) => t.code === timing)?.hour ?? "08";
}

export function mealTimingDisplay(timing: MealTiming): string {
  return MEAL_TIMING_OPTIONS.find((t) => t.code === timing)?.display ?? "";
}

/** 「YYYY-MM-DD の朝/昼/夕」を FHIR dateTime にする。 */
function mealDateTime(date: string, timing: MealTiming): string {
  return toFhirDateTime(`${date}T${timingHour(timing)}:00`);
}

/**
 * FHIR dateTime から食事のタイミングを読み戻す。08/12/18 以外の時刻(手で直された
 * データや他システムからの取り込み)は判定できないので undefined を返し、
 * 呼び出し側は生の時刻を出す。
 */
function parseMealTiming(value: string): MealTiming | undefined {
  if (value.length <= 10) return undefined;
  const hour = value.slice(11, 13);
  return MEAL_TIMING_OPTIONS.find((t) => t.hour === hour)?.code;
}

/** タイミングの並び順。開始・終了の前後比較に使う。 */
function timingIndex(timing: MealTiming): number {
  return MEAL_TIMING_OPTIONS.findIndex((t) => t.code === timing);
}

/**
 * 食事変更のときに前のオーダーへ立てる終了。新しい食事が始まる直前の食事まで
 * が前のオーダーの担当になる(朝から新食 → 前日の夕まで)。
 */
export function previousMealPoint(
  date: string,
  timing: MealTiming,
): { date: string; timing: MealTiming } {
  const index = timingIndex(timing);
  if (index > 0) {
    return { date, timing: MEAL_TIMING_OPTIONS[index - 1].code };
  }
  // 朝の直前は前日の夕。
  return { date: addDays(date, -1), timing: "dinner" };
}

/**
 * 終了した食事の次の食事。期限付きのオーダー(外泊中の食止め など)が終わった
 * あとに元の食事へ戻す、再開オーダーの開始に使う(夕まで → 翌日の朝から)。
 */
export function nextMealPoint(
  date: string,
  timing: MealTiming,
): { date: string; timing: MealTiming } {
  const index = timingIndex(timing);
  if (index >= 0 && index < MEAL_TIMING_OPTIONS.length - 1) {
    return { date, timing: MEAL_TIMING_OPTIONS[index + 1].code };
  }
  return { date: addDays(date, 1), timing: "breakfast" };
}

// ---- 食事の提供時刻(施設設定) ----
//
// 退院・外出泊は時刻を持つので、「その時刻までに出た最後の食事」「その時刻以降に出る
// 最初の食事」を施設の提供時刻で決める。occurrenceDateTime に焼く 08/12/18 は
// SS-MIX2 のコードで、ここの提供時刻とは別物(設定を変えてもオーダーの時刻は動かない)。

/** 施設の食事提供時刻(backend の facility_settings.meal_schedule)。HH:mm。 */
export type MealScheduleSettings = Record<MealTiming, string>;

/** 設定が読めていないときの既定。backend の DEFAULT_MEAL_SCHEDULE と同じ値。 */
export const DEFAULT_MEAL_SCHEDULE: MealScheduleSettings = {
  breakfast: "08:00",
  lunch: "12:00",
  dinner: "18:00",
};

export interface MealPoint {
  date: string;
  timing: MealTiming;
}

/** `YYYY-MM-DD` / `YYYY-MM-DDTHH:mm(…)` の時刻部分(HH:mm)。日付だけなら 00:00 扱い。 */
function timeOf(dateTime: string): string {
  const time = dateTime.slice(11, 16);
  return /^\d\d:\d\d$/.test(time) ? time : "00:00";
}

/**
 * その時刻までに提供済みの最後の食事(退院 10:30 → 朝、06:00 → 前日の夕)。
 * 退院・外出泊で「どの食事まで出すか」に使う。
 */
export function lastMealAtOrBefore(dateTime: string, schedule: MealScheduleSettings): MealPoint {
  const date = dateTime.slice(0, 10);
  const time = timeOf(dateTime);
  for (let index = MEAL_TIMING_OPTIONS.length - 1; index >= 0; index -= 1) {
    const timing = MEAL_TIMING_OPTIONS[index].code;
    if (schedule[timing] <= time) return { date, timing };
  }
  return { date: addDays(date, -1), timing: "dinner" };
}

/**
 * 提供時刻がその時刻以降の最初の食事(帰院 15:00 → 夕、20:00 → 翌日の朝)。
 * 帰院・退院取消で「どの食事から戻すか」に使う。
 */
export function firstMealAtOrAfter(dateTime: string, schedule: MealScheduleSettings): MealPoint {
  const date = dateTime.slice(0, 10);
  const time = timeOf(dateTime);
  for (const option of MEAL_TIMING_OPTIONS) {
    if (schedule[option.code] >= time) return { date, timing: option.code };
  }
  return { date: addDays(date, 1), timing: "breakfast" };
}

/** 「8/30 朝」。 */
export function mealPointDisplay(point: MealPoint): string {
  return mealPointLabel(mealPointKey(point.date, point.timing));
}

/** マスタから写した食種・主食 1 件。 */
export interface MealItemRef {
  code: string;
  name: string;
}

/**
 * 欠食(その食事は出さない)。主食セレクトの選択肢として扱うので、主食の項目コードと
 * 衝突しない値にしてある。
 */
export const MEAL_SKIPPED = "__skipped__";

/** 1 食ぶんの指定。null = 主食の指定なし。 */
export type MealStapleChoice = MealItemRef | typeof MEAL_SKIPPED | null;

/** 朝・昼・夕それぞれの指定。 */
export type MealStaples = Record<MealTiming, MealStapleChoice>;

export function emptyMealStaples(): MealStaples {
  return { breakfast: null, lunch: null, dinner: null };
}

/**
 * 対象の食事すべてで同じ主食か(違うときだけ食事ごとの行を出すための判定)。
 * timings は既定で朝・昼・夕の全部。カレンダーはオーダーが担当する食事だけを渡す。
 */
export function uniformStaple(
  staples: MealStaples,
  timings: readonly MealTiming[] = MEAL_TIMING_OPTIONS.map((t) => t.code),
): MealItemRef | null {
  const first = staples[timings[0]];
  if (!first || first === MEAL_SKIPPED) return null;
  const same = timings.every((timing) => {
    const choice = staples[timing];
    return choice !== null && choice !== MEAL_SKIPPED && choice.code === first.code;
  });
  return same ? first : null;
}

/**
 * 欠食理由の選択肢(参考仕様 §5 の「ＮＰＯ、ＯＰＥ絶食、検査絶食、外泊、退院、その他」)。
 * 「入力せず」は拡張を持たない状態("")で表す。
 *
 * leave(外泊)は外出泊の連動が自動で入れるが、連動を使わずに手で食止めを出すこともある
 * ので選択肢にも残す。discharge(退院)は退院の連動が「既存オーダーの終了理由」で表す
 * (新しいオーダーを作らない)ので、こちらは手で食止めを出すときだけ使う。
 */
export const MEAL_FASTING_REASON_OPTIONS = [
  { code: "npo", display: "絶食(NPO)" },
  { code: "ope", display: "手術絶食" },
  { code: "exam", display: "検査絶食" },
  { code: "leave", display: "外泊" },
  { code: "discharge", display: "退院" },
  { code: "other", display: "その他" },
] as const;

/** 欠食理由。"" は「入力せず」。 */
export type MealFastingReason = (typeof MEAL_FASTING_REASON_OPTIONS)[number]["code"] | "";

export function mealFastingReasonDisplay(reason: MealFastingReason): string {
  return MEAL_FASTING_REASON_OPTIONS.find((r) => r.code === reason)?.display ?? "";
}

export interface MealOrderFormValues {
  /** 食種(必須)。食止めもここに入る。 */
  diet: MealItemRef | null;
  /** 食止めの食種か。主食欄を無効にするための画面の状態で、FHIR には出さない。 */
  dietIsFasting: boolean;
  /** 朝・昼・夕の主食(任意)と欠食。 */
  staples: MealStaples;
  /**
   * 副食形態(きざみ・ミキサー など、任意)。主食と違い朝昼夕の軸を持たず、
   * オーダー 1 件に 1 つ(参考仕様も食事ごとに分けていない)。
   */
  sideDishForm: MealItemRef | null;
  /** 塩分制限(g/日、任意)。入力欄の文字列のまま持ち、組み立てで数値にする。 */
  saltLimit: string;
  /**
   * 欠食理由。食止めの食種か、1 食でも欠食があるオーダーにだけ付く
   * (mealOrderHasFasting)。"" は「入力せず」。
   */
  fastingReason: MealFastingReason;
  startDate: string;
  startTiming: MealTiming;
  /** 終了日。空なら継続(終了を決めずにオーダーする)。 */
  endDate: string;
  endTiming: MealTiming;
  comment: string;
  problem: ProblemRef | null;
}

export function emptyMealOrderForm(): MealOrderFormValues {
  return {
    diet: null,
    dietIsFasting: false,
    staples: emptyMealStaples(),
    sideDishForm: null,
    saltLimit: "",
    fastingReason: "",
    startDate: today(),
    startTiming: DEFAULT_MEAL_TIMING,
    endDate: "",
    endTiming: DEFAULT_MEAL_END_TIMING,
    comment: "",
    problem: null,
  };
}

/**
 * 欠食理由を入れる余地があるか(1 日を通しての食止め、または 1 食でも欠食がある)。
 * 画面はこの判定で欄の出し入れをし、保存時にも食事が出るだけのオーダーから理由を落とす
 * (食種を食止めから戻したときに理由だけ residual に残らないようにするため)。
 */
export function mealOrderHasFasting(values: MealOrderFormValues): boolean {
  return (
    values.dietIsFasting || MEAL_TIMING_OPTIONS.some((t) => values.staples[t.code] === MEAL_SKIPPED)
  );
}

/**
 * 塩分制限の入力を数値にする。空欄・数値でない・負の値は「指定なし」(undefined)。
 * 0 は有効な指定(無塩)なので落とさない。
 */
export function parseSaltLimit(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/** 食事オーダーの ServiceRequest か。 */
export function isMealServiceRequest(sr: fhir4.ServiceRequest): boolean {
  return categoryCoding(sr, ORDER_TYPE_SYSTEM)?.code === MEAL_ORDER_TYPE.code;
}

// ---- 組み立て ----

export interface MealOrderBuildOptions {
  serviceRequestId?: string;
  /** 入院 Encounter の id。入退院の連動(退院予定の取消で戻す など)が突き合わせる。 */
  encounterId?: string;
  /** 種別と由来。新規登録・連動で作るオーダーに付ける(更新では元の値を引き継ぐ)。 */
  link?: MealOrderLink;
  /** 終了の理由。連動で終了を決めたオーダーに付ける。 */
  endCause?: MealOrderEndCause;
}

function buildMealOrderServiceRequest(
  values: MealOrderFormValues,
  patientId: string,
  requester: OrderAttribution,
  options: MealOrderBuildOptions = {},
): fhir4.ServiceRequest {
  const { serviceRequestId, encounterId, link, endCause } = options;
  const resource: fhir4.ServiceRequest = {
    resourceType: "ServiceRequest",
    status: "active",
    intent: "order",
    // 食事は入院患者にだけ出すオーダーなので、入外区分は入院で固定
    // (画面にも選択欄を置かない)。一覧の区分列を他のオーダーと揃えるために
    // 値そのものは他と同じ形で持つ。
    category: [
      { coding: [{ system: ORDER_TYPE_SYSTEM, ...MEAL_ORDER_TYPE }] },
      {
        coding: [
          {
            system: SETTING_SYSTEM,
            code: "inpatient",
            display: displayOf(SETTING_OPTIONS, "inpatient"),
          },
        ],
      },
    ],
    subject: { reference: `Patient/${patientId}` },
    authoredOn: today(),
    // 開始日 + 食事のタイミング(SS-MIX2 の TQ1-7)。
    occurrenceDateTime: mealDateTime(values.startDate, values.startTiming),
  };

  if (serviceRequestId) resource.id = serviceRequestId;
  if (encounterId) resource.encounter = { reference: `Encounter/${encounterId}` };

  if (values.diet) {
    resource.code = {
      coding: [
        { system: MEAL_TYPE_SYSTEM, code: values.diet.code, display: values.diet.name },
      ],
      text: values.diet.name,
    };
  }

  // 主食は「食種をどう出すか」の追加指示なので orderDetail(細菌検査の目的菌と同じ扱い)。
  // 朝・昼・夕で中身が変わるので、指定のある食事ごとに 1 要素ずつ出し、どの食事の
  // ものかを meal-timing 拡張で示す(SS-MIX2 の ODS-2 サービス時間帯)。
  const stapleDetails: fhir4.CodeableConcept[] = [];
  const skippedExtensions: fhir4.Extension[] = [];
  for (const timing of MEAL_TIMING_OPTIONS) {
    const choice = values.staples[timing.code];
    if (!choice) continue;
    if (choice === MEAL_SKIPPED) {
      skippedExtensions.push({ url: MEAL_SKIPPED_TIMING_EXT_URL, valueCode: timing.code });
      continue;
    }
    stapleDetails.push({
      extension: [{ url: MEAL_TIMING_EXT_URL, valueCode: timing.code }],
      coding: [{ system: STAPLE_FOOD_SYSTEM, code: choice.code, display: choice.name }],
      text: choice.name,
    });
  }
  // 副食形態は「主食以外をどう調理して出すか」なので主食と同じ orderDetail に入れ、
  // Coding の system で分ける。朝昼夕の軸は持たないので meal-timing 拡張は付けない
  // (SS-MIX2 で ODS-2 をブランクにしたものと同じ「全食共通」)。
  if (values.sideDishForm) {
    stapleDetails.push({
      coding: [
        {
          system: SIDE_DISH_FORM_SYSTEM,
          code: values.sideDishForm.code,
          display: values.sideDishForm.name,
        },
      ],
      text: values.sideDishForm.name,
    });
  }
  if (stapleDetails.length > 0) resource.orderDetail = stapleDetails;

  const extensions: fhir4.Extension[] = [...skippedExtensions];
  // 塩分制限。空欄・数値でない入力は拡張ごと出さない(画面が数値入力で弾いている)。
  const salt = parseSaltLimit(values.saltLimit);
  if (salt !== undefined) {
    extensions.push({
      url: MEAL_SALT_LIMIT_EXT_URL,
      valueQuantity: { value: salt, unit: "g", system: UCUM_SYSTEM, code: "g" },
    });
  }
  // 欠食理由。食事が出るオーダーからは画面側で落としてある(mealOrderHasFasting)ので、
  // ここは値があればそのまま書く。連動で作る外泊食止め・帰院での書き換え(rewrite)や
  // 再開オーダーの写しでも、この 1 行だけで理由が保たれる。
  if (values.fastingReason) {
    extensions.push({ url: MEAL_FASTING_REASON_EXT_URL, valueCode: values.fastingReason });
  }
  if (values.endDate) {
    extensions.push({
      url: MEAL_ORDER_END_EXT_URL,
      valueDateTime: mealDateTime(values.endDate, values.endTiming),
    });
    if (endCause) extensions.push(endCauseExtension(endCause));
  }
  if (link) extensions.push(linkExtension(link));
  // 依頼科・病棟は applyOrderContext がこの配列に足す。
  if (extensions.length > 0) resource.extension = extensions;

  if (values.comment) resource.note = [{ text: values.comment }];

  if (values.problem) {
    resource.reasonReference = [
      {
        reference: `Condition/${values.problem.conditionId}`,
        display: values.problem.display,
      },
    ];
  }

  // 依頼医師(requester)・依頼科・入院病棟のローカル拡張。終了の拡張を先に
  // 積んであるので、applyOrderContext は既存の extension に足す形で効く。
  applyOrderContext(resource, requester);

  return resource;
}

function transactionBundle(entry: fhir4.BundleEntry[]): fhir4.Bundle {
  return { resourceType: "Bundle", type: "transaction", entry };
}

function linkExtension(link: MealOrderLink): fhir4.Extension {
  const children: fhir4.Extension[] = [{ url: "kind", valueCode: link.kind }];
  if (link.sourceId) {
    children.push({ url: "source", valueReference: { reference: `ServiceRequest/${link.sourceId}` } });
  }
  if (link.leaveId) children.push({ url: "leave", valueString: link.leaveId });
  return { url: MEAL_ORDER_LINK_EXT_URL, extension: children };
}

function endCauseExtension(cause: MealOrderEndCause): fhir4.Extension {
  const children: fhir4.Extension[] = [{ url: "reason", valueCode: cause.reason }];
  if (cause.leaveId) children.push({ url: "leave", valueString: cause.leaveId });
  if (cause.previousEnd) children.push({ url: "previousEnd", valueDateTime: cause.previousEnd });
  return { url: MEAL_ORDER_END_REASON_EXT_URL, extension: children };
}

export function mealOrderLink(sr: fhir4.ServiceRequest): MealOrderLink | undefined {
  const found = sr.extension?.find((e) => e.url === MEAL_ORDER_LINK_EXT_URL);
  const kind = found?.extension?.find((c) => c.url === "kind")?.valueCode;
  if (!kind || !(kind in MEAL_ORDER_KIND_LABELS)) return undefined;
  const source = found?.extension?.find((c) => c.url === "source")?.valueReference?.reference;
  return {
    kind: kind as MealOrderKind,
    sourceId: source?.split("/").pop() || undefined,
    leaveId: found?.extension?.find((c) => c.url === "leave")?.valueString || undefined,
  };
}

/** 種別の表示。種別を持たない(連動を入れる前の)オーダーは従来どおり「変更」。 */
export function mealOrderKindLabel(sr: fhir4.ServiceRequest): string {
  return MEAL_ORDER_KIND_LABELS[mealOrderLink(sr)?.kind ?? "change"];
}

export function mealOrderEndCause(sr: fhir4.ServiceRequest): MealOrderEndCause | undefined {
  const found = sr.extension?.find((e) => e.url === MEAL_ORDER_END_REASON_EXT_URL);
  const reason = found?.extension?.find((c) => c.url === "reason")?.valueCode;
  if (!reason || !(reason in MEAL_ORDER_END_REASON_LABELS)) return undefined;
  return {
    reason: reason as MealOrderEndReason,
    leaveId: found?.extension?.find((c) => c.url === "leave")?.valueString || undefined,
    previousEnd: found?.extension?.find((c) => c.url === "previousEnd")?.valueDateTime ?? "",
  };
}

export function mealOrderEndReasonLabel(sr: fhir4.ServiceRequest): string {
  const cause = mealOrderEndCause(sr);
  return cause ? MEAL_ORDER_END_REASON_LABELS[cause.reason] : "";
}

/** 退院(予定)で止められているオーダーか。暦に「退院食止め」の印を出す判定。 */
export function isMealOrderStoppedByDischarge(sr: fhir4.ServiceRequest): boolean {
  const reason = mealOrderEndCause(sr)?.reason;
  return reason === "discharge" || reason === "discharge-plan";
}

/**
 * 連動で書き換える前の終了(FHIR dateTime、継続なら空)。終了理由を持つオーダーは
 * previousEnd、持たなければ今の終了そのもの。
 */
export function mealOrderOriginalEnd(sr: fhir4.ServiceRequest): string {
  const cause = mealOrderEndCause(sr);
  return cause ? cause.previousEnd : mealOrderEnd(sr);
}

/**
 * 継続中のオーダーに終了を書き足す PUT エントリ。食事変更(新しい食事を出すと同時に
 * 前の食事を終える)を 1 transaction で行うために使う。
 *
 * 終了は「新しい食事の直前の食事まで」。オーダー全体を置き換える PUT なので、
 * 元のリソースを基に拡張だけ差し替える。cause を渡すと終了の理由も書く(戻せるように
 * 上書き前の終了も残す。理由が同じ系統の上書きなら、さらに前の終了を引き継ぐ)。
 */
export function buildMealOrderCloseEntry(
  sr: fhir4.ServiceRequest,
  endDate: string,
  endTiming: MealTiming,
  cause?: Omit<MealOrderEndCause, "previousEnd">,
): fhir4.BundleEntry {
  const extension = (sr.extension ?? []).filter(
    (e) => e.url !== MEAL_ORDER_END_EXT_URL && e.url !== MEAL_ORDER_END_REASON_EXT_URL,
  );
  extension.push({ url: MEAL_ORDER_END_EXT_URL, valueDateTime: mealDateTime(endDate, endTiming) });
  if (cause) {
    const current = mealOrderEndCause(sr);
    const sameFamily = current && isSameEndCauseFamily(current, cause);
    extension.push(
      endCauseExtension({
        ...cause,
        previousEnd: sameFamily ? current.previousEnd : mealOrderEnd(sr),
      }),
    );
  }
  const next: fhir4.ServiceRequest = { ...sr, extension };
  return { resource: next, request: { method: "PUT", url: `ServiceRequest/${sr.id}` } };
}

/**
 * 同じ系統の理由か。退院予定 → 退院予定の日付変更 → 退院実施 は 1 つの流れなので、
 * 上書きしても「連動の前の終了」を保ち続ける。外出泊は同じ外出泊 id のときだけ。
 */
export function isSameEndCauseFamily(
  a: Pick<MealOrderEndCause, "reason" | "leaveId">,
  b: Pick<MealOrderEndCause, "reason" | "leaveId">,
): boolean {
  const discharge = (r: MealOrderEndReason) => r === "discharge" || r === "discharge-plan";
  if (discharge(a.reason) && discharge(b.reason)) return true;
  if (a.reason === "leave" && b.reason === "leave") return a.leaveId === b.leaveId;
  return a.reason === b.reason;
}

/**
 * 連動で書いた終了を取り消して、書く前の終了に戻す PUT エントリ(退院予定の取消・
 * 退院取消・外出泊取消)。上書き前が継続なら終了拡張ごと外す。
 */
export function buildMealOrderRestoreEntry(sr: fhir4.ServiceRequest): fhir4.BundleEntry {
  const previousEnd = mealOrderOriginalEnd(sr);
  const extension = (sr.extension ?? []).filter(
    (e) => e.url !== MEAL_ORDER_END_EXT_URL && e.url !== MEAL_ORDER_END_REASON_EXT_URL,
  );
  if (previousEnd) extension.push({ url: MEAL_ORDER_END_EXT_URL, valueDateTime: previousEnd });
  const next: fhir4.ServiceRequest = {
    ...sr,
    extension: extension.length > 0 ? extension : undefined,
  };
  return { resource: next, request: { method: "PUT", url: `ServiceRequest/${sr.id}` } };
}

/**
 * 退院などで食事を止める PUT エントリ。指定の食事までで終わっていないオーダーだけを
 * 対象にするので、退院の transaction にそのまま足せる(止める対象が無ければ空配列)。
 */
export function buildMealOrderStopEntries(
  orders: fhir4.ServiceRequest[],
  endDate: string,
  endTiming: MealTiming,
): fhir4.BundleEntry[] {
  return orders
    .filter((sr) => mealOrderNeedsStop(sr, endDate, endTiming))
    .map((sr) => buildMealOrderCloseEntry(sr, endDate, endTiming));
}

/**
 * 終了を決めた新しいオーダーの後に「戻す先」になり得るオーダーか。
 *
 * 外泊中の食止めのように期限付きの食事を挟むと、終了させた元のオーダーは復活しない
 * ので、そのままでは終了の翌食から食事が無くなる。新しいオーダーの終了より後まで
 * 続くはずだったオーダー(= 終了を立てて縮めたぶんが残っているもの)だけが対象。
 * 判定は退院で止める対象と同じ条件なので mealOrderNeedsStop を使い回す。
 */
export function mealOrderResumable(
  sr: fhir4.ServiceRequest,
  endDate: string,
  endTiming: MealTiming,
): boolean {
  return Boolean(endDate) && mealOrderNeedsStop(sr, endDate, endTiming);
}

/**
 * 元の食事に戻す再開オーダーの POST エントリ。中身(食種・主食・欠食・コメント・
 * プロブレム・終了)は元のオーダーから写し、開始だけを差し替える。
 *
 * 元のオーダーを延長するのではなく別オーダーを作るのは、食事オーダーが
 * 「開始した食事から終了の食事まで」の 1 区間しか表せないため(1 本で
 * 8/1〜8/9 と 8/12〜 の 2 区間は持てない)。
 *
 * 依頼医師・科・病棟は写さず、いま登録している人のものを入れる(DO と同じ扱い)。
 */
export function buildMealOrderResumeEntry(
  sr: fhir4.ServiceRequest,
  startDate: string,
  startTiming: MealTiming,
  patientId: string,
  requester: OrderAttribution,
  options: { encounterId?: string; leaveId?: string; endDate?: string; endTiming?: MealTiming } = {},
): fhir4.BundleEntry {
  const values: MealOrderFormValues = { ...parseMealOrderForm(sr), startDate, startTiming };
  if (options.endDate !== undefined) {
    values.endDate = options.endDate;
    values.endTiming = options.endTiming ?? DEFAULT_MEAL_END_TIMING;
  }
  return {
    resource: buildMealOrderServiceRequest(values, patientId, requester, {
      encounterId: options.encounterId ?? mealOrderEncounterId(sr),
      link: { kind: "resume", sourceId: sr.id, leaveId: options.leaveId },
    }),
    request: { method: "POST", url: "ServiceRequest" },
  };
}

/** FHIR dateTime(08/12/18 の時刻)を食事点に読み戻す。時刻が食事に当たらなければ undefined。 */
export function parseMealPoint(dateTime: string): MealPoint | undefined {
  const timing = parseMealTiming(dateTime);
  return timing ? { date: dateTime.slice(0, 10), timing } : undefined;
}

/** 連動で作る新規オーダー(外泊食止め など)の POST エントリ。 */
export function buildMealOrderCreateEntry(
  values: MealOrderFormValues,
  patientId: string,
  requester: OrderAttribution,
  options: MealOrderBuildOptions = {},
): fhir4.BundleEntry {
  return {
    resource: buildMealOrderServiceRequest(values, patientId, requester, options),
    request: { method: "POST", url: "ServiceRequest" },
  };
}

/**
 * 保存済みオーダーの一部(開始・終了)を書き換える PUT エントリ。種別・入院との結びつき・
 * 終了理由・依頼科などはそのまま引き継ぐ(帰院で再開オーダーの開始を動かす、
 * 外泊食止めに終了を書く など、連動が自分で作ったオーダーを直すのに使う)。
 */
export function buildMealOrderRewriteEntry(
  sr: fhir4.ServiceRequest,
  patch: Partial<MealOrderFormValues>,
): fhir4.BundleEntry {
  const values = { ...parseMealOrderForm(sr), ...patch };
  const resource = buildMealOrderServiceRequest(values, sr.subject?.reference?.split("/").pop() ?? "", prescriptionRequester(sr), {
    serviceRequestId: sr.id,
    encounterId: mealOrderEncounterId(sr),
    link: mealOrderLink(sr),
    endCause: mealOrderEndCause(sr),
  });
  // authoredOn は登録日のまま(書き換えで今日に動かさない)。
  if (sr.authoredOn) resource.authoredOn = sr.authoredOn;
  return { resource, request: { method: "PUT", url: `ServiceRequest/${sr.id}` } };
}

export function mealOrderEncounterId(sr: fhir4.ServiceRequest): string | undefined {
  return sr.encounter?.reference?.split("/").pop() || undefined;
}

/**
 * 新規登録。食事変更のときは、前のオーダーを終了する PUT を同じ transaction に
 * 入れる(新しい食事だけが登録されて前の食事が残り続ける状態を作らない)。
 * 終了を決めたオーダー(外泊中の食止め など)では、終了の次の食事から元の食事に
 * 戻す再開オーダーの POST も同じ transaction に入れられる。
 */
export function buildMealOrderBundle(
  values: MealOrderFormValues,
  patientId: string,
  requester: OrderAttribution,
  /** 同時に終了する継続中のオーダー。画面のチェックで選ばれたもの。 */
  closing: fhir4.ServiceRequest[] = [],
  /** 終了後に元の食事へ戻すオーダー。画面のチェックで選ばれたもの。 */
  resuming: fhir4.ServiceRequest[] = [],
  /** 入院 Encounter の id。 */
  encounterId?: string,
): fhir4.Bundle {
  const end = previousMealPoint(values.startDate, values.startTiming);
  const resume = nextMealPoint(values.endDate, values.endTiming);
  // 種別は文脈で決める: いま出ている食事を終了させるなら「変更」、そうでなければ「開始」。
  const link: MealOrderLink =
    closing.length > 0 ? { kind: "change", sourceId: closing[0].id } : { kind: "start" };
  return transactionBundle([
    {
      resource: buildMealOrderServiceRequest(values, patientId, requester, { encounterId, link }),
      request: { method: "POST", url: "ServiceRequest" },
    },
    ...closing.map((sr) => buildMealOrderCloseEntry(sr, end.date, end.timing, { reason: "change" })),
    // 終了を決めていないオーダーには戻す先が無い(次の指示まで続くので不要)。
    ...(values.endDate
      ? resuming
          .filter((sr) => mealOrderResumable(sr, values.endDate, values.endTiming))
          .map((sr) =>
            buildMealOrderResumeEntry(sr, resume.date, resume.timing, patientId, requester, {
              encounterId,
            }),
          )
      : []),
  ]);
}

/**
 * 更新。明細が無いので既存ヘッダ 1 件への PUT だけ。種別・入院との結びつきは元の
 * オーダーから引き継ぐ。終了の理由は、終了を変えていなければ引き継ぎ、手で変えたら外す
 * (手で決め直した終了は連動の取消で戻さない)。
 */
export function buildMealOrderUpdateBundle(
  values: MealOrderFormValues,
  patientId: string,
  serviceRequestId: string,
  requester: OrderAttribution,
  current?: fhir4.ServiceRequest,
): fhir4.Bundle {
  const cause = current ? mealOrderEndCause(current) : undefined;
  const endUnchanged =
    current &&
    (values.endDate ? mealDateTime(values.endDate, values.endTiming) : "") === mealOrderEnd(current);
  return transactionBundle([
    {
      resource: buildMealOrderServiceRequest(values, patientId, requester, {
        serviceRequestId,
        encounterId: current ? mealOrderEncounterId(current) : undefined,
        link: current ? mealOrderLink(current) : undefined,
        endCause: endUnchanged ? cause : undefined,
      }),
      request: { method: "PUT", url: `ServiceRequest/${serviceRequestId}` },
    },
  ]);
}

/**
 * 既存のオーダーを DO(流用)して新規登録するためのフォーム値。開始を当日に戻し、
 * 終了は引き継がない(前のオーダーの終了日をそのまま持ってくると過去日になる)。
 */
export function buildDoMealOrderForm(values: MealOrderFormValues): MealOrderFormValues {
  return {
    ...values,
    startDate: today(),
    startTiming: DEFAULT_MEAL_TIMING,
    endDate: "",
    endTiming: DEFAULT_MEAL_END_TIMING,
  };
}

// ---- 一覧・カルテ表示のための parse ----

/** 食事 1 食ぶんの表示行(朝・昼・夕で中身が変わるオーダーで使う)。 */
export interface MealStapleLine {
  timingDisplay: string;
  /** 主食の名称、または「欠食」。指定が無ければ「-」。 */
  text: string;
}

export interface MealOrderSummary {
  /** 食種の名称。 */
  dietName: string;
  /** 全食同じ主食のときだけ、その名称。食事ごとに違う・欠食があるときは空。 */
  stapleName: string;
  /** 食事ごとに中身が違うときだけ、朝・昼・夕の 3 行。全食同じなら空。 */
  stapleLines: MealStapleLine[];
  /** 副食形態の名称。指定が無ければ空。 */
  sideDishFormName: string;
  /** 塩分制限「6g」。指定が無ければ空。 */
  saltLimitLabel: string;
  /** 欠食理由の表示名。食止め・欠食のオーダーで、理由を入れてあるときだけ。 */
  fastingReasonLabel: string;
  /** 「8/28 朝」形式の開始。 */
  startLabel: string;
  /** 「8/30 夕まで」形式の終了。連動で決めた終了なら「8/30 朝まで(退院食止め)」。継続中なら空。 */
  endLabel: string;
  /** 種別(開始 / 変更 / 再開 / 外泊食止め)。 */
  kindLabel: string;
  /** 終了を決めていないオーダーか。 */
  continuing: boolean;
  comment: string;
}

/** 「8/28 朝」。タイミングが 08/12/18 でないデータは時刻をそのまま出す。 */
export function mealPointLabel(value: string): string {
  if (!value) return "";
  const date = value.slice(0, 10);
  const [, month, day] = date.split("-");
  const md = month && day ? `${Number(month)}/${Number(day)}` : date;
  const timing = parseMealTiming(value);
  if (timing) return `${md} ${mealTimingDisplay(timing)}`;
  return value.length > 10 ? `${md} ${value.slice(11, 16)}` : md;
}

export function mealOrderEnd(sr: fhir4.ServiceRequest): string {
  return sr.extension?.find((e) => e.url === MEAL_ORDER_END_EXT_URL)?.valueDateTime ?? "";
}

/** 副食形態。指定の無いオーダーは null。 */
export function mealSideDishForm(sr: fhir4.ServiceRequest): MealItemRef | null {
  for (const detail of sr.orderDetail ?? []) {
    const coding = codingBySystem(detail.coding, SIDE_DISH_FORM_SYSTEM);
    if (coding?.code) {
      return { code: coding.code, name: detail.text || coding.display || coding.code };
    }
  }
  return null;
}

/** 塩分制限(g/日)。指定の無いオーダーは undefined。 */
export function mealSaltLimit(sr: fhir4.ServiceRequest): number | undefined {
  const value = sr.extension?.find((e) => e.url === MEAL_SALT_LIMIT_EXT_URL)?.valueQuantity?.value;
  return typeof value === "number" ? value : undefined;
}

/** 「6g」。指定が無ければ空文字。 */
export function mealSaltLimitLabel(sr: fhir4.ServiceRequest): string {
  const value = mealSaltLimit(sr);
  return value === undefined ? "" : `${value}g`;
}

/** 欠食理由。持たない(「入力せず」)オーダーと、知らない値は "" を返す。 */
export function mealFastingReason(sr: fhir4.ServiceRequest): MealFastingReason {
  const code = sr.extension?.find((e) => e.url === MEAL_FASTING_REASON_EXT_URL)?.valueCode;
  return MEAL_FASTING_REASON_OPTIONS.some((r) => r.code === code)
    ? (code as MealFastingReason)
    : "";
}

export function mealFastingReasonLabel(sr: fhir4.ServiceRequest): string {
  return mealFastingReasonDisplay(mealFastingReason(sr));
}

/**
 * 主食の表示のまとめ。対象の食事すべてで同じなら stapleName に 1 つ、違えば
 * stapleLines に食事ごとの行を入れる(どちらか一方だけが埋まる)。
 *
 * timings を絞れるのはカレンダー用。1 日の途中で食事が変わった日は、オーダーが
 * 担当する食事(朝だけ・夕だけ など)の主食だけを出したい。
 */
export function mealStapleSummary(
  sr: fhir4.ServiceRequest,
  timings: readonly MealTiming[] = MEAL_TIMING_OPTIONS.map((t) => t.code),
): { stapleName: string; stapleLines: MealStapleLine[] } {
  const staples = parseMealStaples(sr);
  const uniform = uniformStaple(staples, timings);
  const anySpecified = timings.some((timing) => staples[timing] !== null);

  return {
    stapleName: uniform?.name ?? "",
    stapleLines:
      uniform || !anySpecified
        ? []
        : timings.map((timing) => ({
            timingDisplay: mealTimingDisplay(timing),
            text: mealStapleChoiceText(staples[timing]),
          })),
  };
}

export function summarizeMealOrder(sr: fhir4.ServiceRequest): MealOrderSummary {
  const end = mealOrderEnd(sr);
  const reason = mealOrderEndReasonLabel(sr);

  return {
    dietName: mealOrderDietName(sr),
    ...mealStapleSummary(sr),
    sideDishFormName: mealSideDishForm(sr)?.name ?? "",
    saltLimitLabel: mealSaltLimitLabel(sr),
    fastingReasonLabel: mealFastingReasonLabel(sr),
    startLabel: mealPointLabel(sr.occurrenceDateTime ?? ""),
    endLabel: end ? `${mealPointLabel(end)}まで${reason ? `(${reason})` : ""}` : "",
    kindLabel: mealOrderKindLabel(sr),
    continuing: !end,
    comment: orderComment(sr),
  };
}

/** 食種の名称。 */
export function mealOrderDietName(sr: fhir4.ServiceRequest): string {
  return sr.code?.text || codingBySystem(sr.code?.coding, MEAL_TYPE_SYSTEM)?.display || "";
}

/** 1 食ぶんの指定の表示名。 */
export function mealStapleChoiceText(choice: MealStapleChoice): string {
  if (choice === MEAL_SKIPPED) return "欠食";
  return choice?.name ?? "-";
}

/**
 * 主食を 1 行に畳んだ表示。全食同じなら主食名、違えば「朝 米飯180g / 昼 欠食 / 夕 全粥」。
 * 詳細パネルと「いま出ている食事」の見出しで共用する。
 */
export function mealStapleText(summary: MealOrderSummary): string {
  if (summary.stapleName) return summary.stapleName;
  return summary.stapleLines.map((line) => `${line.timingDisplay} ${line.text}`).join(" / ");
}

/**
 * 指定の日以降まで続くオーダーか(終了を持たないオーダーは常に true)。暦が「その月に
 * かかるオーダー」を選ぶのに使う。上流に「終了拡張が未来か」を問い合わせる術が無いので、
 * 候補を引いてからここで絞る。
 */
export function mealOrderEndsOnOrAfter(sr: fhir4.ServiceRequest, at: string): boolean {
  const end = mealOrderEnd(sr);
  return !end || end.slice(0, 10) >= at;
}

/**
 * 指定の日に出ている食事オーダーか(その日までに始まり、まだ終わっていない)。
 * 食事変更で終了させる候補を選ぶのに使う。まだ始まっていないオーダーを候補にすると、
 * 開始より前の終了を立ててしまうので、開始日も見る。
 */
export function isMealOrderRunningOn(sr: fhir4.ServiceRequest, at: string): boolean {
  const start = (sr.occurrenceDateTime ?? "").slice(0, 10);
  if (!start || start > at) return false;
  return mealOrderEndsOnOrAfter(sr, at);
}

/**
 * 指定の食事より後まで続いてしまうオーダーか(= 退院で止める必要があるか)。
 *
 * 開始が退院日より後のオーダーも対象にする。退院日を早めたときに先の食事が
 * 残ってしまうのを防ぐためで、そういうオーダーには開始より前の終了が入るが、
 * どの食事にも当たらない(= 1 食も出ない)ので止めた状態になる。
 * すでにその食事以前で終わっているオーダーは触らない(終了を後ろへ動かさない)。
 */
export function mealOrderNeedsStop(
  sr: fhir4.ServiceRequest,
  endDate: string,
  endTiming: MealTiming,
): boolean {
  const end = mealOrderEnd(sr);
  return !end || mealPointKeyOf(end) > mealPointKey(endDate, endTiming);
}

// ---- どの日のどの食事にどのオーダーが効いているか ----
//
// 食事オーダーは「開始した食事から、終了の食事まで(終了が無ければずっと)」続く。
// 開始・終了はどちらも `YYYY-MM-DDTHH:mm`(時刻は 08/12/18)なので、この文字列の
// 辞書順がそのまま時間順になる。カレンダーはこの比較だけで各食事の担当を決める。

/** 比較用のキー。タイムゾーンを落とした地方時の `YYYY-MM-DDTHH:mm`。 */
export function mealPointKey(date: string, timing: MealTiming): string {
  return `${date}T${timingHour(timing)}:00`;
}

export function mealPointKeyOf(dateTime: string): string {
  return dateTime.slice(0, 16);
}

/**
 * 指定の日・食事に効いているオーダー。候補が複数あるとき(データが乱れて期間が
 * 重なっているとき)は、いちばん後に始まったものを採る。
 */
export function mealOrderAt(
  orders: fhir4.ServiceRequest[],
  date: string,
  timing: MealTiming,
): fhir4.ServiceRequest | undefined {
  const point = mealPointKey(date, timing);
  let found: fhir4.ServiceRequest | undefined;
  let foundStart = "";

  for (const order of orders) {
    const start = mealPointKeyOf(order.occurrenceDateTime ?? "");
    if (!start || start > point) continue;
    const end = mealOrderEnd(order);
    if (end && mealPointKeyOf(end) < point) continue;
    if (!found || start > foundStart) {
      found = order;
      foundStart = start;
    }
  }
  return found;
}

/** その日に始まる(= その日に食事が変わった)オーダー。 */
export function mealOrdersStartingOn(
  orders: fhir4.ServiceRequest[],
  date: string,
): fhir4.ServiceRequest[] {
  return orders.filter((order) => (order.occurrenceDateTime ?? "").slice(0, 10) === date);
}

/** カレンダーの 1 マスに出す、1 オーダーぶんの担当範囲。 */
export interface MealDayEntry {
  order: fhir4.ServiceRequest;
  /** そのオーダーがその日に担当する食事。 */
  timings: MealTiming[];
}

/**
 * 1 日ぶんの食事。朝・昼・夕それぞれの担当オーダーを引き、同じオーダーが続く
 * ぶんはまとめる(1 日の途中で食事が変わった日だけ 2 つ以上になる)。
 */
export function mealDayEntries(
  orders: fhir4.ServiceRequest[],
  date: string,
): MealDayEntry[] {
  const entries: MealDayEntry[] = [];
  for (const timing of MEAL_TIMING_OPTIONS) {
    const order = mealOrderAt(orders, date, timing.code);
    if (!order) continue;
    const last = entries[entries.length - 1];
    if (last && last.order.id === order.id) last.timings.push(timing.code);
    else entries.push({ order, timings: [timing.code] });
  }
  return entries;
}

// ---- 編集フォームへの復元 ----

export const mealOrderProblem = orderProblem;

/**
 * 保存済みオーダーから朝・昼・夕の指定を読み戻す。
 *
 * orderDetail の要素は meal-timing 拡張でどの食事のものかを示すが、拡張を持たない
 * 要素は「全食共通」(SS-MIX2 で ODS-2 をブランクにしたもの)。食事ごとの指定を
 * 先に置き、共通の主食は空いている食事だけを埋める。
 */
export function parseMealStaples(sr: fhir4.ServiceRequest): MealStaples {
  const staples = emptyMealStaples();

  // 欠食が先。共通の主食で上書きされないようにする。
  for (const extension of sr.extension ?? []) {
    if (extension.url !== MEAL_SKIPPED_TIMING_EXT_URL) continue;
    const timing = mealTimingOf(extension.valueCode);
    if (timing) staples[timing] = MEAL_SKIPPED;
  }

  const general: MealItemRef[] = [];
  for (const detail of sr.orderDetail ?? []) {
    const coding = codingBySystem(detail.coding, STAPLE_FOOD_SYSTEM);
    if (!coding?.code) continue;
    const item = { code: coding.code, name: detail.text || coding.display || coding.code };
    const timing = mealTimingOf(
      detail.extension?.find((e) => e.url === MEAL_TIMING_EXT_URL)?.valueCode,
    );
    if (timing) staples[timing] = item;
    else general.push(item);
  }

  for (const item of general) {
    for (const timing of MEAL_TIMING_OPTIONS) {
      if (staples[timing.code] === null) staples[timing.code] = item;
    }
  }

  return staples;
}

/** 拡張に入っていた文字列が朝・昼・夕のどれか。知らない値は無視する。 */
function mealTimingOf(value: string | undefined): MealTiming | undefined {
  return MEAL_TIMING_OPTIONS.find((t) => t.code === value)?.code;
}

export function parseMealOrderForm(sr: fhir4.ServiceRequest): MealOrderFormValues {
  const diet = codingBySystem(sr.code?.coding, MEAL_TYPE_SYSTEM);
  const occurrence = sr.occurrenceDateTime ?? "";
  const end = mealOrderEnd(sr);

  return {
    diet: diet?.code
      ? { code: diet.code, name: sr.code?.text || diet.display || diet.code }
      : null,
    // 食止めかどうかはマスタ側の属性なので、フォームを開いた画面がマスタから
    // 引き直して入れ直す(オーダーには写していない)。
    dietIsFasting: false,
    staples: parseMealStaples(sr),
    sideDishForm: mealSideDishForm(sr),
    saltLimit: mealSaltLimit(sr)?.toString() ?? "",
    fastingReason: mealFastingReason(sr),
    startDate: occurrence.slice(0, 10) || today(),
    startTiming: parseMealTiming(occurrence) ?? DEFAULT_MEAL_TIMING,
    endDate: end.slice(0, 10),
    endTiming: parseMealTiming(end) ?? DEFAULT_MEAL_END_TIMING,
    comment: orderComment(sr),
    problem: mealOrderProblem(sr),
  };
}
