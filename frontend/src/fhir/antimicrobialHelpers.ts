import type { AntimicrobialCategory, Medicine, MedicineAttributeFlags } from "../api/masterClient";
import { addDays, diffDays } from "../lib/dates";
import { ingredientKey, type MedicationWarning } from "./medicationSafetyHelpers";

// 抗菌薬適正使用支援(AST)。設計は docs/antimicrobial-stewardship-design.md。
//
// 抗菌薬かどうかは薬効分類(薬価基準コード・YJ コードの上 4 桁)で決める。特定抗菌薬(届出制・許可制)と
// 1 日規定用量(DDD)は施設の薬剤付加情報(Master::MedicineAttribute)に持つ。

/** 抗菌薬とみなす薬効分類の前方一致(61x 抗生物質製剤・622 抗結核剤・624 合成抗菌剤)。 */
export const ANTIMICROBIAL_YAKKO_PREFIXES = ["61", "622", "624"];

/** 血液培養とみなす材料(JANIS 材料コード。401 静脈血・402 動脈血)。系統「血液・穿刺液」は髄液・胸水を含むので使わない。 */
export const BLOOD_CULTURE_SPECIMEN_CODES = ["401", "402"];

/** 長期投与の警告を出す日数(何日目から)。 */
export const LONG_COURSE_DAYS = 7;
export const VERY_LONG_COURSE_DAYS = 14;

export const ANTIMICROBIAL_CATEGORY_LABEL: Record<AntimicrobialCategory, string> = {
  none: "",
  notify: "届出制",
  approve: "許可制",
};

export function isAntimicrobialYakko(code: string | null | undefined): boolean {
  return Boolean(code && ANTIMICROBIAL_YAKKO_PREFIXES.some((prefix) => code.startsWith(prefix)));
}

/**
 * 薬が抗菌薬か。YJ コード・薬効分類があればそれで決め、無ければ抗菌薬の医薬品コードの集合で引く
 * (編集・DO で開いた行は医薬品マスタの付帯情報を持たないため)。
 */
export function isAntimicrobialMedicine(
  medicine: { medicine_code?: string | null; yj_code?: string | null; yakko_code?: string | null } | null | undefined,
  antimicrobialCodes: ReadonlySet<string>,
): boolean {
  if (!medicine) return false;
  if (isAntimicrobialYakko(medicine.yakko_code) || isAntimicrobialYakko(medicine.yj_code)) return true;
  return Boolean(medicine.medicine_code && antimicrobialCodes.has(medicine.medicine_code));
}

/** 特定抗菌薬の区分(特定抗菌薬でなければ none)。 */
export function antimicrobialCategoryOf(
  medicineCode: string | null | undefined,
  attributes: ReadonlyMap<string, MedicineAttributeFlags>,
): AntimicrobialCategory {
  return (medicineCode && attributes.get(medicineCode)?.antimicrobial_category) || "none";
}

// ---- 連続投与(長期投与の判定) ----

/** 抗菌薬を投与した(する)期間 1 つ。処方は RP の開始〜終了、注射は施行日 1 日。 */
export interface AntimicrobialSpan {
  patientId: string;
  /** 成分(ingredientKey)。無ければ医薬品コード。 */
  ingredient: string;
  medicineCode: string;
  name: string;
  start: string;
  end: string;
  /** 元のオーダー(編集中のオーダーを数えないため)。 */
  orderId: string;
}

/** 成分ごとの連続投与。 */
export interface AntimicrobialCourse {
  patientId: string;
  ingredient: string;
  /** 最後に投与した薬の医薬品コード(特定抗菌薬の区分を引くのに使う)。 */
  medicineCode: string;
  name: string;
  start: string;
  end: string;
}

/** 成分のキー。成分の取れない薬は医薬品コードで代える。 */
export function antimicrobialIngredient(medicine: {
  medicine_code: string;
  yj_code?: string | null;
  yakka_code?: string | null;
  generic?: boolean;
}): string {
  return ingredientKey(medicine) ?? `code:${medicine.medicine_code}`;
}

/**
 * 期間を患者 × 成分ごとにつないで連続投与にする。前の投与の終了日の翌日までに次の投与が始まれば
 * 続きとみなす(連日の注射・日をまたぐ処方)。開始日の古い順。
 */
export function antimicrobialCourses(spans: AntimicrobialSpan[]): AntimicrobialCourse[] {
  const byKey = new Map<string, AntimicrobialSpan[]>();
  for (const span of spans) {
    if (!span.start) continue;
    const key = `${span.patientId}|${span.ingredient}`;
    byKey.set(key, [...(byKey.get(key) ?? []), span]);
  }
  const courses: AntimicrobialCourse[] = [];
  for (const list of byKey.values()) {
    const sorted = [...list].sort((a, b) => a.start.localeCompare(b.start));
    let current: AntimicrobialCourse | null = null;
    for (const span of sorted) {
      const end = span.end && span.end > span.start ? span.end : span.start;
      if (current && span.start <= addDays(current.end, 1)) {
        if (end >= current.end) {
          current.end = end;
          current.medicineCode = span.medicineCode;
          current.name = span.name;
        }
        continue;
      }
      if (current) courses.push(current);
      current = {
        patientId: span.patientId,
        ingredient: span.ingredient,
        medicineCode: span.medicineCode,
        name: span.name,
        start: span.start,
        end,
      };
    }
    if (current) courses.push(current);
  }
  return courses.sort((a, b) => a.start.localeCompare(b.start));
}

/** その日に続いている連続投与(その日を含むか、前日までで終わってその日に続けられるもの)。 */
export function courseOn(
  courses: AntimicrobialCourse[],
  ingredient: string,
  onDate: string,
): AntimicrobialCourse | undefined {
  return courses.find(
    (course) => course.ingredient === ingredient && course.start <= onDate && addDays(course.end, 1) >= onDate,
  );
}

/** 連続投与の何日目か(開始日を 1 日目)。 */
export function courseDayNumber(course: AntimicrobialCourse, onDate: string): number {
  return diffDays(course.start, onDate) + 1;
}

// ---- 処方・注射フォームの警告 ----

export interface AntimicrobialWarningLine {
  medicine: Medicine | null;
}

export interface AntimicrobialWarningRp {
  medicines: AntimicrobialWarningLine[];
}

/**
 * 処方・注射フォームの抗菌薬の警告。形は buildMedicationWarnings と同じ [RP][薬剤]。
 * - 特定抗菌薬: 届出制は注意、許可制は強い警告
 * - 長期投与: 同じ成分の連続投与が開始日に続いていて 7 日目以上(14 日目以上は強い警告)
 */
export function buildAntimicrobialWarnings(args: {
  rps: AntimicrobialWarningRp[];
  startDate: string;
  courses: AntimicrobialCourse[];
  attributes: ReadonlyMap<string, MedicineAttributeFlags>;
  antimicrobialCodes: ReadonlySet<string>;
}): MedicationWarning[][][] {
  return args.rps.map((rp) =>
    rp.medicines.map((line) => {
      const medicine = line.medicine;
      if (!medicine || !isAntimicrobialMedicine(medicine, args.antimicrobialCodes)) return [];
      const warnings: MedicationWarning[] = [];
      const category = antimicrobialCategoryOf(medicine.medicine_code, args.attributes);
      if (category !== "none") {
        warnings.push({
          kind: "antimicrobial",
          text: `特定抗菌薬(${ANTIMICROBIAL_CATEGORY_LABEL[category]})`,
          high: category === "approve",
          detail: category === "approve" ? "AST の許可が要ります。届出書を提出してください。" : "届出書を提出してください。",
        });
      }
      if (args.startDate) {
        const course = courseOn(args.courses, antimicrobialIngredient(medicine), args.startDate);
        const day = course ? courseDayNumber(course, args.startDate) : 0;
        if (course && day >= LONG_COURSE_DAYS) {
          warnings.push({
            kind: "antimicrobial",
            text: `投与 ${day} 日目`,
            high: day >= VERY_LONG_COURSE_DAYS,
            detail: `${course.name} を ${course.start} から続けて投与しています。`,
          });
        }
      }
      return warnings;
    }),
  );
}
