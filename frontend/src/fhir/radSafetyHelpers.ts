import type { Medicine } from "../api/masterClient";
import { type Advisory, type AdvisoryKind, advisoryKey, severityOf } from "./advisoryHelpers";
import {
  allergyMatchLabel,
  medicationAllergenCodes,
  summarizeAllergy,
  type AllergyMatch,
} from "./allergyHelpers";
import type { RenalSummary } from "./bodyMeasureHelpers";
import type { FlagSummary } from "./flagHelpers";
import type { ActiveMedication } from "./medicationSafetyHelpers";

// 放射線オーダーの造影・MRI の注意(docs/rad-backlog.md B-1 / B-2)。
// カルテにある記録(注意区分・アレルギー・検査結果・処方)から拾って文で出し、共通の警告
// (docs/advisory-design.md)に写す。強く出すもの(重篤なアレルギー・eGFR 30 未満・注意区分)は
// 登録時に理由の確認を要する。

/** JJ1017 の種別(1 桁目)。 */
const MODALITY_ANGIOGRAPHY = "3";
const MODALITY_MRI = "7";
/** JJ1017 の手技小分類(4–5 桁目)の「造影」。 */
const PROCEDURE_MINOR_CONTRAST = "01";

/** eGFR(mL/分/1.73m²)の注意の閾値。下の値を下回ると強く出す。 */
export const EGFR_CAUTION = 45;
export const EGFR_HIGH = 30;

/** ビグアナイド系の薬効分類(YJ コードの上 4 桁)。ヨード造影剤の前後で休薬を判断する。 */
const BIGUANIDE_CLASS = "3962";

export interface RadSafetyItem {
  jj1017Code: string;
  modalityCode: string;
}

/** 造影を伴う撮影か。手技小分類が「造影」か、血管撮影(造影が前提)。 */
export function isContrastExam(item: RadSafetyItem): boolean {
  if (item.modalityCode === MODALITY_ANGIOGRAPHY) return true;
  return item.jj1017Code.slice(3, 5) === PROCEDURE_MINOR_CONTRAST;
}

export function isMriExam(item: RadSafetyItem): boolean {
  return item.modalityCode === MODALITY_MRI;
}

/**
 * 造影剤に当たる JFAGY のアレルゲンコード(銘柄 YCM・成分 GCM)。造影剤マスタの全件から作る。
 */
export function contrastAllergenCodes(medicines: Medicine[]): Set<string> {
  const codes = new Set<string>();
  for (const medicine of medicines) {
    if ((medicine.contrast_medium_category ?? "0").trim() !== "1") continue;
    const allergen = medicationAllergenCodes(medicine.yj_code);
    if (!allergen) continue;
    codes.add(allergen.brand);
    codes.add(allergen.generic);
  }
  return codes;
}

/**
 * 造影剤のアレルギー。JFAGY コードが造影剤に当たるものと、コードを持たず名前に
 * 「造影」を含むもの(自由記載で登録された副作用歴)を拾う。否定(refuted)は外す。
 */
export function matchContrastAllergies(
  allergies: fhir4.AllergyIntolerance[],
  contrastCodes: Set<string>,
): AllergyMatch[] {
  const matches: AllergyMatch[] = [];
  for (const allergy of allergies) {
    if (allergy.verificationStatus?.coding?.[0]?.code === "refuted") continue;
    const summary = summarizeAllergy(allergy);
    const byCode = summary.jfagyCode !== "" && contrastCodes.has(summary.jfagyCode);
    const byName = summary.jfagyCode === "" && summary.name.includes("造影");
    if (!byCode && !byName) continue;
    matches.push({
      allergyId: summary.id,
      kind: summary.jfagyCode.startsWith("GCM") ? "generic" : "brand",
      name: summary.name,
      criticalityLabel: summary.criticalityLabel,
      high: allergy.criticality === "high",
      reaction: summary.reaction,
    });
  }
  return matches;
}

export interface RadSafetyNote {
  key: string;
  kind: AdvisoryKind;
  text: string;
  /** 強く出す(重篤なアレルギー・eGFR 30 未満)。 */
  high: boolean;
}

/** 注意を共通の警告に写す。造影剤アレルギーの一致は重篤度に関係なく確認を要する。 */
export function radSafetyAdvisories(notes: RadSafetyNote[]): Advisory[] {
  return notes.map((note) => ({
    key: advisoryKey(note.kind, note.text),
    kind: note.kind,
    severity: severityOf(note.kind, note.kind === "contrast-allergy" || note.high),
    message: note.text,
  }));
}

export function buildRadSafetyNotes(args: {
  items: RadSafetyItem[];
  /** 有効な注意(Flag)を注意区分マスタで読んだもの。 */
  flags: FlagSummary[];
  contrastAllergies: AllergyMatch[];
  renal: RenalSummary;
  medications: ActiveMedication[];
}): RadSafetyNote[] {
  const notes: RadSafetyNote[] = [];
  const contrast = args.items.some(isContrastExam);
  const mri = args.items.some(isMriExam);

  const flagNote = (pictogram: string) =>
    args.flags
      .filter((flag) => flag.pictogram === pictogram)
      .map((flag) => [flag.name, flag.text].filter(Boolean).join(" "));

  if (contrast) {
    for (const [index, text] of flagNote("contrast").entries()) {
      notes.push({ key: `flag-contrast-${index}`, kind: "contrast-flag", text, high: true });
    }
    for (const match of args.contrastAllergies) {
      const reaction = match.reaction ? ` ${match.reaction}` : "";
      notes.push({
        key: `allergy-${match.allergyId}`,
        kind: "contrast-allergy",
        text: `造影剤アレルギー: ${allergyMatchLabel(match)}${reaction}`,
        high: match.high,
      });
    }
    const renalNote = egfrNote(args.renal);
    if (renalNote) notes.push(renalNote);
    const biguanides = args.medications.filter((m) => m.ingredient.startsWith(BIGUANIDE_CLASS));
    if (biguanides.length > 0) {
      notes.push({
        key: "biguanide",
        kind: "biguanide",
        text: `ビグアナイド系内服中: ${[...new Set(biguanides.map((m) => m.name))].join("、")}`,
        high: false,
      });
    }
  }

  if (mri) {
    for (const [index, text] of flagNote("implant").entries()) {
      notes.push({ key: `flag-implant-${index}`, kind: "implant", text, high: true });
    }
  }

  return notes;
}

/**
 * 腎機能の注意。閾値を下回るときと、算出できないとき(クレアチニンが無い・性別や
 * 生年月日が無い)に出す。算出できないことを黙って空欄にしない。
 */
function egfrNote(renal: RenalSummary): RadSafetyNote | null {
  if (!renal.creatinine) {
    return { key: "egfr", kind: "egfr", text: "eGFR: 血清クレアチニンの結果がありません", high: false };
  }
  if (renal.egfr === null) {
    return {
      key: "egfr",
      kind: "egfr",
      text: `eGFR: ${renal.egfrUnavailable || "算出できません"}`,
      high: false,
    };
  }
  if (renal.egfr >= EGFR_CAUTION) return null;
  return {
    key: "egfr",
    kind: "egfr",
    text: `eGFR ${renal.egfr}(${renal.creatinine.date} クレアチニン ${renal.creatinine.value}${renal.creatinine.unit})`,
    high: renal.egfr < EGFR_HIGH,
  };
}
