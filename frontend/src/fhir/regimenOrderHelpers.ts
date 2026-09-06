import type { Medicine, MedicineUsage, RegimenDetail, RegimenDrug, RegimenStep } from "../api/masterClient";
import { addDays, diffDays, today } from "../lib/dates";
import { orderProblem, type ProblemRef } from "./conditionHelpers";
import {
  DAILY_SCHEDULE,
  SERIES_SCHEDULE_EXT_URL,
  SERIES_START_EXT_URL,
  buildInjectionSingleDayEntries,
  buildInjectionUpdateBundle,
  isInjectionServiceRequest,
  parseInjectionForm,
  type InjectionFormValues,
  type InjectionRpValues,
} from "./injectionHelpers";
import type { InjectionTaskStatus } from "./injectionTaskHelpers";
import {
  ORDER_TYPE_SYSTEM,
  SETTING_SYSTEM,
  applyOrderContext,
  buildPrescriptionBundle,
  buildPrescriptionUpdateBundle,
  ORDER_IN_RP_SYSTEM,
  RP_NUMBER_SYSTEM,
  identifierValue,
  parsePrescriptionForm,
  prescriptionRequester,
  type MedicineLineValues,
  type OrderAttribution,
  type PrescriptionFormValues,
  type PrescriptionSetting,
  type RpValues,
} from "./prescriptionHelpers";
import { isHeaderEntry } from "./provenanceHelpers";
import { doseUnitSuffix } from "./regimenHelpers";
import type { RxTaskStatus } from "./rxTaskHelpers";
import { categoryCoding, findSettingDisplay, orderComment, orderDay, registrationAuthoredOn } from "./shared";

// 化学療法レジメンオーダー(患者への適用)。docs/chemo-regimen-design.md §7。
//
// 適用 1 件 = ヘッダの ServiceRequest(どのレジメンを、いつから、何クール)+ 相対日を
// 実日付に展開した日ごとのオーダー。日ごとのオーダーは**通常の注射・処方そのもの**
// (ServiceRequest + MedicationRequest)で、注射一覧・払出・実施入力・経過表は
// 何も変えずに動く。どのレジメン適用の何クール目の何日目かは、日オーダーのヘッダに
// 焼く拡張(regimen-order)と requisition(適用 1 件の uuid)で読む。
//
// ヘッダは intent = plan で、カルテのカードにはしない(看護指示と同じく専用タブで見る)。

/** ヘッダ ServiceRequest のオーダー種別。 */
export const REGIMEN_ORDER_TYPE = { code: "chemo-regimen", display: "化学療法" };
/** ヘッダの code。レジメンマスタのコードと名前。 */
export const REGIMEN_CODE_SYSTEM = "http://fhir-client.local/CodeSystem/regimen";
/** 適用 1 件の uuid。ヘッダは identifier に、日オーダーは requisition に持つ。 */
export const REGIMEN_INSTANCE_SYSTEM = "http://fhir-client.local/Identifier/regimen-instance";
/** ヘッダの拡張(1 クールの日数・予定クール数・投与量の算出に使った体表面積など)。 */
export const REGIMEN_EXT_URL = "http://fhir-client.local/StructureDefinition/regimen";
/** 日オーダーの拡張(どの適用の何クール目の何日目か)。 */
export const REGIMEN_ORDER_EXT_URL = "http://fhir-client.local/StructureDefinition/regimen-order";
/**
 * 薬剤 1 件の投与量の拡張(MedicationRequest に付ける)。減量の投与率と、力価・製剤数を
 * 残す。`doseQuantity` は力価(換算を持たない薬剤は製剤数)なので、次のクールが
 * 「前クールと同じ量で」を再現するには率と、どちらの単位で出したかが要る(§7.6 B-1 / B-2)。
 */
export const REGIMEN_DOSE_EXT_URL = "http://fhir-client.local/StructureDefinition/regimen-dose";
/** ヘッダの instantiatesUri。マスタは backend にあるので FHIR 上は URI で指すだけ。 */
export const REGIMEN_URI_PREFIX = "http://fhir-client.local/regimen/";

/**
 * Calvert 式の定数(非腎排泄クリアランス、mL/分)。投与量 = AUC × (GFR + 25)。
 */
export const CALVERT_ADD = 25;

/** 一度に登録できるクール数の上限(1 クールが長いレジメンで transaction が膨らみすぎないように)。 */
export const MAX_REGIMEN_CYCLES_AT_ONCE = 3;

export function isRegimenServiceRequest(sr: fhir4.ServiceRequest): boolean {
  return categoryCoding(sr, ORDER_TYPE_SYSTEM)?.code === REGIMEN_ORDER_TYPE.code;
}

// ---- ヘッダ(レジメン適用) ----

export interface RegimenApplication {
  id: string;
  /** 適用 1 件の uuid。日オーダーの requisition と突き合わせる。 */
  instanceId: string;
  code: string;
  name: string;
  /** 最初のクールの Day 1。 */
  startDate: string;
  cycleDays: number;
  treatmentDays: number;
  /** 予定クール数。null は継続。 */
  plannedCycles: number | null;
  /** 投与量の算出に使った値。無ければ null。 */
  bsa: number | null;
  height: number | null;
  weight: number | null;
  status: fhir4.ServiceRequest["status"];
  setting: PrescriptionSetting;
  comment: string;
  problem: ProblemRef | null;
  /** 中止したときの理由と日付(§7.6 C-2)。中止していなければ null。 */
  discontinuation: RegimenDiscontinuation | null;
  /** 完了にした日(§7.6 C-1)。完了していなければ null。 */
  completedOn: string | null;
}

export interface RegimenDiscontinuation {
  /** `REGIMEN_DISCONTINUATION_REASON_OPTIONS` のコード。 */
  reason: string;
  note: string;
  date: string;
}

/** レジメンを中止する理由の区分。完遂は中止ではなく「完了」で扱う。 */
export const REGIMEN_DISCONTINUATION_REASON_OPTIONS = [
  { code: "progression", display: "病勢進行" },
  { code: "adverse-event", display: "有害事象" },
  { code: "patient-request", display: "患者希望" },
  { code: "change", display: "治療変更" },
  { code: "other", display: "その他" },
] as const;

export function discontinuationReasonLabel(code: string): string {
  return REGIMEN_DISCONTINUATION_REASON_OPTIONS.find((o) => o.code === code)?.display ?? code;
}

function extString(ext: fhir4.Extension | undefined, url: string): string {
  const e = ext?.extension?.find((x) => x.url === url);
  return e?.valueString ?? e?.valueCode ?? e?.valueDate ?? "";
}

function extInt(ext: fhir4.Extension | undefined, url: string): number | null {
  const value = ext?.extension?.find((e) => e.url === url)?.valueInteger;
  return typeof value === "number" ? value : null;
}

function extDecimal(ext: fhir4.Extension | undefined, url: string): number | null {
  const value = ext?.extension?.find((e) => e.url === url)?.valueDecimal;
  return typeof value === "number" ? value : null;
}

export function parseRegimenApplication(sr: fhir4.ServiceRequest): RegimenApplication | null {
  if (!isRegimenServiceRequest(sr) || !sr.id) return null;
  const coding = sr.code?.coding?.find((c) => c.system === REGIMEN_CODE_SYSTEM);
  const ext = sr.extension?.find((e) => e.url === REGIMEN_EXT_URL);
  return {
    id: sr.id,
    instanceId: sr.identifier?.find((i) => i.system === REGIMEN_INSTANCE_SYSTEM)?.value ?? "",
    code: coding?.code ?? "",
    name: coding?.display ?? sr.code?.text ?? "",
    startDate: orderDay(sr),
    cycleDays: extInt(ext, "cycleDays") ?? 0,
    treatmentDays: extInt(ext, "treatmentDays") ?? 0,
    plannedCycles: extInt(ext, "plannedCycles"),
    bsa: extDecimal(ext, "bsa"),
    height: extDecimal(ext, "height"),
    weight: extDecimal(ext, "weight"),
    status: sr.status,
    setting: (categoryCoding(sr, SETTING_SYSTEM)?.code ?? "") as PrescriptionSetting,
    comment: orderComment(sr),
    problem: orderProblem(sr),
    discontinuation:
      sr.status === "revoked"
        ? {
            reason: extString(ext, "discontinuationReason"),
            note: extString(ext, "discontinuationNote"),
            date: extString(ext, "discontinuedOn"),
          }
        : null,
    completedOn: sr.status === "completed" ? extString(ext, "completedOn") || null : null,
  };
}

export const REGIMEN_STATUS_LABELS: Record<string, string> = {
  active: "適用中",
  completed: "完了",
  revoked: "中止",
  "on-hold": "休止",
};

export function regimenStatusLabel(status: string): string {
  return REGIMEN_STATUS_LABELS[status] ?? status;
}

// ---- 日オーダーの印 ----

export interface RegimenOrderRef {
  /** ヘッダ ServiceRequest の id。 */
  regimenSrId: string;
  /** 適用 1 件の uuid(requisition)。 */
  instanceId: string;
  cycle: number;
  day: number;
  code: string;
  name: string;
  /** そのクールの減量理由(§7.6 B-1)。減量していなければ空。 */
  reduction: string;
}

/** 日オーダー(注射・処方のヘッダ)に焼いてあるレジメンの印。無ければ null。 */
export function regimenOrderOf(sr: fhir4.ServiceRequest): RegimenOrderRef | null {
  const ext = sr.extension?.find((e) => e.url === REGIMEN_ORDER_EXT_URL);
  if (!ext) return null;
  const reference = ext.extension?.find((e) => e.url === "regimen")?.valueReference?.reference ?? "";
  const regimenSrId = reference.split("/").pop() ?? "";
  const cycle = extInt(ext, "cycle");
  const day = extInt(ext, "day");
  if (!regimenSrId || cycle === null || day === null) return null;
  return {
    regimenSrId,
    instanceId: sr.requisition?.system === REGIMEN_INSTANCE_SYSTEM ? (sr.requisition.value ?? "") : "",
    cycle,
    day,
    code: ext.extension?.find((e) => e.url === "code")?.valueString ?? "",
    name: ext.extension?.find((e) => e.url === "name")?.valueString ?? "",
    reduction: ext.extension?.find((e) => e.url === "reduction")?.valueString ?? "",
  };
}

/** 「C1 Day8」。 */
export function cycleDayLabel(ref: Pick<RegimenOrderRef, "cycle" | "day">): string {
  return `C${ref.cycle} Day${ref.day}`;
}

/** カードに添える「mFOLFOX6 C1 Day8」。レジメンから出たオーダーでなければ空。 */
export function regimenOrderLabel(sr: fhir4.ServiceRequest): string {
  const ref = regimenOrderOf(sr);
  if (!ref) return "";
  return `${ref.name} ${cycleDayLabel(ref)}`;
}

// ---- 投与量の算出 ----

/** 体表面積(m²)。DuBois 式。身長 cm・体重 kg のどちらかが無ければ null。 */
export function bodySurfaceArea(heightCm: number | null, weightKg: number | null): number | null {
  if (!heightCm || !weightKg || heightCm <= 0 || weightKg <= 0) return null;
  return Math.round(0.007184 * weightKg ** 0.425 * heightCm ** 0.725 * 100) / 100;
}

/** 医薬品コード → 入力単位(mg など)→ 1 [薬価算定単位] あたりの量。 */
export type DoseFactorMap = Map<string, Map<string, number>>;

/** 投与量の算出に使う患者の値。GFR は AUC(Calvert 式)のときだけ要る。 */
export interface RegimenBody {
  bsa: number | null;
  weight: number | null;
  /** Calvert 式に使う GFR(mL/分、体表面積の補正なし)。 */
  gfr?: number | null;
}

/**
 * 薬剤 1 件の投与量。
 *
 * 抗がん剤の指示は力価(mg)で行うので、画面の入力欄は力価にして製剤数(瓶・錠)は
 * 換算して併記する(「1.49 瓶」だけでは何 mg か読めない)。オーダーに保存するのは
 * 従来どおり製剤数で、注射・処方の既存フォームが単位を薬価算定単位で出すのに合わせる。
 */
export interface RegimenDrugPlan {
  drug: RegimenDrug;
  /** 入力の主体。amount = 力価で入れて製剤数を導く / pack = 製剤数を直接入れる。 */
  input: "amount" | "pack";
  /** 力価の入力値。pack のときも算出できていれば表示用に持つ。 */
  amount: string;
  /** 力価の単位。基準の単位(mg など)、製剤単位が基準の薬剤では換算に使う単位(mL など)。 */
  unit: string;
  /** 算出した力価。医師が直したかの判定に使う。 */
  calculated: string;
  /** 1 [薬価算定単位] あたりの力価(投与量換算マスタ)。null なら製剤数を直接入れる。 */
  factor: number | null;
  /** 製剤数の入力値。input が pack のときに使う。 */
  packs: string;
  packUnit: string;
  /** 上限値で頭打ちにしたか。 */
  capped: boolean;
  /** 算出の根拠(「85 mg/m² × 1.75 m²」)。 */
  basis: string;
  /** 自動で出せなかった理由(手入力を促す)。 */
  manualReason: string;
  /**
   * 投与率(%)。減量したときに 100 未満になる(§7.6 B-1)。基準 × 体格 × 率 で力価を出す。
   * 減量レベル表(レベル × 薬剤 × %)はマスタに持たず、率を直接入れる運用にした。
   */
  ratio: string;
}

/**
 * 減量(投与率)を入れられる薬剤か。基準から量を出せるものだけで、補液(製剤単位)と
 * AUC は対象外(補液は減らすものではなく、AUC は Calvert 式の目標値そのものが指示)。
 */
export function canReduceDose(drug: RegimenDrug): boolean {
  return drug.dose_basis === "bsa" || drug.dose_basis === "weight" || drug.dose_basis === "fixed";
}

/** 投与率(%)。空や不正なら 100。 */
export function ratioOf(plan: Pick<RegimenDrugPlan, "ratio">): number {
  const value = Number(plan.ratio);
  return Number.isFinite(value) && value > 0 ? value : 100;
}

/** オーダーに載せる製剤数(薬価算定単位)。力価で入れているなら換算して出す。 */
export function planPacks(plan: RegimenDrugPlan): string {
  if (plan.input === "pack") return plan.packs;
  const amount = Number(plan.amount);
  if (!plan.factor || !Number.isFinite(amount) || amount <= 0) return "";
  return fmt(amount / plan.factor);
}

/**
 * 薬剤コメントに写す投与量。オーダーに載るのは製剤数(1.49 瓶)なので、指示の実体である
 * **力価だけ**を添える(「148.75 mg」)。算出の式は書かない — 体表面積・体重は適用の
 * ヘッダに残してあり、基準はレジメンマスタで読めるので、カードや注射箋で毎回読ませる
 * ほどの情報ではない。製剤単位が基準の薬剤(補液)は製剤数そのものが指示なので何も添えない。
 */
export function planNote(plan: RegimenDrugPlan): string {
  // 減量したときだけ率を添える。基準はレジメンマスタで読めるので式は書かないが、
  // 標準量でないことは指示そのものなので薬剤部・病棟に伝える。
  const ratio = ratioOf(plan);
  const reduced = canReduceDose(plan.drug) && ratio !== 100 ? `（${ratio}%）` : "";
  if (plan.input === "amount") {
    // オーダーには力価が載るので、製剤数の目安を添える(「≒ 1.19 瓶」。払出の当たりになる)。
    const packs = planPacks(plan);
    if (packs) return `≒ ${packs} ${plan.packUnit}${reduced}`;
    // 力価を出せないもの(AUC)は基準をそのまま残す。
    return `${plan.basis}${reduced}`;
  }
  // 製剤数で出す薬剤(換算を持たないもの)。力価の目安があれば添える。
  if (plan.drug.dose_basis === "unit") return reduced;
  if (plan.amount.trim() !== "") return `${plan.amount} ${plan.unit}${reduced}`;
  return `${plan.basis}${reduced}`;
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function fmt(value: number): string {
  return String(round(value, 2));
}

/**
 * 製剤単位が基準の薬剤(補液・溶解液)を力価で入れるときの単位。輸液は容量(mL)で
 * 指示するのが自然で、粉末は力価。換算マスタにある単位を上から順に探す。
 */
const PACK_BASIS_UNITS = ["mL", "mg", "g", "単位", "万単位", "国際単位", "mEq", "MBq", "ug"];

function pickPackBasisUnit(byUnit: Map<string, number> | undefined): { unit: string; factor: number } | null {
  for (const unit of PACK_BASIS_UNITS) {
    const factor = byUnit?.get(unit);
    if (factor && factor > 0) return { unit, factor };
  }
  return null;
}

/**
 * 薬剤 1 件の投与量を体格から出す。
 *
 * ［決定］入力は**力価が基本**。抗がん剤も補液も、指示は「148.75 mg」「250 mL」の形で
 * 出すものなので、換算マスタで製剤数に直せる薬剤はすべて力価で入力する
 * (製剤単位が基準のレジメン設定でも、画面では mL・mg に直して入れる)。
 * 換算を持たない薬剤(規格が読めない粉末バイアルなど)だけ製剤数を直接入れる。
 */
export function planDrugDose(
  drug: RegimenDrug,
  body: RegimenBody,
  factors: DoseFactorMap,
  /** 投与率(%)。減量するときに 100 未満を渡す。 */
  ratio = 100,
): RegimenDrugPlan {
  const unit = drug.dose_unit ?? "";
  const value = drug.dose_value !== null ? Number(drug.dose_value) : null;
  const max = drug.dose_max !== null ? Number(drug.dose_max) : null;
  const suffix = doseUnitSuffix(drug.dose_basis, unit);
  const byUnit = factors.get(drug.medicine_code);
  const packUnit = drug.resolved_unit_name ?? "";
  const base: RegimenDrugPlan = {
    drug,
    input: "pack",
    amount: "",
    unit,
    calculated: "",
    factor: null,
    packs: "",
    packUnit,
    capped: false,
    basis: "",
    manualReason: "",
    ratio: String(canReduceDose(drug) ? ratio : 100),
  };
  const noConversion = `${unit || "力価"} から ${packUnit || "製剤単位"} への換算がありません`;

  if (value === null) return { ...base, manualReason: "基準値がありません" };

  // 製剤単位が基準(「1 袋」)でも、容量・力価に直せるならそちらで入れる。
  if (drug.dose_basis === "unit") {
    const picked = pickPackBasisUnit(byUnit);
    if (!picked) return { ...base, packs: fmt(value) };
    const amount = fmt(round(value * picked.factor, 2));
    return {
      ...base,
      input: "amount",
      unit: picked.unit,
      factor: picked.factor,
      amount,
      calculated: amount,
      basis: `${value} ${packUnit}`,
    };
  }

  const factor = byUnit?.get(unit) ?? null;

  let amount: number;
  let basis: string;
  switch (drug.dose_basis) {
    // Calvert 式: 投与量(mg) = AUC × (GFR + 25)。GFR は体表面積で補正しない値で、
    // 画面で出どころ(CCr / eGFR)を選び、手で直せる(§7.6 B-3)。
    case "auc": {
      const gfr = body.gfr ?? null;
      if (gfr === null) {
        return {
          ...base,
          input: factor ? "amount" : "pack",
          factor,
          basis: `AUC ${value}`,
          manualReason: factor ? "GFR が出せません。力価(mg)を入力してください" : noConversion,
        };
      }
      amount = value * (gfr + CALVERT_ADD);
      basis = `AUC ${value} × (GFR ${gfr} + ${CALVERT_ADD})`;
      break;
    }
    case "bsa":
      if (body.bsa === null) return { ...base, manualReason: "体表面積が出せません" };
      amount = value * body.bsa;
      basis = `${value} ${suffix} × ${body.bsa} m²`;
      break;
    case "weight":
      if (body.weight === null) return { ...base, manualReason: "体重がありません" };
      amount = value * body.weight;
      basis = `${value} ${suffix} × ${body.weight} kg`;
      break;
    default:
      amount = value;
      basis = `${value} ${suffix}`;
      break;
  }

  // 減量(§7.6 B-1)。上限値は「体格から計算しても超えない量」なので、率を掛けた**後**に
  // 当てる(減量したのに上限で戻る、ということが起きない)。
  if (canReduceDose(drug) && ratio !== 100) {
    amount = (amount * ratio) / 100;
    basis = `${basis} × ${ratio}%`;
  }

  let capped = false;
  if (max !== null && amount > max) {
    amount = max;
    capped = true;
  }
  const calculated = fmt(round(amount, 2));
  // 力価は出せるが製剤数に直せない薬剤は、製剤数を手で入れる(力価は目安として出す)。
  if (!factor) {
    return { ...base, amount: calculated, calculated, basis, capped, manualReason: noConversion };
  }
  return { ...base, input: "amount", amount: calculated, calculated, factor, basis, capped };
}

// ---- 適用の入力値 ----

export interface RegimenStepPlan {
  step: RegimenStep;
  drugs: RegimenDrugPlan[];
}

export interface RegimenApplyValues {
  /** 登録する最初のクールの Day 1。 */
  startDate: string;
  /** 登録する最初のクール番号(新規適用は 1、追加登録は続き)。 */
  firstCycle: number;
  /** 今回登録するクール数。 */
  cycleCount: string;
  /** 予定クール数(新規適用のときヘッダに焼く)。空は継続。 */
  plannedCycles: string;
  setting: PrescriptionSetting;
  /** 注射区分(注射ステップがあるとき)。 */
  injectionCategory: string;
  /** 処方区分(内服ステップがあるとき)。 */
  prescriptionCategory: string;
  problem: ProblemRef | null;
  height: string;
  weight: string;
  /** Calvert 式に使う GFR(mL/分)。AUC の薬剤があるレジメンでだけ使う。 */
  gfr: string;
  /** GFR の出どころ。手で直したら "manual" になり、体格を変えても追随しない。 */
  gfrSource: GfrSource;
  comment: string;
  /** 減量した理由(そのクールの日オーダーに焼く)。減量していなければ空。 */
  reductionReason: string;
  /** 前クールと同じ量で出しているか(次クール登録のみ。§7.6 B-2)。 */
  carryOver: boolean;
  steps: RegimenStepPlan[];
}

export type GfrSource = "ccr" | "egfr" | "manual";

export const GFR_SOURCE_OPTIONS: { code: GfrSource; display: string }[] = [
  { code: "ccr", display: "CCr(Cockcroft-Gault)" },
  { code: "egfr", display: "eGFR(補正なしに換算)" },
  { code: "manual", display: "手入力" },
];

/** 入力値から Calvert 式に使う GFR。 */
export function gfrOf(values: Pick<RegimenApplyValues, "gfr">): number | null {
  const value = Number(values.gfr);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** 前クールの投与量(薬剤 1 件ぶん)。MedicationRequest の拡張から読む。 */
export interface PreviousDose {
  ratio: number;
  /** 力価。製剤数で入れた薬剤は null。 */
  amount: number | null;
  unit: string;
  /** 製剤数(オーダーに載った値)。 */
  packs: number | null;
}

/** 入力値から体表面積。 */
export function bsaOf(values: Pick<RegimenApplyValues, "height" | "weight">): number | null {
  return bodySurfaceArea(Number(values.height) || null, Number(values.weight) || null);
}

/**
 * ステップの薬剤をすべて算出し直す。`previous` を渡すと**前クールと同じ量**で出す
 * (§7.6 B-2)。渡さなければそのときの体格から出し直す。
 */
export function planSteps(
  regimen: RegimenDetail,
  body: RegimenBody,
  factors: DoseFactorMap,
  previous?: Map<number, PreviousDose>,
): RegimenStepPlan[] {
  return regimen.steps.map((step) => ({
    step,
    drugs: step.drugs.map((drug) => {
      const prev = previous?.get(drug.id);
      const plan = planDrugDose(drug, body, factors, prev ? prev.ratio : 100);
      return prev ? carryOverDose(plan, prev) : plan;
    }),
  }));
}

/**
 * 前クールの投与量を写す。率だけでなく**力価そのもの**を引き継ぐ(端数調整や
 * 手入力をそのまま持ち越すため)。単位が変わっていれば率だけを引き継いで、
 * 量は今の体格から出した値を残す(単位違いの数字をそのまま入れる方が危ない)。
 */
function carryOverDose(plan: RegimenDrugPlan, prev: PreviousDose): RegimenDrugPlan {
  if (plan.input === "amount") {
    if (prev.amount === null) return plan;
    if (prev.unit && plan.unit && prev.unit !== plan.unit) return plan;
    return { ...plan, amount: fmt(prev.amount) };
  }
  if (prev.packs === null) return plan;
  return { ...plan, packs: fmt(prev.packs) };
}

/** 標準量から減らした薬剤があるか。減量理由の入力欄を出すかどうかの判定に使う。 */
export function hasReducedDose(values: Pick<RegimenApplyValues, "steps">): boolean {
  return values.steps.some((plan) => plan.drugs.some((d) => canReduceDose(d.drug) && ratioOf(d) !== 100));
}

export function regimenHasInjection(regimen: RegimenDetail): boolean {
  return regimen.steps.some((s) => s.usage_type !== "oral");
}

/** AUC(Calvert 式)で量を出す薬剤があるか。GFR の入力欄を出すかの判定。 */
export function regimenHasAuc(regimen: RegimenDetail): boolean {
  return regimen.steps.some((s) => s.drugs.some((d) => d.dose_basis === "auc"));
}

export function regimenHasOral(regimen: RegimenDetail): boolean {
  return regimen.steps.some((s) => s.usage_type === "oral");
}

/** 適用の入力を検証する。問題なければ null。 */
export function validateRegimenApply(values: RegimenApplyValues, regimen: RegimenDetail): string | null {
  if (!values.startDate) return "開始日(Day 1)を入力してください";
  const count = Number(values.cycleCount);
  if (!Number.isInteger(count) || count < 1) return "登録するクール数は 1 以上の整数で入力してください";
  if (count > MAX_REGIMEN_CYCLES_AT_ONCE) return `一度に登録できるのは ${MAX_REGIMEN_CYCLES_AT_ONCE} クールまでです`;
  if (values.plannedCycles.trim() !== "") {
    const planned = Number(values.plannedCycles);
    if (!Number.isInteger(planned) || planned < 1) return "予定クール数は 1 以上の整数で入力してください";
  }
  if (!values.setting) return "入外区分を選択してください";
  if (regimenHasInjection(regimen) && !values.injectionCategory) return "注射区分を選択してください";
  if (regimenHasOral(regimen) && !values.prescriptionCategory) return "処方区分を選択してください";
  const cycleDays = (regimen.treatment_days ?? 0) + (regimen.rest_days ?? 0);
  if (count > 1 && cycleDays <= 0) return "1 クールの日数が無いレジメンは 1 クールずつ登録してください";
  for (const plan of values.steps) {
    if (plan.step.usage_type === "oral" && !plan.step.usage) {
      return `ステップ「${plan.step.name || "内服"}」の用法がマスタにありません`;
    }
    for (const d of plan.drugs) {
      const name = d.drug.resolved_name ?? d.drug.medicine_code;
      const entered = d.input === "amount" ? d.amount : d.packs;
      const value = Number(entered);
      if (entered.trim() === "" || !Number.isFinite(value) || value <= 0) {
        return `${name} の投与量を入力してください`;
      }
      // 力価で入れていても、オーダーに載るのは製剤数(換算できないと保存できない)。
      if (Number(planPacks(d)) <= 0) return `${name} の投与量を製剤数に換算できません`;
    }
  }
  return null;
}

// ---- FHIR の組み立て ----

/**
 * オーダーに載せる薬剤。`unit_name` は**投与量の単位**として `doseQuantity.unit` に写るので、
 * 力価で出す薬剤は力価の単位(mg)、製剤数で出す薬剤は薬価算定単位(瓶)を入れる。
 */
function medicineOf(drug: RegimenDrug, unitName: string | null): Medicine {
  return {
    id: 0,
    medicine_code: drug.medicine_code,
    name: drug.resolved_name ?? drug.medicine_code,
    name_kana: null,
    unit_code: null,
    unit_name: unitName,
    dosage_form: drug.dosage_form,
    injection_volume: null,
    yakka_code: null,
    price: null,
    generic_name_description: null,
    abolished_on: null,
    yakko_code: null,
    yakko_name: null,
    yj_code: drug.yj_code,
  };
}

function medicineLines(plan: RegimenStepPlan): MedicineLineValues[] {
  return plan.drugs.map((d) => ({
    // ［決定］保存は**力価**(148.75 mg)。指示の実体が力価で、カード・実施入力・帳票は
    // `doseQuantity.unit` を尊重して出す。製剤数は払出で換算マスタから出す
    // (`doseConversionHelpers`)。換算を持たない薬剤だけ製剤数のまま。
    medicine: medicineOf(d.drug, d.input === "amount" ? d.unit : d.packUnit),
    dose: d.input === "amount" ? d.amount : d.packs,
    comment: planNote(d),
  }));
}

/** ステップの見出し・器材・注意を用法コメントにまとめる(注射箋・ラベルに出る)。 */
function stepComment(step: RegimenStep): string {
  return [step.name, step.device_note ? `器材: ${step.device_note}` : "", step.note]
    .filter((s): s is string => Boolean(s))
    .join(" / ");
}

function injectionRpOf(plan: RegimenStepPlan): InjectionRpValues {
  const step = plan.step;
  return {
    usageType: step.usage_type === "drip" ? "drip" : "one-shot",
    routeCode: step.route_code ?? "",
    siteCode: "",
    methodCode: step.method_code ?? "",
    lineCode: step.line_code ?? "",
    rate: step.rate ? String(Number(step.rate)) : "",
    infusionHours: "",
    times: [],
    usageComment: stepComment(step),
    medicines: medicineLines(plan),
  };
}

function oralRpOf(plan: RegimenStepPlan): RpValues {
  const step = plan.step;
  const usage: MedicineUsage | null = step.usage ?? null;
  return {
    usage,
    doseDays: step.dose_days ? String(step.dose_days) : "",
    doseCount: "",
    usageComment: stepComment(step),
    medicines: medicineLines(plan),
  };
}

interface StampRef {
  headerReference: string;
  instanceId: string;
  cycle: number;
  day: number;
  code: string;
  name: string;
  /** そのクールの減量理由。空なら焼かない。 */
  reduction: string;
}

function regimenOrderExtension(ref: StampRef): fhir4.Extension {
  return {
    url: REGIMEN_ORDER_EXT_URL,
    extension: [
      { url: "regimen", valueReference: { reference: ref.headerReference } },
      { url: "cycle", valueInteger: ref.cycle },
      { url: "day", valueInteger: ref.day },
      { url: "code", valueString: ref.code },
      { url: "name", valueString: ref.name },
      ...(ref.reduction ? [{ url: "reduction", valueString: ref.reduction }] : []),
    ],
  };
}

/**
 * 薬剤 1 件の投与量を MedicationRequest に焼く。レジメンマスタの薬剤 id を一緒に
 * 持たせて、クールをまたいでも取り違えないようにする。
 */
function regimenDoseExtension(plan: RegimenDrugPlan): fhir4.Extension {
  const parts: fhir4.Extension[] = [
    { url: "drug", valueInteger: plan.drug.id },
    { url: "ratio", valueDecimal: ratioOf(plan) },
  ];
  const amount = Number(plan.amount);
  if (plan.amount.trim() !== "" && Number.isFinite(amount) && amount > 0) {
    parts.push({ url: "amount", valueDecimal: amount });
    if (plan.unit) parts.push({ url: "unit", valueString: plan.unit });
  }
  const packs = Number(planPacks(plan));
  if (Number.isFinite(packs) && packs > 0) parts.push({ url: "packs", valueDecimal: packs });
  return { url: REGIMEN_DOSE_EXT_URL, extension: parts };
}

/** 薬剤 1 件の投与量の拡張を読む。レジメンから出たオーダーでなければ null。 */
export function regimenDoseOf(mr: fhir4.MedicationRequest): (PreviousDose & { drugId: number }) | null {
  const ext = mr.extension?.find((e) => e.url === REGIMEN_DOSE_EXT_URL);
  const drugId = ext?.extension?.find((e) => e.url === "drug")?.valueInteger;
  if (!ext || drugId === undefined) return null;
  const decimal = (url: string) => ext.extension?.find((e) => e.url === url)?.valueDecimal ?? null;
  return {
    drugId,
    ratio: decimal("ratio") ?? 100,
    amount: decimal("amount"),
    unit: ext.extension?.find((e) => e.url === "unit")?.valueString ?? "",
    packs: decimal("packs"),
  };
}

/**
 * 日オーダーの MedicationRequest に投与量の拡張を焼く。RP 番号と RP 内の順で薬剤に
 * 引き当てる(`buildCycleEntries` が RP の並びをステップの並びと一致させている)。
 */
function stampRegimenDrugs(entries: fhir4.BundleEntry[], plans: RegimenStepPlan[]): fhir4.BundleEntry[] {
  return entries.map((entry) => {
    const resource = entry.resource;
    if (resource?.resourceType !== "MedicationRequest") return entry;
    const mr = resource as fhir4.MedicationRequest;
    const rp = Number(identifierValue(mr, RP_NUMBER_SYSTEM) ?? "0");
    const order = Number(identifierValue(mr, ORDER_IN_RP_SYSTEM) ?? "0");
    const plan = plans[rp - 1]?.drugs[order - 1];
    if (!plan) return entry;
    return {
      ...entry,
      resource: { ...mr, extension: [...(mr.extension ?? []), regimenDoseExtension(plan)] },
    };
  });
}

/**
 * 日オーダーのヘッダにレジメンの印を焼く。注射の束ね(requisition と series 拡張)は
 * レジメンが担うので落とし、requisition を適用 1 件の uuid に差し替える。
 */
function stampRegimenOrder(entries: fhir4.BundleEntry[], ref: StampRef): fhir4.BundleEntry[] {
  return entries.map((entry) => {
    if (!isHeaderEntry(entry)) return entry;
    const sr = entry.resource;
    return {
      ...entry,
      resource: {
        ...sr,
        requisition: { system: REGIMEN_INSTANCE_SYSTEM, value: ref.instanceId },
        extension: [
          ...(sr.extension ?? []).filter(
            (e) =>
              e.url !== SERIES_START_EXT_URL &&
              e.url !== SERIES_SCHEDULE_EXT_URL &&
              e.url !== REGIMEN_ORDER_EXT_URL,
          ),
          regimenOrderExtension(ref),
        ],
      },
    };
  });
}

function rpKeyOf(mr: fhir4.MedicationRequest): string {
  return `${identifierValue(mr, RP_NUMBER_SYSTEM) ?? ""}:${identifierValue(mr, ORDER_IN_RP_SYSTEM) ?? ""}`;
}

/**
 * 移動で MedicationRequest を組み直すときに、投与量の拡張(`regimen-dose`)を写す。
 * フォーム(`parseInjectionForm`)は拡張を持たないので、写さないと日を動かしただけで
 * 減量の記録が消える。RP 番号と RP 内の順で引き当てるので、並びに依存しない。
 */
function carryRegimenDoses(
  entries: fhir4.BundleEntry[],
  originals: fhir4.MedicationRequest[],
): fhir4.BundleEntry[] {
  const byKey = new Map<string, fhir4.Extension>();
  for (const mr of originals) {
    const ext = mr.extension?.find((e) => e.url === REGIMEN_DOSE_EXT_URL);
    if (ext) byKey.set(rpKeyOf(mr), ext);
  }
  if (byKey.size === 0) return entries;
  return entries.map((entry) => {
    const resource = entry.resource;
    if (resource?.resourceType !== "MedicationRequest") return entry;
    const mr = resource as fhir4.MedicationRequest;
    const ext = byKey.get(rpKeyOf(mr));
    if (!ext) return entry;
    return {
      ...entry,
      resource: {
        ...mr,
        extension: [...(mr.extension ?? []).filter((e) => e.url !== REGIMEN_DOSE_EXT_URL), ext],
      },
    };
  });
}

/**
 * 1 クールぶんの日オーダー。ステップの相対日を Day 1 の実日付から展開し、同じ日の
 * 注射ステップは 1 つの注射オーダー(RP = ステップ)、内服ステップは 1 つの処方にまとめる。
 */
function buildCycleEntries(
  values: RegimenApplyValues,
  regimen: RegimenDetail,
  cycle: number,
  day1: string,
  headerReference: string,
  instanceId: string,
  patientId: string,
  requester: OrderAttribution,
  authoredOn: string,
): fhir4.BundleEntry[] {
  // RP の並び = ステップの並び。投与量の拡張(`stampRegimenDrugs`)がこの順で薬剤に
  // 引き当てるので、値ではなく plan を積んで順を保つ。
  const injectionByDay = new Map<number, RegimenStepPlan[]>();
  const oralByDay = new Map<number, RegimenStepPlan[]>();
  for (const plan of values.steps) {
    for (const day of plan.step.days) {
      if (plan.step.usage_type === "oral") {
        oralByDay.set(day, [...(oralByDay.get(day) ?? []), plan]);
      } else {
        injectionByDay.set(day, [...(injectionByDay.get(day) ?? []), plan]);
      }
    }
  }

  const ref = (day: number): StampRef => ({
    headerReference,
    instanceId,
    cycle,
    day,
    code: regimen.regimen_code,
    name: regimen.name,
    // 出し直して標準量に戻したときは、引き継いだ理由をそのまま焼かない。
    reduction: hasReducedDose(values) ? values.reductionReason.trim() : "",
  });
  const entries: fhir4.BundleEntry[] = [];
  const days = Array.from(new Set([...injectionByDay.keys(), ...oralByDay.keys()])).sort((a, b) => a - b);
  for (const day of days) {
    const date = addDays(day1, day - 1);
    const injectionPlans = injectionByDay.get(day);
    if (injectionPlans) {
      const injection: InjectionFormValues = {
        setting: values.setting,
        category: values.injectionCategory,
        startDate: date,
        endDate: date,
        schedule: DAILY_SCHEDULE,
        comment: values.comment,
        problem: values.problem,
        rps: injectionPlans.map(injectionRpOf),
        series: null,
      };
      entries.push(
        ...stampRegimenDrugs(
          stampRegimenOrder(buildInjectionSingleDayEntries(injection, patientId, requester, authoredOn), ref(day)),
          injectionPlans,
        ),
      );
    }
    const oralPlans = oralByDay.get(day);
    if (oralPlans) {
      const prescription: PrescriptionFormValues = {
        setting: values.setting,
        category: values.prescriptionCategory,
        startDate: date,
        comment: values.comment,
        problem: values.problem,
        rps: oralPlans.map(oralRpOf),
      };
      entries.push(
        ...stampRegimenDrugs(
          stampRegimenOrder(buildPrescriptionBundle(prescription, patientId, requester).entry ?? [], ref(day)),
          oralPlans,
        ),
      );
    }
  }
  return entries;
}

function cycleDaysOfRegimen(regimen: RegimenDetail): number {
  return (regimen.treatment_days ?? 0) + (regimen.rest_days ?? 0);
}

function buildHeader(
  values: RegimenApplyValues,
  regimen: RegimenDetail,
  patientId: string,
  requester: OrderAttribution,
  authoredOn: string,
  instanceId: string,
): fhir4.ServiceRequest {
  const bsa = bsaOf(values);
  const height = Number(values.height) || null;
  const weight = Number(values.weight) || null;
  const planned = values.plannedCycles.trim() === "" ? null : Number(values.plannedCycles);
  const sr: fhir4.ServiceRequest = {
    resourceType: "ServiceRequest",
    status: "active",
    // 個々の投与ではなく治療計画なので plan。日オーダーが order。
    intent: "plan",
    category: [
      { coding: [{ system: ORDER_TYPE_SYSTEM, ...REGIMEN_ORDER_TYPE }] },
      {
        coding: [{ system: SETTING_SYSTEM, code: values.setting, display: findSettingDisplay(values.setting) }],
      },
    ],
    code: {
      coding: [{ system: REGIMEN_CODE_SYSTEM, code: regimen.regimen_code, display: regimen.name }],
      text: regimen.name,
    },
    identifier: [{ system: REGIMEN_INSTANCE_SYSTEM, value: instanceId }],
    instantiatesUri: [`${REGIMEN_URI_PREFIX}${regimen.regimen_code}`],
    subject: { reference: `Patient/${patientId}` },
    authoredOn,
    occurrenceDateTime: values.startDate,
    extension: [
      {
        url: REGIMEN_EXT_URL,
        extension: [
          { url: "cycleDays", valueInteger: cycleDaysOfRegimen(regimen) },
          { url: "treatmentDays", valueInteger: regimen.treatment_days ?? 0 },
          ...(planned !== null ? [{ url: "plannedCycles", valueInteger: planned }] : []),
          ...(bsa !== null ? [{ url: "bsa", valueDecimal: bsa }] : []),
          ...(height !== null ? [{ url: "height", valueDecimal: height }] : []),
          ...(weight !== null ? [{ url: "weight", valueDecimal: weight }] : []),
        ],
      },
    ],
  };
  if (values.problem) {
    sr.reasonReference = [
      { reference: `Condition/${values.problem.conditionId}`, display: values.problem.display },
    ];
  }
  applyOrderContext(sr, requester);
  if (values.comment) sr.note = [{ text: values.comment }];
  return sr;
}

/**
 * 新規適用。ヘッダ + 指定したクール数ぶんの日オーダーを 1 つの transaction で登録する
 * (全部登録か全部失敗か)。
 */
export function buildRegimenApplicationBundle(
  values: RegimenApplyValues,
  regimen: RegimenDetail,
  patientId: string,
  requester: OrderAttribution,
): fhir4.Bundle {
  const instanceId = crypto.randomUUID();
  const headerReference = `urn:uuid:${crypto.randomUUID()}`;
  const authoredOn = registrationAuthoredOn();
  const header = buildHeader(values, regimen, patientId, requester, authoredOn, instanceId);
  const entries: fhir4.BundleEntry[] = [
    { fullUrl: headerReference, resource: header, request: { method: "POST", url: "ServiceRequest" } },
  ];
  const cycleDays = cycleDaysOfRegimen(regimen);
  const count = Number(values.cycleCount) || 1;
  for (let i = 0; i < count; i += 1) {
    const cycle = values.firstCycle + i;
    const day1 = addDays(values.startDate, cycleDays * i);
    entries.push(
      ...buildCycleEntries(values, regimen, cycle, day1, headerReference, instanceId, patientId, requester, authoredOn),
    );
  }
  return { resourceType: "Bundle", type: "transaction", entry: entries };
}

/** 適用済みのレジメンにクールを追加登録する。ヘッダは触らない。 */
export function buildRegimenCycleBundle(
  values: RegimenApplyValues,
  regimen: RegimenDetail,
  application: RegimenApplication,
  patientId: string,
  requester: OrderAttribution,
): fhir4.Bundle {
  const authoredOn = registrationAuthoredOn();
  const headerReference = `ServiceRequest/${application.id}`;
  const cycleDays = application.cycleDays || cycleDaysOfRegimen(regimen);
  const count = Number(values.cycleCount) || 1;
  const entries: fhir4.BundleEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    const cycle = values.firstCycle + i;
    const day1 = addDays(values.startDate, cycleDays * i);
    entries.push(
      ...buildCycleEntries(
        values,
        regimen,
        cycle,
        day1,
        headerReference,
        application.instanceId,
        patientId,
        requester,
        authoredOn,
      ),
    );
  }
  return { resourceType: "Bundle", type: "transaction", entry: entries };
}

// ---- 登録済みの日オーダー ----

export interface RegimenDayOrder {
  kind: "injection" | "prescription";
  serviceRequest: fhir4.ServiceRequest;
  medicationRequests: fhir4.MedicationRequest[];
  /** 進捗の Task(注射・処方とも同じ形)。まだ無ければ undefined = 依頼済。 */
  task?: fhir4.Task;
  ref: RegimenOrderRef;
  date: string;
  status: InjectionTaskStatus | RxTaskStatus;
}

export function isRegimenDayOrder(sr: fhir4.ServiceRequest): boolean {
  return regimenOrderOf(sr) !== null;
}

/** クール番号 → そのクールの Day 1 の実日付(登録された日オーダーから逆算)。 */
export function cycleStartDates(orders: RegimenDayOrder[]): Map<number, string> {
  const result = new Map<number, string>();
  for (const order of orders) {
    const start = addDays(order.date, -(order.ref.day - 1));
    const current = result.get(order.ref.cycle);
    // 同じクールで食い違えば早い方(移動で一部だけずれたときは最初の日を基準にする)。
    if (!current || start < current) result.set(order.ref.cycle, start);
  }
  return result;
}

/** 直前のクールの投与量。次のクールを「前クールと同じ量で」出すために読む(§7.6 B-2)。 */
export interface PreviousCycle {
  cycle: number;
  doses: Map<number, PreviousDose>;
  /** そのクールの減量理由。 */
  reduction: string;
  /** 標準量から減らした薬剤があるか。 */
  reduced: boolean;
}

/**
 * `beforeCycle` より前で最も新しいクールの投与量を集める。同じ薬剤が複数の日に出る
 * (Day 1, 8, 15)ときは同じ量なので、どの日から読んでも変わらない。
 */
export function previousCycleOf(orders: RegimenDayOrder[], beforeCycle: number): PreviousCycle | null {
  const earlier = orders.filter((o) => o.ref.cycle < beforeCycle);
  if (earlier.length === 0) return null;
  const cycle = Math.max(...earlier.map((o) => o.ref.cycle));
  const doses = new Map<number, PreviousDose>();
  let reduction = "";
  for (const order of earlier) {
    if (order.ref.cycle !== cycle) continue;
    if (!reduction) reduction = order.ref.reduction;
    for (const mr of order.medicationRequests) {
      const dose = regimenDoseOf(mr);
      if (dose) doses.set(dose.drugId, dose);
    }
  }
  if (doses.size === 0 && !reduction) return null;
  return {
    cycle,
    doses,
    reduction,
    reduced: Array.from(doses.values()).some((d) => d.ratio !== 100),
  };
}

/** 次に登録するクールの番号と既定の Day 1。 */
export function nextCycleOf(
  application: RegimenApplication,
  orders: RegimenDayOrder[],
): { cycle: number; startDate: string } {
  const starts = cycleStartDates(orders);
  if (starts.size === 0) return { cycle: 1, startDate: application.startDate };
  const last = Math.max(...starts.keys());
  const lastStart = starts.get(last) ?? application.startDate;
  return { cycle: last + 1, startDate: addDays(lastStart, application.cycleDays) };
}

/** 医薬品名の並び(その日の内容を tooltip などに出す)。 */
export function dayOrderDrugNames(order: RegimenDayOrder): string[] {
  return order.medicationRequests
    .map((mr) => mr.medicationCodeableConcept?.text ?? mr.medicationCodeableConcept?.coding?.[0]?.display ?? "")
    .filter(Boolean);
}

/**
 * その日のステップ見出し(「前投薬」「オキサリプラチン＋レボホリナート」)。
 *
 * 暦のマスは狭く、薬剤名を並べても読めないので、医師が組んだ単位である
 * ステップ名を出す。適用時に用法コメント(`stepComment`)の先頭へ写してあるので、
 * レジメンマスタを引き直さずに読める。見出しの無いステップは薬剤名で代える。
 */
export function dayOrderStepNames(order: RegimenDayOrder): string[] {
  const byRp = new Map<string, string>();
  for (const mr of order.medicationRequests) {
    const rp = identifierValue(mr, RP_NUMBER_SYSTEM) ?? "";
    if (byRp.has(rp) && byRp.get(rp)) continue;
    const comment = mr.dosageInstruction?.[0]?.additionalInstruction?.[0]?.text ?? "";
    const head = comment.split(" / ")[0].trim();
    // stepComment は [見出し, 器材, 注意] を並べたものなので、見出しが無いと
    // 器材が先頭に来る。それはステップ名ではないので薬剤名に落とす。
    const name =
      head && !head.startsWith("器材:")
        ? head
        : (mr.medicationCodeableConcept?.text ?? mr.medicationCodeableConcept?.coding?.[0]?.display ?? "");
    byRp.set(rp, name);
  }
  return Array.from(byRp.values()).filter(Boolean);
}

/** 暦の 1 日がクールのどこに当たるか。登録済みのクールの範囲だけを見る。 */
export interface CyclePosition {
  cycle: number;
  /** 1 始まりの相対日。 */
  day: number;
  /** 休薬期間(投与期間を過ぎた日)か。 */
  rest: boolean;
}

/**
 * 日付 → クール内の位置。クールの Day 1 は登録済みの日オーダーから逆算した値
 * (`cycleStartDates`)を使うので、移動した日にも追随する。
 */
export function cyclePositionOf(
  date: string,
  starts: Map<number, string>,
  cycleDays: number,
  treatmentDays: number,
): CyclePosition | null {
  if (cycleDays <= 0) return null;
  for (const [cycle, start] of starts) {
    const offset = diffDays(start, date);
    if (offset < 0 || offset >= cycleDays) continue;
    const day = offset + 1;
    return { cycle, day, rest: treatmentDays > 0 && day > treatmentDays };
  }
  return null;
}

/**
 * 日オーダーを別の日へ動かす。内容は変えず日付だけを差し替えて、同じ id へ PUT する
 * (注射の開始時刻の日付も注射日から決まるので一緒に動く)。レジメンの印は引き継ぐ。
 */
export function buildRegimenMoveBundle(
  orders: RegimenDayOrder[],
  deltaDays: number,
  patientId: string,
): fhir4.Bundle {
  const entries = orders.flatMap((order) => {
    const sr = order.serviceRequest;
    const newDate = addDays(order.date, deltaDays);
    const requester = prescriptionRequester(sr);
    const mrIds = order.medicationRequests.map((mr) => mr.id).filter((id): id is string => Boolean(id));
    const ref: StampRef = {
      headerReference: `ServiceRequest/${order.ref.regimenSrId}`,
      instanceId: order.ref.instanceId,
      cycle: order.ref.cycle,
      day: order.ref.day,
      code: order.ref.code,
      name: order.ref.name,
      reduction: order.ref.reduction,
    };
    if (order.kind === "injection") {
      const values = parseInjectionForm(sr, order.medicationRequests);
      const bundle = buildInjectionUpdateBundle(
        { ...values, startDate: newDate, endDate: newDate, series: null },
        patientId,
        sr,
        mrIds,
        requester,
      );
      return carryRegimenDoses(stampRegimenOrder(bundle.entry ?? [], ref), order.medicationRequests);
    }
    const values = parsePrescriptionForm(sr, order.medicationRequests);
    const bundle = buildPrescriptionUpdateBundle({ ...values, startDate: newDate }, patientId, sr, mrIds, requester);
    return carryRegimenDoses(stampRegimenOrder(bundle.entry ?? [], ref), order.medicationRequests);
  });
  return { resourceType: "Bundle", type: "transaction", entry: entries };
}

/** ヘッダを中止(revoked)にする entry。 */
/** ヘッダの `regimen` 拡張に、状態遷移の記録(中止理由・完了日)を足して返す。 */
function withRegimenExtension(header: fhir4.ServiceRequest, parts: fhir4.Extension[]): fhir4.Extension[] {
  const others = (header.extension ?? []).filter((e) => e.url !== REGIMEN_EXT_URL);
  const current = header.extension?.find((e) => e.url === REGIMEN_EXT_URL);
  const urls = new Set(parts.map((p) => p.url));
  return [
    ...others,
    {
      url: REGIMEN_EXT_URL,
      extension: [...(current?.extension ?? []).filter((e) => !urls.has(e.url)), ...parts],
    },
  ];
}

function regimenStatusEntry(
  header: fhir4.ServiceRequest,
  status: fhir4.ServiceRequest["status"],
  parts: fhir4.Extension[],
): fhir4.BundleEntry {
  const resource: fhir4.ServiceRequest = {
    ...header,
    status,
    extension: withRegimenExtension(header, parts),
  };
  return { resource, request: { method: "PUT", url: `ServiceRequest/${header.id}` } };
}

/** レジメンの中止。理由は `regimen` 拡張に残す(治療歴で読む。§7.6 C-2)。 */
export function revokeRegimenEntry(
  header: fhir4.ServiceRequest,
  discontinuation: Pick<RegimenDiscontinuation, "reason" | "note">,
): fhir4.BundleEntry {
  return regimenStatusEntry(header, "revoked", [
    { url: "discontinuationReason", valueCode: discontinuation.reason },
    ...(discontinuation.note.trim() ? [{ url: "discontinuationNote", valueString: discontinuation.note.trim() }] : []),
    { url: "discontinuedOn", valueDate: today() },
  ]);
}

/** レジメンの完了。予定どおり終えたときに医師が押す(自動では完了にしない。§7.6 C-1)。 */
export function completeRegimenEntry(header: fhir4.ServiceRequest): fhir4.BundleEntry {
  return regimenStatusEntry(header, "completed", [{ url: "completedOn", valueDate: today() }]);
}

/** 休止(on-hold)と再開(active)。登録済みの日オーダーは触らない(可逆な操作にする)。 */
export function holdRegimenEntry(header: fhir4.ServiceRequest, hold: boolean): fhir4.BundleEntry {
  return regimenStatusEntry(header, hold ? "on-hold" : "active", []);
}

/** クール 1 つの進み具合(レジメン詳細のクール一覧・治療歴で使う)。 */
export interface CycleProgress {
  cycle: number;
  /** 日オーダーの数と、実施済・中止の数。 */
  total: number;
  completed: number;
  cancelled: number;
  /** 全部が実施済か中止で、少なくとも 1 件は実施済(= 投与したクール)。 */
  done: boolean;
  /** 全部が中止(投与しなかったクール)。 */
  skipped: boolean;
}

export function cycleProgressOf(orders: RegimenDayOrder[]): Map<number, CycleProgress> {
  const result = new Map<number, CycleProgress>();
  for (const order of orders) {
    const p = result.get(order.ref.cycle) ?? {
      cycle: order.ref.cycle,
      total: 0,
      completed: 0,
      cancelled: 0,
      done: false,
      skipped: false,
    };
    p.total += 1;
    if (order.status === "completed") p.completed += 1;
    if (order.status === "cancelled") p.cancelled += 1;
    result.set(order.ref.cycle, p);
  }
  for (const p of result.values()) {
    p.skipped = p.total > 0 && p.cancelled === p.total;
    p.done = p.total > 0 && p.completed > 0 && p.completed + p.cancelled === p.total;
  }
  return result;
}

/** 最後の投与日(中止したオーダーは数えない)。無ければ空。 */
export function lastAdministrationDate(orders: RegimenDayOrder[]): string {
  return orders
    .filter((o) => o.status !== "cancelled")
    .reduce((max, o) => (o.date > max ? o.date : max), "");
}

/** 日オーダーを中止した理由(Task.statusReason)。無ければ空。 */
export function dayOrderCancelReason(order: RegimenDayOrder): string {
  return order.status === "cancelled" ? (order.task?.statusReason?.text ?? "") : "";
}

/** 日オーダーの種別(注射か処方か)。レジメンの日オーダーはこの 2 つしか無い。 */
export function regimenDayOrderKind(sr: fhir4.ServiceRequest): "injection" | "prescription" {
  return isInjectionServiceRequest(sr) ? "injection" : "prescription";
}

/** 進捗の表示(注射・処方で同じ語)。 */
export function regimenDayStatusLabel(status: InjectionTaskStatus | RxTaskStatus): string {
  switch (status) {
    case "requested":
      return "依頼済";
    case "accepted":
      return "受付済";
    case "in-progress":
      return "払出済";
    case "completed":
      return "実施済";
    case "cancelled":
      return "中止";
    default:
      return status;
  }
}
