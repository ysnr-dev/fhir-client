import { useMemo } from "react";
import { useSelfDepartments, useVitalThresholds } from "../api/queries";
import type { ExtractRunContext } from "../fhir/extractTabRunners";

/** 記録タブの実行(fhir/extractTabRunners)に渡す参照データ。 */
export function useExtractRunContext(): ExtractRunContext {
  const { departments } = useSelfDepartments();
  const vitalThresholds = useVitalThresholds();
  return useMemo(() => ({ departments, vitalThresholds }), [departments, vitalThresholds]);
}
