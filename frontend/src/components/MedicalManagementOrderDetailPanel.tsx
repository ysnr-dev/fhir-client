import { problemLabel } from "../fhir/conditionHelpers";
import { orderContextSummary, orderRequester } from "../fhir/orderHeader";
import { EnteredByRow, RegisteredAtRow } from "./OrderDetailRows";
import {
  medicalManagementOrderProblem,
  summarizeMedicalManagementOrder,
  type MedicalManagementItemDisplay,
} from "../fhir/medicalManagementOrderHelpers";
import { shortDate } from "../lib/dates";

// 指導・管理料オーダーの内容表示。カルテ画面の詳細モーダルから使う。

interface MedicalManagementOrderDetailPanelProps {
  serviceRequest: fhir4.ServiceRequest;
  items: MedicalManagementItemDisplay[];
  problemsById?: Map<string, fhir4.Condition>;
}

export function MedicalManagementOrderDetailPanel({
  serviceRequest,
  items,
  problemsById,
}: MedicalManagementOrderDetailPanelProps) {
  const summary = summarizeMedicalManagementOrder(serviceRequest);

  const problem = medicalManagementOrderProblem(serviceRequest);
  const currentProblem = problem ? problemsById?.get(problem.conditionId) : undefined;
  const problemText = currentProblem ? problemLabel(currentProblem) : problem?.display || "-";

  return (
    <div className="prescription-detail">
      <fieldset>
        <legend>依頼共通</legend>
        <dl className="prescription-detail__common">
          <dt>算定日</dt>
          <dd>{summary.date ? shortDate(summary.date) : "-"}</dd>
          <dt>対象プロブレム</dt>
          <dd>{problemText}</dd>
          <dt>入外区分</dt>
          <dd>{summary.settingDisplay || "-"}</dd>
          <dt>依頼科 | 指示医師</dt>
          <dd>{orderContextSummary(orderRequester(serviceRequest)) || "-"}</dd>
          <dt>備考</dt>
          <dd>{summary.comment || "-"}</dd>
          <RegisteredAtRow authoredOn={serviceRequest.authoredOn} />
          <EnteredByRow serviceRequestId={serviceRequest.id} />
        </dl>
      </fieldset>

      <fieldset className="rp-card">
        <legend>算定項目</legend>
        <table className="rp-card__medicines">
          <thead>
            <tr>
              <th>項目</th>
              <th>レセ電算コード</th>
            </tr>
          </thead>
          <tbody>
            {items.flatMap((item) => [
              <tr key={item.id}>
                <td>{item.name}</td>
                <td>{item.code}</td>
              </tr>,
              ...item.additions.map((addition) => (
                <tr key={addition.id}>
                  <td>　{addition.name}</td>
                  <td>{addition.code}</td>
                </tr>
              )),
            ])}
            {items.length === 0 && (
              <tr>
                <td colSpan={2}>算定項目がありません。</td>
              </tr>
            )}
          </tbody>
        </table>
      </fieldset>
    </div>
  );
}
