import { localDay, today } from "../lib/dates";
import { type Advisory, advisoryKey, severityOf } from "./advisoryHelpers";
import type { BloodTypeSummary } from "./bloodTypeHelpers";
import { cautionCoding } from "./flagHelpers";
import {
  bloodTypeLabel,
  isDifferentFromPatient,
  type TransfusionProductValues,
} from "./transfusionOrderHelpers";

// 輸血オーダーのフォームに出す警告(docs/advisory-design.md の器に載せる)。
// JAHIS 患者安全ガイド(輸血編)7.2 の「依頼時のチェック」に当たる。
//  - 輸血拒否の注意区分(患者帯のピクトグラムと同じ Flag)
//  - 血液型が 2 回の検査で確定していない(1 回だけ・結果の食い違い・未検査)
//  - 不規則抗体スクリーニングが未検査か、有効日数を過ぎている
//  - 製剤の型が患者の型と違う(異型適合血。意図した選択なので表示のみ)
//  - 過去の輸血で副作用があった

/** 施設設定 transfusion。 */
export interface TransfusionSettings {
  /** 不規則抗体スクリーニングの有効日数(投与予定日を含む)。 */
  antibody_screen_valid_days: number;
}

export const DEFAULT_TRANSFUSION_SETTINGS: TransfusionSettings = { antibody_screen_valid_days: 3 };

/** 注意区分マスタの「輸血拒否」のコード(db/seed_data/patient_cautions.csv)。 */
const NO_TRANSFUSION_CAUTION_CODE = "no-transfusion";

export function transfusionRefusalAdvisory(flags: fhir4.Flag[]): Advisory | null {
  const flag = flags.find((f) => cautionCoding(f)?.code === NO_TRANSFUSION_CAUTION_CODE);
  if (!flag) return null;
  const note = flag.code?.text && flag.code.text !== "輸血拒否" ? `（${flag.code.text}）` : "";
  return {
    key: advisoryKey("transfusion-refusal", flag.id),
    kind: "transfusion-refusal",
    severity: severityOf("transfusion-refusal", true),
    message: `輸血拒否の注意区分があります${note}`,
  };
}

/** 血液型が確定していない。検査結果が無い・1 回だけ・食い違いのどれかを文言で分ける。 */
export function bloodTypeUnconfirmedAdvisory(summary: BloodTypeSummary | null): Advisory | null {
  const status = summary?.labStatus ?? "none";
  if (status === "confirmed") return null;
  const message =
    status === "conflict"
      ? "血液型の検査結果が一致しません"
      : status === "single"
        ? "血液型検査が 1 回だけです（2 回の検査で確定が必要）"
        : "血液型が検査で確定していません";
  return {
    key: advisoryKey("blood-type-unconfirmed", status),
    kind: "blood-type-unconfirmed",
    severity: severityOf("blood-type-unconfirmed", true),
    message,
  };
}

/** 日付文字列 "YYYY-MM-DD" を日数に直す(差の計算用)。 */
function dayNumber(date: string): number {
  return Math.floor(new Date(`${date}T00:00:00`).getTime() / 86_400_000);
}

/**
 * 不規則抗体スクリーニングが投与予定日を含む有効日数の中にあるか。
 * 投与予定日が未定なら今日で判定する。
 */
export function antibodyScreenAdvisory(
  summary: BloodTypeSummary | null,
  scheduledDate: string,
  settings: TransfusionSettings,
): Advisory | null {
  const screen = summary?.antibodyScreen ?? null;
  if (!screen) {
    return {
      key: advisoryKey("antibody-screen", "missing"),
      kind: "antibody-screen",
      severity: severityOf("antibody-screen", true),
      message: "不規則抗体スクリーニングが未検査です",
    };
  }
  const validDays = Math.max(1, settings.antibody_screen_valid_days);
  const target = localDay(scheduledDate) || today();
  const elapsed = dayNumber(target) - dayNumber(screen.date);
  if (elapsed < validDays && elapsed >= 0) return null;
  const when = elapsed < 0 ? "投与予定日より後" : `${validDays} 日以内が必要`;
  return {
    key: advisoryKey("antibody-screen", "expired", screen.date, target),
    kind: "antibody-screen",
    severity: severityOf("antibody-screen", true),
    message: `不規則抗体スクリーニングが有効期間外です（${screen.date}、${when}）`,
  };
}

/** 製剤の型が患者の型と違う。異型適合血は意図した選択なので表示だけ。 */
export function differentBloodTypeAdvisories(
  products: TransfusionProductValues[],
  patient: { abo: string; rhd: string },
): Advisory[] {
  return products
    .filter((product) => product.productCode && isDifferentFromPatient(product, patient))
    .map((product) => ({
      key: advisoryKey("blood-type-different", product.productCode, product.abo, product.rhd),
      kind: "blood-type-different" as const,
      severity: severityOf("blood-type-different", false),
      message: `${product.abbreviation || product.productName} を患者の型（${bloodTypeLabel(
        patient.abo,
        patient.rhd,
      )}）と違う ${bloodTypeLabel(product.abo, product.rhd)} で出します`,
    }));
}

/** 過去の輸血で副作用があった記録。 */
export interface TransfusionReactionHistory {
  date: string;
  note: string;
}

export function reactionHistoryAdvisory(history: TransfusionReactionHistory[]): Advisory | null {
  if (history.length === 0) return null;
  const items = history.map((h) => [h.date, h.note].filter(Boolean).join(" ")).join("、");
  return {
    key: advisoryKey("transfusion-reaction-history", history.map((h) => h.date).join(",")),
    kind: "transfusion-reaction-history",
    severity: severityOf("transfusion-reaction-history", false),
    message: `輸血副作用歴があります（${items}）`,
  };
}
