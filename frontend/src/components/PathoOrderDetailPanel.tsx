import { problemLabel } from "../fhir/conditionHelpers";
import {
  organLabel,
  pathoOrderClinicalInfo,
  pathoOrderClinicalInfoTemplate,
  pathoOrderComment,
  pathoOrderOperatingRoom,
  pathoOrderProblem,
  pathoOrderReportDueDate,
  pathoOrderSchemas,
  pathoOrderSpecimens,
  pathoSchemaImageRefs,
  specimenTypeDisplay,
  summarizePathoOrder,
} from "../fhir/pathoOrderHelpers";
import { orderContextSummary, prescriptionRequester } from "../fhir/prescriptionHelpers";
import { schemaAnnotatedLines } from "../fhir/questionnaireResponseHelpers";
import { ResponseSchemaImages, SchemaImageGallery } from "./SchemaImageGallery";

// 病理検査オーダーの内容表示。カルテ画面の詳細モーダルと部門一覧から使う
// (検体検査・細菌検査の DetailPanel と同じ構成)。

interface PathoOrderDetailPanelProps {
  serviceRequest: fhir4.ServiceRequest;
  /** オーダーにぶら下がる検体明細。 */
  itemRequests: fhir4.ServiceRequest[];
  problemsById?: Map<string, fhir4.Condition>;
}

export function PathoOrderDetailPanel({
  serviceRequest,
  itemRequests,
  problemsById,
}: PathoOrderDetailPanelProps) {
  const summary = summarizePathoOrder(serviceRequest);
  const specimens = pathoOrderSpecimens(itemRequests);
  const comment = pathoOrderComment(serviceRequest);
  const operatingRoom = pathoOrderOperatingRoom(serviceRequest);
  const clinicalInfoResponseId = pathoOrderClinicalInfoTemplate(serviceRequest)?.responseId ?? "";
  const schemas = pathoOrderSchemas(serviceRequest);

  const problem = pathoOrderProblem(serviceRequest);
  const currentProblem = problem ? problemsById?.get(problem.conditionId) : undefined;
  const problemText = currentProblem ? problemLabel(currentProblem) : problem?.display || "-";

  return (
    <div className="prescription-detail">
      <fieldset>
        <legend>検査共通</legend>
        <dl className="prescription-detail__common">
          <dt>検査区分</dt>
          <dd>{summary.examCategoryDisplay || "-"}</dd>
          <dt>対象プロブレム</dt>
          <dd>{problemText}</dd>
          <dt>依頼日</dt>
          <dd>{serviceRequest.authoredOn?.slice(0, 10) ?? "-"}</dd>
          <dt>採取(予定)日時</dt>
          <dd>{serviceRequest.occurrenceDateTime?.slice(0, 16).replace("T", " ") || "-"}</dd>
          <dt>入外区分</dt>
          <dd>{summary.settingDisplay || "-"}</dd>
          <dt>至急区分</dt>
          <dd>{summary.priorityDisplay || "-"}</dd>
          <dt>依頼科 | 依頼医師</dt>
          <dd>{orderContextSummary(prescriptionRequester(serviceRequest)) || "-"}</dd>
          <dt>報告希望日</dt>
          <dd>{pathoOrderReportDueDate(serviceRequest) || "-"}</dd>
          {/* 手術室番号は術中迅速でしか入らないので、値があるときだけ出す。 */}
          {operatingRoom && (
            <>
              <dt>手術室番号</dt>
              <dd>{operatingRoom}</dd>
            </>
          )}
          <dt>臨床経過・所見</dt>
          <dd className="patho-order__multiline">
            <TemplateText
              text={pathoOrderClinicalInfo(serviceRequest)}
              responseId={clinicalInfoResponseId}
            />
          </dd>
          <dt>依頼コメント</dt>
          <dd>{comment || "-"}</dd>
        </dl>
      </fieldset>

      <fieldset className="rp-card">
        <legend>検体</legend>
        <table className="rp-card__medicines rp-card__medicines--patho">
          <thead>
            <tr>
              <th>№</th>
              <th>臓器・検査材料</th>
              <th>検体タイプ</th>
              <th>採取法</th>
              <th>補足</th>
            </tr>
          </thead>
          <tbody>
            {specimens.map((specimen, index) => (
              <tr key={specimen.id || index}>
                <td>{index + 1}</td>
                <td>{organLabel(specimen) || "-"}</td>
                <td>{specimen.typeName || specimenTypeDisplay(specimen.typeCode) || "-"}</td>
                <td>{specimen.methodName || "-"}</td>
                <td>{specimen.note || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {specimens.length === 0 && <p className="patient-table__empty">検体がありません。</p>}
      </fieldset>

      {/* シェーマ(JAHIS AP-031)。無いオーダーの方が多いので、あるときだけ枠を出す。 */}
      {schemas.length > 0 && (
        <fieldset>
          <legend>シェーマ</legend>
          <SchemaImageGallery refs={pathoSchemaImageRefs(schemas)} />
        </fieldset>
      )}
    </div>
  );
}

// テンプレートから書いた臨床経過。平文の「(シェーマ画像あり)」の印は落として、
// 実物のサムネイルを続けて出す(放射線オーダーの詳細と同じ見せ方)。
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
