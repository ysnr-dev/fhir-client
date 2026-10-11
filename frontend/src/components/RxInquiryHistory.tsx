import { useOrderInquiryTasks } from "../api/queries";
import { rxInquiryTimeLabel, type RxInquirySummary } from "../fhir/rxInquiryHelpers";

/**
 * 疑義照会の履歴(照会と回答)。薬剤部の画面(表示・調剤登録・払出登録)とカルテの詳細で共用する。
 * legacyNotes は照会の仕組みを入れる前に調剤登録で書いた記録(進捗 Task の note)。
 */
export function RxInquiryHistory({
  inquiries,
  legacyNotes = [],
}: {
  inquiries: RxInquirySummary[];
  legacyNotes?: string[];
}) {
  if (inquiries.length === 0 && legacyNotes.length === 0) return null;

  return (
    <div className="rx-inquiry">
      {inquiries.map((inquiry) => (
        <div className="rx-inquiry__item" key={inquiry.id}>
          <p className="rx-inquiry__head">
            <span className={`rx-inquiry__state rx-inquiry__state--${inquiry.state}`}>
              {inquiry.state === "open" ? "未回答" : inquiry.state === "withdrawn" ? "取下げ" : "回答済"}
            </span>
            {`照会 ${rxInquiryTimeLabel(inquiry.askedAt)}`}
            {inquiry.askedBy && ` ${inquiry.askedBy}`}
            {inquiry.ownerName && ` → ${inquiry.ownerName}`}
          </p>
          <p className="rx-inquiry__text">{inquiry.question}</p>
          {inquiry.state === "answered" && (
            <>
              <p className="rx-inquiry__head">
                {`回答 ${rxInquiryTimeLabel(inquiry.answeredAt)}`}
                {inquiry.answeredBy && ` ${inquiry.answeredBy}`}
              </p>
              <p className="rx-inquiry__text">
                <span className="rx-inquiry__answer">{inquiry.answerLabel}</span>
                {inquiry.answerText}
              </p>
            </>
          )}
        </div>
      ))}
      {legacyNotes.map((note, index) => (
        <p className="rx-inquiry__text" key={`legacy-${index}`}>
          {note}
        </p>
      ))}
    </div>
  );
}

/**
 * オーダーの疑義照会を引いて出す(薬剤部の「表示」・調剤登録・払出登録)。照会も古い記録も
 * 無ければ何も出さない。
 */
export function OrderRxInquiryNotes({
  orderId,
  legacyNotes = [],
}: {
  orderId: string | undefined;
  legacyNotes?: string[];
}) {
  const { inquiries } = useOrderInquiryTasks(orderId);
  if (inquiries.length === 0 && legacyNotes.length === 0) return null;
  return (
    <div className="rx-dispense__notes">
      <p className="rx-dispense__notes-label">疑義照会</p>
      <RxInquiryHistory inquiries={inquiries} legacyNotes={legacyNotes} />
    </div>
  );
}
