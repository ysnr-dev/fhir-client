import { problemLabel } from "../fhir/conditionHelpers";
import { orderContextSummary, prescriptionRequester } from "../fhir/prescriptionHelpers";
import { schemaAnnotatedLines } from "../fhir/questionnaireResponseHelpers";
import {
  bodySiteLabel,
  entryLabel,
  orderEntries,
  radOrderComment,
  radOrderItems,
  radOrderProblem,
  summarizeRadOrder,
  type RadOrderEntry,
} from "../fhir/radOrderHelpers";
import { ResponseSchemaImages } from "./SchemaImageGallery";

// 放射線検査オーダーの内容表示。カルテ画面の詳細モーダルから使う
// (検体検査の LabOrderDetailPanel と同じ構成)。
// 1 GP = 撮影項目 1 つ、またはセット 1 つ。

interface RadOrderDetailPanelProps {
  serviceRequest: fhir4.ServiceRequest;
  /** オーダーにぶら下がる明細(撮影項目・セットの構成項目)。 */
  itemRequests: fhir4.ServiceRequest[];
  problemsById?: Map<string, fhir4.Condition>;
}

export function RadOrderDetailPanel({
  serviceRequest,
  itemRequests,
  problemsById,
}: RadOrderDetailPanelProps) {
  const summary = summarizeRadOrder(serviceRequest);
  const entries = orderEntries(radOrderItems(serviceRequest, itemRequests));
  const comment = radOrderComment(serviceRequest);

  const problem = radOrderProblem(serviceRequest);
  const currentProblem = problem ? problemsById?.get(problem.conditionId) : undefined;
  const problemText = currentProblem ? problemLabel(currentProblem) : problem?.display || "-";

  return (
    <div className="prescription-detail">
      <fieldset>
        <legend>検査共通</legend>
        <dl className="prescription-detail__common">
          <dt>対象プロブレム</dt>
          <dd>{problemText}</dd>
          <dt>撮影日</dt>
          <dd>{serviceRequest.authoredOn?.slice(0, 10) ?? "-"}</dd>
          <dt>入外区分</dt>
          <dd>{summary.settingDisplay || "-"}</dd>
          <dt>至急区分</dt>
          <dd>{summary.priorityDisplay || "-"}</dd>
          <dt>依頼科 | 依頼医師</dt>
          <dd>{orderContextSummary(prescriptionRequester(serviceRequest)) || "-"}</dd>
          <dt>依頼コメント</dt>
          <dd>{comment || "-"}</dd>
        </dl>
      </fieldset>

      {entries.map((entry, index) => (
        <GroupDetail key={entry.item.code || `gp-${index}`} entry={entry} number={index + 1} />
      ))}
      {entries.length === 0 && <p className="patient-table__empty">撮影項目がありません。</p>}
    </div>
  );
}

function GroupDetail({ entry, number }: { entry: RadOrderEntry; number: number }) {
  const { item, members } = entry;
  // セットは自身が撮影ではないので、構成する撮影を並べる。単項目はその 1 件。
  const shots = members.length > 0 ? members : [item];

  return (
    <fieldset className="rp-card">
      <legend>{`GP${number} ${entryLabel(entry)}`}</legend>
      <dl className="prescription-detail__common">
        <dt>依頼病名</dt>
        <dd>{item.reasonName || "-"}</dd>
        <dt>検査目的</dt>
        <dd className="rad-gp__text">
          <TemplateText text={item.purpose} responseId={item.purposeTemplate?.responseId ?? ""} />
        </dd>
        <dt>特別指示</dt>
        <dd className="rad-gp__text">
          <TemplateText text={item.remarks} responseId={item.remarksTemplate?.responseId ?? ""} />
        </dd>
      </dl>
      <table className="rp-card__medicines rp-card__medicines--detail">
        <thead>
          <tr>
            <th>撮影項目</th>
            <th>部位</th>
            <th>項目コード</th>
            <th>JJ1017-32</th>
          </tr>
        </thead>
        <tbody>
          {shots.map((shot) => (
            <tr key={shot.code}>
              <td>{shot.name}</td>
              <td>{bodySiteLabel(shot) || "-"}</td>
              <td>{shot.code}</td>
              <td className="rad-frequent__code">{shot.jj1017Code || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </fieldset>
  );
}

// 検査目的・特別指示。テンプレートから記載した場合は回答に描き込み済みシェーマ画像が
// 含まれることがあるので、平文の「あり」の印に代えて実物を続けて出す
// (カルテのカードと同じ見せ方)。
function TemplateText({ text, responseId }: { text: string; responseId: string }) {
  const lines = schemaAnnotatedLines(text);
  if (lines.length === 0 && !responseId) return <>-</>;

  return (
    <>
      {lines.join("\n")}
      {responseId && <ResponseSchemaImages responseId={responseId} />}
    </>
  );
}
