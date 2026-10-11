import { useMemo } from "react";
import type { ExtractRecordDefinition } from "../fhir/extractRecordQuery";
import { stableJson } from "../fhir/extractRecordQuery";
import type { ExtractRunContext, ExtractTabRunner, RecordTable } from "../fhir/extractTabRunners";

/** 記録タブの結果を表にする(fhir/extractTabRunners)。結果か条件の中身が変わったときだけ組み直す。 */
export function useRecordTable<D extends ExtractRecordDefinition, C, R>(
  runner: ExtractTabRunner<D, C, R>,
  result: R | null,
  definition: D,
  context: ExtractRunContext,
): RecordTable | null {
  // 条件はレンダーのたびに組み直されるので、中身の文字列で比べる。
  const definitionKey = stableJson(definition);
  return useMemo(
    () => (result ? runner.table(result, definition, context) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runner, result, definitionKey, context],
  );
}
