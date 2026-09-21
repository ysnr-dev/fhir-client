import { problemLabel } from "../fhir/conditionHelpers";
import { orderContextSummary, prescriptionRequester } from "../fhir/prescriptionHelpers";
import {
  formatDose,
  radiotherapyOrderProblem,
  summarizeRadiotherapyOrder,
} from "../fhir/radiotherapyOrderHelpers";
import {
  radiotherapyTaskStatusDisplay,
  type RadiotherapyTaskStatus,
} from "../fhir/radiotherapyTaskHelpers";
import { EnteredByRow, RegisteredAtRow } from "./OrderDetailRows";

// 放射線治療(治療処方)の内容表示。カルテ画面の詳細モーダルと部門一覧から使う。

interface RadiotherapyOrderDetailPanelProps {
  serviceRequest: fhir4.ServiceRequest;
  taskStatus?: RadiotherapyTaskStatus;
  problemsById?: Map<string, fhir4.Condition>;
  /** 元になった他科依頼を開く。渡されたときだけリンクにする。 */
  onOpenConsult?: (consultSrId: string) => void;
}

export function RadiotherapyOrderDetailPanel({
  serviceRequest,
  taskStatus,
  problemsById,
  onOpenConsult,
}: RadiotherapyOrderDetailPanelProps) {
  const summary = summarizeRadiotherapyOrder(serviceRequest);

  const problem = radiotherapyOrderProblem(serviceRequest);
  const currentProblem = problem ? problemsById?.get(problem.conditionId) : undefined;
  const problemText = currentProblem ? problemLabel(currentProblem) : problem?.display || "-";
  const consult = summary.consultRequest;

  return (
    <div className="prescription-detail">
      <fieldset>
        <legend>治療コース</legend>
        <dl className="prescription-detail__common">
          <dt>コース</dt>
          <dd>第{summary.courseNumber}コース</dd>
          {taskStatus && (
            <>
              <dt>進捗</dt>
              <dd>{radiotherapyTaskStatusDisplay(taskStatus)}</dd>
            </>
          )}
          <dt>治療目的</dt>
          <dd>{summary.intentDisplay || "-"}</dd>
          <dt>治療プロトコル</dt>
          <dd>{summary.protocolName || "-"}</dd>
          <dt>開始予定日</dt>
          <dd>{summary.startDate || "-"}</dd>
          {summary.endedOn && (
            <>
              <dt>{serviceRequest.status === "revoked" ? "中止日" : "終了日"}</dt>
              <dd>
                {summary.endedOn}
                {[summary.terminationReason, summary.terminationNote].filter(Boolean).length > 0 &&
                  `（${[summary.terminationReason, summary.terminationNote].filter(Boolean).join(" ")}）`}
              </dd>
            </>
          )}
          <dt>併用療法</dt>
          <dd>{summary.concurrentTherapyDisplay || "-"}</dd>
          <dt>担当医</dt>
          <dd>{summary.practitionerName || serviceRequest.requester?.display || "-"}</dd>
          <dt>元の他科依頼</dt>
          <dd>
            {consult ? (
              onOpenConsult ? (
                <button type="button" onClick={() => onOpenConsult(consult.id)}>
                  {consult.display || "依頼を表示"}
                </button>
              ) : (
                consult.display || "あり"
              )
            ) : (
              "-"
            )}
          </dd>
          <dt>対象プロブレム</dt>
          <dd>{problemText}</dd>
          <dt>入外区分</dt>
          <dd>{summary.settingDisplay || "-"}</dd>
          <dt>依頼科 | 依頼医師</dt>
          <dd>{orderContextSummary(prescriptionRequester(serviceRequest)) || "-"}</dd>
          <dt>コメント</dt>
          <dd>{summary.comment || "-"}</dd>
          <RegisteredAtRow authoredOn={serviceRequest.authoredOn} />
          <EnteredByRow serviceRequestId={serviceRequest.id} />
        </dl>
      </fieldset>

      <fieldset className="rp-card">
        <legend>標的</legend>
        <table className="rp-card__medicines">
          <thead>
            <tr>
              <th>名称</th>
              <th>部位</th>
              <th>コース合計</th>
            </tr>
          </thead>
          <tbody>
            {summary.volumes.map((volume) => (
              <tr key={volume.volumeId}>
                <td>{volume.label}</td>
                <td>{volume.siteLabel || "-"}</td>
                <td>{volume.doseLabel || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </fieldset>

      {summary.phases.map((phase) => (
        <fieldset key={phase.phaseId} className="rp-card">
          <legend>
            {phase.label}
            {phase.status === "revoked" && "（中止）"}
          </legend>
          <dl className="prescription-detail__common">
            <dt>照射方法</dt>
            <dd>{phase.methodLabel || "-"}</dd>
            <dt>分割回数</dt>
            <dd>
              {phase.fractions} 回{phase.fractionsPerWeek ? `（週 ${phase.fractionsPerWeek} 回）` : ""}
            </dd>
            {phase.deviceName && (
              <>
                <dt>使用予定装置</dt>
                <dd>{phase.deviceName}</dd>
              </>
            )}
          </dl>
          <table className="rp-card__medicines">
            <thead>
              <tr>
                <th>標的</th>
                <th>1回線量</th>
                <th>総線量</th>
              </tr>
            </thead>
            <tbody>
              {phase.doses.map((dose) => (
                <tr key={dose.volumeId}>
                  <td>{dose.volumeLabel}</td>
                  <td>{formatDose(dose.fractionDose)} Gy</td>
                  <td>{formatDose(dose.totalDose)} Gy</td>
                </tr>
              ))}
            </tbody>
          </table>
        </fieldset>
      ))}
    </div>
  );
}
