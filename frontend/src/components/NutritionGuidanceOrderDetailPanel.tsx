import { problemLabel } from "../fhir/conditionHelpers";
import { orderContextSummary, prescriptionRequester } from "../fhir/prescriptionHelpers";
import { EnteredByRow, RegisteredAtRow } from "./OrderDetailRows";
import {
  nutritionGuidanceOrderComment,
  nutritionGuidanceOrderProblem,
  summarizeNutritionGuidanceOrder,
} from "../fhir/nutritionGuidanceOrderHelpers";
import type { NutritionGuidancePerformDisplay } from "../fhir/nutritionGuidanceResultHelpers";

// 栄養指導オーダーの内容表示。カルテ画面の詳細モーダルと部門一覧から使う
// (リハビリの RehabOrderDetailPanel と同じ構成)。
//
// 期間継続型なので実施履歴が複数並ぶ。カードは先頭数件だけを出すが、ここでは全件を
// 新しい順に出す(部門一覧から開いたときは各行から実施の取消もできる)。

interface NutritionGuidanceOrderDetailPanelProps {
  serviceRequest: fhir4.ServiceRequest;
  /** そのオーダーの実施記録(新しい順)。 */
  performs?: NutritionGuidancePerformDisplay[];
  problemsById?: Map<string, fhir4.Condition>;
  /** 実施の取消。部門一覧から開いたときだけ渡す(カルテの詳細では消させない)。 */
  onDeletePerform?: (perform: NutritionGuidancePerformDisplay) => void;
  deletingPerformId?: string;
}

export function NutritionGuidanceOrderDetailPanel({
  serviceRequest,
  performs = [],
  problemsById,
  onDeletePerform,
  deletingPerformId,
}: NutritionGuidanceOrderDetailPanelProps) {
  const summary = summarizeNutritionGuidanceOrder(serviceRequest);
  const comment = nutritionGuidanceOrderComment(serviceRequest);

  const problem = nutritionGuidanceOrderProblem(serviceRequest);
  const currentProblem = problem ? problemsById?.get(problem.conditionId) : undefined;
  const problemText = currentProblem ? problemLabel(currentProblem) : problem?.display || "-";

  // 指導時間の累計。算定は実施ごとの時間で決まるので合計を添える。
  const totalMinutes = performs.reduce((sum, perform) => sum + (perform.minutes ?? 0), 0);

  return (
    <div className="prescription-detail">
      <fieldset>
        <legend>依頼共通</legend>
        <dl className="prescription-detail__common">
          <dt>指導形態</dt>
          <dd>{summary.formatDisplay || "-"}</dd>
          <dt>期間</dt>
          <dd>{summary.periodLabel || "-"}</dd>
          <dt>指導目的</dt>
          <dd className="nutrition-guidance-detail__note">{summary.purpose || "-"}</dd>
          <dt>対象疾患名</dt>
          <dd>{summary.targetDisease || "-"}</dd>
          <dt>指示食種</dt>
          <dd>{summary.targetDiet || "-"}</dd>
          <dt>対象プロブレム</dt>
          <dd>{problemText}</dd>
          <dt>入外区分</dt>
          <dd>{summary.settingDisplay || "-"}</dd>
          <dt>依頼科 | 依頼医師</dt>
          <dd>{orderContextSummary(prescriptionRequester(serviceRequest)) || "-"}</dd>
          <dt>栄養部門への指示</dt>
          <dd>{comment || "-"}</dd>
          <RegisteredAtRow authoredOn={serviceRequest.authoredOn} />
          <EnteredByRow serviceRequestId={serviceRequest.id} />
        </dl>
      </fieldset>

      <fieldset className="rp-card">
        <legend>
          実施履歴
          {performs.length > 0 && ` (${performs.length}回 計${totalMinutes}分)`}
        </legend>
        <table className="rp-card__medicines">
          <thead>
            <tr>
              <th>実施日時</th>
              <th>指導種別</th>
              <th>時間</th>
              <th>担当</th>
              <th>指導内容</th>
              {onDeletePerform && <th />}
            </tr>
          </thead>
          <tbody>
            {performs.map((perform) => (
              <tr key={perform.id}>
                <td>{perform.performedAt || "-"}</td>
                <td>{perform.sessionTypeShort || "-"}</td>
                <td>{perform.minutes ? `${perform.minutes}分` : "-"}</td>
                <td>{perform.performerName || "-"}</td>
                <td className="nutrition-guidance-detail__note">{perform.note || "-"}</td>
                {onDeletePerform && (
                  <td>
                    <button
                      type="button"
                      onClick={() => onDeletePerform(perform)}
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
