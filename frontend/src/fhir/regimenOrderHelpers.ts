import type { Medicine, MedicineUsage, RegimenDetail, RegimenDrug, RegimenStep } from "../api/masterClient";
import { addDays, diffDays } from "../lib/dates";
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
/** ヘッダの instantiatesUri。マスタは backend にあるので FHIR 上は URI で指すだけ。 */
export const REGIMEN_URI_PREFIX = "http://fhir-client.local/regimen/";

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
  // 製剤単位が基準の薬剤(補液)は、製剤数と名前(「大塚糖液５％ ２５０ｍＬ」)で足りる。
  if (plan.drug.dose_basis === "unit") return "";
  if (plan.amount.trim() !== "") return `${plan.amount} ${plan.unit}`;
  // 力価を出せないもの(AUC)は基準をそのまま残す。
  return plan.basis;
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
  body: { bsa: number | null; weight: number | null },
  factors: DoseFactorMap,
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

  // AUC は Calvert 式に GFR が要るので自動では出さない。力価(mg)を手で入れてもらい、
  // 製剤数はそこから出す。
  if (drug.dose_basis === "auc") {
    return {
      ...base,
      input: factor ? "amount" : "pack",
      factor,
      basis: `AUC ${value}`,
      manualReason: factor ? "AUC は Calvert 式で計算して入力してください" : noConversion,
    };
  }

  let amount: number;
  let basis: string;
  switch (drug.dose_basis) {
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
  comment: string;
  steps: RegimenStepPlan[];
}

/** 入力値から体表面積。 */
export function bsaOf(values: Pick<RegimenApplyValues, "height" | "weight">): number | null {
  return bodySurfaceArea(Number(values.height) || null, Number(values.weight) || null);
}

/** ステップの薬剤をすべて体格から算出し直す。 */
export function planSteps(
  regimen: RegimenDetail,
  body: { bsa: number | null; weight: number | null },
  factors: DoseFactorMap,
): RegimenStepPlan[] {
  return regimen.steps.map((step) => ({
    step,
    drugs: step.drugs.map((drug) => planDrugDose(drug, body, factors)),
  }));
}

export function regimenHasInjection(regimen: RegimenDetail): boolean {
  return regimen.steps.some((s) => s.usage_type !== "oral");
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

function medicineOf(drug: RegimenDrug): Medicine {
  return {
    id: 0,
    medicine_code: drug.medicine_code,
    name: drug.resolved_name ?? drug.medicine_code,
    name_kana: null,
    unit_code: null,
    unit_name: drug.resolved_unit_name,
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
    medicine: medicineOf(d.drug),
    // 保存は製剤数(注射・処方の既存フォームと同じ単位)。力価は計算根拠としてコメントに残す。
    dose: planPacks(d),
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
    ],
  };
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
  const injectionByDay = new Map<number, InjectionRpValues[]>();
  const oralByDay = new Map<number, RpValues[]>();
  for (const plan of values.steps) {
    for (const day of plan.step.days) {
      if (plan.step.usage_type === "oral") {
        oralByDay.set(day, [...(oralByDay.get(day) ?? []), oralRpOf(plan)]);
      } else {
        injectionByDay.set(day, [...(injectionByDay.get(day) ?? []), injectionRpOf(plan)]);
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
  });
  const entries: fhir4.BundleEntry[] = [];
  const days = Array.from(new Set([...injectionByDay.keys(), ...oralByDay.keys()])).sort((a, b) => a - b);
  for (const day of days) {
    const date = addDays(day1, day - 1);
    const rps = injectionByDay.get(day);
    if (rps) {
      const injection: InjectionFormValues = {
        setting: values.setting,
        category: values.injectionCategory,
        startDate: date,
        endDate: date,
        schedule: DAILY_SCHEDULE,
        comment: values.comment,
        problem: values.problem,
        rps,
        series: null,
      };
      entries.push(
        ...stampRegimenOrder(buildInjectionSingleDayEntries(injection, patientId, requester, authoredOn), ref(day)),
      );
    }
    const oral = oralByDay.get(day);
    if (oral) {
      const prescription: PrescriptionFormValues = {
        setting: values.setting,
        category: values.prescriptionCategory,
        startDate: date,
        comment: values.comment,
        problem: values.problem,
        rps: oral,
      };
      entries.push(
        ...stampRegimenOrder(buildPrescriptionBundle(prescription, patientId, requester).entry ?? [], ref(day)),
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
      return stampRegimenOrder(bundle.entry ?? [], ref);
    }
    const values = parsePrescriptionForm(sr, order.medicationRequests);
    const bundle = buildPrescriptionUpdateBundle({ ...values, startDate: newDate }, patientId, sr, mrIds, requester);
    return stampRegimenOrder(bundle.entry ?? [], ref);
  });
  return { resourceType: "Bundle", type: "transaction", entry: entries };
}

/** ヘッダを中止(revoked)にする entry。 */
export function revokeRegimenEntry(header: fhir4.ServiceRequest): fhir4.BundleEntry {
  const resource: fhir4.ServiceRequest = { ...header, status: "revoked" };
  return { resource, request: { method: "PUT", url: `ServiceRequest/${header.id}` } };
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
