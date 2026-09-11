import { REVIEW_REPORT_KIND_LABEL, type ResultReviewRow } from "../../fhir/resultReviewHelpers";

/**
 * 検査結果確認の内容セル。何の検査か(種別)と、レポートの要約を出す。
 * 値そのものはカルテで読むので、ここには出さない。
 */
export function ResultReviewNotificationCells({ row }: { row: ResultReviewRow }) {
  return (
    <>
      <td className="notification__compact">{row.date}</td>
      <td>
        <span className="notification__review-kind">{REVIEW_REPORT_KIND_LABEL[row.kind]}</span>
        {row.summary}
      </td>
    </>
  );
}
