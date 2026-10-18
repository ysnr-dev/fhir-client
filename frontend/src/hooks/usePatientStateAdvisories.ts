import { useMemo } from "react";
import { useLabInfectionResults, useManualInfections, usePregnancy } from "../api/queries";
import type { Advisory } from "../fhir/advisoryHelpers";
import { HAS_LAB_MAPPED_TYPES, infectionAdvisory, summarizeInfections } from "../fhir/infectionHelpers";
import { pregnancyAdvisory, summarizePregnancy } from "../fhir/pregnancyHelpers";

// 患者の状態から出す警告(docs/advisory-design.md §2.2)。該当が無ければ空。
// 患者が決まらない画面(オーダーセットの内容入力)では patientId を空で呼ぶ。

/** 妊娠中・授乳中。処方・注射・放射線のフォームに出す。 */
export function usePregnancyAdvisory(patientId: string): Advisory[] {
  const { observations } = usePregnancy(patientId || undefined);
  return useMemo(() => {
    const advisory = patientId ? pregnancyAdvisory(summarizePregnancy(observations)) : null;
    return advisory ? [advisory] : [];
  }, [patientId, observations]);
}

/** 陽性の感染症。放射線・生理・内視鏡のフォームに出す(患者帯のピクトグラムと同じ集計)。 */
export function useInfectionAdvisory(patientId: string): Advisory[] {
  const manual = useManualInfections(patientId || undefined);
  const lab = useLabInfectionResults(patientId || undefined, HAS_LAB_MAPPED_TYPES);
  return useMemo(() => {
    const advisory = patientId ? infectionAdvisory(summarizeInfections(manual.observations, lab.observations)) : null;
    return advisory ? [advisory] : [];
  }, [patientId, manual.observations, lab.observations]);
}
