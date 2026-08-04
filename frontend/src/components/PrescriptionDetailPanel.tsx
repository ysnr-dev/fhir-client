import type { ReactNode } from "react";
import { problemLabel } from "../fhir/conditionHelpers";
import {
  groupByRp,
  orderContextSummary,
  prescriptionComment,
  prescriptionProblem,
  prescriptionRequester,
  summarizeServiceRequest,
} from "../fhir/prescriptionHelpers";

// 処方の内容表示。処方内容ページとカルテ画面の詳細モーダルの双方から使う。
// DO・編集・削除の操作ボタンは、遷移先が異なるので呼び出し側が持つ。

interface PrescriptionDetailPanelProps {
  serviceRequest: fhir4.ServiceRequest;
  medicationRequests: fhir4.MedicationRequest[];
  /**
   * 対象プロブレムの表示名を現在の病名から引き直すための辞書。渡さない場合は
   * 処方に保存されている登録時点の表示名をそのまま出す。
   */
  problemsById?: Map<string, fhir4.Condition>;
  /** 内容の後ろに続けて出す要素(詳細ページの FHIR JSON 表示など)。 */
  children?: ReactNode;
}

export function PrescriptionDetailPanel({
  serviceRequest,
  medicationRequests,
  problemsById,
  children,
}: PrescriptionDetailPanelProps) {
  const summary = summarizeServiceRequest(serviceRequest);
  const rps = groupByRp(medicationRequests);
  const comment = prescriptionComment(serviceRequest);

  const problem = prescriptionProblem(serviceRequest);
  const currentProblem = problem ? problemsById?.get(problem.conditionId) : undefined;
  const problemText = currentProblem ? problemLabel(currentProblem) : problem?.display || "-";

  return (
    <div className="prescription-detail">
      <fieldset>
        <legend>処方共通</legend>
        <dl className="prescription-detail__common">
          <dt>対象プロブレム</dt>
          <dd>{problemText}</dd>
          <dt>処方日</dt>
          <dd>{summary.date}</dd>
          <dt>入外区分</dt>
          <dd>{summary.settingDisplay}</dd>
          <dt>処方区分</dt>
          <dd>{summary.categoryDisplay}</dd>
          <dt>依頼科 | 依頼医師</dt>
          <dd>{orderContextSummary(prescriptionRequester(serviceRequest)) || "-"}</dd>
          <dt>処方箋コメント</dt>
          <dd>{comment || "-"}</dd>
        </dl>
      </fieldset>

      {rps.map((rp) => (
        <fieldset className="rp-card" key={rp.rpNumber}>
          <legend>{`RP${rp.rpNumber}`}</legend>
          <table className="rp-card__medicines rp-card__medicines--detail">
            <thead>
              <tr>
                <th>医薬品</th>
                <th>用量</th>
                <th>単位</th>
                <th>薬剤コメント</th>
                <th className="rp-card__medicine-di"></th>
              </tr>
            </thead>
            <tbody>
              {rp.medicines.map((med) => (
                <tr key={med.orderInRp}>
                  <td>{med.name}</td>
                  <td>{med.dose ?? "-"}</td>
                  <td>{med.unit ?? "-"}</td>
                  <td>{med.comment || "-"}</td>
                  <td className="rp-card__medicine-di">
                    {med.yjCode && (
                      <a
                        className="master-search__medley-link"
                        href={`https://medley.life/medicines/prescription/${med.yjCode}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        DI
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="prescription-detail__common">
            <dt>用法</dt>
            <dd className="prescription-detail__usage-value">
              <span>{rp.usageName ?? "-"}</span>
              {rp.basicCategory === "内服" && (
                <span className="prescription-detail__dose">
                  <span className="prescription-detail__dose-label">投与日数</span>
                  {rp.doseDays != null ? `${rp.doseDays}日分` : "-"}
                </span>
              )}
              {rp.basicCategory === "頓服" && (
                <span className="prescription-detail__dose">
                  <span className="prescription-detail__dose-label">投与回数</span>
                  {rp.doseCount != null ? `${rp.doseCount}回分` : "-"}
                </span>
              )}
            </dd>
            <dt>用法コメント</dt>
            <dd>{rp.usageComment || "-"}</dd>
          </dl>
        </fieldset>
      ))}

      {children}
    </div>
  );
}
