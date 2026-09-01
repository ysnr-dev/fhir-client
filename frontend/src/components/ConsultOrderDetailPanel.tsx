import { problemLabel } from "../fhir/conditionHelpers";
import {
  consultOrderComment,
  consultOrderProblem,
  summarizeConsultOrder,
} from "../fhir/consultOrderHelpers";
import { orderContextSummary, prescriptionRequester } from "../fhir/prescriptionHelpers";
import { EnteredByRow, RegisteredAtRow } from "./OrderDetailRows";

// 他科依頼の内容表示。カルテの詳細モーダルと部門一覧・回答モーダルから使う
// (リハビリ・輸血の DetailPanel と同じ構成)。
//
// 回答そのものは診療記録なのでここには出さない(回答者と回答済かどうかだけ出し、
// 本文はカードの「回答表示」から診療記録として開く。docs/consult-order-design.md §5)。

interface ConsultOrderDetailPanelProps {
  serviceRequest: fhir4.ServiceRequest;
  problemsById?: Map<string, fhir4.Condition>;
}

export function ConsultOrderDetailPanel({
  serviceRequest,
  problemsById,
}: ConsultOrderDetailPanelProps) {
  const summary = summarizeConsultOrder(serviceRequest);
  const comment = consultOrderComment(serviceRequest);

  const problem = consultOrderProblem(serviceRequest);
  const currentProblem = problem ? problemsById?.get(problem.conditionId) : undefined;
  const problemText = currentProblem ? problemLabel(currentProblem) : problem?.display || "-";

  return (
    <div className="prescription-detail">
      <fieldset>
        <legend>依頼内容</legend>
        <dl className="prescription-detail__common">
          <dt>依頼先</dt>
          <dd>{summary.targetLabel || "-"}</dd>
          <dt>依頼種別</dt>
          <dd>{summary.requestTypeDisplay || "-"}</dd>
          <dt>緊急度</dt>
          <dd>{summary.priorityDisplay}</dd>
          <dt>希望日</dt>
          <dd>{summary.desiredDate || "指定なし"}</dd>
          <dt>依頼目的</dt>
          {/* 依頼目的は複数行で書かれるので、改行をそのまま出す。 */}
          <dd className="consult-detail__purpose">{summary.purpose || "-"}</dd>
          <dt>補足</dt>
          <dd>{comment || "-"}</dd>
          <dt>対象プロブレム</dt>
          <dd>{problemText}</dd>
          <dt>入外区分</dt>
          <dd>{summary.settingDisplay || "-"}</dd>
          <dt>依頼科 | 依頼医師</dt>
          <dd>{orderContextSummary(prescriptionRequester(serviceRequest)) || "-"}</dd>
          <dt>回答</dt>
          <dd>{summary.replyId ? `回答済${summary.replierName ? ` | ${summary.replierName}` : ""}` : "未回答"}</dd>
          <RegisteredAtRow authoredOn={serviceRequest.authoredOn} />
          <EnteredByRow serviceRequestId={serviceRequest.id} />
        </dl>
      </fieldset>
    </div>
  );
}
