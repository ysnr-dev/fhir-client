import { useState } from "react";
import { useOrderEnterer, useOrderInquiryTasks, useWriteRxInquiry } from "../api/queries";
import {
  buildRxInquiryBundle,
  buildRxInquiryWithdrawBundle,
  progressBuilderOf,
  progressOf,
  rxInquiryOwnerOf,
  type RxInquiryOrderKind,
} from "../fhir/rxInquiryHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { RxInquiryHistory } from "./RxInquiryHistory";

/**
 * 薬剤部から処方医への疑義照会(処方一覧・注射一覧から開く)。送ると処方医に通知が届き、
 * 回答があるまで調剤登録・払出登録は止まる。回答待ちの照会があるときは、新しい照会の代わりに
 * 取下げを出す(1 オーダーに同時に出せる照会は 1 件)。
 */
export function RxInquiryModal({
  kind,
  order,
  orderLabel,
  onClose,
}: {
  kind: RxInquiryOrderKind;
  order: fhir4.ServiceRequest;
  /** 通知の一覧に出すオーダーの要約(「処方 2026-10-11 アムロジピン錠5mg 他1剤」など)。 */
  orderLabel: string;
  onClose: () => void;
}) {
  const [question, setQuestion] = useState("");
  const enterer = useOrderEnterer();
  // 進捗は一覧の行より新しい版を書き換える(照会の間に進捗が動いていれば 412 で止める)。
  const orderTasks = useOrderInquiryTasks(order.id);
  const write = useWriteRxInquiry();
  const owner = rxInquiryOwnerOf(order);

  function handleSend() {
    if (!enterer || !owner || !question.trim()) return;
    write.mutate(
      buildRxInquiryBundle({
        kind,
        order,
        progress: progressOf(kind, orderTasks.tasks),
        buildProgress: progressBuilderOf(kind),
        question: question.trim(),
        orderLabel,
        pharmacist: { practitionerId: enterer.practitionerId, display: enterer.display },
      }),
      { onSuccess: onClose },
    );
  }

  function handleWithdraw() {
    if (!open) return;
    write.mutate(
      buildRxInquiryWithdrawBundle({
        inquiry: open.task,
        order,
        progress: progressOf(kind, orderTasks.tasks),
        buildProgress: progressBuilderOf(kind),
      }),
      { onSuccess: onClose },
    );
  }

  const open = orderTasks.openInquiry;
  const blocked = !enterer
    ? "医療従事者として登録されたアカウントでログインしてください。"
    : !owner
      ? "依頼医師の無いオーダーには照会できません。"
      : "";

  return (
    <Modal title="疑義照会" onClose={onClose}>
      <div className="rx-inquiry-form">
        <ErrorBanner error={orderTasks.error ?? write.error} />
        {blocked && !open && (
          <p className="error-banner__line error-banner__line--error">{blocked}</p>
        )}
        <RxInquiryHistory inquiries={orderTasks.inquiries} />
        {open ? (
          <div className="rx-inquiry-form__actions">
            <button type="button" onClick={handleWithdraw} disabled={write.isPending}>
              取下げ
            </button>
            <button type="button" onClick={onClose}>
              閉じる
            </button>
          </div>
        ) : (
          <>
            <dl className="prescription-detail__common">
              <dt>宛先</dt>
              <dd>{owner?.display || "-"}</dd>
            </dl>
            <label>
              照会内容
              <textarea rows={4} value={question} onChange={(e) => setQuestion(e.target.value)} />
            </label>
            <div className="rx-inquiry-form__actions">
              <button
                type="button"
                onClick={handleSend}
                disabled={
                  Boolean(blocked) || !question.trim() || orderTasks.isLoading || write.isPending
                }
              >
                送信
              </button>
              <button type="button" onClick={onClose}>
                キャンセル
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
