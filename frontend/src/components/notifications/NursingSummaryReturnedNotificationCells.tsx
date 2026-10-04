import type { NursingSummaryReturnedRow } from "../../fhir/nursingSummaryTaskHelpers";

/** 看護サマリの差戻しの内容セル。どのサマリを誰が差し戻したかと理由。 */
export function NursingSummaryReturnedNotificationCells({ row }: { row: NursingSummaryReturnedRow }) {
  return (
    <>
      <td className="notification__compact">{row.authoredOn.slice(0, 10)}</td>
      <td>
        <span className="notification__review-kind">{row.summaryLabel}</span>
        {row.reason}
        {row.requesterName && ` (${row.requesterName})`}
      </td>
    </>
  );
}
