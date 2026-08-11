import { problemLabel } from "../fhir/conditionHelpers";
import {
  collectionSiteLabel,
  examPurposeDisplay,
  microOrderComment,
  microOrderContents,
  microOrderExamPurpose,
  microOrderPriorAntimicrobial,
  microOrderProblem,
  organismSummary,
  specimenLabel,
  summarizeMicroOrder,
} from "../fhir/microOrderHelpers";
import { orderContextSummary, prescriptionRequester } from "../fhir/prescriptionHelpers";

// 細菌検査オーダーの内容表示。カルテ画面の詳細モーダルから使う
// (検体検査・放射線検査の DetailPanel と同じ構成)。

interface MicroOrderDetailPanelProps {
  serviceRequest: fhir4.ServiceRequest;
  /** オーダーにぶら下がる明細(検体グループ・検査項目)。 */
  itemRequests: fhir4.ServiceRequest[];
  problemsById?: Map<string, fhir4.Condition>;
}

export function MicroOrderDetailPanel({
  serviceRequest,
  itemRequests,
  problemsById,
}: MicroOrderDetailPanelProps) {
  const summary = summarizeMicroOrder(serviceRequest);
  const { specimen, items } = microOrderContents(itemRequests);
  const comment = microOrderComment(serviceRequest);

  const problem = microOrderProblem(serviceRequest);
  const currentProblem = problem ? problemsById?.get(problem.conditionId) : undefined;
  const problemText = currentProblem ? problemLabel(currentProblem) : problem?.display || "-";

  return (
    <div className="prescription-detail">
      <fieldset>
        <legend>検査共通</legend>
        <dl className="prescription-detail__common">
          <dt>対象プロブレム</dt>
          <dd>{problemText}</dd>
          <dt>依頼日</dt>
          <dd>{serviceRequest.authoredOn?.slice(0, 10) ?? "-"}</dd>
          <dt>入外区分</dt>
          <dd>{summary.settingDisplay || "-"}</dd>
          <dt>至急区分</dt>
          <dd>{summary.priorityDisplay || "-"}</dd>
          <dt>依頼科 | 依頼医師</dt>
          <dd>{orderContextSummary(prescriptionRequester(serviceRequest)) || "-"}</dd>
          <dt>前投与抗菌薬</dt>
          <dd className="micro-order__multiline">
            {microOrderPriorAntimicrobial(serviceRequest) || "-"}
          </dd>
          <dt>検査目的</dt>
          <dd>{examPurposeDisplay(microOrderExamPurpose(serviceRequest)) || "-"}</dd>
          <dt>依頼コメント</dt>
          <dd>{comment || "-"}</dd>
        </dl>
      </fieldset>

      <fieldset className="rp-card">
        <legend>{`GP1 ${specimenLabel(specimen)}`}</legend>
        <dl className="prescription-detail__common">
          <dt>検体種別</dt>
          <dd>{specimen.typeName || specimen.typeCode || "-"}</dd>
          <dt>採取部位</dt>
          <dd>{collectionSiteLabel(specimen) || "-"}</dd>
          <dt>採取方法</dt>
          <dd>{specimen.methodName || "-"}</dd>
          <dt>採取予定日時</dt>
          <dd>{specimen.collectionDateTime.replace("T", " ") || "-"}</dd>
          <dt>疑い病名</dt>
          <dd>{specimen.reasonName || "-"}</dd>
          <dt>目的菌</dt>
          <dd>{organismSummary(specimen.organisms) || "-"}</dd>
        </dl>
        <table className="rp-card__medicines rp-card__medicines--detail">
          <thead>
            <tr>
              <th>検査項目</th>
              <th>項目コード</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.code}>
                <td>{item.name}</td>
                <td>{item.code}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && <p className="patient-table__empty">検査項目がありません。</p>}
      </fieldset>
    </div>
  );
}
