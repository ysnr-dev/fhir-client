import type { Medicine } from "../api/masterClient";
import { doseUnitOptions, hasDoseUnitChoice, type DoseUnits } from "../fhir/doseConversionHelpers";

interface Props {
  medicine: Medicine | null;
  /** フォーム上の医薬品の選べる単位(`useMedicineDoseUnits`)。 */
  doseUnits: Map<string, DoseUnits> | undefined;
  /** 容量(mL)も選択肢に入れる(注射)。 */
  volume: boolean;
  onChange: (unit: string, doseUnits: DoseUnits) => void;
}

/**
 * 処方・注射の薬剤行の単位。換算マスタに力価(・容量)の行がある医薬品はセレクトにし、
 * 無ければ薬価算定単位を表示するだけにする。
 */
export function DoseUnitSelect({ medicine, doseUnits, volume, onChange }: Props) {
  const units = medicine ? doseUnits?.get(medicine.medicine_code) : undefined;
  if (!medicine || !units || !hasDoseUnitChoice(units, { volume })) return <>{medicine?.unit_name ?? "-"}</>;
  return (
    <select
      className="rp-card__unit-select"
      aria-label="単位"
      value={medicine.unit_name ?? ""}
      onChange={(e) => onChange(e.target.value, units)}
    >
      {doseUnitOptions(units, medicine.unit_name, { volume }).map((o) => (
        <option key={o.unit} value={o.unit}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
