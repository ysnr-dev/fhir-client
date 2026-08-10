import { useMemo } from "react";
import { useKarteConditions } from "../api/queries";
import { summarizeCondition, type ProblemRef } from "../fhir/conditionHelpers";

// 患者に登録済みの病名を、依頼病名の選択候補に整える。
// 対象プロブレム(useProblemOptions)と違い、プロブレムとレセプト病名の両方を出し、
// 表示も「#1」を付けない病名そのもの。依頼先(放射線科)が読むのは病名だからで、
// 選んだ値はそのまま依頼病名の文字列になる。
export function useConditionOptions(patientId: string): ProblemRef[] {
  const { conditions } = useKarteConditions(patientId);

  return useMemo(
    () =>
      conditions
        .map((condition) => ({
          conditionId: condition.id ?? "",
          display: summarizeCondition(condition).name,
        }))
        .filter((option) => option.conditionId && option.display),
    [conditions],
  );
}
