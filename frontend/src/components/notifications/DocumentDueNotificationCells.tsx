import type { DocumentDueRow } from "../../fhir/documentDueHelpers";

/**
 * 文書作成の督促の内容セル。どの文書がいつまでか。期限を過ぎていれば超過日数を
 * 赤で添える(期限超過は表示時に今日と比べて決める。Task の強度は変えない)。
 */
export function DocumentDueNotificationCells({ row }: { row: DocumentDueRow }) {
  return (
    <>
      <td className="notification__compact">{row.dischargeDate}</td>
      <td>
        <span className="notification__review-kind">{row.documentLabel}</span>
        未作成(期限 {row.dueDate || "-"})
        {row.overdueDays > 0 && (
          <span className="notification__overdue"> 期限超過 {row.overdueDays} 日</span>
        )}
      </td>
    </>
  );
}
