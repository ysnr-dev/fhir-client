import type { ReactNode } from "react";
import { problemLabel } from "../fhir/conditionHelpers";
import {
  groupInjectionByRp,
  injectionComment,
  injectionProblem,
  summarizeInjectionServiceRequest,
} from "../fhir/injectionHelpers";
import { orderContextSummary, prescriptionRequester } from "../fhir/prescriptionHelpers";

// 注射オーダーの内容表示。カルテ画面の詳細モーダルから使う(処方の
// PrescriptionDetailPanel と同じ構成)。

interface InjectionDetailPanelProps {
  serviceRequest: fhir4.ServiceRequest;
  medicationRequests: fhir4.MedicationRequest[];
  problemsById?: Map<string, fhir4.Condition>;
  children?: ReactNode;
}

export function InjectionDetailPanel({
  serviceRequest,
  medicationRequests,
  problemsById,
  children,
}: InjectionDetailPanelProps) {
  const summary = summarizeInjectionServiceRequest(serviceRequest);
  const rps = groupInjectionByRp(medicationRequests);
  const comment = injectionComment(serviceRequest);

  const problem = injectionProblem(serviceRequest);
  const currentProblem = problem ? problemsById?.get(problem.conditionId) : undefined;
  const problemText = currentProblem ? problemLabel(currentProblem) : problem?.display || "-";

  return (
    <div className="prescription-detail">
      <fieldset>
        <legend>注射共通</legend>
        <dl className="prescription-detail__common">
          <dt>対象プロブレム</dt>
          <dd>{problemText}</dd>
          <dt>注射日</dt>
          <dd>{serviceRequest.authoredOn?.slice(0, 10) ?? "-"}</dd>
          <dt>入外区分</dt>
          <dd>{summary.settingDisplay || "-"}</dd>
          <dt>注射区分</dt>
          <dd>{summary.categoryDisplay || "-"}</dd>
          <dt>依頼科 | 依頼医師</dt>
          <dd>{orderContextSummary(prescriptionRequester(serviceRequest)) || "-"}</dd>
          <dt>注射コメント</dt>
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
                <th>投与量</th>
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
            <dt>用法種別</dt>
            <dd>{rp.usageTypeDisplay ?? "-"}</dd>
            <dt>投与経路</dt>
            <dd>{rp.routeDisplay ?? "-"}</dd>
            <dt>投与部位</dt>
            <dd>{rp.siteDisplay ?? "-"}</dd>
            <dt>手技</dt>
            <dd>{rp.methodDisplay ?? "-"}</dd>
            <dt>ライン</dt>
            <dd>{rp.lineDisplay ?? "-"}</dd>
            <dt>投与速度</dt>
            <dd>{rp.rate != null ? `${rp.rate} mL/h` : "-"}</dd>
            <dt>開始時刻</dt>
            {/* 日付は注射日なので時刻だけを並べる。 */}
            <dd>{rp.startTimes.join("、") || "-"}</dd>
            <dt>用法コメント</dt>
            <dd>{rp.usageComment || "-"}</dd>
          </dl>
        </fieldset>
      ))}

      {children}
    </div>
  );
}
