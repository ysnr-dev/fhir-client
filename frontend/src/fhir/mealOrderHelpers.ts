import { today } from "../lib/dates";
// FHIR dateTime へのタイムゾーン付与は診療記録と同じ変換でよいので共用する。
import { toFhirDateTime } from "./clinicalNoteHelpers";
import { orderProblem, type ProblemRef } from "./conditionHelpers";
import { categoryCoding, codingBySystem, displayOf, orderComment } from "./shared";
import {
  ORDER_TYPE_SYSTEM,
  SETTING_OPTIONS,
  SETTING_SYSTEM,
  applyOrderContext,
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

// 他のオーダー種別の ServiceRequest と区別するオーダー種別。
export const MEAL_ORDER_TYPE = { code: "meal", display: "食事" };

// 食種(食止めを含む)。SS-MIX2 の例でいうローカルコード表 99SKS / SSMIXTF01 にあたる。
const MEAL_TYPE_SYSTEM = "http://fhir-client.local/CodeSystem/meal-type";
// 主食。SS-MIX2 の例でいうローカルコード表 99SSK にあたる。
const STAPLE_FOOD_SYSTEM = "http://fhir-client.local/CodeSystem/meal-staple-food";

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
  // 朝の直前は前日の夕。ローカル日付の引き算なのでタイムゾーンは考えなくてよい。
  const previous = new Date(`${date}T00:00:00`);
  previous.setDate(previous.getDate() - 1);
  const yyyy = previous.getFullYear();
  const mm = String(previous.getMonth() + 1).padStart(2, "0");
  const dd = String(previous.getDate()).padStart(2, "0");
  return { date: `${yyyy}-${mm}-${dd}`, timing: "dinner" };
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

export interface MealOrderFormValues {
  /** 食種(必須)。食止めもここに入る。 */
  diet: MealItemRef | null;
  /** 食止めの食種か。主食欄を無効にするための画面の状態で、FHIR には出さない。 */
  dietIsFasting: boolean;
  /** 朝・昼・夕の主食(任意)と欠食。 */
  staples: MealStaples;
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
    startDate: today(),
    startTiming: DEFAULT_MEAL_TIMING,
    endDate: "",
    endTiming: DEFAULT_MEAL_END_TIMING,
    comment: "",
    problem: null,
  };
}

/** 食事オーダーの ServiceRequest か。 */
export function isMealServiceRequest(sr: fhir4.ServiceRequest): boolean {
  return categoryCoding(sr, ORDER_TYPE_SYSTEM)?.code === MEAL_ORDER_TYPE.code;
}

// ---- 組み立て ----

function buildMealOrderServiceRequest(
  values: MealOrderFormValues,
  patientId: string,
  requester: OrderAttribution,
  serviceRequestId?: string,
): fhir4.ServiceRequest {
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
  if (stapleDetails.length > 0) resource.orderDetail = stapleDetails;

  const extensions: fhir4.Extension[] = [...skippedExtensions];
  if (values.endDate) {
    extensions.push({
      url: MEAL_ORDER_END_EXT_URL,
      valueDateTime: mealDateTime(values.endDate, values.endTiming),
    });
  }
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

/**
 * 継続中のオーダーに終了を書き足す PUT エントリ。食事変更(新しい食事を出すと同時に
 * 前の食事を終える)を 1 transaction で行うために使う。
 *
 * 終了は「新しい食事の直前の食事まで」。オーダー全体を置き換える PUT なので、
 * 元のリソースを基に拡張だけ差し替える。
 */
export function buildMealOrderCloseEntry(
  sr: fhir4.ServiceRequest,
  endDate: string,
  endTiming: MealTiming,
): fhir4.BundleEntry {
  const next: fhir4.ServiceRequest = {
    ...sr,
    extension: [
      ...(sr.extension ?? []).filter((e) => e.url !== MEAL_ORDER_END_EXT_URL),
      { url: MEAL_ORDER_END_EXT_URL, valueDateTime: mealDateTime(endDate, endTiming) },
    ],
  };
  return { resource: next, request: { method: "PUT", url: `ServiceRequest/${sr.id}` } };
}

/**
 * 新規登録。食事変更のときは、前のオーダーを終了する PUT を同じ transaction に
 * 入れる(新しい食事だけが登録されて前の食事が残り続ける状態を作らない)。
 */
export function buildMealOrderBundle(
  values: MealOrderFormValues,
  patientId: string,
  requester: OrderAttribution,
  /** 同時に終了する継続中のオーダー。画面のチェックで選ばれたもの。 */
  closing: fhir4.ServiceRequest[] = [],
): fhir4.Bundle {
  const end = previousMealPoint(values.startDate, values.startTiming);
  return transactionBundle([
    {
      resource: buildMealOrderServiceRequest(values, patientId, requester),
      request: { method: "POST", url: "ServiceRequest" },
    },
    ...closing.map((sr) => buildMealOrderCloseEntry(sr, end.date, end.timing)),
  ]);
}

/** 更新。明細が無いので既存ヘッダ 1 件への PUT だけ。 */
export function buildMealOrderUpdateBundle(
  values: MealOrderFormValues,
  patientId: string,
  serviceRequestId: string,
  requester: OrderAttribution,
): fhir4.Bundle {
  return transactionBundle([
    {
      resource: buildMealOrderServiceRequest(values, patientId, requester, serviceRequestId),
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
  /** 「8/28 朝」形式の開始。 */
  startLabel: string;
  /** 「8/30 夕まで」形式の終了。継続中なら空。 */
  endLabel: string;
  /** 終了を決めていないオーダーか。 */
  continuing: boolean;
  comment: string;
}

/** 「8/28 朝」。タイミングが 08/12/18 でないデータは時刻をそのまま出す。 */
function mealPointLabel(value: string): string {
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

  return {
    dietName: mealOrderDietName(sr),
    ...mealStapleSummary(sr),
    startLabel: mealPointLabel(sr.occurrenceDateTime ?? ""),
    endLabel: end ? `${mealPointLabel(end)}まで` : "",
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

// ---- どの日のどの食事にどのオーダーが効いているか ----
//
// 食事オーダーは「開始した食事から、終了の食事まで(終了が無ければずっと)」続く。
// 開始・終了はどちらも `YYYY-MM-DDTHH:mm`(時刻は 08/12/18)なので、この文字列の
// 辞書順がそのまま時間順になる。カレンダーはこの比較だけで各食事の担当を決める。

/** 比較用のキー。タイムゾーンを落とした地方時の `YYYY-MM-DDTHH:mm`。 */
function mealPointKey(date: string, timing: MealTiming): string {
  return `${date}T${timingHour(timing)}:00`;
}

function mealPointKeyOf(dateTime: string): string {
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
    startDate: occurrence.slice(0, 10) || today(),
    startTiming: parseMealTiming(occurrence) ?? DEFAULT_MEAL_TIMING,
    endDate: end.slice(0, 10),
    endTiming: parseMealTiming(end) ?? DEFAULT_MEAL_END_TIMING,
    comment: orderComment(sr),
    problem: mealOrderProblem(sr),
  };
}
