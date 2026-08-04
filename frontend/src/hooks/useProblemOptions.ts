import { useMemo } from "react";
import { useKarteConditions } from "../api/queries";
import { problemRefOf, splitConditions, type ProblemRef } from "../fhir/conditionHelpers";

// 患者のプロブレム(POMR)を対象プロブレム選択の候補に整える。診療記録・処方の
// 入力フォームから使う。
export function useProblemOptions(patientId: string): ProblemRef[] {
  const { conditions } = useKarteConditions(patientId);
  return useMemo(() => splitConditions(conditions).problems.map(problemRefOf), [conditions]);
}
