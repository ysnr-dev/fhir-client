// 様式1 の必須条件・表示条件を組み立てる部品。定義表(records/*.ts)から使う。

import type { Dpc1Context, Dpc1PayloadNo, Dpc1Rule } from "./types";

// 診断情報のレコード。ICD-10 はどれもペイロード 2。
export const MAIN_DIAGNOSIS = "A006010";
export const ADMISSION_DIAGNOSIS = "A006020";
export const RESOURCE_DIAGNOSIS = "A006030";
export const RESOURCE2_DIAGNOSIS = "A006031";
export const COMORBIDITY_DIAGNOSIS = "A006040";
export const COMPLICATION_DIAGNOSIS = "A006050";

export const DIAGNOSIS_CODES = [
  MAIN_DIAGNOSIS,
  ADMISSION_DIAGNOSIS,
  RESOURCE_DIAGNOSIS,
  RESOURCE2_DIAGNOSIS,
  COMORBIDITY_DIAGNOSIS,
  COMPLICATION_DIAGNOSIS,
];

const ICD_PAYLOAD: Dpc1PayloadNo = 2;

function icdsOf(ctx: Dpc1Context, codes: string[]): string[] {
  return codes.flatMap((code) => ctx.rows(code).map((row) => row.p[ICD_PAYLOAD] ?? "")).filter(Boolean);
}

/**
 * ICD-10 が表記に当てはまるか。表記は実施説明資料の書き方に合わせ、末尾の "$" は
 * 「以降の桁は何でもよい」(I50$ は I500・I501・I509 に当たる)。"$" が無ければ完全一致。
 */
export function icdMatches(icd10: string, patterns: string[]): boolean {
  return patterns.some((pattern) =>
    pattern.endsWith("$") ? icd10.startsWith(pattern.slice(0, -1)) : icd10 === pattern,
  );
}

/**
 * 診断群分類の上 6 桁が表記に当てはまるか。表記は 6 桁そのもの("010020")か、
 * 前方一致の接頭辞("04" は MDC04、"01021" は 01021x)。
 */
function mdc6Matches(mdc6: string[], prefixes: string[]): boolean {
  return mdc6.some((code) => prefixes.some((prefix) => code.startsWith(prefix)));
}

export const and =
  (...rules: Dpc1Rule[]): Dpc1Rule =>
  (ctx) =>
    rules.every((rule) => rule(ctx));

export const or =
  (...rules: Dpc1Rule[]): Dpc1Rule =>
  (ctx) =>
    rules.some((rule) => rule(ctx));

export const not =
  (rule: Dpc1Rule): Dpc1Rule =>
  (ctx) =>
    !rule(ctx);

/** 入院時の年齢が n 歳以上。年齢が分からないときは偽。 */
export const ageAtLeast =
  (n: number): Dpc1Rule =>
  (ctx) =>
    ctx.age !== null && ctx.age >= n;

/** 入院時の年齢が n 歳未満。年齢が分からないときは偽。 */
export const ageUnder =
  (n: number): Dpc1Rule =>
  (ctx) =>
    ctx.age !== null && ctx.age < n;

/** あるペイロードの値が、挙げた値のどれかである。 */
export const payloadIn =
  (code: string, payload: Dpc1PayloadNo, ...values: string[]): Dpc1Rule =>
  (ctx) =>
    values.includes(ctx.get(code, payload));

/** あるペイロードに値が入っている。 */
export const payloadFilled =
  (code: string, payload: Dpc1PayloadNo): Dpc1Rule =>
  (ctx) =>
    ctx.get(code, payload) !== "";

/** 医療資源を最も投入した傷病名の ICD-10 が表記に当てはまる。 */
export const resourceIcdIn =
  (...patterns: string[]): Dpc1Rule =>
  (ctx) =>
    icdsOf(ctx, [RESOURCE_DIAGNOSIS]).some((icd) => icdMatches(icd, patterns));

/** 挙げた診断情報レコードのどれかの ICD-10 が表記に当てはまる。 */
export const diagnosisIcdIn =
  (codes: string[], ...patterns: string[]): Dpc1Rule =>
  (ctx) =>
    icdsOf(ctx, codes).some((icd) => icdMatches(icd, patterns));

/** 医療資源を最も投入した傷病名が、挙げた診断群分類(上 6 桁・接頭辞)に定義されている。 */
export const resourceMdc6In =
  (...prefixes: string[]): Dpc1Rule =>
  (ctx) =>
    icdsOf(ctx, [RESOURCE_DIAGNOSIS]).some((icd) => mdc6Matches(ctx.mdc6(icd), prefixes));

/** 挙げた診断情報レコードのどれかの傷病名が、挙げた診断群分類に定義されている。 */
export const diagnosisMdc6In =
  (codes: string[], ...prefixes: string[]): Dpc1Rule =>
  (ctx) =>
    icdsOf(ctx, codes).some((icd) => mdc6Matches(ctx.mdc6(icd), prefixes));

/** 入院経路(A000020 ペイロード 2)が挙げた値のどれか。 */
export const admissionRouteIn = (...values: string[]): Dpc1Rule => payloadIn("A000020", 2, ...values);

/** 予定・救急医療入院(A000020 ペイロード 5)が救急医療入院(3**)。 */
export const emergencyAdmission: Dpc1Rule = (ctx) => ctx.get("A000020", 5).startsWith("3");

/** 予定・救急医療入院が挙げた値のどれか。 */
export const admissionTypeIn = (...values: string[]): Dpc1Rule => payloadIn("A000020", 5, ...values);

/** 死亡退院(退院時転帰が 6・7)。 */
export const diedAtDischarge: Dpc1Rule = payloadIn("A000030", 3, "6", "7");

/** 調査対象となる一般病棟への入院だけが「有」(A000050 のペイロード 2 だけが 1)。 */
export const generalWardOnly: Dpc1Rule = (ctx) =>
  ctx.get("A000050", 2) === "1" && ctx.get("A000050", 3) !== "1" && ctx.get("A000050", 4) !== "1";

/** 精神病棟グループに属する入院がある(A000050 ペイロード 3 が 1)。 */
export const psychiatricWard: Dpc1Rule = payloadIn("A000050", 3, "1");

/**
 * 画面で人が決める条件。算定した入院料や診療科のように、様式1 の入力値からは
 * 分からない条件に使う。常に偽を返すので、該当するときは画面で手動でレコードを開く。
 */
export const manual: Dpc1Rule = () => false;
