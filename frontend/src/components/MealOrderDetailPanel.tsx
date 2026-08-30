import { problemLabel } from "../fhir/conditionHelpers";
import { orderContextSummary, prescriptionRequester } from "../fhir/prescriptionHelpers";
import { mealOrderProblem, mealStapleText, summarizeMealOrder } from "../fhir/mealOrderHelpers";

// 食事オーダーの内容表示。カルテ画面の詳細モーダルから使う。
// 明細を持たないオーダーなので、他の部門オーダーのような GP ごとの表は無い。

interface MealOrderDetailPanelProps {
  serviceRequest: fhir4.ServiceRequest;
  problemsById?: Map<string, fhir4.Condition>;
}

export function MealOrderDetailPanel({
  serviceRequest,
  problemsById,
}: MealOrderDetailPanelProps) {
  const summary = summarizeMealOrder(serviceRequest);

  const problem = mealOrderProblem(serviceRequest);
  const currentProblem = problem ? problemsById?.get(problem.conditionId) : undefined;
  const problemText = currentProblem ? problemLabel(currentProblem) : problem?.display || "-";

  return (
    <div className="prescription-detail">
      <fieldset>
        <legend>食事内容</legend>
        <dl className="prescription-detail__common">
          <dt>種別</dt>
          {/* 開始 / 変更 / 再開 / 外泊食止め。登録の文脈から自動で決まる。 */}
          <dd>{summary.kindLabel}</dd>
          <dt>食種</dt>
          <dd>{summary.dietName || "-"}</dd>
          <dt>主食</dt>
          {/* 全食同じなら主食名、朝昼夕で違えば「朝 米飯180g / 昼 欠食 / 夕 全粥」。 */}
          <dd>{mealStapleText(summary) || "-"}</dd>
          {/* 欠食理由は食止め・欠食のオーダーにだけ付く項目なので、あるときだけ行を出す。 */}
          {summary.fastingReasonLabel && (
            <>
              <dt>欠食理由</dt>
              <dd>{summary.fastingReasonLabel}</dd>
            </>
          )}
          <dt>期間</dt>
          {/* 終了を決めていないオーダーは「継続中」。次の食事オーダーで終わる。 */}
          <dd>{`${summary.startLabel}〜${summary.continuing ? " 継続中" : ` ${summary.endLabel}`}`}</dd>
          <dt>コメント</dt>
          <dd>{summary.comment || "-"}</dd>
          <dt>対象プロブレム</dt>
          <dd>{problemText}</dd>
          <dt>オーダー日</dt>
          <dd>{serviceRequest.authoredOn?.slice(0, 10) ?? "-"}</dd>
          <dt>依頼科 | 依頼医師</dt>
          <dd>{orderContextSummary(prescriptionRequester(serviceRequest)) || "-"}</dd>
        </dl>
      </fieldset>
    </div>
  );
}
