import { RECORD_DISPLAY_LIMIT } from "../../fhir/extractQueryHelpers";
import type { ExtractTabRunner, RecordTable } from "../../fhir/extractTabRunners";
import { TruncatedNotice } from "../TruncatedNotice";

/** 記録タブの結果の注記(読み切れなかった・表を出せない・先頭だけを表示)。 */
export function RecordResultNotices({
  runner,
  truncated,
  table,
}: {
  runner: Pick<ExtractTabRunner<never, never, never>, "truncatedMessage" | "incompleteMessage">;
  truncated: boolean | undefined;
  table: RecordTable;
}) {
  return (
    <>
      <TruncatedNotice show={Boolean(runner.truncatedMessage) && truncated && !table.incomplete}>
        {runner.truncatedMessage}
      </TruncatedNotice>
      <TruncatedNotice show={table.incomplete}>{runner.incompleteMessage}</TruncatedNotice>
      <TruncatedNotice show={table.rows.length > RECORD_DISPLAY_LIMIT}>
        {`先頭の ${RECORD_DISPLAY_LIMIT} ${table.unit}を表示しています。すべては CSV に出ます。`}
      </TruncatedNotice>
    </>
  );
}
