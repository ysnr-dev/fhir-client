import type { DrugDoseRule, RegimenDetail } from "../api/masterClient";
import { type Advisory, advisoryKey, severityOf } from "./advisoryHelpers";
import { codeMatches, evaluateConditions, type PatientFactors } from "./drugCheckHelpers";
import { ingredientKey } from "./medicationSafetyHelpers";
import { MEDICINE_CODE_SYSTEM, YJ_CODE_SYSTEM } from "./prescriptionHelpers";
import {
  REGIMEN_DOSE_EXT_URL,
  type RegimenApplication,
  type RegimenDayOrder,
  type RegimenStepPlan,
} from "./regimenOrderHelpers";
import { codingBySystem } from "./shared";

/**
 * 累積投与量の上限(docs/chemo-regimen-design.md §8.23)。
 *
 * 上限は薬剤チェックの用量規則(`master_drug_dose_rules.max_cumulative_dose`)に成分で持ち、
 * 患者のレジメンの日オーダー(全適用ぶん、中止を除く)と今回登録する量を足して比べる。
 * 積算はオーダーの投与量(`doseQuantity`)で行い、実施記録は見ない(中断した投与も 1 回と数える)。
 * 体表面積あたりの上限は、オーダーごとに登録したときの体表面積で割ってから足す。
 *
 * 内服のステップは数えない(1 日量 × 日数の読み方が注射と違い、累積上限の対象になる薬も無いため)。
 * ［決定］上限を超えても**登録は止めない**(他の投与前チェックと同じ)。確認を要する警告にする。
 */

export type CumulativeStatus = "ok" | "over" | "unknown";

export interface CumulativeDoseCheck {
  rule: DrugDoseRule;
  /** 今回のレジメンでの薬剤名(最初の行)。 */
  name: string;
  /** 比べる単位(「mg/m²」「mg」)。 */
  unit: string;
  limit: number;
  /** 登録済みの日オーダーの合計(中止を除く)。量が読めないオーダーは足さない。 */
  registered: number;
  registeredCount: number;
  /** そのうち実施済。 */
  administered: number;
  /** 今回登録する量。出せなければ null。 */
  planned: number | null;
  /** 登録済み + 今回。 */
  total: number;
  status: CumulativeStatus;
  /** 判定できなかった理由や、足せなかったオーダーの件数。 */
  note: string;
}

/** 質量の単位の倍率(mg 基準)。それ以外の単位は換算しない。 */
function massFactor(unit: string): number | null {
  const normalized = unit.normalize("NFKC").replace(/[μµ]/g, "u").trim().toLowerCase();
  if (normalized === "mg") return 1;
  if (normalized === "g") return 1000;
  if (normalized === "ug" || normalized === "mcg") return 0.001;
  return null;
}

function convertAmount(value: number, from: string, to: string): number | null {
  if (from.trim() === to.trim()) return value;
  const a = massFactor(from);
  const b = massFactor(to);
  return a !== null && b !== null ? (value * a) / b : null;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 日オーダーの薬剤 1 件の投与量(規則の単位)。体表面積あたりなら m² で割る。読めなければ null。 */
function orderedAmount(
  mr: fhir4.MedicationRequest,
  unit: string,
  perBsa: boolean,
  headerBsa: number | null,
): number | null {
  const ext = mr.extension?.find((e) => e.url === REGIMEN_DOSE_EXT_URL);
  const decimal = (url: string) => ext?.extension?.find((e) => e.url === url)?.valueDecimal ?? null;
  // 指示の実体は doseQuantity(編集で変えた量もここに入る)。製剤数で載っていて換算できなければ
  // 登録時の力価(拡張の amount)を使う。
  const quantity = mr.dosageInstruction?.[0]?.doseAndRate?.[0]?.doseQuantity;
  let amount =
    quantity?.value !== undefined ? convertAmount(quantity.value, quantity.unit ?? "", unit) : null;
  if (amount === null) {
    const extAmount = decimal("amount");
    const extUnit = ext?.extension?.find((e) => e.url === "unit")?.valueString ?? "";
    amount = extAmount !== null ? convertAmount(extAmount, extUnit, unit) : null;
  }
  if (amount === null || !perBsa) return amount;
  const bsa = decimal("bsa") ?? headerBsa;
  return bsa ? amount / bsa : null;
}

function isCountedOrder(order: RegimenDayOrder): boolean {
  if (order.kind !== "injection") return false;
  if (order.status === "cancelled") return false;
  return order.serviceRequest.status !== "revoked" && order.serviceRequest.status !== "entered-in-error";
}

export function checkCumulativeDoses(args: {
  regimen: RegimenDetail;
  steps: RegimenStepPlan[];
  cycleCount: number;
  bsa: number | null;
  orders: RegimenDayOrder[];
  applications: RegimenApplication[];
  doseRules: DrugDoseRule[];
  patient: PatientFactors;
}): CumulativeDoseCheck[] {
  const { regimen, steps, cycleCount, bsa, orders, applications, doseRules, patient } = args;
  const rules = doseRules.filter((r) => r.max_cumulative_dose !== null && r.dose_unit);
  if (rules.length === 0) return [];

  // 保存済みのオーダーが YJ コードを持たないときは、このレジメンの薬剤の医薬品コードで引き当てる。
  const keyByMedicine = new Map<string, string>();
  for (const step of regimen.steps) {
    for (const drug of step.drugs) {
      const key = ingredientKey(drug);
      if (key) keyByMedicine.set(drug.medicine_code, key);
    }
  }
  const headerBsa = new Map(applications.map((a) => [a.id, a.bsa]));
  const counted = orders.filter(isCountedOrder);

  const results: CumulativeDoseCheck[] = [];
  for (const rule of rules) {
    const plans = steps
      .filter((plan) => plan.step.usage_type !== "oral")
      .flatMap((plan) =>
        plan.drugs
          .filter((d) => {
            const key = ingredientKey(d.drug);
            if (!key || !codeMatches(key, rule.code)) return false;
            return !rule.dosage_form || rule.dosage_form === d.drug.dosage_form;
          })
          .map((d) => ({ plan: d, days: plan.step.days.length })),
      );
    if (plans.length === 0) continue;

    const condition = evaluateConditions(rule, patient);
    if (!condition) continue;

    const unit = rule.dose_unit ?? "";
    const perBsa = rule.cumulative_per_bsa;
    const limit = Number(rule.max_cumulative_dose);
    const notes: string[] = [];
    if (condition.status === "unknown") notes.push(`${condition.missing}が無いため条件を確認できません`);

    let registered = 0;
    let registeredCount = 0;
    let administered = 0;
    let unreadable = 0;
    for (const order of counted) {
      for (const mr of order.medicationRequests) {
        const coding = mr.medicationCodeableConcept?.coding;
        const medicineCode = codingBySystem(coding, MEDICINE_CODE_SYSTEM)?.code ?? "";
        const key =
          ingredientKey({ yj_code: codingBySystem(coding, YJ_CODE_SYSTEM)?.code }) ??
          keyByMedicine.get(medicineCode) ??
          null;
        if (!key || !codeMatches(key, rule.code)) continue;
        const amount = orderedAmount(mr, unit, perBsa, headerBsa.get(order.ref.regimenSrId) ?? null);
        if (amount === null) {
          unreadable += 1;
          continue;
        }
        registered += amount;
        registeredCount += 1;
        if (order.status === "completed") administered += amount;
      }
    }
    if (unreadable > 0) notes.push(`量を読めないオーダー ${unreadable} 件は足していません`);

    let planned: number | null = 0;
    for (const { plan, days } of plans) {
      const value = Number(plan.amount);
      const converted =
        plan.input === "amount" && Number.isFinite(value) && value > 0
          ? convertAmount(value, plan.unit, unit)
          : null;
      if (converted === null || (perBsa && !bsa)) {
        planned = null;
        break;
      }
      planned += (perBsa ? converted / bsa! : converted) * days * cycleCount;
    }
    if (planned === null) {
      notes.push(perBsa && !bsa ? "体表面積が無いため今回の量を出せません" : `今回の量を ${unit} で出せません`);
    }

    const total = registered + (planned ?? 0);
    const over = total > limit * 1.0001;
    const status: CumulativeStatus = over
      ? "over"
      : planned === null || condition.status === "unknown"
        ? "unknown"
        : "ok";
    results.push({
      rule,
      name: plans[0].plan.drug.resolved_name ?? rule.name,
      unit: perBsa ? `${unit}/m²` : unit,
      limit,
      registered: round(registered),
      registeredCount,
      administered: round(administered),
      planned: planned !== null ? round(planned) : null,
      total: round(total),
      status,
      note: notes.join(" / "),
    });
  }
  return results;
}

/** 上限を超える薬剤があれば確認を要する警告にする。判定できないだけなら表示のみ。 */
export function regimenCumulativeAdvisories(checks: CumulativeDoseCheck[]): Advisory[] {
  return checks.flatMap((check): Advisory[] => {
    if (check.status === "over") {
      return [
        {
          key: advisoryKey("regimen-cumulative", check.rule.id, "over"),
          kind: "regimen-cumulative",
          severity: severityOf("regimen-cumulative", true),
          message: `累積投与量の上限超過: ${check.name} ${check.total} ${check.unit} > ${check.limit} ${check.unit}`,
          detail: check.rule.message ?? undefined,
        },
      ];
    }
    if (check.status === "unknown") {
      return [
        {
          key: advisoryKey("regimen-cumulative", check.rule.id, "unknown"),
          kind: "regimen-cumulative",
          severity: severityOf("regimen-cumulative", false),
          message: `累積投与量を確認できません: ${check.name}(${check.note})`,
        },
      ];
    }
    return [];
  });
}
