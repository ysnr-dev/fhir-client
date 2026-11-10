import { problemLabel } from "../fhir/conditionHelpers";
import {
  dialysisModalityHasDialysate,
  dialysisModalityHasReplacement,
  dialysisModalityHasSubstitution,
  dialysisOrderProblem,
  summarizeDialysisOrder,
} from "../fhir/dialysisOrderHelpers";
import {
  dialysisMinutesLabel,
  type DialysisSessionDisplay,
  type DryWeight,
} from "../fhir/dialysisResultHelpers";
import { orderContextSummary, orderRequester } from "../fhir/orderHeader";
import { shortDate } from "../lib/dates";
import { EnteredByRow, RegisteredAtRow } from "./OrderDetailRows";

// 透析オーダーの内容表示。カルテ画面の詳細モーダルから使う。

interface DialysisOrderDetailPanelProps {
  serviceRequest: fhir4.ServiceRequest;
  problemsById?: Map<string, fhir4.Condition>;
  /** 各回の実施(新しい順)。渡さなければ実施の欄を出さない。 */
  performs?: DialysisSessionDisplay[];
  /** 直近のドライウェイト。 */
  dryWeight?: DryWeight | null;
}

export function DialysisOrderDetailPanel({
  serviceRequest,
  problemsById,
  performs,
  dryWeight,
}: DialysisOrderDetailPanelProps) {
  const summary = summarizeDialysisOrder(serviceRequest);
  const hasDialysate = dialysisModalityHasDialysate(summary.modality);
  const hasSubstitution = dialysisModalityHasSubstitution(summary.modality);
  const hasReplacement = dialysisModalityHasReplacement(summary.modality);

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
          {hasDialysate && (
            <>
              <dt>透析液</dt>
              <dd>{summary.dialysate || "-"}</dd>
            </>
          )}
          {hasSubstitution && (
            <>
              <dt>補充液</dt>
              <dd>{[summary.substitutionFluid, summary.substitutionVolumeLabel].filter(Boolean).join(" ") || "-"}</dd>
            </>
          )}
          {hasReplacement && (
            <>
              <dt>置換液</dt>
              <dd>{[summary.replacementFluid, summary.replacementVolumeLabel].filter(Boolean).join(" ") || "-"}</dd>
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
          {dryWeight !== undefined && (
            <>
              <dt>ドライウェイト</dt>
              <dd>{dryWeight ? `${dryWeight.value}kg(${shortDate(dryWeight.date)})` : "-"}</dd>
            </>
          )}
        </dl>
      </fieldset>

      {performs && (
        <fieldset className="rp-card">
          <legend>
            実施履歴
            {performs.length > 0 && ` (${performs.filter((p) => p.status === "completed").length}回)`}
          </legend>
          <table className="rp-card__medicines dialysis-detail__performs">
            <thead>
              <tr>
                <th>日付</th>
                <th>状態</th>
                <th>時刻</th>
                <th>実透析時間</th>
                <th>体重(前→後)</th>
                <th>除水量</th>
                <th>血圧(前 / 後)</th>
                <th className="dialysis-detail__used">血液浄化器・薬剤・器材</th>
                <th>担当</th>
              </tr>
            </thead>
            <tbody>
              {performs.map((perform) => (
                <tr key={perform.id}>
                  <td>{perform.date ? shortDate(perform.date) : "-"}</td>
                  <td>{perform.statusLabel}</td>
                  <td>{perform.timeLabel || "-"}</td>
                  <td>{dialysisMinutesLabel(perform.actualMinutes) || "-"}</td>
                  <td>
                    {perform.preWeight != null || perform.postWeight != null
                      ? `${perform.preWeight ?? "-"} → ${perform.postWeight ?? "-"}kg`
                      : "-"}
                  </td>
                  <td>{perform.ultrafiltration != null ? `${perform.ultrafiltration}L` : "-"}</td>
                  <td>{[perform.preBp || "-", perform.postBp || "-"].join(" / ")}</td>
                  <td className="dialysis-detail__used">
                    {[...perform.purifiers, ...perform.medicines, ...perform.materials, ...perform.procedures].join("、") ||
                      "-"}
                    {perform.comment && <div className="karte-perform__note">{perform.comment}</div>}
                  </td>
                  <td>{perform.performerName || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {performs.length === 0 && <p className="patient-table__empty">実施記録がありません。</p>}
        </fieldset>
      )}
    </div>
  );
}
