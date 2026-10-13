import type { MealPattern, MealPatternStepJson } from "../api/masterClient";
import type { ProblemRef } from "./conditionHelpers";
import {
  DEFAULT_MEAL_END_TIMING,
  MEAL_FASTING_REASON_OPTIONS,
  MEAL_SKIPPED,
  MEAL_TIMING_OPTIONS,
  buildMealOrderCloseEntry,
  buildMealOrderCreateEntry,
  buildMealOrderResumeEntry,
  emptyMealStaples,
  mealOrderResumable,
  mealPointDisplay,
  mealStapleChoiceText,
  nextMealPoint,
  previousMealPoint,
  uniformStaple,
  type MealAllergyRef,
  type MealFastingReason,
  type MealItemRef,
  type MealOrderFormValues,
  type MealOrderLink,
  type MealStapleChoice,
  type MealStaples,
  type MealTiming,
} from "./mealOrderHelpers";
import type { OrderAttribution } from "./orderHeader";
import { transactionBundle } from "./shared";

// パターン食。術後の食上げ(流動食 → 三分粥 → 五分粥 → 全粥 → 常食)や検査前の食事
// (低残渣食 → 食止め)のように段階的に変わる食事を、1 回の登録で段階ごとの食事オーダーに
// 展開する(docs/meal-order-design.md §2.11)。
//
// 段階の長さは食数(朝昼夕の数)。開始が昼や夕でも食数どおりにずれていき、段階 i の開始は
// 前の段階の終了の次の食事。最後の段階だけ食数を空にでき、そのときは「次の指示まで継続」。
// 展開後は段階ごとに独立した食事オーダーで、パターンと段階は表示のための拡張
// (meal-pattern)に焼き付くだけ。

/** 段階の食事内容。フォーム値から期間・対象プロブレム・食物アレルギーを除いたもの(全段階で共通にする)。 */
export type MealPatternStepValues = Omit<
  MealOrderFormValues,
  "startDate" | "startTiming" | "endDate" | "endTiming" | "problem" | "allergies"
>;

export interface MealPatternStep {
  /** 食数。null は「次の指示まで継続」(最後の段階だけ)。 */
  meals: number | null;
  values: MealPatternStepValues;
}

/** 開始日とタイミングから計算した、段階ごとの期間。endDate が空なら継続。 */
export interface MealPatternSpan {
  step: MealPatternStep;
  startDate: string;
  startTiming: MealTiming;
  endDate: string;
  endTiming: MealTiming;
}

/** オーダー登録フォームが送る、選んだパターンと直した段階。 */
export interface MealPatternSubmission {
  code: string;
  name: string;
  steps: MealPatternStep[];
}

function itemRefOf(value: unknown): MealItemRef | null {
  if (!value || typeof value !== "object") return null;
  const { code, name } = value as { code?: unknown; name?: unknown };
  return typeof code === "string" && code ? { code, name: typeof name === "string" ? name : code } : null;
}

function stapleChoiceOf(value: unknown): MealStapleChoice {
  return value === MEAL_SKIPPED ? MEAL_SKIPPED : itemRefOf(value);
}

function fastingReasonOf(value: unknown): MealFastingReason {
  return MEAL_FASTING_REASON_OPTIONS.some((r) => r.code === value)
    ? (value as MealFastingReason)
    : "";
}

/** マスタの段階(backend は形を見るだけ)をフォーム値の形に読み戻す。欠けたキーは空で埋める。 */
export function mealPatternStepOf(json: MealPatternStepJson): MealPatternStep {
  const staples: MealStaples = emptyMealStaples();
  const rawStaples = (json.staples ?? {}) as Record<string, unknown>;
  for (const timing of MEAL_TIMING_OPTIONS) {
    staples[timing.code] = stapleChoiceOf(rawStaples[timing.code]);
  }
  return {
    meals: typeof json.meals === "number" && json.meals >= 1 ? Math.floor(json.meals) : null,
    values: {
      diet: itemRefOf(json.diet),
      dietIsFasting: json.dietIsFasting === true,
      staples,
      sideDishForm: itemRefOf(json.sideDishForm),
      saltLimit: typeof json.saltLimit === "string" ? json.saltLimit : "",
      fastingReason: fastingReasonOf(json.fastingReason),
      comment: typeof json.comment === "string" ? json.comment : "",
    },
  };
}

export function mealPatternStepsOf(pattern: MealPattern): MealPatternStep[] {
  return pattern.steps.map(mealPatternStepOf);
}

/** フォーム値から段階の食事内容を取り出す(期間・プロブレムは段階に持たせない)。 */
export function stepValuesFromForm(values: MealOrderFormValues): MealPatternStepValues {
  const { diet, dietIsFasting, staples, sideDishForm, saltLimit, fastingReason, comment } = values;
  return { diet, dietIsFasting, staples, sideDishForm, saltLimit, fastingReason, comment };
}

/** 段階の食事内容を、段階編集のフォームに渡す値にする(期間は空、プロブレムなし)。 */
export function formValuesOfStep(values: MealPatternStepValues): MealOrderFormValues {
  return {
    ...values,
    startDate: "",
    startTiming: "breakfast",
    endDate: "",
    endTiming: DEFAULT_MEAL_END_TIMING,
    problem: null,
    allergies: [],
  };
}

/** 段階 1 つの要約「三分粥食800kcal(三分粥)」。 */
export function mealPatternStepText(step: MealPatternStep): string {
  const { values } = step;
  const staple = uniformStaple(values.staples);
  const detail = [
    staple?.name ??
      (MEAL_TIMING_OPTIONS.some((t) => values.staples[t.code] !== null)
        ? MEAL_TIMING_OPTIONS.map(
            (t) => `${t.display} ${mealStapleChoiceText(values.staples[t.code])}`,
          ).join(" / ")
        : ""),
    values.sideDishForm?.name ?? "",
  ].filter(Boolean);
  const name = values.diet?.name ?? "(食種なし)";
  return detail.length > 0 ? `${name}(${detail.join("・")})` : name;
}

/** 食数の表示「3食」「継続」。 */
export function mealCountLabel(meals: number | null): string {
  return meals === null ? "継続" : `${meals}食`;
}

/** 「流動食 3食 → 三分粥 3食 → 常食 継続」。一覧・選択モーダルに出す。 */
export function mealPatternStepsSummary(steps: MealPatternStep[]): string {
  return steps
    .map((step) => `${step.values.diet?.name ?? "(食種なし)"} ${mealCountLabel(step.meals)}`)
    .join(" → ");
}

/**
 * 段階の検証。マスタの編集とオーダー登録で同じ規則を使う。
 * 食数を空にできるのは最後の段階だけ(途中で空だと次の段階の開始が決まらない)。
 */
export function validateMealPatternSteps(steps: MealPatternStep[]): string {
  if (steps.length === 0) return "段階を 1 つ以上入れてください。";
  for (const [index, step] of steps.entries()) {
    const nth = `${index + 1} 段階目`;
    if (!step.values.diet) return `${nth}の食種を選んでください。`;
    if (step.meals === null) {
      if (index !== steps.length - 1) return `${nth}の食数を入れてください。`;
    } else if (!Number.isInteger(step.meals) || step.meals < 1) {
      return `${nth}の食数は 1 以上の整数で入れてください。`;
    }
  }
  return "";
}

/**
 * 開始日・開始タイミングから段階ごとの期間を食数で刻む。
 * 段階の終了 = 開始から (食数 − 1) 回進めた食事、次の段階の開始 = その次の食事。
 */
export function planMealPattern(
  steps: MealPatternStep[],
  startDate: string,
  startTiming: MealTiming,
): MealPatternSpan[] {
  const spans: MealPatternSpan[] = [];
  let point = { date: startDate, timing: startTiming };
  for (const step of steps) {
    if (step.meals === null) {
      spans.push({
        step,
        startDate: point.date,
        startTiming: point.timing,
        endDate: "",
        endTiming: DEFAULT_MEAL_END_TIMING,
      });
      break;
    }
    let end = point;
    for (let i = 1; i < step.meals; i += 1) end = nextMealPoint(end.date, end.timing);
    spans.push({
      step,
      startDate: point.date,
      startTiming: point.timing,
      endDate: end.date,
      endTiming: end.timing,
    });
    point = nextMealPoint(end.date, end.timing);
  }
  return spans;
}

/** 「10/14 昼〜10/15 朝」「10/20 朝〜継続」。 */
export function mealPatternSpanLabel(span: MealPatternSpan): string {
  const start = mealPointDisplay({ date: span.startDate, timing: span.startTiming });
  const end = span.endDate ? mealPointDisplay({ date: span.endDate, timing: span.endTiming }) : "継続";
  return `${start}〜${end}`;
}

function joinComments(...parts: string[]): string {
  return parts.filter((p) => p.trim()).join("\n");
}

/**
 * パターン食の登録。段階ごとの POST を、食事変更の終了(closing)と、最後の段階が期限付きの
 * ときの再開(resuming)と一緒に 1 つの transaction にまとめる(buildMealOrderBundle と同じ並び)。
 * コメント・対象プロブレム・食物アレルギーは全段階に共通で、段階のコメントがあれば続けて書く。
 */
export function buildMealPatternBundle(
  pattern: MealPatternSubmission,
  startDate: string,
  startTiming: MealTiming,
  shared: { comment: string; problem: ProblemRef | null; allergies: MealAllergyRef[] },
  patientId: string,
  requester: OrderAttribution,
  closing: fhir4.ServiceRequest[] = [],
  resuming: fhir4.ServiceRequest[] = [],
  encounterId?: string,
): fhir4.Bundle {
  const spans = planMealPattern(pattern.steps, startDate, startTiming);
  const end = previousMealPoint(startDate, startTiming);
  const last = spans[spans.length - 1];
  const resume = last?.endDate ? nextMealPoint(last.endDate, last.endTiming) : null;

  return transactionBundle([
    ...spans.map((span, index) => {
      // 最初の段階は単独の登録と同じく「いま出ている食事を終わらせるなら変更、でなければ開始」。
      // 2 段階目以降は前の段階からの変更(transaction 内の参照は持たせない)。
      const link: MealOrderLink =
        index === 0
          ? closing.length > 0
            ? { kind: "change", sourceId: closing[0].id }
            : { kind: "start" }
          : { kind: "change" };
      const values: MealOrderFormValues = {
        ...span.step.values,
        comment: joinComments(span.step.values.comment, shared.comment),
        problem: shared.problem,
        allergies: shared.allergies,
        startDate: span.startDate,
        startTiming: span.startTiming,
        endDate: span.endDate,
        endTiming: span.endTiming,
      };
      return buildMealOrderCreateEntry(values, patientId, requester, {
        encounterId,
        link,
        pattern: { code: pattern.code, name: pattern.name, step: index + 1, count: spans.length },
      });
    }),
    ...closing.map((sr) => buildMealOrderCloseEntry(sr, end.date, end.timing, { reason: "change" })),
    // 最後の段階が継続なら戻す先が無い(次の指示まで続く)。
    ...(resume && last
      ? resuming
          .filter((sr) => mealOrderResumable(sr, last.endDate, last.endTiming))
          .map((sr) =>
            buildMealOrderResumeEntry(sr, resume.date, resume.timing, patientId, requester, {
              encounterId,
              allergies: shared.allergies,
            }),
          )
      : []),
  ]);
}
