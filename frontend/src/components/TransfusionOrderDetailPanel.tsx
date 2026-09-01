import { problemLabel } from "../fhir/conditionHelpers";
import { orderContextSummary, prescriptionRequester } from "../fhir/prescriptionHelpers";
import { RegisteredAtRow } from "./OrderDetailRows";
import { TransfusionBloodBadge } from "./TransfusionBloodBadge";
import {
  summarizeTransfusionOrder,
  transfusionOrderComment,
  transfusionOrderProblem,
  transfusionOrderProducts,
} from "../fhir/transfusionOrderHelpers";

// 輸血オーダーの内容表示。カルテ画面の詳細モーダルと部門一覧から使う
// (病理・検体検査の DetailPanel と同じ構成)。

interface TransfusionOrderDetailPanelProps {
  serviceRequest: fhir4.ServiceRequest;
  /** オーダーにぶら下がる製剤明細。 */
  itemRequests: fhir4.ServiceRequest[];
  problemsById?: Map<string, fhir4.Condition>;
}

export function TransfusionOrderDetailPanel({
  serviceRequest,
  itemRequests,
  problemsById,
}: TransfusionOrderDetailPanelProps) {
  const summary = summarizeTransfusionOrder(serviceRequest);
  const products = transfusionOrderProducts(itemRequests);
  const comment = transfusionOrderComment(serviceRequest);

  const problem = transfusionOrderProblem(serviceRequest);
  const currentProblem = problem ? problemsById?.get(problem.conditionId) : undefined;
  const problemText = currentProblem ? problemLabel(currentProblem) : problem?.display || "-";

  return (
    <div className="prescription-detail">
      <fieldset>
        <legend>依頼共通</legend>
        <dl className="prescription-detail__common">
          <dt>輸血検査区分</dt>
          <dd>{summary.testTypeDisplay || "-"}</dd>
          <dt>血液型</dt>
          <dd>
            {summary.bloodTypeDisplay ? (
              <TransfusionBloodBadge abo={summary.aboBloodType} rhd={summary.rhdBloodType} />
            ) : (
              "-"
            )}
          </dd>
          <dt>対象プロブレム</dt>
          <dd>{problemText}</dd>
          <dt>投与予定日時</dt>
          <dd>{serviceRequest.occurrenceDateTime?.slice(0, 16).replace("T", " ") || "-"}</dd>
          <dt>入外区分</dt>
          <dd>{summary.settingDisplay || "-"}</dd>
          <dt>至急区分</dt>
          <dd>{summary.priorityDisplay || "-"}</dd>
          <dt>依頼科 | 依頼医師</dt>
          <dd>{orderContextSummary(prescriptionRequester(serviceRequest)) || "-"}</dd>
          {/* 同意書は輸血の必須要件。取得済でないオーダーは例外なので明示する。 */}
          <dt>輸血同意書</dt>
          <dd>{summary.consentConfirmed ? "取得済" : "未取得"}</dd>
          <dt>依頼コメント</dt>
          <dd>{comment || "-"}</dd>
          <RegisteredAtRow authoredOn={serviceRequest.authoredOn} />
        </dl>
      </fieldset>

      <fieldset className="rp-card">
        <legend>製剤</legend>
        <table className="rp-card__medicines">
          <thead>
            <tr>
              <th>№</th>
              <th>製剤</th>
              <th>単位数</th>
              <th>備考</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product, index) => (
              <tr key={product.id || index}>
                <td>{index + 1}</td>
                <td>{product.productName || "-"}</td>
                <td>{product.units ? `${product.units}${product.unitLabel}` : "-"}</td>
                <td>{product.note || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {products.length === 0 && <p className="patient-table__empty">製剤がありません。</p>}
      </fieldset>
    </div>
  );
}
