import { today } from "../lib/dates";
import type { Medicine, MedicineUsage } from "../api/masterClient";
import type { LineDose } from "./drugCheckHelpers";
import type { InsulinScaleValues } from "./insulinScaleHelpers";
import { orderProblem, type ProblemRef } from "./conditionHelpers";
import { isAsNeededUsage, timesPerDay } from "./medicationScheduleHelpers";
import {
  supplementInstructions,
  supplementLabel,
  supplementOf,
  unevenDosesOf,
  unevenInstructions,
  unevenLabel,
  usageCommentOf,
  type SupplementaryUsage,
} from "./supplementaryUsage";
import {
  categoryCoding,
  codingBySystem,
  findSettingDisplay,
  orderComment,
  orderDay,
  registrationAuthoredOn,
  SETTING_OPTIONS,
  withVersionLock,
} from "./shared";
import { applyOrderContext, isRegimenDayOrder, ORDER_TYPE_SYSTEM, type OrderAttribution } from "./orderHeader";
import type { OrderContext } from "../orderContext";

export { codingBySystem, SETTING_OPTIONS };

// ローカル拡張・コードシステム。JP Core / FHIR 標準に存在しない項目を表現するための、
// この処方オーダー機能専用の URI。
// 入外区分。注射オーダーでも同じ区分(入院/外来)を使うので injectionHelpers.ts と共用する
// (URI の "prescription-" は登録済みデータと揃えるためそのまま)。

/**
 * 処方のオーダー種別。ヘッダ ServiceRequest の category の先頭に持たせるほか、内服の与薬の
 * 実施記録(Procedure / MedicationAdministration)を注射・処置の記録と振り分けるのにも使う。
 */
export const PRESCRIPTION_ORDER_TYPE = { code: "prescription", display: "処方" };

export const SETTING_SYSTEM = "http://fhir-client.local/CodeSystem/prescription-setting";
// 処方区分。
export const PRESCRIPTION_CATEGORY_SYSTEM =
  "http://fhir-client.local/CodeSystem/prescription-category";
const ORDER_DETAIL_MR_EXT_URL =
  "http://fhir-client.local/StructureDefinition/prescription-medication-request"; // orderDetail→MedicationRequest 参照
// レセプト電算コード（6始まり9桁）。JP Core の MedicationCode ValueSet には
// レセ電コードに対応する正式な CodeSystem が定義されていないため、ローカル URI を使用。
// (注射オーダー injectionHelpers.ts とも共用する)
export const MEDICINE_CODE_SYSTEM = "http://fhir-client.local/CodeSystem/medicine-code";
// 個別医薬品コード（YJコード）。JP Core（CAPS）で定義された正式な CodeSystem URL。
export const YJ_CODE_SYSTEM = "http://capstandard.jp/iyaku.info/CodeSystem/YJ-code";
// 医薬品一般名処方コード(厚労省保険局の一般名処方マスタ)。JP Core の MedicationCode
// ValueSet に含まれる正式な CodeSystem で、一般名処方はこのコードだけを載せる
// (特定の銘柄を指さないので、レセ電コード・YJコードは付けない)。
export const GENERAL_ORDER_CODE_SYSTEM =
  "http://jpfhir.jp/fhir/core/mhlw/CodeSystem/MedicationGeneralOrderCode";
export const USAGE_CODE_SYSTEM = "http://fhir-client.local/CodeSystem/medicine-usage";
export const USAGE_CATEGORY_SYSTEM = "http://fhir-client.local/CodeSystem/medicine-usage-basic-category";

// JP Core: MedicationRequest.identifier の必須スライス。値を入れないと警告になる。
export const RP_NUMBER_SYSTEM = "http://jpfhir.jp/fhir/core/mhlw/IdSystem/Medication-RPGroupNumber";
export const ORDER_IN_RP_SYSTEM =
  "http://jpfhir.jp/fhir/core/mhlw/IdSystem/MedicationAdministrationIndex";

export const UNITS_OF_MEASURE_SYSTEM = "http://unitsofmeasure.org";

// JP Core の力価区分(Dosage.doseAndRate.type)。力価で指示した量にだけ「原薬量」を付け、
// 印の無い量は製剤量(薬価算定単位)として読む。
export const DOSE_STRENGTH_TYPE_SYSTEM =
  "http://jpfhir.jp/fhir/core/CodeSystem/JP_MedicationIngredientStrengthStrengthType_CS";
export const POTENCY_DOSE_TYPE: fhir4.CodeableConcept = {
  coding: [{ system: DOSE_STRENGTH_TYPE_SYSTEM, code: "2", display: "原薬量" }],
};

/** 量が力価(原薬量)で指示されているか。 */
export function isPotencyDose(doseAndRate: fhir4.DosageDoseAndRate | undefined): boolean {
  return codingBySystem(doseAndRate?.type?.coding, DOSE_STRENGTH_TYPE_SYSTEM)?.code === "2";
}

const BASIC_USAGE_CATEGORY_ORAL = "内服";

/**
 * 用量の入力区分(処方全体で 1 つ)。日数を持つ内服の明細は、どちらで入力しても 1 回量を `doseQuantity`、
 * 1 日量を `doseAndRate.rateRatio`(JP Core の JP_MedicationRatio_DosePerDay)に持つ。区分はヘッダの拡張に
 * 残し、編集・DO で同じ区分で開くのに使う。
 */
export type DoseBasis = "single" | "daily";

export const DOSE_BASIS_EXT_URL = "http://fhir-client.local/StructureDefinition/prescription-dose-basis";

export const DOSE_BASIS_OPTIONS: { code: DoseBasis; display: string }[] = [
  { code: "single", display: "1回量" },
  { code: "daily", display: "1日量" },
];

/** 処方の用量の入力区分。拡張が無い処方は 1 日量で入力したもの。 */
export function doseBasisOf(sr: fhir4.ServiceRequest | undefined): DoseBasis {
  return sr?.extension?.find((e) => e.url === DOSE_BASIS_EXT_URL)?.valueCode === "single" ? "single" : "daily";
}

/** 1 回量・1 日量の換算の丸め(小数第 3 位)。0.1 × 3 の浮動小数の端数もここで落とす。 */
export function roundDose(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * 明細の用量欄が表す量。頓用は 1 回量、日数を持たないもの(外用など)は全量。日数を持つ内服は
 * 入力区分に従うが、不均等(各回は別に入れ、用量欄は合計)と回数の分からない用法は 1 日量。
 */
export type DoseFieldKind = DoseBasis | "amount";

export function doseFieldKind(
  rp: Pick<RpValues, "usage">,
  line: Pick<MedicineLineValues, "unevenDoses">,
  basis: DoseBasis | undefined,
): DoseFieldKind {
  const usageCode = rp.usage?.usage_code;
  if (isAsNeededUsage(usageCode)) return "single";
  if (!hasDoseDays(usageCode, rp.usage?.basic_usage_category)) return "amount";
  if (line.unevenDoses || timesPerDay(usageCode) === null) return "daily";
  return basis ?? "daily";
}

/**
 * RP の用量欄の見出し。行ごとに意味が違う(不均等の行だけ 1 日量など)ときは「用量」。
 * 用法を選ぶ前は、入れている量の意味が分かるよう入力区分で出す。
 */
export function rpDoseFieldLabel(rp: Pick<RpValues, "usage" | "medicines">, basis: DoseBasis | undefined): string {
  if (!rp.usage) return (basis ?? "daily") === "single" ? "1回量" : "1日量";
  const kinds = new Set(rp.medicines.map((med) => doseFieldKind(rp, med, basis)));
  const [kind] = kinds;
  if (kinds.size !== 1) return "用量";
  return kind === "single" ? "1回量" : kind === "daily" ? "1日量" : "用量";
}

/** 1 回量と 1 日量(分からない方は undefined)。日数を持たないもの(外用など)の量は `amount`。 */
export interface DoseAmounts {
  single?: number;
  daily?: number;
  amount?: number;
}

function amountsFromField(
  kind: DoseFieldKind,
  dose: number,
  usageCode: string | undefined,
  uneven: boolean,
): DoseAmounts {
  if (kind === "amount") return { amount: dose };
  const times = isAsNeededUsage(usageCode) ? null : timesPerDay(usageCode);
  if (kind === "single") return { single: dose, ...(times ? { daily: roundDose(dose * times) } : {}) };
  return { daily: dose, ...(times && !uneven ? { single: roundDose(dose / times) } : {}) };
}

/** フォームの明細の 1 回量・1 日量。用量が未入力なら null。 */
export function lineDoseAmounts(
  rp: Pick<RpValues, "usage">,
  line: Pick<MedicineLineValues, "dose" | "unevenDoses">,
  basis: DoseBasis | undefined,
): DoseAmounts | null {
  const dose = Number(line.dose);
  if (!(dose > 0)) return null;
  return amountsFromField(doseFieldKind(rp, line, basis), dose, rp.usage?.usage_code, Boolean(line.unevenDoses));
}

/** 用量欄の量の意味を決めるもの(RP の用法・行の不均等・入力区分)。 */
export interface DoseFieldContext {
  rp: Pick<RpValues, "usage">;
  line: Pick<MedicineLineValues, "dose" | "unevenDoses">;
  basis: DoseBasis | undefined;
}

/**
 * 用量欄の意味が変わるとき(入力区分の切り替え・用法の変更・不均等の付け外し)に、量を新しい意味へ換算する。
 * 1 回量 ↔ 1 日量の間だけを回数で換算し、頓用・外用が絡むときと回数が分からないときはそのまま残す。
 */
export function convertDoseField(from: DoseFieldContext, to: DoseFieldContext): string {
  const dose = Number(from.line.dose);
  const fromKind = doseFieldKind(from.rp, from.line, from.basis);
  const toKind = doseFieldKind(to.rp, to.line, to.basis);
  if (!(dose > 0) || fromKind === toKind || fromKind === "amount" || toKind === "amount") return from.line.dose;
  if (isAsNeededUsage(from.rp.usage?.usage_code) || isAsNeededUsage(to.rp.usage?.usage_code)) return from.line.dose;
  // 1 日量 → 1 回量は新しい用法の回数で割り、1 回量 → 1 日量は元の用法の回数を掛ける。
  const times = timesPerDay((toKind === "single" ? to : from).rp.usage?.usage_code);
  if (!times) return from.line.dose;
  return String(roundDose(toKind === "single" ? dose / times : dose * times));
}

const DOSE_PER_DAY_DENOMINATOR: fhir4.Quantity = {
  value: 1,
  unit: "日",
  system: "http://unitsofmeasure.org",
  code: "d",
};

/**
 * 保存済みの明細(Dosage)の 1 回量・1 日量。日数を持つ内服は `rateRatio` が 1 日量で `doseQuantity` が 1 回量。
 * `rateRatio` を持たない日数を持つ内服は、1 日量を `doseQuantity` に入れていた形として読む(1 回量は回数で割る)。
 */
export function prescriptionDoseOf(dosage: fhir4.Dosage | undefined): DoseAmounts {
  const doseAndRate = dosage?.doseAndRate?.[0];
  const quantity = doseAndRate?.doseQuantity?.value;
  const perDay = doseAndRate?.rateRatio?.numerator?.value;
  if (perDay !== undefined) return { daily: perDay, ...(quantity !== undefined ? { single: quantity } : {}) };
  if (quantity === undefined) return {};
  const usageCode = codingBySystem(dosage?.timing?.code?.coding, USAGE_CODE_SYSTEM)?.code;
  const category = codingBySystem(dosage?.timing?.code?.coding, USAGE_CATEGORY_SYSTEM)?.display;
  if (isAsNeededUsage(usageCode)) return { single: quantity };
  if (!hasDoseDays(usageCode, category)) return { amount: quantity };
  return amountsFromField("daily", quantity, usageCode, Boolean(unevenDosesOf(dosage)));
}

/** 明細の量の単位。 */
export function prescriptionDoseUnitOf(dosage: fhir4.Dosage | undefined): string | undefined {
  const doseAndRate = dosage?.doseAndRate?.[0];
  return doseAndRate?.doseQuantity?.unit ?? doseAndRate?.rateRatio?.numerator?.unit;
}

/** 量 1 つで扱うときの量。日数を持つ内服は 1 日量、頓用は 1 回量、外用などは全量(調剤数量・請求・抽出の量)。 */
export function orderedDose(amounts: DoseAmounts): number | undefined {
  return amounts.daily ?? amounts.single ?? amounts.amount;
}

/** 1 回量と 1 日量の併記(「1回1錠（1日3錠）」)。力価の印は呼ぶ側で付ける。 */
export function doseText(amounts: DoseAmounts, unit: string | undefined): string {
  const u = unit ?? "";
  if (amounts.single !== undefined && amounts.daily !== undefined) {
    return `1回${amounts.single}${u}（1日${amounts.daily}${u}）`;
  }
  if (amounts.daily !== undefined) return `1日${amounts.daily}${u}`;
  if (amounts.single !== undefined) return `1回${amounts.single}${u}`;
  return amounts.amount !== undefined ? `${amounts.amount}${u}` : "";
}

/**
 * 投与日数で処方する用法か。頓用でない内服だけが日数を持つ。
 *
 * 頓用かどうかは用法コードの 3 桁目で判定する(`isAsNeededUsage`)。用法マスタの基本区分は
 * 内服 / 外用 / 注射 / 注入 の 4 種で「頓服」が無いため、区分では頓用を見分けられない。
 */
export function hasDoseDays(
  usageCode: string | null | undefined,
  basicCategory: string | null | undefined,
): boolean {
  return basicCategory === BASIC_USAGE_CATEGORY_ORAL && !isAsNeededUsage(usageCode ?? undefined);
}

/**
 * 薬剤チェックの用量上限と比べる量(`drugCheckHelpers.LineDose`)。
 * - 日数を持つ内服: 入力区分で 1 回量か 1 日量を入れ、もう一方を回数(用法コード 4 桁目)で出す。
 *   不均等なら 1 回量は最大の回。`Z` などで回数が分からなければ 1 回量は出さない
 * - 頓用: 用量が 1 回量。1 日量は出さない
 * - 外用など: 用量の意味が決まっていないので比べない
 */
export function prescriptionLineDose(
  rp: Pick<RpValues, "usage">,
  line: Pick<MedicineLineValues, "medicine" | "dose" | "unevenDoses">,
  basis: DoseBasis | undefined,
): LineDose | null {
  const amounts = lineDoseAmounts(rp, line, basis);
  if (!line.medicine || !amounts || amounts.amount !== undefined) return null;
  const unit = line.medicine.unit_name ?? "";
  if (isAsNeededUsage(rp.usage?.usage_code)) return { daily: null, single: amounts.single ?? null, unit };

  const uneven = (line.unevenDoses ?? []).map(Number).filter((d) => d > 0);
  const single = uneven.length > 0 ? Math.max(...uneven) : (amounts.single ?? null);
  return { daily: amounts.daily ?? null, single, unit };
}

export type PrescriptionSetting = "inpatient" | "outpatient" | "";

export const CATEGORY_OPTIONS: Record<
  Exclude<PrescriptionSetting, "">,
  { code: string; display: string }[]
> = {
  inpatient: [
    { code: "regular", display: "定期" },
    { code: "continuous", display: "継続" },
    { code: "temporary", display: "臨時" },
    { code: "discharge", display: "退院" },
    { code: "emergency", display: "緊急" },
  ],
  outpatient: [
    { code: "external", display: "院外" },
    { code: "internal", display: "院内" },
  ],
};

/**
 * 処方区分「持参」。継続した持参薬を院内処方に起こしたもので、薬剤部は調剤せず、請求にも
 * 載せない(docs/brought-medication-design.md)。持参薬タブの「継続」からだけ作るので、
 * 医師が選ぶ選択肢(CATEGORY_OPTIONS)・施設設定の初期値には入れない。
 */
export const BROUGHT_CATEGORY = { code: "brought", display: "持参" };

/** 処方区分が「持参」の処方か。 */
export function isBroughtPrescription(sr: fhir4.ServiceRequest): boolean {
  return categoryCoding(sr, PRESCRIPTION_CATEGORY_SYSTEM)?.code === BROUGHT_CATEGORY.code;
}

/**
 * 施設設定「処方区分の初期値」。入外区分ごとに、処方フォームを開いたときの処方区分を
 * 決める(空なら「選択してください」のまま開く)。入外区分を選び直したときも、その区分の
 * 初期値に入れ替える。登録済みの処方には区分が焼き付いているので、設定を変えても動かない。
 */
export type PrescriptionCategoryDefaults = Record<Exclude<PrescriptionSetting, "">, string>;

/** 施設設定「処方の用量の入力」。新規の処方フォームが開く入力区分。 */
export interface PrescriptionDoseSettings {
  basis: DoseBasis;
}

export const DEFAULT_PRESCRIPTION_DOSE: PrescriptionDoseSettings = { basis: "daily" };

/**
 * 施設設定「処方のチェック」。days_limits は処方区分ごとの投与日数の上限(0 は上限なし)。
 * unset_adoption_as_not_adopted は採用区分を決めていない薬を採用外として扱うか。
 */
export interface PrescriptionCheckSettings {
  days_limits: Record<string, number>;
  unset_adoption_as_not_adopted: boolean;
}

export const DEFAULT_PRESCRIPTION_CHECK: PrescriptionCheckSettings = {
  days_limits: Object.fromEntries(
    [...CATEGORY_OPTIONS.inpatient, ...CATEGORY_OPTIONS.outpatient].map((o) => [o.code, 0]),
  ),
  unset_adoption_as_not_adopted: false,
};

export const DEFAULT_PRESCRIPTION_CATEGORY: PrescriptionCategoryDefaults = {
  inpatient: "",
  outpatient: "",
};

/** その入外区分の処方区分の初期値。設定が無い・選択肢に無いコードなら空(未選択)。 */
export function defaultPrescriptionCategory(
  defaults: PrescriptionCategoryDefaults | undefined,
  setting: PrescriptionSetting,
): string {
  if (!setting) return "";
  const code = defaults?.[setting] ?? "";
  return CATEGORY_OPTIONS[setting].some((o) => o.code === code) ? code : "";
}

/**
 * 後発品への変更不可(処方箋 様式第2号の「変更不可(医療上必要)」「患者希望」の列)。
 * JP Core の変更可否コードは「1 後発品変更不可」で、どちらの理由かは substitution.reason で区別する。
 */
export type SubstitutionBlock = "medical-necessity" | "patient-request";

export const SUBSTITUTION_PROHIBITED_SYSTEM =
  "http://jpfhir.jp/fhir/core/mhlw/CodeSystem/MedicationSubstitutionProhibittedCategory";
export const SUBSTITUTION_BLOCK_REASON_SYSTEM =
  "http://fhir-client.local/CodeSystem/substitution-not-allowed-reason";

export const SUBSTITUTION_BLOCK_OPTIONS: { code: SubstitutionBlock; display: string; mark: string }[] = [
  { code: "medical-necessity", display: "医療上必要", mark: "変更不可" },
  { code: "patient-request", display: "患者希望", mark: "患者希望" },
];

/**
 * 後発品変更不可を付けられる行か。銘柄を指定した外来処方だけ(一般名処方は銘柄を指定しないので
 * 付ける意味が無く、入院は院内の採用薬で調剤するので処方箋の欄が無い)。
 */
export function canBlockSubstitution(
  setting: PrescriptionSetting | string,
  medicine: Medicine | null | undefined,
): boolean {
  return setting === "outpatient" && Boolean(medicine) && !medicine?.generic;
}

export function substitutionBlockMark(block: SubstitutionBlock): string {
  return SUBSTITUTION_BLOCK_OPTIONS.find((o) => o.code === block)?.mark ?? "";
}

function buildSubstitution(block: SubstitutionBlock): fhir4.MedicationRequest["substitution"] {
  const reason = SUBSTITUTION_BLOCK_OPTIONS.find((o) => o.code === block);
  return {
    allowedCodeableConcept: {
      coding: [{ system: SUBSTITUTION_PROHIBITED_SYSTEM, code: "1", display: "後発品変更不可" }],
    },
    reason: { coding: [{ system: SUBSTITUTION_BLOCK_REASON_SYSTEM, code: block, display: reason?.display }] },
  };
}

/** 明細の後発品変更不可。変更可(substitution 無し・コード 0)なら null。 */
export function substitutionBlockOf(mr: fhir4.MedicationRequest): SubstitutionBlock | null {
  const allowed = codingBySystem(
    mr.substitution?.allowedCodeableConcept?.coding,
    SUBSTITUTION_PROHIBITED_SYSTEM,
  )?.code;
  if (!allowed || allowed === "0") return null;
  const reason = codingBySystem(mr.substitution?.reason?.coding, SUBSTITUTION_BLOCK_REASON_SYSTEM)?.code;
  return reason === "patient-request" ? "patient-request" : "medical-necessity";
}

export interface MedicineLineValues {
  id?: string;
  medicine: Medicine | null;
  dose: string;
  comment: string;
  /** 薬剤コメントの入力欄を出しているか(フォーム内だけの値)。 */
  showComment?: boolean;
  /** 後発品変更不可。null・未設定なら変更可。 */
  substitutionBlock?: SubstitutionBlock | null;
  /** 不均等投与の量(服用タイミング順)。null・未設定なら不均等でない。 */
  unevenDoses?: string[] | null;
  /** 持参薬から起こした行の元の持参薬(MedicationStatement.id)。 */
  broughtMedicationId?: string;
  /** インスリンのスケール(注射のみ)。null・未設定ならスケールを持たない。 */
  insulinScale?: InsulinScaleValues | null;
  /** 用量を力価で入れた行。単位は `medicine.unit_name` に力価の単位(mg など)が入る。 */
  potency?: boolean;
  /**
   * 入力区分を切り替えたときの換算前の値(フォーム内だけの値)。切り替えて戻したときに丸めの誤差
   * (1 → 0.333 → 0.999)を出さず、換算後の値のままなら元の値に戻すのに使う。
   */
  doseBeforeSwitch?: { dose: string; converted: string };
}

/**
 * 調剤指示(一包化・粉砕など)。RP 単位で選び、RP 内の明細すべての dispenseRequest に JP Core の
 * instructionForDispense 拡張(薬剤単位の定義なので、RP の全明細に同じ値を書く)で持つ。
 * コードは JAMI の調剤方法コード(電子処方箋と同じ)。
 */
export type DispenseInstruction = "OP" | "C" | "SP" | "MX";

export const DISPENSE_INSTRUCTION_EXT_URL =
  "http://jpfhir.jp/fhir/core/Extension/StructureDefinition/JP_MedicationRequest_DispenseRequest_InstructionForDispense";
export const DISPENSE_INSTRUCTION_SYSTEM = "http://jami.jp/CodeSystem/DrugDispensePreparationMethod";

export const DISPENSE_INSTRUCTION_OPTIONS: { code: DispenseInstruction; display: string }[] = [
  { code: "OP", display: "一包化" },
  { code: "C", display: "粉砕" },
  { code: "SP", display: "別包化" },
  { code: "MX", display: "混合" },
];

/** 明細の調剤指示(選択肢の並び順)。無ければ空。 */
export function dispenseInstructionsOf(mr: fhir4.MedicationRequest): DispenseInstruction[] {
  const codes = new Set(
    (mr.dispenseRequest?.extension ?? [])
      .filter((ext) => ext.url === DISPENSE_INSTRUCTION_EXT_URL)
      .map((ext) => codingBySystem(ext.valueCodeableConcept?.coding, DISPENSE_INSTRUCTION_SYSTEM)?.code),
  );
  return DISPENSE_INSTRUCTION_OPTIONS.filter((o) => codes.has(o.code)).map((o) => o.code);
}

/** 調剤指示の表示(「一包化・粉砕」)。 */
export function dispenseInstructionLabel(codes: DispenseInstruction[] | null | undefined): string {
  return DISPENSE_INSTRUCTION_OPTIONS.filter((o) => codes?.includes(o.code))
    .map((o) => o.display)
    .join("・");
}

function dispenseInstructionExtensions(codes: DispenseInstruction[]): fhir4.Extension[] {
  return DISPENSE_INSTRUCTION_OPTIONS.filter((o) => codes.includes(o.code)).map((o) => ({
    url: DISPENSE_INSTRUCTION_EXT_URL,
    valueCodeableConcept: { coding: [{ system: DISPENSE_INSTRUCTION_SYSTEM, code: o.code, display: o.display }] },
  }));
}

export interface RpValues {
  usage: MedicineUsage | null;
  doseDays: string;
  doseCount: string;
  usageComment: string;
  /** 用法コメントの入力欄を出しているか(フォーム内だけの値)。 */
  showUsageComment?: boolean;
  /** 補足用法(日数間隔・曜日・日付・期間内回数)。 */
  supplement?: SupplementaryUsage | null;
  /** 調剤指示。null・未設定なら入力欄を出していない(空配列は欄だけ出ている)。 */
  dispenseInstructions?: DispenseInstruction[] | null;
  medicines: MedicineLineValues[];
}

export interface PrescriptionFormValues {
  setting: PrescriptionSetting;
  category: string;
  /**
   * 投与開始日(occurrenceDateTime)。外来は処方日と同じ日でよいが、入院の定期・継続・退院処方は
   * 先の日付になる。処方日(交付日)は登録日時(authoredOn)の日付で、フォームでは入力しない。
   */
  startDate: string;
  comment: string;
  // 対象プロブレム(POMR)。null なら特定の問題に紐付かない処方。
  problem: ProblemRef | null;
  /**
   * 用量の入力区分。新規の空のフォームだけが未設定で、フォームが施設設定の初期値を入れる。
   * 組み立て(`buildPrescriptionBundle`)では未設定を 1 日量として扱う。
   */
  doseBasis?: DoseBasis;
  rps: RpValues[];
}

export const emptyMedicineLine: MedicineLineValues = { medicine: null, dose: "", comment: "" };

export const emptyRp: RpValues = {
  usage: null,
  doseDays: "",
  doseCount: "",
  usageComment: "",
  medicines: [{ ...emptyMedicineLine }],
};

// problem を渡すと対象プロブレムを選択済みで開く(プロブレムリストで選んでいる
// プロブレムをそのまま新規処方の対象にするため)。処方区分は空で、施設設定の初期値は
// フォーム(PrescriptionForm)が入れる。
export function emptyPrescriptionForm(
  problem: ProblemRef | null = null,
  setting: PrescriptionSetting = "outpatient",
): PrescriptionFormValues {
  return {
    setting,
    category: "",
    startDate: today(),
    comment: "",
    problem,
    rps: [{ ...emptyRp, medicines: [{ ...emptyMedicineLine }] }],
  };
}

function findCategoryDisplay(setting: PrescriptionSetting, code: string): string {
  if (code === BROUGHT_CATEGORY.code) return BROUGHT_CATEGORY.display;
  if (!setting) return code;
  return CATEGORY_OPTIONS[setting].find((c) => c.code === code)?.display ?? code;
}

/**
 * 医薬品の CodeableConcept。銘柄はレセプト電算コード(+ あれば YJ コード)、
 * 一般名処方は一般名処方コードだけを載せる。
 */
export function medicationCodeableConcept(medicine: Medicine): fhir4.CodeableConcept {
  if (medicine.generic) {
    return {
      coding: [
        {
          system: GENERAL_ORDER_CODE_SYSTEM,
          code: medicine.medicine_code,
          display: medicine.name,
        },
      ],
      text: medicine.name,
    };
  }

  return {
    coding: [
      { system: MEDICINE_CODE_SYSTEM, code: medicine.medicine_code, display: medicine.name },
      ...(medicine.yj_code
        ? [{ system: YJ_CODE_SYSTEM, code: medicine.yj_code, display: medicine.name }]
        : []),
    ],
    text: medicine.name,
  };
}

/**
 * RP の用法と薬剤 1 行から Dosage を組み立てる。処方の MedicationRequest.dosageInstruction と
 * 持参薬の MedicationStatement.dosage が同じ形(JP_MedicationDosage)を使う。
 * 投与日数は Dosage ではなく MedicationRequest.dispenseRequest に置く。
 *
 * `basis` は `medLine.dose` が 1 回量か 1 日量か(日数を持つ内服だけが見る)。日数を持つ内服は
 * 1 回量を `doseQuantity`(不均等・回数不明では持たない)、1 日量を `rateRatio` に入れる。
 */
export function buildDosage(
  rp: Pick<RpValues, "usage" | "doseCount" | "usageComment" | "supplement">,
  medLine: Pick<MedicineLineValues, "medicine" | "dose" | "unevenDoses" | "potency">,
  startDate: string,
  basis: DoseBasis = "daily",
): fhir4.Dosage {
  const timingCoding: fhir4.Coding[] = [];
  if (rp.usage) {
    timingCoding.push({
      system: USAGE_CODE_SYSTEM,
      code: rp.usage.usage_code,
      display: rp.usage.usage_name,
    });
    timingCoding.push({
      system: USAGE_CATEGORY_SYSTEM,
      code: rp.usage.basic_usage_category_code ?? undefined,
      display: rp.usage.basic_usage_category ?? undefined,
    });
  }

  const dosage: fhir4.Dosage = {
    // 用法が無いときは timing ごと持たない(空の timing.code は FHIR として不正)。
    timing: rp.usage
      ? { code: { coding: timingCoding, text: rp.usage.usage_name } }
      : undefined,
    doseAndRate: medLine.dose ? [buildDoseAndRate(rp, medLine, basis)] : undefined,
  };

  const additionalInstruction: fhir4.CodeableConcept[] = [
    ...supplementInstructions(rp.supplement, Number(startDate.slice(5, 7)) || 1),
    ...unevenInstructions(
      medLine.unevenDoses,
      rp.usage?.usage_code,
      medLine.medicine?.unit_name,
    ),
    ...(rp.usageComment ? [{ text: rp.usageComment }] : []),
  ];
  if (additionalInstruction.length) dosage.additionalInstruction = additionalInstruction;

  if (isAsNeededUsage(rp.usage?.usage_code)) {
    dosage.asNeededBoolean = true;
    if (rp.doseCount) {
      dosage.timing = {
        ...dosage.timing,
        repeat: { count: Number(rp.doseCount) },
      };
    }
  }

  return dosage;
}

function buildDoseAndRate(
  rp: Pick<RpValues, "usage">,
  medLine: Pick<MedicineLineValues, "medicine" | "dose" | "unevenDoses" | "potency">,
  basis: DoseBasis,
): fhir4.DosageDoseAndRate {
  const unit = medLine.medicine?.unit_name ?? undefined;
  const type = medLine.potency ? { type: POTENCY_DOSE_TYPE } : {};
  if (!hasDoseDays(rp.usage?.usage_code, rp.usage?.basic_usage_category)) {
    return { ...type, doseQuantity: { value: Number(medLine.dose), unit } };
  }
  const uneven = Boolean(medLine.unevenDoses);
  const amounts = amountsFromField(uneven ? "daily" : basis, Number(medLine.dose), rp.usage?.usage_code, uneven);
  return {
    ...type,
    ...(amounts.single !== undefined && !uneven ? { doseQuantity: { value: amounts.single, unit } } : {}),
    ...(amounts.daily !== undefined
      ? { rateRatio: { numerator: { value: amounts.daily, unit }, denominator: DOSE_PER_DAY_DENOMINATOR } }
      : {}),
  };
}

function buildMedicationRequest(
  rp: RpValues,
  medLine: MedicineLineValues,
  setting: PrescriptionSetting,
  startDate: string,
  rpNumber: number,
  orderInRp: number,
  patientId: string,
  authoredOn: string,
  serviceRequestReference: string,
  requester: OrderContext,
  doseBasis: DoseBasis | undefined,
): fhir4.MedicationRequest {
  const kind = doseFieldKind(rp, medLine, doseBasis);
  const dosageInstruction = buildDosage(rp, medLine, startDate, kind === "single" ? "single" : "daily");

  const resource: fhir4.MedicationRequest = {
    resourceType: "MedicationRequest",
    status: "active",
    intent: "order",
    identifier: [
      { system: RP_NUMBER_SYSTEM, value: String(rpNumber) },
      { system: ORDER_IN_RP_SYSTEM, value: String(orderInRp) },
    ],
    medicationCodeableConcept: medLine.medicine
      ? medicationCodeableConcept(medLine.medicine)
      : undefined,
    subject: { reference: `Patient/${patientId}` },
    authoredOn,
    basedOn: [{ reference: serviceRequestReference }],
    dosageInstruction: [dosageInstruction],
  };

  if (medLine.id) resource.id = medLine.id;

  applyOrderContext(resource, requester);

  if (hasDoseDays(rp.usage?.usage_code, rp.usage?.basic_usage_category) && rp.doseDays) {
    resource.dispenseRequest = {
      expectedSupplyDuration: {
        value: Number(rp.doseDays),
        unit: "日",
        system: UNITS_OF_MEASURE_SYSTEM,
        code: "d",
      },
    };
  }

  if (rp.dispenseInstructions?.length) {
    resource.dispenseRequest = {
      ...resource.dispenseRequest,
      extension: dispenseInstructionExtensions(rp.dispenseInstructions),
    };
  }

  if (medLine.comment) {
    resource.note = [{ text: medLine.comment }];
  }

  if (medLine.substitutionBlock && canBlockSubstitution(setting, medLine.medicine)) {
    resource.substitution = buildSubstitution(medLine.substitutionBlock);
  }

  // 持参薬から起こした行は元の持参薬を指す。R4 の basedOn は MedicationStatement を
  // 指せないので、任意の参照を置ける supportingInformation を使う。
  if (medLine.broughtMedicationId) {
    resource.supportingInformation = [
      { reference: broughtMedicationReference(medLine.broughtMedicationId) },
    ];
  }

  return resource;
}

/**
 * 持参薬の参照。同じ transaction で作る持参薬(urn:uuid)はそのまま、登録済みは
 * MedicationStatement/{id} にする。
 */
function broughtMedicationReference(id: string): string {
  return id.startsWith("urn:uuid:") ? id : `MedicationStatement/${id}`;
}

/** 処方の行(MedicationRequest)が起こされた元の持参薬の id。無ければ undefined。 */
export function broughtMedicationIdOf(mr: fhir4.MedicationRequest): string | undefined {
  const reference = mr.supportingInformation?.find((r) =>
    r.reference?.startsWith("MedicationStatement/"),
  )?.reference;
  return reference?.split("/").pop();
}

function buildPrescriptionTransactionBundle(
  values: PrescriptionFormValues,
  patientId: string,
  requester: OrderAttribution,
  // 登録日時。新規は registrationAuthoredOn()、更新は元の SR の値(編集で動かさない)。
  // SR と全 MedicationRequest に同じ値を入れる。
  authoredOn: string,
  serviceRequestId?: string,
  originalMedicationRequestIds?: string[],
): fhir4.Bundle {
  const serviceRequestReference = serviceRequestId
    ? `ServiceRequest/${serviceRequestId}`
    : `urn:uuid:${crypto.randomUUID()}`;

  const orderDetail: fhir4.CodeableConcept[] = [];
  const medicationEntries: fhir4.BundleEntry[] = [];
  const keptMedicationRequestIds = new Set<string>();

  values.rps.forEach((rp, rpIndex) => {
    const rpNumber = rpIndex + 1;
    rp.medicines.forEach((medLine, medIndex) => {
      const orderInRp = medIndex + 1;
      const resource = buildMedicationRequest(
        rp,
        medLine,
        values.setting,
        values.startDate,
        rpNumber,
        orderInRp,
        patientId,
        authoredOn,
        serviceRequestReference,
        requester,
        values.doseBasis,
      );

      const fullUrl = medLine.id ? `MedicationRequest/${medLine.id}` : `urn:uuid:${crypto.randomUUID()}`;
      if (medLine.id) keptMedicationRequestIds.add(medLine.id);

      medicationEntries.push({
        fullUrl,
        resource,
        request: medLine.id
          ? { method: "PUT", url: `MedicationRequest/${medLine.id}` }
          : { method: "POST", url: "MedicationRequest" },
      });
      orderDetail.push({
        extension: [
          {
            url: ORDER_DETAIL_MR_EXT_URL,
            valueReference: { reference: fullUrl },
          },
        ],
        text: `RP${rpNumber}-${orderInRp}`,
      });
    });
  });

  const serviceRequest: fhir4.ServiceRequest = {
    resourceType: "ServiceRequest",
    status: "active",
    intent: "order",
    category: [
      { coding: [{ system: ORDER_TYPE_SYSTEM, ...PRESCRIPTION_ORDER_TYPE }] },
      {
        coding: [
          { system: SETTING_SYSTEM, code: values.setting, display: findSettingDisplay(values.setting) },
        ],
      },
      {
        coding: [
          {
            system: PRESCRIPTION_CATEGORY_SYSTEM,
            code: values.category,
            display: findCategoryDisplay(values.setting, values.category),
          },
        ],
      },
    ],
    subject: { reference: `Patient/${patientId}` },
    authoredOn,
    // 投与開始日。カルテのカードの位置はこの日(部門一覧は交付日=authoredOn で引く)。
    occurrenceDateTime: values.startDate,
    orderDetail,
    ...(values.doseBasis === "single"
      ? { extension: [{ url: DOSE_BASIS_EXT_URL, valueCode: "single" }] }
      : {}),
  };

  // 入院のオーダーはその入院に紐付ける。与薬の実施記録(Procedure /
  // MedicationAdministration)がここから Encounter を写す(oralPerformHelpers)。
  if (requester.encounterId) {
    serviceRequest.encounter = { reference: `Encounter/${requester.encounterId}` };
  }

  if (serviceRequestId) serviceRequest.id = serviceRequestId;
  // 対象プロブレム(POMR)。オーダーの適応を表す標準要素 reasonReference をそのまま使う
  // (診療記録と違いローカル拡張は不要)。紐付けは処方オーダー 1 件に対して 1 つ持たせ、
  // RP ごとに分けたいときはオーダーを分けて登録する。
  if (values.problem) {
    serviceRequest.reasonReference = [
      {
        reference: `Condition/${values.problem.conditionId}`,
        display: values.problem.display,
      },
    ];
  }
  applyOrderContext(serviceRequest, requester);
  if (values.comment) {
    serviceRequest.note = [{ text: values.comment }];
  }

  const removedMedicationRequestEntries: fhir4.BundleEntry[] = (originalMedicationRequestIds ?? [])
    .filter((id) => !keptMedicationRequestIds.has(id))
    .map((id) => ({ request: { method: "DELETE", url: `MedicationRequest/${id}` } }));

  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      {
        fullUrl: serviceRequestReference,
        resource: serviceRequest,
        request: serviceRequestId
          ? { method: "PUT", url: `ServiceRequest/${serviceRequestId}` }
          : { method: "POST", url: "ServiceRequest" },
      },
      ...medicationEntries,
      ...removedMedicationRequestEntries,
    ],
  };
}

// requester: 新規はヘッダーで選択中の依頼科・依頼医師、更新は既存の処方から
// 引き継いだ値(orderRequester)を渡す。
export function buildPrescriptionBundle(
  values: PrescriptionFormValues,
  patientId: string,
  requester: OrderAttribution,
): fhir4.Bundle {
  return buildPrescriptionTransactionBundle(values, patientId, requester, registrationAuthoredOn());
}

/**
 * CDS Hooks の order-select / order-sign に渡す未保存の処方(draftOrders、docs/cds-hooks-design.md §2.5)。
 * 薬剤が入った行だけを MedicationRequest(status=draft)にし、id は RP と行の位置から作る
 * (入力のたびに同じ行は同じ id になり、selections で「いま選んだ行」を指せる)。
 * オーダーヘッダはまだ無いので basedOn は付けない。authoredOn は日付だけにする(時刻を入れると
 * 呼ぶたびに内容が変わり、どの行を選んだかが分からなくなる)。
 */
export function buildPrescriptionDraftOrders(
  values: PrescriptionFormValues,
  patientId: string,
  requester: OrderContext,
): fhir4.Bundle {
  const authoredOn = today();
  const entry: fhir4.BundleEntry[] = [];
  values.rps.forEach((rp, rpIndex) => {
    rp.medicines.forEach((line, lineIndex) => {
      if (!line.medicine) return;
      const resource = buildMedicationRequest(
        rp, { ...line, id: undefined }, values.setting, values.startDate, rpIndex + 1, lineIndex + 1,
        patientId, authoredOn, "", requester, values.doseBasis,
      );
      delete resource.basedOn;
      const draft: fhir4.MedicationRequest = { ...resource, id: prescriptionDraftOrderId(rpIndex, lineIndex), status: "draft" };
      entry.push({ resource: draft });
    });
  });
  return { resourceType: "Bundle", type: "collection", entry };
}

export function prescriptionDraftOrderId(rpIndex: number, lineIndex: number): string {
  return `draft-${rpIndex + 1}-${lineIndex + 1}`;
}

// 更新は元の ServiceRequest を受け取る。id のほかに登録日時(authoredOn)を引き継ぐため。
export function buildPrescriptionUpdateBundle(
  values: PrescriptionFormValues,
  patientId: string,
  original: fhir4.ServiceRequest,
  originalMedicationRequestIds: string[],
  requester: OrderAttribution,
): fhir4.Bundle {
  if (!original.id) throw new Error("更新する処方に id がありません");
  return withVersionLock(
    buildPrescriptionTransactionBundle(
      values,
      patientId,
      requester,
      registrationAuthoredOn(original),
      original.id,
      originalMedicationRequestIds,
    ),
    original,
  );
}

// 既存の処方を DO(流用)して新規登録するためのフォーム値に変換する。
// ・用法/投与量/投与日数/コメント/対象プロブレムなど入力値はすべて引き継ぐ
// ・MedicationRequest の id を落とし、既存リソースの更新(PUT)ではなく新規登録(POST)にする
// ・投与開始日は DO 元ではなく当日にする(登録日時は保存時に採るのでフォームには無い)
// ・入外区分はいまの患者の状態(setting)に合わせる。DO 元と変わる場合は処方区分の
//   選択肢ごと変わるので、処方区分は空にしてフォームに初期値(施設設定)を入れさせる。
export function buildDoPrescriptionForm(
  values: PrescriptionFormValues,
  setting: PrescriptionSetting,
): PrescriptionFormValues {
  return {
    ...values,
    setting,
    // 「持参」は持参薬の継続からだけ作る区分なので、DO では持ち越さない。
    category:
      setting === values.setting && values.category !== BROUGHT_CATEGORY.code
        ? values.category
        : "",
    startDate: today(),
    rps: values.rps.map((rp) => ({
      ...rp,
      medicines: rp.medicines.map(
        ({ id: _id, broughtMedicationId: _brought, ...rest }) => rest,
      ),
    })),
  };
}

/**
 * 処方の削除。明細(MedicationRequest)は条件付き削除でまとめて消すので、消す前に
 * 明細の id を引き直す必要はない(上流は該当する全件を消す conditionalDelete に
 * 対応している)。
 */
export function buildPrescriptionDeleteBundle(serviceRequestId: string): fhir4.Bundle {
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      { request: { method: "DELETE", url: `ServiceRequest/${serviceRequestId}` } },
      {
        request: {
          method: "DELETE",
          url: `MedicationRequest?based-on=ServiceRequest/${serviceRequestId}`,
        },
      },
    ],
  };
}

// ---- 一覧・詳細表示のための parse ----

export interface PrescriptionSummary {
  id: string;
  /**
   * 処方日(交付日)。処方箋の交付年月日と同じで、登録日時の日付。化学療法レジメンの日オーダーは
   * 数クール分を先に登録し、投与日に処方箋を渡すので投与開始日にする。
   */
  date: string;
  /** 投与開始日(occurrenceDateTime)。持たない処方では処方日と同じ。 */
  startDate: string;
  settingCode: string;
  settingDisplay: string;
  categoryCode: string;
  categoryDisplay: string;
  medicineCount: number;
}

/** ServiceRequest が処方オーダー(order-type|prescription)かどうか。 */
export function isPrescriptionServiceRequest(sr: fhir4.ServiceRequest): boolean {
  return categoryCoding(sr, ORDER_TYPE_SYSTEM)?.code === PRESCRIPTION_ORDER_TYPE.code;
}

export function summarizeServiceRequest(sr: fhir4.ServiceRequest): PrescriptionSummary {
  const setting = categoryCoding(sr, SETTING_SYSTEM);
  const category = categoryCoding(sr, PRESCRIPTION_CATEGORY_SYSTEM);

  return {
    id: sr.id ?? "",
    date: isRegimenDayOrder(sr) ? orderDay(sr) : (sr.authoredOn?.slice(0, 10) ?? ""),
    startDate: orderDay(sr),
    settingCode: setting?.code ?? "",
    settingDisplay: setting?.display ?? "",
    categoryCode: category?.code ?? "",
    categoryDisplay: category?.display ?? "",
    medicineCount: sr.orderDetail?.length ?? 0,
  };
}

export const prescriptionComment = orderComment;
export const prescriptionProblem = orderProblem;

export interface PrescriptionDetailBundle {
  serviceRequest?: fhir4.ServiceRequest;
  medicationRequests: fhir4.MedicationRequest[];
  /** 進捗の Task(注射の詳細で進捗を出すのに使う。処方の詳細では見ていない)。 */
  tasks: fhir4.Task[];
}

export function splitPrescriptionDetailBundle(bundle: fhir4.Bundle): PrescriptionDetailBundle {
  const result: PrescriptionDetailBundle = { medicationRequests: [], tasks: [] };
  for (const entry of bundle.entry ?? []) {
    const resource = entry.resource;
    if (resource?.resourceType === "ServiceRequest") {
      result.serviceRequest = resource as fhir4.ServiceRequest;
    } else if (resource?.resourceType === "MedicationRequest") {
      result.medicationRequests.push(resource as fhir4.MedicationRequest);
    } else if (resource?.resourceType === "Task") {
      result.tasks.push(resource as fhir4.Task);
    }
  }
  return result;
}

export interface MedicineLineDisplay {
  orderInRp: number;
  code: string;
  name: string;
  yjCode?: string;
  /** 一般名処方(【般】〜)の行。名称に【般】が付くので表示上の区別は不要だが、印刷・集計で使う。 */
  generic?: boolean;
  /** 量 1 つで扱うときの量(`orderedDose`。日数を持つ内服は 1 日量、頓用は 1 回量、外用などは全量)。 */
  dose?: number;
  /** 1 回量・1 日量(処方のみ。表示は `doseText`)。 */
  amounts?: DoseAmounts;
  unit?: string;
  /** 用量が力価(原薬量)。単位の横に「力価」の印を出す。 */
  potency?: boolean;
  comment?: string;
  /** 後発品変更不可。変更可なら undefined。 */
  substitutionBlock?: SubstitutionBlock;
  /** 不均等投与の表示(「朝 3.5錠・夕 1錠」)。 */
  unevenLabel?: string;
  /** インスリンのスケール(注射のみ)。dose はスケールの基本量で、スケールのみなら空。 */
  insulinScale?: InsulinScaleValues | null;
}

export interface RpDisplay {
  rpNumber: number;
  usageCode?: string;
  usageName?: string;
  basicCategory?: string;
  doseDays?: number;
  doseCount?: number;
  usageComment?: string;
  /** 補足用法の表示(「毎週月・木曜日」)。 */
  supplementLabel?: string;
  /** 調剤指示の表示(「一包化・粉砕」)。 */
  dispenseInstructionLabel?: string;
  medicines: MedicineLineDisplay[];
}

export function identifierValue(mr: fhir4.MedicationRequest, system: string): string | undefined {
  return mr.identifier?.find((i) => i.system === system)?.value;
}

export function groupByRp(mrs: fhir4.MedicationRequest[]): RpDisplay[] {
  const groups = new Map<number, RpDisplay>();

  for (const mr of mrs) {
    const rpNumber = Number(identifierValue(mr, RP_NUMBER_SYSTEM) ?? "0");
    const orderInRp = Number(identifierValue(mr, ORDER_IN_RP_SYSTEM) ?? "0");
    const dosage = mr.dosageInstruction?.[0];
    const usageCoding = codingBySystem(dosage?.timing?.code?.coding, USAGE_CODE_SYSTEM);
    const usageCategoryCoding = codingBySystem(dosage?.timing?.code?.coding, USAGE_CATEGORY_SYSTEM);

    let group = groups.get(rpNumber);
    if (!group) {
      group = {
        rpNumber,
        usageCode: usageCoding?.code,
        usageName: usageCoding?.display,
        basicCategory: usageCategoryCoding?.display,
        doseDays: mr.dispenseRequest?.expectedSupplyDuration?.value,
        doseCount: dosage?.timing?.repeat?.count,
        usageComment: usageCommentOf(dosage),
        supplementLabel: supplementLabel(supplementOf(dosage)) || undefined,
        dispenseInstructionLabel: dispenseInstructionLabel(dispenseInstructionsOf(mr)) || undefined,
        medicines: [],
      };
      groups.set(rpNumber, group);
    }

    const coding = mr.medicationCodeableConcept?.coding;
    const genericCoding = codingBySystem(coding, GENERAL_ORDER_CODE_SYSTEM);
    const medicineCoding = genericCoding ?? codingBySystem(coding, MEDICINE_CODE_SYSTEM);
    const yjCoding = codingBySystem(coding, YJ_CODE_SYSTEM);
    const amounts = prescriptionDoseOf(dosage);

    group.medicines.push({
      orderInRp,
      code: medicineCoding?.code ?? "",
      name: medicineCoding?.display ?? mr.medicationCodeableConcept?.text ?? "",
      yjCode: yjCoding?.code ?? undefined,
      generic: genericCoding ? true : undefined,
      dose: orderedDose(amounts),
      amounts,
      unit: prescriptionDoseUnitOf(dosage),
      potency: isPotencyDose(dosage?.doseAndRate?.[0]) || undefined,
      comment: mr.note?.[0]?.text,
      substitutionBlock: substitutionBlockOf(mr) ?? undefined,
      unevenLabel: unevenLabel(unevenDosesOf(dosage), usageCoding?.code, prescriptionDoseUnitOf(dosage)) || undefined,
    });
  }

  const result = Array.from(groups.values());
  result.forEach((g) => g.medicines.sort((a, b) => a.orderInRp - b.orderInRp));
  result.sort((a, b) => a.rpNumber - b.rpNumber);
  return result;
}

// ---- 編集フォームへの復元 ----
//
// FHIR リソースにはマスタの全項目(id, 剤形など)は保存されていないため、フォーム上で
// 再選択されない限り、コード・名称・単位など保存済みの項目のみを持つ簡易オブジェクトとして復元する。

/** 保存済みの処方の処方区分(院内・院外…)のコード。無ければ空。 */
export function prescriptionCategoryOf(sr: fhir4.ServiceRequest): string {
  return categoryCoding(sr, PRESCRIPTION_CATEGORY_SYSTEM)?.code ?? "";
}

export function medicineFromCoding(mr: fhir4.MedicationRequest): Medicine | null {
  return medicineFromConcept(
    mr.medicationCodeableConcept,
    prescriptionDoseUnitOf(mr.dosageInstruction?.[0]),
  );
}

/**
 * 医薬品の CodeableConcept から Medicine を復元する。マスタのコードを持たない(名前だけの)
 * ものは null。単位は医薬品の CodeableConcept に無いので、Dosage の単位を渡す。
 */
export function medicineFromConcept(
  concept: fhir4.CodeableConcept | undefined,
  unitName: string | undefined,
): Medicine | null {
  const codings = concept?.coding;
  // 一般名処方は一般名処方コードだけを持ち、レセ電コードは無い。
  const genericCoding = codingBySystem(codings, GENERAL_ORDER_CODE_SYSTEM);
  const coding = genericCoding ?? codingBySystem(codings, MEDICINE_CODE_SYSTEM);
  if (!coding) return null;
  const yjCoding = codingBySystem(codings, YJ_CODE_SYSTEM);
  const name = coding.display ?? concept?.text ?? "";
  return {
    id: 0,
    medicine_code: coding.code ?? "",
    name,
    name_kana: null,
    unit_code: null,
    unit_name: unitName ?? null,
    dosage_form: null,
    injection_volume: null,
    yakka_code: null,
    yakko_code: null,
    yakko_name: null,
    yj_code: yjCoding?.code ?? null,
    price: null,
    generic_name_description: genericCoding ? name : null,
    abolished_on: null,
    ...(genericCoding ? { generic: true } : {}),
  };
}

/** Dosage の用法コードから MedicineUsage を復元する。用法コードが無ければ null。 */
export function usageFromDosage(dosage: fhir4.Dosage | undefined): MedicineUsage | null {
  const usageCoding = codingBySystem(dosage?.timing?.code?.coding, USAGE_CODE_SYSTEM);
  const usageCategoryCoding = codingBySystem(dosage?.timing?.code?.coding, USAGE_CATEGORY_SYSTEM);
  if (!usageCoding) return null;
  return {
    id: 0,
    usage_code: usageCoding.code ?? "",
    usage_name: usageCoding.display ?? "",
    basic_usage_category_code: usageCategoryCoding?.code ?? null,
    basic_usage_category: usageCategoryCoding?.display ?? null,
    detailed_usage_category_code: null,
    detailed_usage_category: null,
    timing_category_code: null,
    timing_category: null,
  };
}

/**
 * `basis` を渡すと、その入力区分で用量欄を起こす(調剤登録・処方監査は 1 日量で扱う)。省略は処方の入力区分。
 */
export function parsePrescriptionForm(
  sr: fhir4.ServiceRequest,
  mrs: fhir4.MedicationRequest[],
  { basis = doseBasisOf(sr) }: { basis?: DoseBasis } = {},
): PrescriptionFormValues {
  const setting = (categoryCoding(sr, SETTING_SYSTEM)?.code ?? "") as PrescriptionSetting;
  const category = categoryCoding(sr, PRESCRIPTION_CATEGORY_SYSTEM)?.code ?? "";

  const rpGroups = new Map<number, RpValues & { medicinesByOrder: Map<number, MedicineLineValues> }>();

  for (const mr of mrs) {
    const rpNumber = Number(identifierValue(mr, RP_NUMBER_SYSTEM) ?? "0");
    const orderInRp = Number(identifierValue(mr, ORDER_IN_RP_SYSTEM) ?? "0");
    const dosage = mr.dosageInstruction?.[0];

    let group = rpGroups.get(rpNumber);
    if (!group) {
      group = {
        usage: usageFromDosage(dosage),
        doseDays: mr.dispenseRequest?.expectedSupplyDuration?.value != null
          ? String(mr.dispenseRequest.expectedSupplyDuration.value)
          : "",
        doseCount: dosage?.timing?.repeat?.count != null ? String(dosage.timing.repeat.count) : "",
        usageComment: usageCommentOf(dosage) ?? "",
        supplement: supplementOf(dosage),
        dispenseInstructions: dispenseInstructionsOf(mr).length ? dispenseInstructionsOf(mr) : null,
        medicines: [],
        medicinesByOrder: new Map(),
      };
      rpGroups.set(rpNumber, group);
    }

    const amounts = prescriptionDoseOf(dosage);
    const unevenDoses = unevenDosesOf(dosage);
    const kind = doseFieldKind(group, { unevenDoses }, basis);
    const doseValue = kind === "single" ? amounts.single : kind === "daily" ? amounts.daily : amounts.amount;
    group.medicinesByOrder.set(orderInRp, {
      id: mr.id,
      medicine: medicineFromCoding(mr),
      dose: doseValue != null ? String(doseValue) : "",
      comment: mr.note?.[0]?.text ?? "",
      showComment: Boolean(mr.note?.[0]?.text),
      substitutionBlock: substitutionBlockOf(mr),
      unevenDoses,
      ...(isPotencyDose(dosage?.doseAndRate?.[0]) ? { potency: true } : {}),
      ...(broughtMedicationIdOf(mr) ? { broughtMedicationId: broughtMedicationIdOf(mr) } : {}),
    });
  }

  const rps: RpValues[] = Array.from(rpGroups.entries())
    .sort(([a], [b]) => a - b)
    .map(([, group]) => ({
      usage: group.usage,
      doseDays: group.doseDays,
      doseCount: group.doseCount,
      usageComment: group.usageComment,
      showUsageComment: Boolean(group.usageComment),
      supplement: group.supplement,
      dispenseInstructions: group.dispenseInstructions,
      medicines: Array.from(group.medicinesByOrder.entries())
        .sort(([a], [b]) => a - b)
        .map(([, medLine]) => medLine),
    }));

  return {
    setting,
    category,
    startDate: orderDay(sr) || today(),
    comment: prescriptionComment(sr),
    problem: prescriptionProblem(sr),
    doseBasis: basis,
    rps: rps.length ? rps : [{ ...emptyRp, medicines: [{ ...emptyMedicineLine }] }],
  };
}
