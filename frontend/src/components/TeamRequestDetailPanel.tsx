import { problemLabel } from "../fhir/conditionHelpers";
import { orderContextSummary, orderRequester } from "../fhir/orderHeader";
import { summarizeTeamRequest, teamRequestComment, teamRequestProblem } from "../fhir/teamRequestHelpers";
import { teamRequestCancelReason, teamRequestTaskStatus, teamRequestTaskStatusDisplay } from "../fhir/teamRequestTaskHelpers";
import { EnteredByRow, RegisteredAtRow } from "./OrderDetailRows";

// チーム依頼の内容表示。カルテの詳細モーダルとワークリスト・回診記録モーダルから使う。
// 回診記録そのものは診療記録なのでここには出さない(最後の回診と次回回診日だけ)。

interface TeamRequestDetailPanelProps {
  serviceRequest: fhir4.ServiceRequest;
  task?: fhir4.Task;
  problemsById?: Map<string, fhir4.Condition>;
}

export function TeamRequestDetailPanel({ serviceRequest, task, problemsById }: TeamRequestDetailPanelProps) {
  const summary = summarizeTeamRequest(serviceRequest);
  const comment = teamRequestComment(serviceRequest);
  const problem = teamRequestProblem(serviceRequest);
  const currentProblem = problem ? problemsById?.get(problem.conditionId) : undefined;
  const problemText = currentProblem ? problemLabel(currentProblem) : problem?.display || "-";
  const status = teamRequestTaskStatus(task);
  const reason = teamRequestCancelReason(task);

  return (
    <div className="prescription-detail">
      <fieldset>
        <legend>依頼内容</legend>
        <dl className="prescription-detail__common">
          <dt>依頼先</dt>
          <dd>{summary.teamName || "-"}</dd>
          <dt>緊急度</dt>
          <dd>{summary.urgent ? "至急" : "通常"}</dd>
          <dt>希望日</dt>
          <dd>{summary.desiredDate || "指定なし"}</dd>
          <dt>依頼目的</dt>
          <dd className="consult-detail__purpose">{summary.purpose || "-"}</dd>
          <dt>補足</dt>
          <dd>{comment || "-"}</dd>
          <dt>対象プロブレム</dt>
          <dd>{problemText}</dd>
          <dt>入外区分</dt>
          <dd>{summary.settingDisplay || "-"}</dd>
          <dt>依頼科 | 依頼医師</dt>
          <dd>{orderContextSummary(orderRequester(serviceRequest)) || "-"}</dd>
          {task && (
            <>
              <dt>状態</dt>
              <dd>
                {teamRequestTaskStatusDisplay(status)}
                {reason && ` | ${reason}`}
              </dd>
            </>
          )}
          <dt>最終回診</dt>
          <dd>
            {summary.lastRoundDate
              ? `${summary.lastRoundDate}${summary.lastRecorderName ? ` | ${summary.lastRecorderName}` : ""}`
              : "-"}
          </dd>
          <dt>次回回診日</dt>
          <dd>{summary.nextRoundDate || "-"}</dd>
          <RegisteredAtRow authoredOn={serviceRequest.authoredOn} />
          <EnteredByRow serviceRequestId={serviceRequest.id} />
        </dl>
      </fieldset>
    </div>
  );
}
