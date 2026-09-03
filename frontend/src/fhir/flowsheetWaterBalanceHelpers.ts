import type { NursingObservation } from "../api/masterClient";
import { NURSING_OBSERVATION_CODE_SYSTEM } from "./nursingOrderHelpers";
import { codingBySystem } from "./shared";

// 経過表の水分出納(In/Out)。
//
// 「どの観察項目を In / Out に数えるか」は**施設の運用**で違う(導尿と膀胱瘻を分けて
// 数えるか合算するか、ドレーンをどこまで含めるか)。MEDIS の観察マスタは尿量だけで
// 29 件、ドレーン排液は 200 件を超えるので、コードに焼き付けた対応表は作れない。
// 施設設定に MEDIS の管理番号を並べて持ち、集計はその番号で突き合わせる。
//
// 同じ名前で単位違いの項目が並ぶ(尿量 mL / 尿量 g、出血量 mL / g)ため、**名前ではなく
// 管理番号**で持つ。集計できるのは mL の項目だけなので、設定画面の候補も mL に絞る。
//
// 注射(点滴)を IN に数えるには別の換算が要る。投与量は袋・管・瓶といった薬価算定
// 単位で記録されており mL ではないので、投与量換算マスタで直す(注射フォームの
// 総投与量と同じ仕組み)。換算行の無い薬剤は数えられないので、その件数を返す。

/** In / Out に数える看護観察(MEDIS の管理番号)。 */
export interface WaterBalanceSettings {
  in: string[];
  out: string[];
}

export const EMPTY_WATER_BALANCE: WaterBalanceSettings = { in: [], out: [] };

/** 集計できる単位か。mL 以外(g・回/日・kcal/日)は足し合わせられない。 */
export function isWaterBalanceUnit(unit: string | null | undefined): boolean {
  return (unit ?? "").trim().toLowerCase() === "ml";
}

/** 枠(日・時)ごとの合計。 */
export interface WaterBalanceTotals {
  /** 枠のキー → 合計(mL)。値の無い枠は持たない。 */
  in: Map<string, number>;
  out: Map<string, number>;
  /** IN − OUT。IN・OUT のどちらかがある枠だけ持つ。 */
  balance: Map<string, number>;
  /** mL に換算できなかった注射の薬剤の数。0 なら注記を出さない。 */
  unconvertible: number;
}

function add(totals: Map<string, number>, key: string, value: number) {
  if (!key || !Number.isFinite(value)) return;
  totals.set(key, (totals.get(key) ?? 0) + value);
}

/**
 * 水分出納を枠ごとに合計する。
 *
 * - 看護観察: `Observation.valueQuantity` が mL のものだけ。設定に無い項目は数えない。
 * - 注射: `MedicationAdministration.dosage.dose` を mL に換算して IN に足す。
 *   実施記録(誤登録・実施せずを除く)だけを数える(予定は数えない。実際に入った量が
 *   出納なので)。
 */
export function buildWaterBalance(args: {
  settings: WaterBalanceSettings;
  /** 看護観察の実施記録。 */
  observations: fhir4.Observation[];
  /** 注射の実施(薬剤ごと)。 */
  administrations: fhir4.MedicationAdministration[];
  /** 医薬品コード → 1 薬価算定単位あたりの mL。 */
  mlFactors: Map<string, number>;
  /** 日時 → 枠のキー。 */
  slotKeyOf: (at: string) => string;
}): WaterBalanceTotals {
  const inTotals = new Map<string, number>();
  const outTotals = new Map<string, number>();
  const inCodes = new Set(args.settings.in);
  const outCodes = new Set(args.settings.out);
  let unconvertible = 0;

  for (const observation of args.observations) {
    if (observation.status === "entered-in-error") continue;
    const at = observation.effectiveDateTime ?? "";
    const quantity = observation.valueQuantity;
    if (!at || quantity?.value === undefined || !isWaterBalanceUnit(quantity.unit)) continue;
    const manageNo = codingBySystem(observation.code?.coding, NURSING_OBSERVATION_CODE_SYSTEM)?.code;
    if (!manageNo) continue;
    if (inCodes.has(manageNo)) add(inTotals, args.slotKeyOf(at), quantity.value);
    else if (outCodes.has(manageNo)) add(outTotals, args.slotKeyOf(at), quantity.value);
  }

  for (const administration of args.administrations) {
    if (administration.status !== "completed" && administration.status !== "stopped") continue;
    const at = administration.effectivePeriod?.start ?? administration.effectiveDateTime;
    const dose = administration.dosage?.dose?.value;
    if (!at || dose === undefined) continue;
    const code = administration.medicationCodeableConcept?.coding?.[0]?.code;
    const factor = code ? args.mlFactors.get(code) : undefined;
    if (factor === undefined) {
      unconvertible += 1;
      continue;
    }
    add(inTotals, args.slotKeyOf(at), dose * factor);
  }

  const balance = new Map<string, number>();
  for (const key of new Set([...inTotals.keys(), ...outTotals.keys()])) {
    balance.set(key, (inTotals.get(key) ?? 0) - (outTotals.get(key) ?? 0));
  }

  return { in: inTotals, out: outTotals, balance, unconvertible };
}

/** 合計の表示。小数は 1 桁で丸め、整数は整数のまま。 */
export function waterBalanceLabel(value: number | undefined): string {
  if (value === undefined) return "";
  const rounded = Math.round(value * 10) / 10;
  return `${rounded}`;
}

/** 設定に選んだ項目のうち、mL 以外の単位のもの(集計できないので設定画面で注意を出す)。 */
export function unsupportedWaterBalanceItems(
  settings: WaterBalanceSettings,
  byManageNo: Map<string, NursingObservation> | undefined,
): string[] {
  if (!byManageNo) return [];
  return [...settings.in, ...settings.out]
    .map((manageNo) => byManageNo.get(manageNo))
    .filter((item): item is NursingObservation => Boolean(item))
    .filter((item) => !isWaterBalanceUnit(item.unit))
    .map((item) => `${item.name}（${item.unit ?? "単位なし"}）`);
}
