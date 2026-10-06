import type { NoteCountersignRow } from "../../fhir/countersignHelpers";

/** 研修医の診療記録のカウンターサインの内容セル。どの記録を誰が書いたか。 */
export function NoteCountersignNotificationCells({ row }: { row: NoteCountersignRow }) {
  return (
    <>
      <td className="notification__compact">{row.authoredOn.slice(0, 10)}</td>
      <td>
        <span className="notification__review-kind">{row.noteLabel}</span>
        {row.traineeName && <span className="order-select__muted">{`研修医: ${row.traineeName}`}</span>}
      </td>
    </>
  );
}
