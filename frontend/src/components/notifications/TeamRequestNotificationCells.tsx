import type { TeamRequestNotificationRow } from "../../fhir/teamRequestTaskHelpers";

/** チーム依頼の内容セル。希望日と依頼目的。 */
export function TeamRequestNotificationCells({ row }: { row: TeamRequestNotificationRow }) {
  return (
    <>
      <td className="notification__compact">{row.desiredDate}</td>
      <td className="notification__content">{row.purpose || "-"}</td>
    </>
  );
}
