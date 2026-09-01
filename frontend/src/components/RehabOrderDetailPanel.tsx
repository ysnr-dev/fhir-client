import { problemLabel } from "../fhir/conditionHelpers";
import { orderContextSummary, prescriptionRequester } from "../fhir/prescriptionHelpers";
import { RegisteredAtRow } from "./OrderDetailRows";
import {
  REHAB_UNIT_LABEL,
  rehabElapsedDays,
  rehabOrderComment,
  rehabOrderProblem,
  summarizeRehabOrder,
} from "../fhir/rehabOrderHelpers";
import type { RehabPerformDisplay } from "../fhir/rehabResultHelpers";

// リハビリオーダーの内容表示。カルテ画面の詳細モーダルと部門一覧から使う
// (輸血・病理の DetailPanel と同じ構成)。
//
// 期間継続型なので実施履歴が何十件も並ぶ。カードは先頭数件だけを出すが、ここでは
// 全件を新しい順に出す(部門一覧から開いたときは各行から実施の取消もできる)。

interface RehabOrderDetailPanelProps {
  serviceRequest: fhir4.ServiceRequest;
  /** そのオーダーの実施記録(新しい順)。 */
  performs?: RehabPerformDisplay[];
  problemsById?: Map<string, fhir4.Condition>;
  /** 実施の取消。部門一覧から開いたときだけ渡す(カルテの詳細では消させない)。 */
  onDeletePerform?: (procedureId: string) => void;
  deletingPerformId?: string;
}

export function RehabOrderDetailPanel({
  serviceRequest,
  performs = [],
  problemsById,
  onDeletePerform,
  deletingPerformId,
}: RehabOrderDetailPanelProps) {
  const summary = summarizeRehabOrder(serviceRequest);
  const comment = rehabOrderComment(serviceRequest);

  const problem = rehabOrderProblem(serviceRequest);
  const currentProblem = problem ? problemsById?.get(problem.conditionId) : undefined;
  const problemText = currentProblem ? problemLabel(currentProblem) : problem?.display || "-";

  // 起算日からの経過日数。疾患別リハの算定日数上限を意識する手がかりとして出す。
  const elapsedDays = rehabElapsedDays(summary.onsetDate);

  // 実施した単位数の累計。算定は実績の単位数で決まるので合計を添える。
  const totalUnits = performs.reduce((sum, perform) => sum + (perform.units ?? 0), 0);

  return (
    <div className="prescription-detail">
      <fieldset>
        <legend>依頼共通</legend>
        <dl className="prescription-detail__common">
          <dt>疾患別リハ区分</dt>
          <dd>{summary.diseaseCategoryDisplay || "-"}</dd>
          <dt>療法種別</dt>
          <dd>{summary.therapyTypesLabel || "-"}</dd>
          <dt>実施量</dt>
          <dd>{summary.scheduleLabel || "-"}</dd>
          <dt>期間</dt>
          <dd>{summary.periodLabel || "-"}</dd>
          <dt>対象疾患名</dt>
          <dd>{summary.targetDisease || "-"}</dd>
          <dt>起算日</dt>
          <dd>
            {summary.onsetDate
              ? `${summary.onsetDate}${elapsedDays === undefined ? "" : `(本日で ${elapsedDays} 日目)`}`
              : "-"}
          </dd>
          <dt>対象プロブレム</dt>
          <dd>{problemText}</dd>
          <dt>入外区分</dt>
          <dd>{summary.settingDisplay || "-"}</dd>
          <dt>依頼科 | 依頼医師</dt>
          <dd>{orderContextSummary(prescriptionRequester(serviceRequest)) || "-"}</dd>
          <dt>リハ部門への指示</dt>
          <dd>{comment || "-"}</dd>
          <RegisteredAtRow authoredOn={serviceRequest.authoredOn} />
        </dl>
      </fieldset>

      <fieldset className="rp-card">
        <legend>
          実施履歴
          {performs.length > 0 &&
            ` (${performs.length}回 計${totalUnits}${REHAB_UNIT_LABEL})`}
        </legend>
        <table className="rp-card__medicines">
          <thead>
            <tr>
              <th>実施日時</th>
              <th>療法</th>
              <th>単位数</th>
              <th>担当</th>
              <th>訓練内容</th>
              {onDeletePerform && <th />}
            </tr>
          </thead>
          <tbody>
            {performs.map((perform) => (
              <tr key={perform.id}>
                <td>{perform.performedAt || "-"}</td>
                <td>{perform.therapyTypeShort || "-"}</td>
                <td>{perform.units ? `${perform.units}${REHAB_UNIT_LABEL}` : "-"}</td>
                <td>{perform.performerName || "-"}</td>
                <td>{perform.note || "-"}</td>
                {onDeletePerform && (
                  <td>
                    <button
                      type="button"
                      onClick={() => onDeletePerform(perform.id)}
                      disabled={deletingPerformId === perform.id}
                    >
                      {deletingPerformId === perform.id ? "取消中..." : "実施取消"}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {performs.length === 0 && <p className="patient-table__empty">実施記録がありません。</p>}
      </fieldset>
    </div>
  );
}
