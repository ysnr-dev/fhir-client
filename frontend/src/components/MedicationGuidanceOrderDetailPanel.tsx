import { problemLabel } from "../fhir/conditionHelpers";
import { orderContextSummary, orderRequester } from "../fhir/orderHeader";
import {
  medicationGuidanceOrderProblem,
  summarizeMedicationGuidanceOrder,
} from "../fhir/medicationGuidanceOrderHelpers";
import type { MedicationGuidancePerformDisplay } from "../fhir/medicationGuidanceResultHelpers";
import { EnteredByRow, RegisteredAtRow } from "./OrderDetailRows";

// 服薬指導オーダーの内容表示。カルテ画面の詳細モーダルと部門一覧から使う(栄養指導と同じ構成)。

interface Props {
  serviceRequest: fhir4.ServiceRequest;
  /** そのオーダーの実施記録(新しい順)。 */
  performs?: MedicationGuidancePerformDisplay[];
  /** 担当薬剤師の表示名。部門一覧から開いたときだけ渡す。 */
  assigneeName?: string;
  problemsById?: Map<string, fhir4.Condition>;
  /** 実施の取消。部門一覧から開いたときだけ渡す(カルテの詳細では消させない)。 */
  onDeletePerform?: (perform: MedicationGuidancePerformDisplay) => void;
  deletingPerformId?: string;
}

export function MedicationGuidanceOrderDetailPanel({
  serviceRequest,
  performs = [],
  assigneeName,
  problemsById,
  onDeletePerform,
  deletingPerformId,
}: Props) {
  const summary = summarizeMedicationGuidanceOrder(serviceRequest);
  const problem = medicationGuidanceOrderProblem(serviceRequest);
  const currentProblem = problem ? problemsById?.get(problem.conditionId) : undefined;
  const problemText = currentProblem ? problemLabel(currentProblem) : problem?.display || "-";

  return (
    <div className="prescription-detail">
      <fieldset>
        <legend>依頼共通</legend>
        <dl className="prescription-detail__common">
          <dt>指導区分</dt>
          <dd>{summary.kindDisplay || "-"}</dd>
          <dt>指導条件</dt>
          <dd>{summary.conditionsLabel || "-"}</dd>
          <dt>対象薬剤</dt>
          <dd>{summary.targetDrugs || "-"}</dd>
          <dt>指導してほしいこと</dt>
          <dd className="nutrition-guidance-detail__note">{summary.purpose || "-"}</dd>
          <dt>期間</dt>
          <dd>{summary.periodLabel || "-"}</dd>
          <dt>対象プロブレム</dt>
          <dd>{problemText}</dd>
          <dt>入外区分</dt>
          <dd>{summary.settingDisplay || "-"}</dd>
          <dt>依頼科 | 依頼医師</dt>
          <dd>{orderContextSummary(orderRequester(serviceRequest)) || "-"}</dd>
          <dt>薬剤部への連絡事項</dt>
          <dd>{summary.comment || "-"}</dd>
          {assigneeName !== undefined && (
            <>
              <dt>担当薬剤師</dt>
              <dd>{assigneeName || "-"}</dd>
            </>
          )}
          <RegisteredAtRow authoredOn={serviceRequest.authoredOn} />
          <EnteredByRow serviceRequestId={serviceRequest.id} />
        </dl>
      </fieldset>

      <fieldset className="rp-card">
        <legend>
          実施履歴
          {performs.length > 0 && ` (${performs.length}回)`}
        </legend>
        <table className="rp-card__medicines">
          <thead>
            <tr>
              <th>実施日時</th>
              <th>指導種別</th>
              <th>理解度</th>
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
                <td>{perform.understanding || "-"}</td>
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
