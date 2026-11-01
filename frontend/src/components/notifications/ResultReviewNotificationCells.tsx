import { REVIEW_REPORT_KIND_LABEL, type ResultReviewRow } from "../../fhir/resultReviewHelpers";

/**
 * 検査結果確認の内容セル。何の検査か(種別)と、レポートの要約を出す。
 * 値そのものはカルテで読むので、ここには出さない。重要度・訂正などの印は要約の前に添える。
 */
export function ResultReviewNotificationCells({ row }: { row: ResultReviewRow }) {
  return (
    <>
      <td className="notification__compact">{row.date}</td>
      <td className="notification__content">
        <span className="notification__review-kind">{REVIEW_REPORT_KIND_LABEL[row.kind]}</span>
        {row.flags.map((flag) => (
          <span key={flag} className="micro-result__badge notification__review-flag">
            {flag}
          </span>
        ))}
        {row.summary}
      </td>
    </>
  );
}
