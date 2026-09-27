import type { ExamCriticalFindingRow } from "../../fhir/examCriticalFindingHelpers";

/** 重要所見の内容セル。何の検査かと、記載医が書いた要点を出す。 */
export function ExamCriticalFindingNotificationCells({ row }: { row: ExamCriticalFindingRow }) {
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
