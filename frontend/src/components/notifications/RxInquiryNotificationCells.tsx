import type { RxInquiryAnsweredRow, RxInquiryRow } from "../../fhir/rxInquiryHelpers";

/** 疑義照会の内容セル。どのオーダーに何を問われたかと、照会した薬剤師。 */
export function RxInquiryNotificationCells({ row }: { row: RxInquiryRow }) {
  return (
    <>
      <td className="notification__compact">{row.authoredOn.slice(0, 10)}</td>
      <td className="notification__content">
        <span className="notification__review-kind">{row.orderLabel}</span>
        {row.question}
        {row.requesterName && ` (${row.requesterName})`}
      </td>
    </>
  );
}

/** 疑義照会の回答の内容セル。回答区分と回答文、回答した処方医。 */
export function RxInquiryAnsweredNotificationCells({ row }: { row: RxInquiryAnsweredRow }) {
  return (
    <>
      <td className="notification__compact">{row.authoredOn.slice(0, 10)}</td>
      <td className="notification__content">
        <span className="notification__review-kind">{row.orderLabel}</span>
        <span className="rx-inquiry__answer">{row.answerLabel}</span>
        {row.answerText}
        {row.requesterName && ` (${row.requesterName})`}
      </td>
    </>
  );
}
