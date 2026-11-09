import { problemLabel } from "../fhir/conditionHelpers";
import { dialysisOrderProblem, summarizeDialysisOrder } from "../fhir/dialysisOrderHelpers";
import { orderContextSummary, orderRequester } from "../fhir/orderHeader";
import { EnteredByRow, RegisteredAtRow } from "./OrderDetailRows";

// 透析オーダーの内容表示。カルテ画面の詳細モーダルから使う。

interface DialysisOrderDetailPanelProps {
  serviceRequest: fhir4.ServiceRequest;
  problemsById?: Map<string, fhir4.Condition>;
}

export function DialysisOrderDetailPanel({ serviceRequest, problemsById }: DialysisOrderDetailPanelProps) {
  const summary = summarizeDialysisOrder(serviceRequest);

  const problem = dialysisOrderProblem(serviceRequest);
  const currentProblem = problem ? problemsById?.get(problem.conditionId) : undefined;
  const problemText = currentProblem ? problemLabel(currentProblem) : problem?.display || "-";

  return (
    <div className="prescription-detail">
      <fieldset>
        <legend>依頼共通</legend>
        <dl className="prescription-detail__common">
          <dt>浄化方法</dt>
          <dd>{summary.modalityDisplay || "-"}</dd>
          <dt>期間</dt>
          <dd>{summary.periodLabel || "-"}</dd>
          <dt>曜日 × シフト</dt>
          <dd>{summary.scheduleLabel || "-"}</dd>
          <dt>対象プロブレム</dt>
          <dd>{problemText}</dd>
          <dt>入外区分</dt>
          <dd>{summary.settingDisplay || "-"}</dd>
          <dt>依頼科 | 依頼医師</dt>
          <dd>{orderContextSummary(orderRequester(serviceRequest)) || "-"}</dd>
          <dt>透析部門への指示</dt>
          <dd>{summary.comment || "-"}</dd>
          <RegisteredAtRow authoredOn={serviceRequest.authoredOn} />
          <EnteredByRow serviceRequestId={serviceRequest.id} />
        </dl>
      </fieldset>

      <fieldset>
        <legend>透析条件</legend>
        <dl className="prescription-detail__common">
          <dt>透析時間</dt>
          <dd>{summary.durationLabel || "-"}</dd>
          <dt>QB</dt>
          <dd>{summary.qbLabel || "-"}</dd>
          <dt>QD</dt>
          <dd>{summary.qdLabel || "-"}</dd>
          <dt>血液浄化器</dt>
          <dd>{summary.purifierNames.join(" / ") || "-"}</dd>
          <dt>透析液</dt>
          <dd>{summary.dialysate || "-"}</dd>
          {summary.substitutionLabel && (
            <>
              <dt>補液量</dt>
              <dd>{summary.substitutionLabel}</dd>
            </>
          )}
          <dt>抗凝固薬</dt>
          <dd>
            {[summary.anticoagulantName, summary.anticoagulantDoseLabel].filter(Boolean).join(" ") || "-"}
          </dd>
          <dt>バスキュラーアクセス</dt>
          <dd>{summary.accessLabel || "-"}</dd>
          <dt>穿刺針</dt>
          <dd>{summary.needle || "-"}</dd>
        </dl>
      </fieldset>
    </div>
  );
}
