import { useLabInfectionResults, useManualInfections } from "../api/queries";
import { HAS_LAB_MAPPED_TYPES, summarizeInfections } from "../fhir/infectionHelpers";

/**
 * 陽性の感染症。放射線・生理・内視鏡のオーダー画面に出す(検査室の清掃順・
 * 感染対策の判断に要る)。患者帯のピクトグラムと同じ集計(手入力 + 検査結果)。
 *
 * 陽性が無ければ何も出さない(PregnancyNotice と同じ方針)。
 */
export function InfectionNotice({ patientId }: { patientId: string }) {
  const manual = useManualInfections(patientId);
  const lab = useLabInfectionResults(patientId, HAS_LAB_MAPPED_TYPES);
  const positives = summarizeInfections(manual.observations, lab.observations).filter(
    (row) => row.result === "positive",
  );

  if (positives.length === 0) return null;

  return (
    <p className="pregnancy-notice" role="note">
      感染症:{" "}
      {positives
        .map((row) => `${row.typeLabel} 陽性${row.effectiveDate ? `（${row.effectiveDate}）` : ""}`)
        .join(" / ")}
    </p>
  );
}
