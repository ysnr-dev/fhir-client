import { problemLabel } from "../fhir/conditionHelpers";
import {
  groupBySpecimen,
  labOrderComment,
  labOrderItems,
  labOrderProblem,
  specimenGroupLabel,
  summarizeLabOrder,
} from "../fhir/labOrderHelpers";
import { orderContextSummary, prescriptionRequester } from "../fhir/prescriptionHelpers";

// 検体検査オーダーの内容表示。カルテ画面の詳細モーダルから使う
// (処方の PrescriptionDetailPanel と同じ構成)。

interface LabOrderDetailPanelProps {
  serviceRequest: fhir4.ServiceRequest;
  problemsById?: Map<string, fhir4.Condition>;
}

export function LabOrderDetailPanel({ serviceRequest, problemsById }: LabOrderDetailPanelProps) {
  const summary = summarizeLabOrder(serviceRequest);
  const groups = groupBySpecimen(labOrderItems(serviceRequest));
  const comment = labOrderComment(serviceRequest);

  const problem = labOrderProblem(serviceRequest);
  const currentProblem = problem ? problemsById?.get(problem.conditionId) : undefined;
  const problemText = currentProblem ? problemLabel(currentProblem) : problem?.display || "-";

  return (
    <div className="prescription-detail">
      <fieldset>
        <legend>検査共通</legend>
        <dl className="prescription-detail__common">
          <dt>対象プロブレム</dt>
          <dd>{problemText}</dd>
          <dt>検査日</dt>
          <dd>{serviceRequest.authoredOn?.slice(0, 10) ?? "-"}</dd>
          <dt>入外区分</dt>
          <dd>{summary.settingDisplay || "-"}</dd>
          <dt>至急区分</dt>
          <dd>{summary.priorityDisplay || "-"}</dd>
          <dt>依頼科 | 依頼医師</dt>
          <dd>{orderContextSummary(prescriptionRequester(serviceRequest)) || "-"}</dd>
          <dt>検査コメント</dt>
          <dd>{comment || "-"}</dd>
        </dl>
      </fieldset>

      {groups.map((group, index) => (
        <fieldset className="rp-card" key={group.specimenCode || `unset-${index}`}>
          <legend>{`GP${index + 1} ${specimenGroupLabel(group)}`}</legend>
          <table className="rp-card__medicines rp-card__medicines--detail">
            <thead>
              <tr>
                <th>検査項目</th>
                <th>構成項目</th>
                <th>項目コード</th>
                <th>JLACコード</th>
              </tr>
            </thead>
            <tbody>
              {group.entries.map((entry) => (
                <tr key={entry.item.code}>
                  <td>{entry.item.name}</td>
                  {/* 構成項目もオーダーの内容(パネルから外したものはここにも出ない)。 */}
                  <td>{entry.members.map((member) => member.name).join(", ") || "-"}</td>
                  <td>{entry.item.code}</td>
                  <td>{entry.item.jlacCode || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </fieldset>
      ))}
      {groups.length === 0 && <p className="patient-table__empty">検査項目がありません。</p>}
    </div>
  );
}
