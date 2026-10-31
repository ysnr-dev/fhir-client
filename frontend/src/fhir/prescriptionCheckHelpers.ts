import type { AdoptionCategory, Medicine, MedicineAttributeFlags } from "../api/masterClient";
import type { CheckedLine } from "./drugCheckHelpers";
import type { MedicationWarning } from "./medicationSafetyHelpers";
import {
  BROUGHT_CATEGORY,
  CATEGORY_OPTIONS,
  hasDoseDays,
  lineDoseAmounts,
  prescriptionLineDose,
  type DoseBasis,
  type PrescriptionSetting,
  type RpValues,
} from "./prescriptionHelpers";

// 薬剤付加情報(施設の薬剤の設定)と処方・注射の入力の照合(docs/drug-check-master-design.md §2)。
//
//   採用区分        … 採用外・院外専用の薬を院内で調剤するオーダー、仮採用の薬
//   処方できる診療科 … 依頼科が薬剤付加情報の診療科に無い
//   粉砕・分割      … 粉砕の調剤指示に粉砕不可の薬、端数の用量に分割不可の薬
//   剤形と用法      … 医薬品マスタの剤形と用法の基本区分が食い違う
//   処方区分の日数  … 施設設定の処方区分ごとの投与日数の上限
//
// 形は `buildMedicationWarnings` と同じ [RP][薬剤]。**登録は止めない**。

/** 調剤の場所。院内(入院・外来の院内処方・注射)か院外処方か。分からないときは null(採用区分を見ない)。 */
export type Dispensing = "internal" | "external" | null;

export interface PrescriptionCheckLine {
  medicine: Medicine | null;
  /** 1 回量(不均等なら各回)に端数がある。 */
  fractional?: boolean;
}

export interface PrescriptionCheckRp {
  medicines: PrescriptionCheckLine[];
  /** 用法の基本区分(内服・外用・注射・注入)。 */
  usageCategory?: string | null;
  /** 調剤指示に粉砕がある。 */
  crush?: boolean;
  /** 投与日数。日数を持つ内服の RP だけ。 */
  days?: number | null;
}

/** 薬剤チェック全体(`useMedicationWarnings`)に渡す RP。注射は用法の区分・調剤指示・日数を持たない。 */
export interface MedicationCheckRp extends Omit<PrescriptionCheckRp, "medicines"> {
  medicines: (CheckedLine & PrescriptionCheckLine)[];
}

/** 処方の RP を薬剤チェックに渡す形にする(用量・日数・用法の区分・粉砕・端数)。 */
export function prescriptionCheckRpOf(rp: RpValues, basis: DoseBasis | undefined): MedicationCheckRp {
  const days = hasDoseDays(rp.usage?.usage_code, rp.usage?.basic_usage_category) ? Number(rp.doseDays) || null : null;
  return {
    usageCategory: rp.usage?.basic_usage_category ?? null,
    crush: (rp.dispenseInstructions ?? []).includes("C"),
    days,
    medicines: rp.medicines.map((m) => ({
      medicine: m.medicine,
      dose: prescriptionLineDose(rp, m, basis),
      fractional: hasFraction([lineDoseAmounts(rp, m, basis)?.single, ...(m.unevenDoses ?? []).map(Number)]),
    })),
  };
}

/** 処方の調剤の場所。入院と外来の院内処方は院内、外来の院外処方は院外。持参は調剤しない。 */
export function prescriptionDispensing(setting: PrescriptionSetting, category: string): Dispensing {
  if (category === BROUGHT_CATEGORY.code || !setting) return null;
  if (setting === "inpatient") return "internal";
  if (category === "external") return "external";
  return category === "internal" ? "internal" : null;
}

/** 処方区分のコードと表示名。入外区分の選択肢に無ければ null。 */
export function prescriptionCategoryOption(
  setting: PrescriptionSetting,
  category: string,
): { code: string; display: string } | null {
  return (setting && CATEGORY_OPTIONS[setting].find((o) => o.code === category)) || null;
}

/** 処方区分の日数の上限。 */
export interface CategoryDaysLimit {
  label: string;
  days: number;
}

/** 剤形区分(医薬品マスタ)ごとの、合う用法の基本区分。内用薬の経管投与は「注入」。 */
const USAGE_CATEGORIES_OF_FORM: Record<string, { label: string; categories: string[] }> = {
  "1": { label: "内用薬", categories: ["内服", "注入"] },
  "4": { label: "注射薬", categories: ["注射", "注入"] },
  "6": { label: "外用薬", categories: ["外用"] },
};

const DEFAULT_FLAGS: MedicineAttributeFlags = {
  lot_required: false,
  antimicrobial_category: "none",
  ddd: null,
  adoption: "unset",
  no_crush: false,
  no_split: false,
  departments: [],
};

/** 採用区分の実効値。未設定は施設設定で採用外として扱える。 */
export function adoptionOf(
  flags: MedicineAttributeFlags | undefined,
  unsetAsNotAdopted: boolean,
): AdoptionCategory {
  const adoption = flags?.adoption ?? "unset";
  return adoption === "unset" && unsetAsNotAdopted ? "not_adopted" : adoption;
}

function adoptionWarning(adoption: AdoptionCategory, dispensing: Dispensing): MedicationWarning | null {
  if (adoption === "provisional") return { kind: "adoption", text: "仮採用の薬です", high: false };
  if (dispensing !== "internal") return null;
  if (adoption === "not_adopted") return { kind: "adoption", text: "採用外の薬です", high: true };
  if (adoption === "outpatient_only") return { kind: "adoption", text: "院外専用の薬です", high: true };
  return null;
}

/** 1 回量に端数があるか(0.5 錠など)。 */
export function hasFraction(amounts: (number | null | undefined)[]): boolean {
  return amounts.some((amount) => amount != null && amount > 0 && !Number.isInteger(Math.round(amount * 1000) / 1000));
}

export function buildPrescriptionCheckWarnings(args: {
  rps: PrescriptionCheckRp[];
  attributes: ReadonlyMap<string, MedicineAttributeFlags>;
  dispensing: Dispensing;
  /** 依頼科の診療科コード。分からなければ診療科を見ない。 */
  departmentCode?: string;
  /** 診療科コード → 名称(警告の文言に使う)。 */
  departmentNames?: ReadonlyMap<string, string>;
  unsetAsNotAdopted: boolean;
  categoryDaysLimit?: CategoryDaysLimit | null;
}): MedicationWarning[][][] {
  const { attributes, dispensing, departmentCode, departmentNames, unsetAsNotAdopted, categoryDaysLimit } = args;

  return args.rps.map((rp) => {
    // 処方区分の日数は RP の性質なので、薬剤の入った最初の行にだけ出す。
    const firstLine = rp.medicines.findIndex((line) => line.medicine);
    return rp.medicines.map((line, lineIndex) => {
      const medicine = line.medicine;
      if (!medicine) return [];
      const flags = attributes.get(medicine.medicine_code) ?? DEFAULT_FLAGS;
      const warnings: MedicationWarning[] = [];

      const adoption = adoptionWarning(adoptionOf(flags, unsetAsNotAdopted), dispensing);
      if (adoption) warnings.push(adoption);

      if (departmentCode && flags.departments.length > 0 && !flags.departments.includes(departmentCode)) {
        const names = flags.departments.map((code) => departmentNames?.get(code) ?? code).join("・");
        warnings.push({
          kind: "restricted-department",
          text: "依頼科では処方できない薬です",
          high: true,
          detail: `処方できる診療科: ${names}`,
        });
      }

      if (rp.crush && flags.no_crush) {
        warnings.push({ kind: "crush-split", text: "粉砕不可の薬です", high: true });
      }
      if (line.fractional && flags.no_split) {
        warnings.push({ kind: "crush-split", text: "分割不可の薬です(端数の用量)", high: true });
      }

      const form = USAGE_CATEGORIES_OF_FORM[(medicine.dosage_form ?? "").trim()];
      if (form && rp.usageCategory && !form.categories.includes(rp.usageCategory)) {
        warnings.push({ kind: "usage-form", text: `${form.label}に${rp.usageCategory}の用法です`, high: false });
      }

      if (
        lineIndex === firstLine &&
        categoryDaysLimit &&
        categoryDaysLimit.days > 0 &&
        rp.days != null &&
        rp.days > categoryDaysLimit.days
      ) {
        warnings.push({
          kind: "days-limit",
          text: `${categoryDaysLimit.label}処方の日数の上限超過: ${rp.days}日 > ${categoryDaysLimit.days}日`,
          high: true,
        });
      }
      return warnings;
    });
  });
}
