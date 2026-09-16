import type { RadCriticalFindingRow } from "../../fhir/radCriticalFindingHelpers";

/** 重要所見の内容セル。何の撮影かと、読影医が書いた要点を出す。 */
export function RadCriticalFindingNotificationCells({ row }: { row: RadCriticalFindingRow }) {
  return (
    <>
      <td className="notification__compact">{row.date}</td>
      <td>
        {row.exam && <span className="notification__review-kind">{row.exam}</span>}
        {row.point}
      </td>
    </>
  );
}
