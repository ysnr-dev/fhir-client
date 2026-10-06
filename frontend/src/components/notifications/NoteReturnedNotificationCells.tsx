import type { NoteReturnedRow } from "../../fhir/countersignHelpers";

/** 診療記録の差戻しの内容セル。どの記録を誰が差し戻したかと理由。 */
export function NoteReturnedNotificationCells({ row }: { row: NoteReturnedRow }) {
  return (
    <>
      <td className="notification__compact">{row.authoredOn.slice(0, 10)}</td>
      <td>
        <span className="notification__review-kind">{row.noteLabel}</span>
        {row.reason}
        {row.requesterName && ` (${row.requesterName})`}
      </td>
    </>
  );
}
