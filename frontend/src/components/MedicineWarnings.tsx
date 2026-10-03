import { useMemo } from "react";
import {
  useActiveAllergies,
  useActiveBroughtMedications,
  useActiveMedications,
  useBodyMeasures,
  usePatient,
  useRecentLabResults,
} from "../api/queries";
import {
  useDrugDoseRules,
  useDrugInteractions,
  useMedicineDoseFactors,
  useYakkaCodes,
} from "../api/masterQueries";
import { summarizeBodyMeasures, summarizeRenal } from "../fhir/bodyMeasureHelpers";
import { broughtActiveMedications, summarizeBroughtMedication } from "../fhir/broughtMedicationHelpers";
import {
  buildDrugCheckWarnings,
  type CheckedRp,
  type PatientFactors,
} from "../fhir/drugCheckHelpers";
import {
  buildMedicationWarnings,
  ingredientKey,
  medicineCautions,
  type MedicationWarning,
} from "../fhir/medicationSafetyHelpers";
import { calculateAge } from "../fhir/patientHelpers";
import type { Medicine } from "../api/masterClient";

// 薬剤オーダーの安全性チェックの表示(`docs/order-common-backlog.md` §3)。
// 処方・注射のフォームが同じ部品を使う。**登録は止めない**(判断は医師のもの)。
// 相互作用・用量と患者条件は施設マスタで照合する(docs/drug-check-master-design.md)。

/**
 * フォームの薬剤行に出す警告を全行ぶんまとめて出す。
 * 戻り値は `rps` と同じ形([RP][薬剤])なので、行を描くところで添字で引く。
 */
export function useMedicationWarnings(args: {
  patientId: string;
  /** 投与開始日。この日に効いている他のオーダーと突き合わせる。 */
  startDate: string;
  /** 行に `dose` を渡すと施設マスタの用量上限とも比べる。 */
  rps: CheckedRp[];
  /** 編集中のオーダー(自分自身との重複は出さない)。 */
  excludeOrderId?: string;
  /** 継続して処方に起こしている最中の持参薬。 */
  excludeBroughtIds?: string[];
}): MedicationWarning[][][] {
  const { patientId, startDate, excludeOrderId, excludeBroughtIds } = args;
  const { allergies } = useActiveAllergies(patientId);
  const { medications } = useActiveMedications(patientId, startDate);
  const { statements: broughtStatements } = useActiveBroughtMedications(patientId);
  const patient = usePatientFactors(patientId);

  // YJ コードを持たない薬(統一名収載品など)は薬価基準コードで成分を補う。医薬品検索で
  // 選んだ行は持っているが、保存済みのオーダーから起こした行(編集・DO)と持参薬は持たない。
  const { data: yakkaCodes } = useYakkaCodes([
    ...args.rps.flatMap((rp) =>
      rp.medicines.flatMap((m) => (needsYakkaLookup(m.medicine) ? [m.medicine!.medicine_code] : [])),
    ),
    ...broughtStatements.flatMap((statement) => {
      const medicine = summarizeBroughtMedication(statement).medicine;
      return needsYakkaLookup(medicine) ? [medicine!.medicine_code] : [];
    }),
  ]);
  const rps = useMemo(() => withYakkaCodes(args.rps, yakkaCodes), [args.rps, yakkaCodes]);

  // 施設マスタ(相互作用・用量規則)。患者が決まらない画面(オーダーセットの内容入力)では読まない。
  const enabled = Boolean(patientId);
  const { data: interactions } = useDrugInteractions("", enabled);
  const { data: doseRules } = useDrugDoseRules("", enabled);
  const { data: conversions } = useMedicineDoseFactors(
    enabled && (doseRules?.length ?? 0) > 0
      ? rps.flatMap((rp) =>
          rp.medicines.flatMap((m) => (m.medicine ? [m.medicine.medicine_code] : [])),
        )
      : [],
  );

  const active = useMemo(
    () => [...medications, ...broughtActiveMedications(broughtStatements, yakkaCodes)],
    [medications, broughtStatements, yakkaCodes],
  );

  return useMemo(() => {
    const base = buildMedicationWarnings({ rps, allergies, active, excludeOrderId, excludeBroughtIds });
    if (!enabled) return base;
    const checks = buildDrugCheckWarnings({
      rps,
      active,
      interactions: interactions ?? [],
      doseRules: doseRules ?? [],
      patient,
      conversions,
      excludeOrderId,
      excludeBroughtIds,
    });
    return base.map((rp, i) => rp.map((line, j) => [...line, ...(checks[i]?.[j] ?? [])]));
  }, [
    rps,
    allergies,
    active,
    excludeOrderId,
    excludeBroughtIds,
    enabled,
    interactions,
    doseRules,
    patient,
    conversions,
  ]);
}

/** 成分キーが取れず、医薬品マスタを引けば薬価基準コードが分かりうる薬か。 */
function needsYakkaLookup(medicine: Medicine | null | undefined): boolean {
  return Boolean(medicine?.medicine_code) && !medicine?.generic && !ingredientKey(medicine);
}

function withYakkaCodes(rps: CheckedRp[], yakkaCodes: Map<string, string> | undefined): CheckedRp[] {
  if (!yakkaCodes || yakkaCodes.size === 0) return rps;
  return rps.map((rp) => ({
    ...rp,
    medicines: rp.medicines.map((line) => {
      const yakka = line.medicine && needsYakkaLookup(line.medicine) ? yakkaCodes.get(line.medicine.medicine_code) : undefined;
      return yakka ? { ...line, medicine: { ...line.medicine!, yakka_code: yakka } } : line;
    }),
  }));
}

/** 用量規則の条件に使う患者の値(年齢・最新の体重・腎機能)。プロファイルの身体区画と同じ引き方。 */
function usePatientFactors(patientId: string): PatientFactors {
  const patient = usePatient(patientId || undefined).data?.data;
  const bodyMeasures = useBodyMeasures(patientId || undefined);
  const labResults = useRecentLabResults(patientId || undefined);

  return useMemo(() => {
    const age = patient?.birthDate ? calculateAge(patient.birthDate) : undefined;
    const weight = summarizeBodyMeasures(bodyMeasures.observations).weight;
    const renal = summarizeRenal(labResults.observations, {
      age,
      gender: patient?.gender,
      weight: weight?.value ?? null,
    });
    return {
      age: age ?? null,
      weight: weight ? { value: weight.value, date: weight.date } : null,
      egfr: renal.egfr,
      ccr: renal.ccr,
    };
  }, [patient, bodyMeasures.observations, labResults.observations]);
}

/** 医薬品名の後ろに出す印(麻薬・毒薬・向精神薬・生物由来製品・造影剤)。 */
export function MedicineCautionMarks({ medicine }: { medicine: Medicine | null }) {
  const cautions = medicineCautions(medicine);
  if (cautions.length === 0) return null;

  return (
    <>
      {cautions.map((c) => (
        <span
          key={c.kind}
          className={`medicine-caution${c.strong ? " medicine-caution--strong" : ""}`}
        >
          {c.label}
        </span>
      ))}
    </>
  );
}

/** 院内フォーミュラリの推奨順位の印(docs/formulary-design.md)。載っていない薬には何も出さない。 */
export function FormularyMark({ medicine }: { medicine: Pick<Medicine, "formulary_rank"> | null }) {
  if (!medicine?.formulary_rank) return null;
  return <span className="medicine-caution formulary-mark">第{medicine.formulary_rank}選択</span>;
}

/** 1 つの薬剤行に出すアレルギー・重複投与の警告。 */
export function MedicineWarnings({ warnings }: { warnings: MedicationWarning[] | undefined }) {
  if (!warnings || warnings.length === 0) return null;

  return (
    <>
      {warnings.map((w, i) => (
        <span
          key={i}
          className={`medicine-warning medicine-warning--${w.kind}${w.high ? " medicine-warning--high" : ""}`}
          title={w.detail}
          role="note"
        >
          {w.text}
        </span>
      ))}
    </>
  );
}
