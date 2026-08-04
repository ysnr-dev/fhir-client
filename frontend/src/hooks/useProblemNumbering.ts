import { useKarteConditions } from "../api/queries";
import {
  nextProblemNumber,
  problemNumberOf,
  splitConditions,
  type ConditionFormValues,
} from "../fhir/conditionHelpers";

// プロブレム区分で保存するときに付けるプロブレム番号(#1, #2...)を決める。
// 既にプロブレムだったものは番号を引き継ぎ、新規登録と保険病名からの変更だけ
// 「既存プロブレムの最大値 +1」で採番する(欠番は再利用しない)。
export function useProblemNumbering(patientId: string | undefined) {
  const { conditions } = useKarteConditions(patientId);

  return function problemNumberFor(
    values: ConditionFormValues,
    existing?: fhir4.Condition,
  ): number | undefined {
    if (values.category !== "problem") return undefined;
    return (
      (existing && problemNumberOf(existing)) ??
      nextProblemNumber(splitConditions(conditions).problems)
    );
  };
}
