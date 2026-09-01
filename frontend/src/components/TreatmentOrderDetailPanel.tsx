import { problemLabel } from "../fhir/conditionHelpers";
import { orderDay } from "../fhir/shared";
import { EnteredByRow, RegisteredAtRow } from "./OrderDetailRows";
import { orderContextSummary, prescriptionRequester } from "../fhir/prescriptionHelpers";
import {
  entryLabel,
  orderEntries,
  treatmentOrderItems,
  treatmentOrderProblem,
  treatmentOrderTime,
  summarizeTreatmentOrder,
  type TreatmentOrderEntry,
} from "../fhir/treatmentOrderHelpers";

// 処置オーダーの内容表示。カルテ画面の詳細モーダルから使う
// (検体検査の LabOrderDetailPanel と同じ構成)。
// 1 GP = 処置項目 1 つ、またはセット 1 つ。

interface TreatmentOrderDetailPanelProps {
  serviceRequest: fhir4.ServiceRequest;
  /** オーダーにぶら下がる明細(処置項目・セットの構成項目)。 */
  itemRequests: fhir4.ServiceRequest[];
  problemsById?: Map<string, fhir4.Condition>;
}

export function TreatmentOrderDetailPanel({
  serviceRequest,
  itemRequests,
  problemsById,
}: TreatmentOrderDetailPanelProps) {
  const summary = summarizeTreatmentOrder(serviceRequest);
  const entries = orderEntries(treatmentOrderItems(serviceRequest, itemRequests));

  const problem = treatmentOrderProblem(serviceRequest);
  const currentProblem = problem ? problemsById?.get(problem.conditionId) : undefined;
  const problemText = currentProblem ? problemLabel(currentProblem) : problem?.display || "-";

  return (
    <div className="prescription-detail">
      <fieldset>
        <legend>処置共通</legend>
        <dl className="prescription-detail__common">
          <dt>対象プロブレム</dt>
          <dd>{problemText}</dd>
          <dt>実施日</dt>
          <dd>{orderDay(serviceRequest) || "-"}</dd>
          <dt>実施時刻</dt>
          {/* 日付は実施日として上に出るので時刻だけを並べる(注射の開始時刻と同じ)。 */}
          <dd>{treatmentOrderTime(serviceRequest) || "-"}</dd>
          <dt>入外区分</dt>
          <dd>{summary.settingDisplay || "-"}</dd>
          <dt>依頼科 | 依頼医師</dt>
          <dd>{orderContextSummary(prescriptionRequester(serviceRequest)) || "-"}</dd>
          <RegisteredAtRow authoredOn={serviceRequest.authoredOn} />
          <EnteredByRow serviceRequestId={serviceRequest.id} />
        </dl>
      </fieldset>

      {entries.map((entry, index) => (
        <GroupDetail key={entry.item.code || `gp-${index}`} entry={entry} number={index + 1} />
      ))}
      {entries.length === 0 && <p className="patient-table__empty">処置項目がありません。</p>}
    </div>
  );
}

function GroupDetail({ entry, number }: { entry: TreatmentOrderEntry; number: number }) {
  const { item, members } = entry;
  // セットは自身が処置ではないので、構成する処置を並べる。単項目はその 1 件。
  const exams = members.length > 0 ? members : [item];

  return (
    <fieldset className="rp-card">
      <legend>{`GP${number} ${entryLabel(entry)}`}</legend>
      <table className="rp-card__medicines rp-card__medicines--detail">
        <thead>
          <tr>
            <th>処置項目</th>
            <th>項目コード</th>
          </tr>
        </thead>
        <tbody>
          {exams.map((exam) => (
            <tr key={exam.code}>
              <td>{exam.name}</td>
              <td>{exam.code}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </fieldset>
  );
}
