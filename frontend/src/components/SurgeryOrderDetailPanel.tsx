import { problemLabel } from "../fhir/conditionHelpers";
import { orderContextSummary, prescriptionRequester } from "../fhir/prescriptionHelpers";
import { RegisteredAtRow } from "./OrderDetailRows";
import { schemaAnnotatedLines } from "../fhir/questionnaireResponseHelpers";
import {
  summarizeSurgeryOrder,
  surgeryAnesthesiaManagementDisplay,
  surgeryAnesthesiaMethodDisplay,
  surgeryApproachDisplay,
  surgeryBloodPreparationDisplay,
  surgeryBodySiteLabel,
  surgeryConsentDisplay,
  surgeryOrderItems,
  surgeryOrderProblem,
  surgeryPositionDisplay,
  surgerySpecimenPlanDisplay,
  surgeryStaffRoleDisplay,
} from "../fhir/surgeryOrderHelpers";
import { ResponseSchemaImages } from "./SchemaImageGallery";

// 手術オーダーの内容表示。カルテ画面の詳細モーダルから使う
// (処置の TreatmentOrderDetailPanel と同じ構成)。
// 申込ヘッダが厚いぶん、共通欄が長く、術式の表に部位・到達法・術前診断が付く。

interface SurgeryOrderDetailPanelProps {
  serviceRequest: fhir4.ServiceRequest;
  /** オーダーにぶら下がる明細(術式)。 */
  itemRequests: fhir4.ServiceRequest[];
  problemsById?: Map<string, fhir4.Condition>;
}

export function SurgeryOrderDetailPanel({
  serviceRequest,
  itemRequests,
  problemsById,
}: SurgeryOrderDetailPanelProps) {
  const summary = summarizeSurgeryOrder(serviceRequest);
  const items = surgeryOrderItems(serviceRequest, itemRequests);

  const problem = surgeryOrderProblem(serviceRequest);
  const currentProblem = problem ? problemsById?.get(problem.conditionId) : undefined;
  const problemText = currentProblem ? problemLabel(currentProblem) : problem?.display || "-";

  const scheduled = summary.scheduledDate
    ? `${summary.scheduledDate} ${summary.scheduledTime}`.trim() +
      (summary.durationMinutes != null ? `(${summary.durationMinutes}分)` : "")
    : "未定";
  const bloodPreparation = summary.bloodPreparation
    ? surgeryBloodPreparationDisplay(summary.bloodPreparation) +
      (summary.bloodPreparationUnits ? ` ${summary.bloodPreparationUnits}単位` : "")
    : "-";

  return (
    <div className="prescription-detail">
      <fieldset>
        <legend>手術共通</legend>
        <dl className="prescription-detail__common">
          <dt>対象プロブレム</dt>
          <dd>{problemText}</dd>
          <dt>予定区分</dt>
          <dd>{summary.priorityDisplay}</dd>
          <dt>予定日時</dt>
          <dd>{scheduled}</dd>
          <dt>手術室</dt>
          <dd>{summary.roomName || "未定"}</dd>
          <dt>入外区分</dt>
          <dd>{summary.settingDisplay || "-"}</dd>
          <dt>執刀科</dt>
          <dd>{summary.surgicalDepartmentName || "-"}</dd>
          <dt>依頼科 | 依頼医師</dt>
          <dd>{orderContextSummary(prescriptionRequester(serviceRequest)) || "-"}</dd>
          <dt>スタッフ</dt>
          <dd>
            {summary.staff.length > 0
              ? summary.staff
                  .map((s) => `${surgeryStaffRoleDisplay(s.role)}: ${s.practitionerName}`)
                  .join(" / ")
              : "-"}
          </dd>
          <dt>麻酔</dt>
          <dd>
            {[
              summary.anesthesiaMethods.map(surgeryAnesthesiaMethodDisplay).join("・"),
              surgeryAnesthesiaManagementDisplay(summary.anesthesiaManagement),
            ]
              .filter(Boolean)
              .join(" / ") || "-"}
          </dd>
          <dt>手術体位</dt>
          <dd>{surgeryPositionDisplay(summary.positionCode) || "-"}</dd>
          <dt>予定出血量</dt>
          <dd>{summary.estimatedBloodLoss ? `${summary.estimatedBloodLoss} mL` : "-"}</dd>
          <dt>輸血準備</dt>
          <dd>{bloodPreparation}</dd>
          <dt>特殊機器</dt>
          <dd>{summary.equipmentLabels.join("・") || "-"}</dd>
          <dt>検体提出予定</dt>
          <dd>{summary.specimenPlans.map(surgerySpecimenPlanDisplay).join("・") || "-"}</dd>
          <dt>同意書</dt>
          <dd>{summary.consents.map(surgeryConsentDisplay).join("・") || "-"}</dd>
          <dt>特記・申し送り</dt>
          <dd>{summary.comment || "-"}</dd>
          <dt>術前指示</dt>
          <dd className="rad-gp__text">
            <PreopInstruction
              text={summary.preopInstruction}
              responseId={summary.preopInstructionResponseId}
            />
          </dd>
          <RegisteredAtRow authoredOn={serviceRequest.authoredOn} />
        </dl>
      </fieldset>

      <fieldset className="rp-card">
        <legend>術式</legend>
        <table className="rp-card__medicines rp-card__medicines--detail">
          <thead>
            <tr>
              <th></th>
              <th>術式</th>
              <th>部位</th>
              <th>到達法</th>
              <th>術前診断</th>
              <th>Kコード</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={item.code}>
                <td>{index === 0 ? "主" : "副"}</td>
                <td>{item.name}</td>
                <td>{surgeryBodySiteLabel(item) || "-"}</td>
                <td>{surgeryApproachDisplay(item.approach) || "-"}</td>
                <td>{item.reasonName || "-"}</td>
                <td>{item.receiptCode || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && <p className="patient-table__empty">術式がありません。</p>}
      </fieldset>
    </div>
  );
}

// 術前指示。テンプレートから記載した場合は回答に描き込み済みシェーマ画像が
// 含まれることがあるので、平文の「あり」の印に代えて実物を続けて出す
// (放射線・生理検査の特別指示と同じ見せ方)。
function PreopInstruction({ text, responseId }: { text: string; responseId: string }) {
  const lines = schemaAnnotatedLines(text);
  if (lines.length === 0 && !responseId) return <>-</>;

  return (
    <>
      {lines.join("\n")}
      {responseId && <ResponseSchemaImages responseId={responseId} />}
    </>
  );
}
