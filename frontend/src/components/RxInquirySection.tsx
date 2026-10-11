import { useState } from "react";
import { useOrderEnterer, useOrderInquiryTasks, useWriteRxInquiry } from "../api/queries";
import {
  RX_INQUIRY_ANSWER_OPTIONS,
  buildRxInquiryAnswerBundle,
  progressBuilderOf,
  progressOf,
  rxInquiryTimeLabel,
  type RxInquiryAnswer,
  type RxInquiryOrderKind,
  type RxInquirySummary,
} from "../fhir/rxInquiryHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { RxInquiryHistory } from "./RxInquiryHistory";

/**
 * カルテの詳細(処方・注射)に出す疑義照会。照会の履歴と、宛先の処方医本人に「回答」。
 * 照会が無いオーダーでは何も出さない。
 */
export function RxInquirySection({
  kind,
  order,
  onEditOrder,
}: {
  kind: RxInquiryOrderKind;
  order: fhir4.ServiceRequest;
  /** 「処方を変更する」と回答した後に、そのオーダーの編集を開く。 */
  onEditOrder?: () => void;
}) {
  const orderTasks = useOrderInquiryTasks(order.id);
  const enterer = useOrderEnterer();
  const [answering, setAnswering] = useState<RxInquirySummary | null>(null);

  if (orderTasks.inquiries.length === 0) return null;
  const open = orderTasks.openInquiry;
  const canAnswer =
    open && enterer && open.task.owner?.reference === `Practitioner/${enterer.practitionerId}`;

  // 詳細パネルの区画(処方共通・RP)と同じ枠で見せる。
  return (
    <div className="prescription-detail rx-inquiry-section">
      <fieldset>
        <legend>疑義照会</legend>
        <ErrorBanner error={orderTasks.error} />
        <RxInquiryHistory inquiries={orderTasks.inquiries} />
        {canAnswer && (
          <div className="rx-inquiry-form__actions">
            <button type="button" onClick={() => setAnswering(open)}>
              回答
            </button>
          </div>
        )}
        {answering && enterer && (
          <RxInquiryAnswerModal
            kind={kind}
            order={order}
            inquiry={answering}
            progress={progressOf(kind, orderTasks.tasks)}
            doctor={{ practitionerId: enterer.practitionerId, display: enterer.display }}
            onAnswered={(answer) => {
              setAnswering(null);
              if (answer === "order-change") onEditOrder?.();
            }}
            onClose={() => setAnswering(null)}
          />
        )}
      </fieldset>
    </div>
  );
}

function RxInquiryAnswerModal({
  kind,
  order,
  inquiry,
  progress,
  doctor,
  onAnswered,
  onClose,
}: {
  kind: RxInquiryOrderKind;
  order: fhir4.ServiceRequest;
  inquiry: RxInquirySummary;
  progress: fhir4.Task | undefined;
  doctor: { practitionerId: string; display: string };
  onAnswered: (answer: RxInquiryAnswer) => void;
  onClose: () => void;
}) {
  const [answer, setAnswer] = useState<RxInquiryAnswer | "">("");
  const [text, setText] = useState("");
  const write = useWriteRxInquiry();

  function handleAnswer() {
    if (!answer) return;
    write.mutate(
      buildRxInquiryAnswerBundle({
        inquiry: inquiry.task,
        order,
        progress,
        buildProgress: progressBuilderOf(kind),
        answer,
        text: text.trim(),
        doctor,
      }),
      { onSuccess: () => onAnswered(answer) },
    );
  }

  return (
    <Modal title="疑義照会の回答" onClose={onClose}>
      <div className="rx-inquiry-form">
        <ErrorBanner error={write.error} />
        <dl className="prescription-detail__common">
          <dt>照会</dt>
          <dd>{`${rxInquiryTimeLabel(inquiry.askedAt)} ${inquiry.askedBy}`}</dd>
          <dt>照会内容</dt>
          <dd className="rx-inquiry__text">{inquiry.question}</dd>
        </dl>
        <div className="rx-inquiry-form__choices" role="radiogroup" aria-label="回答区分">
          {RX_INQUIRY_ANSWER_OPTIONS.map((option) => (
            <label key={option.code} className="rx-inquiry-form__choice">
              <input
                type="radio"
                name="rx-inquiry-answer"
                checked={answer === option.code}
                onChange={() => setAnswer(option.code)}
              />
              {option.display}
            </label>
          ))}
        </div>
        <label>
          回答
          <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <div className="rx-inquiry-form__actions">
          <button type="button" onClick={handleAnswer} disabled={!answer || write.isPending}>
            回答
          </button>
          <button type="button" onClick={onClose}>
            キャンセル
          </button>
        </div>
      </div>
    </Modal>
  );
}
