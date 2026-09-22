import { type AdverseEventRecord } from "../fhir/adverseEventHelpers";
import { problemLabel } from "../fhir/conditionHelpers";
import { orderContextSummary, prescriptionRequester } from "../fhir/prescriptionHelpers";
import {
  formatDose,
  radiotherapyOrderProblem,
  summarizeRadiotherapyOrder,
} from "../fhir/radiotherapyOrderHelpers";
import {
  radiotherapyFractionPhaseLabel,
  radiotherapyProgress,
  type RadiotherapyFractionDisplay,
} from "../fhir/radiotherapyResultHelpers";
import { parseRadiotherapyCourseSummary } from "../fhir/radiotherapySummaryHelpers";
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
  /** そのコースの照射記録(新しい順)。 */
  fractions?: RadiotherapyFractionDisplay[];
  /** 治療終了サマリー(書いてあれば)。 */
  courseSummary?: fhir4.Procedure;
  /** そのコースの有害事象(発現日の新しい順。§6.3)。記録はカルテの右ペインで行う。 */
  adverseEvents?: AdverseEventRecord[];
  /** 照射の取消。部門一覧から開いたときだけ渡す(カルテの詳細では取り消させない)。 */
  onCancelFraction?: (fractionId: string) => void;
  cancellingFractionId?: string;
  /** 元になった他科依頼を開く。渡されたときだけリンクにする。 */
  onOpenConsult?: (consultSrId: string) => void;
}

const NO_FRACTIONS: RadiotherapyFractionDisplay[] = [];
const NO_ADVERSE_EVENTS: AdverseEventRecord[] = [];

export function RadiotherapyOrderDetailPanel({
  serviceRequest,
  taskStatus,
  problemsById,
  fractions = NO_FRACTIONS,
  courseSummary,
  adverseEvents = NO_ADVERSE_EVENTS,
  onCancelFraction,
  cancellingFractionId,
  onOpenConsult,
}: RadiotherapyOrderDetailPanelProps) {
  const summary = summarizeRadiotherapyOrder(serviceRequest);
  const progress = radiotherapyProgress(summary, fractions);
  const courseSummaryDisplay = courseSummary
    ? parseRadiotherapyCourseSummary(courseSummary, summary)
    : undefined;

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
          {summary.suspendedOn && (
            <>
              <dt>休止日</dt>
              <dd>
                {summary.suspendedOn}
                {[summary.suspensionReason, summary.suspensionNote].filter(Boolean).length > 0 &&
                  `（${[summary.suspensionReason, summary.suspensionNote].filter(Boolean).join(" ")}）`}
              </dd>
            </>
          )}
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
              {/* 照射が始まっていれば、処方に対してどこまで照射したかを並べる。 */}
              {fractions.length > 0 && <th>実照射線量</th>}
            </tr>
          </thead>
          <tbody>
            {summary.volumes.map((volume) => (
              <tr key={volume.volumeId}>
                <td>{volume.label}</td>
                <td>{volume.siteLabel || "-"}</td>
                <td>{volume.doseLabel || "-"}</td>
                {fractions.length > 0 && (
                  <td>
                    {progress.volumes.find((v) => v.volumeId === volume.volumeId)?.doseLabel ?? "-"}
                  </td>
                )}
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

      {/* 治療中に記録した有害事象(CTCAE)。終了サマリーの「急性有害事象」は医師が書く
          まとめで、こちらは 1 件ずつの記録(§6.3)。 */}
      {adverseEvents.length > 0 && (
        <fieldset className="rp-card">
          <legend>有害事象</legend>
          <table className="rp-card__medicines">
            <thead>
              <tr>
                <th>用語</th>
                <th>Grade</th>
                <th>発現 〜 回復</th>
                <th>対処・経過</th>
              </tr>
            </thead>
            <tbody>
              {adverseEvents.map((record) => (
                <tr key={record.id}>
                  <td>{record.term}</td>
                  <td>G{record.grade}</td>
                  <td>
                    {record.onset}
                    {record.resolved ? ` 〜 ${record.resolved}` : " 〜（継続中）"}
                  </td>
                  <td>{record.note || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </fieldset>
      )}

      {/* 治療終了サマリー。照射記録から数えた実績と、医師が書いた経過・有害事象・方針。 */}
      {courseSummaryDisplay && (
        <fieldset className="rp-card">
          <legend>治療終了サマリー</legend>
          <dl className="prescription-detail__common">
            <dt>治療期間</dt>
            <dd>{courseSummaryDisplay.periodLabel || "-"}</dd>
            <dt>治療の結末</dt>
            <dd>
              {courseSummaryDisplay.outcomeDisplay || "-"}
              {courseSummaryDisplay.terminationReason.name &&
                `（${[courseSummaryDisplay.terminationReason.name, courseSummaryDisplay.terminationNote]
                  .filter(Boolean)
                  .join(" ")}）`}
            </dd>
            <dt>照射回数</dt>
            <dd>{courseSummaryDisplay.fractionLabel}</dd>
            <dt>実照射線量</dt>
            <dd>
              {courseSummaryDisplay.doses.length > 0
                ? courseSummaryDisplay.doses.map((d) => `${d.label} ${d.doseLabel}`).join("、")
                : "-"}
            </dd>
            <dt>治療経過</dt>
            <dd className="radiotherapy-summary__value">{courseSummaryDisplay.progressNote || "-"}</dd>
            <dt>急性有害事象</dt>
            <dd className="radiotherapy-summary__value">{courseSummaryDisplay.adverseEvents || "-"}</dd>
            <dt>今後の方針</dt>
            <dd className="radiotherapy-summary__value">{courseSummaryDisplay.followUpPlan || "-"}</dd>
            <dt>記載医師</dt>
            <dd>{courseSummaryDisplay.practitionerName || "-"}</dd>
          </dl>
        </fieldset>
      )}

      {/* 照射記録。1 コースで数十件になるので新しい順に全件を出す(カードは先頭数件)。 */}
      {fractions.length > 0 && (
        <fieldset className="rp-card">
          <legend>照射記録 ({progress.fractionLabel})</legend>
          <table className="rp-card__medicines">
            <thead>
              <tr>
                <th>照射日</th>
                <th>Phase</th>
                <th>回</th>
                <th>線量</th>
                <th>装置</th>
                <th>位置照合</th>
                <th>実施者</th>
                <th>備考</th>
                {onCancelFraction && <th />}
              </tr>
            </thead>
            <tbody>
              {fractions.map((fraction) => (
                <tr key={fraction.id}>
                  <td>
                    {fraction.performedDate}
                    {fraction.timeLabel && ` ${fraction.timeLabel}`}
                  </td>
                  <td>{radiotherapyFractionPhaseLabel(summary, fraction.phaseId)}</td>
                  <td>{fraction.fractionNumber || "-"}</td>
                  <td>
                    {fraction.planned ? (
                      <span className="micro-result__badge micro-result__badge--muted">予定</span>
                    ) : fraction.notDone ? (
                      <span className="micro-result__badge">未実施</span>
                    ) : (
                      summary.volumes
                        .filter((volume) => fraction.doses[volume.volumeId] !== undefined)
                        .map((volume) => `${volume.label} ${formatDose(fraction.doses[volume.volumeId])} Gy`)
                        .join("、") || "-"
                    )}
                  </td>
                  <td>{fraction.deviceName || "-"}</td>
                  <td>{fraction.imageGuidance || "-"}</td>
                  <td>{fraction.performerName || "-"}</td>
                  <td>{[fraction.notDoneReason, fraction.note].filter(Boolean).join(" ") || "-"}</td>
                  {onCancelFraction && (
                    <td>
                      {/* 予定の変更・削除はカレンダーから行う(ここは照射録の取消)。 */}
                      {!fraction.planned && (
                      <button
                        type="button"
                        onClick={() => onCancelFraction(fraction.id)}
                        disabled={cancellingFractionId === fraction.id}
                      >
                        {cancellingFractionId === fraction.id ? "取消中..." : "取消"}
                      </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </fieldset>
      )}
    </div>
  );
}
