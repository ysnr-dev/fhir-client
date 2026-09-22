import type { RadiotherapyReviewDueRow } from "../../fhir/radiotherapyReviewHelpers";

/**
 * 放射線治療の診察の督促の内容セル。どのコースが何日空いているか。経過日数は表示時に
 * 数え直す(Task を作った日の値ではなく、いま何日空いているかを見せる)。
 */
export function RadiotherapyReviewDueNotificationCells({ row }: { row: RadiotherapyReviewDueRow }) {
  return (
    <>
      <td className="notification__compact">{row.lastReview || "-"}</td>
      <td>
        <span className="notification__review-kind">{row.courseLabel || "治療コース"}</span>
        {row.lastReview ? "診察から" : "診察の記録がありません"}
        {row.elapsed !== null && <span className="notification__overdue"> {row.elapsed} 日</span>}
      </td>
    </>
  );
}
