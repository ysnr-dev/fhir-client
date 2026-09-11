import { useMemo } from "react";
import { useActiveAllergies, useActiveMedications } from "../api/queries";
import {
  buildMedicationWarnings,
  medicineCautions,
  type MedicationRp,
  type MedicationWarning,
} from "../fhir/medicationSafetyHelpers";
import type { Medicine } from "../api/masterClient";

// 薬剤オーダーの安全性チェックの表示(`docs/order-common-backlog.md` §3)。
// 処方・注射のフォームが同じ部品を使う。**登録は止めない**(判断は医師のもの)。

/**
 * フォームの薬剤行に出す警告を全行ぶんまとめて出す。
 * 戻り値は `rps` と同じ形([RP][薬剤])なので、行を描くところで添字で引く。
 */
export function useMedicationWarnings(args: {
  patientId: string;
  /** 投与開始日。この日に効いている他のオーダーと突き合わせる。 */
  startDate: string;
  rps: MedicationRp[];
  /** 編集中のオーダー(自分自身との重複は出さない)。 */
  excludeOrderId?: string;
}): MedicationWarning[][][] {
  const { patientId, startDate, rps, excludeOrderId } = args;
  const { allergies } = useActiveAllergies(patientId);
  const { medications } = useActiveMedications(patientId, startDate);

  return useMemo(
    () => buildMedicationWarnings({ rps, allergies, active: medications, excludeOrderId }),
    [rps, allergies, medications, excludeOrderId],
  );
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
