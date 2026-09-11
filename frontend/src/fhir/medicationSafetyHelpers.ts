import type { Medicine } from "../api/masterClient";
import { allergyMatchLabel, matchMedicationAllergies } from "./allergyHelpers";

// 薬剤オーダーの安全性チェック(`docs/order-common-backlog.md` §3)。
//
// 処方・注射・レジメンのどのフォームからも同じ関数を呼べるよう、FHIR にも React にも
// 依存しない素のデータだけで組み立てる。判断は医師のものなので**登録は止めない**
// (妊娠中の注意 `PregnancyNotice` と同じ扱い)。出すのは 3 種類:
//
//   印(caution)    … 医薬品マスタの規制区分・製品区分。麻薬・毒薬など、選んだ薬そのものの性質
//   アレルギー      … 患者の AllergyIntolerance との照合(`allergyHelpers.matchMedicationAllergies`)
//   重複投与        … 同じ成分がフォーム内の別の行、または投与中の他のオーダーにある

/** YJ コードの成分部(薬効分類 4 桁 + 成分 3 桁)の長さ。 */
const INGREDIENT_LENGTH = 7;

/**
 * 同一成分の判定に使うキー。YJ コード `1149019F1560` の上 7 桁 `1149019` が
 * 薬効分類 + 成分で、規格(8〜9 桁目)と銘柄(10〜12 桁目)の違いを吸収する。
 * 例: カロナール錠 200 と 500、ロキソニン錠とロキソプロフェン Na 錠「YD」は同じキー。
 *
 * 一般名処方は YJ コードを持たないが、一般名処方コードが同じ体系(末尾 3 桁が ZZZ)
 * なので同じ桁を使える。
 *
 * **限界**: 上 4 桁が薬効分類なので、同じ成分でも効能が違えば別のキーになる。
 * 例: アスピリン(解熱鎮痛 1143001)とバイアスピリン(抗血小板 3399007)は重複と出ない。
 * 成分そのもので突き合わせるには別の成分マスタが要る(アレルギー照合も同じ制約)。
 */
export function ingredientKey(
  // 保存済みのオーダーから起こした表示用の行(`MedicineLineDisplay`)も渡せるよう、
  // マスタの `Medicine` そのものではなく必要な 3 項目だけを受ける。
  medicine: { yj_code?: string | null; medicine_code?: string | null; generic?: boolean } | null | undefined,
): string | null {
  if (!medicine) return null;
  const code = medicine.yj_code || (medicine.generic ? medicine.medicine_code : "");
  const trimmed = (code ?? "").trim();
  return trimmed.length >= INGREDIENT_LENGTH ? trimmed.slice(0, INGREDIENT_LENGTH) : null;
}

export type MedicineCautionKind =
  | "narcotic"
  | "poison"
  | "stimulant"
  | "psychotropic"
  | "biological"
  | "contrast";

export interface MedicineCaution {
  kind: MedicineCautionKind;
  label: string;
  /** 取り扱いが法令で縛られるもの(麻薬・毒薬・覚醒剤原料)。強く出す。 */
  strong: boolean;
}

// 医薬品マスタ(薬価基準収載医薬品マスター)の「麻薬・毒薬・向精神薬・覚醒剤原料」区分。
// 開発 DB の実データで値を確かめてある(1: MS コンチン等、2: 抗がん剤等、
// 3: セレギリン・エフェドリン、5: ベンゾジアゼピン系)。4 は収載が無いので扱わない。
const NARCOTIC_LABELS: Record<string, { label: string; strong: boolean }> = {
  "1": { label: "麻薬", strong: true },
  "2": { label: "毒薬", strong: true },
  "3": { label: "覚醒剤原料", strong: true },
  "5": { label: "向精神薬", strong: false },
};

const NARCOTIC_KINDS: Record<string, MedicineCautionKind> = {
  "1": "narcotic",
  "2": "poison",
  "3": "stimulant",
  "5": "psychotropic",
};

const CONTRAST_LABELS: Record<string, string> = {
  "1": "造影剤",
  "2": "造影補助剤",
};

/** 医薬品 1 件に付ける印。該当が無ければ空。 */
export function medicineCautions(medicine: Medicine | null | undefined): MedicineCaution[] {
  if (!medicine) return [];
  const cautions: MedicineCaution[] = [];

  const narcotic = NARCOTIC_LABELS[(medicine.narcotic_category ?? "").trim()];
  if (narcotic) {
    cautions.push({
      kind: NARCOTIC_KINDS[(medicine.narcotic_category ?? "").trim()],
      label: narcotic.label,
      strong: narcotic.strong,
    });
  }
  if ((medicine.biological_product_flag ?? "").trim() === "1") {
    cautions.push({ kind: "biological", label: "生物由来製品", strong: false });
  }
  const contrast = CONTRAST_LABELS[(medicine.contrast_medium_category ?? "").trim()];
  if (contrast) {
    cautions.push({ kind: "contrast", label: contrast, strong: false });
  }
  return cautions;
}

/** 重複投与の相手。投与中の他のオーダーの薬剤 1 件。 */
export interface ActiveMedication {
  /** 元のオーダー(ServiceRequest)の id。編集中のオーダー自身を外すのに使う。 */
  orderId: string;
  name: string;
  ingredient: string;
  /** 投与終了日。日数を持たない RP(頓用・外用)では開始日。 */
  endDate: string;
}

export type MedicationWarningKind = "allergy" | "duplicate";

export interface MedicationWarning {
  kind: MedicationWarningKind;
  text: string;
  /** 重篤度が高いアレルギー。赤く出す。 */
  high: boolean;
  /** 補足(アレルギーの症状など)。title 属性に出す。 */
  detail?: string;
}

export interface MedicationLine {
  medicine: Medicine | null;
}

export interface MedicationRp {
  medicines: MedicationLine[];
}

/**
 * フォームの全薬剤行ぶんの警告を、`rps` と同じ形([RP][薬剤])で返す。
 *
 * 薬剤を選んでいない行は空配列。YJ コードを持たない薬剤(HOT コードマスタに無いもの)は
 * アレルギーも重複も照合できず**黙って通る**ので、薬剤マスタの取り込み範囲が穴になる。
 */
export function buildMedicationWarnings(args: {
  rps: MedicationRp[];
  allergies: fhir4.AllergyIntolerance[];
  /** 投与中の他のオーダーの薬剤。重複投与の判定に使う。 */
  active: ActiveMedication[];
  /** 編集中のオーダー(自分自身との重複は出さない)。 */
  excludeOrderId?: string;
}): MedicationWarning[][][] {
  const { rps, allergies, active, excludeOrderId } = args;

  // フォーム内の同一成分。1 つの成分がどの RP の何行目に出るかを先に集める。
  const positions = new Map<string, { rpIndex: number; medIndex: number }[]>();
  rps.forEach((rp, rpIndex) => {
    rp.medicines.forEach((line, medIndex) => {
      const key = ingredientKey(line.medicine);
      if (!key) return;
      positions.set(key, [...(positions.get(key) ?? []), { rpIndex, medIndex }]);
    });
  });

  return rps.map((rp, rpIndex) =>
    rp.medicines.map((line, medIndex) => {
      const warnings: MedicationWarning[] = [];
      if (!line.medicine) return warnings;

      for (const match of matchMedicationAllergies(line.medicine.yj_code, allergies)) {
        warnings.push({
          kind: "allergy",
          text: `アレルギー: ${allergyMatchLabel(match)}`,
          high: match.high,
          detail: match.reaction || undefined,
        });
      }

      const key = ingredientKey(line.medicine);
      if (!key) return warnings;

      const others = (positions.get(key) ?? []).filter(
        (p) => p.rpIndex !== rpIndex || p.medIndex !== medIndex,
      );
      if (others.length > 0) {
        // 同じ RP の中か、別の RP かで言い方を変える(どこを直せばよいかが分かるように)。
        const otherRps = [...new Set(others.map((p) => p.rpIndex))].filter((i) => i !== rpIndex);
        const text =
          otherRps.length > 0
            ? `同一成分が ${otherRps.map((i) => `RP${i + 1}`).join("・")} にもあります`
            : "同一成分がこの RP の別の行にもあります";
        warnings.push({ kind: "duplicate", text, high: false });
      }

      const ongoing = active.filter((a) => a.ingredient === key && a.orderId !== excludeOrderId);
      for (const a of ongoing) {
        warnings.push({
          kind: "duplicate",
          text: `同一成分を投与中: ${a.name}（${a.endDate} まで）`,
          high: false,
        });
      }

      return warnings;
    }),
  );
}
