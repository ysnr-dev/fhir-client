import type { ReactNode } from "react";
import { problemLabel } from "../fhir/conditionHelpers";
import {
  groupInjectionByRp,
  injectionComment,
  injectionDayOf,
  injectionProblem,
  injectionSeriesLabel,
  injectionSeriesOf,
  injectionTimesLabel,
  scheduleLabel,
  summarizeInjectionServiceRequest,
} from "../fhir/injectionHelpers";
import {
  injectionTaskStatus,
  injectionTaskStatusDisplay,
} from "../fhir/injectionTaskHelpers";
import {
  ORDER_IN_RP_SYSTEM,
  RP_NUMBER_SYSTEM,
  identifierValue,
  orderContextSummary,
  prescriptionRequester,
} from "../fhir/prescriptionHelpers";
import {
  cycleDayLabel,
  regimenDoseOf,
  regimenOrderOf,
  type RegimenApplication,
} from "../fhir/regimenOrderHelpers";
import { EnteredByRow, RegisteredAtRow } from "./OrderDetailRows";

// 注射オーダーの内容表示。カルテ画面の詳細モーダルから使う(処方の
// PrescriptionDetailPanel と同じ構成)。

interface InjectionDetailPanelProps {
  serviceRequest: fhir4.ServiceRequest;
  medicationRequests: fhir4.MedicationRequest[];
  /** この注射の進捗 Task。無ければ依頼済として出す。 */
  task?: fhir4.Task;
  problemsById?: Map<string, fhir4.Condition>;
  /**
   * 化学療法の適用ヘッダ(薬剤部の監査。§7.6 E-1)。渡すと体格と、体表面積あたりの
   * 逆算を薬剤の行に出す。渡さなければ出さない。
   */
  regimenApplication?: RegimenApplication | null;
  children?: ReactNode;
}

/** 力価から体表面積あたりの量を逆算する(「85.0 mg/m²」)。薬剤部が基準と突き合わせる。 */
function perBsaLabel(dose: number | undefined, unit: string | undefined, bsa: number | null): string {
  if (dose === undefined || !bsa || bsa <= 0) return "";
  return `${Math.round((dose / bsa) * 10) / 10} ${unit ?? ""}/m²`;
}

export function InjectionDetailPanel({
  serviceRequest,
  medicationRequests,
  task,
  problemsById,
  regimenApplication,
  children,
}: InjectionDetailPanelProps) {
  const regimenRef = regimenOrderOf(serviceRequest);
  // 減量率は MedicationRequest の拡張にある。RP 番号 + RP 内の順で薬剤の行に当てる。
  const doseByRp = new Map(
    medicationRequests.flatMap((mr) => {
      const dose = regimenDoseOf(mr);
      if (!dose) return [];
      const rp = identifierValue(mr, RP_NUMBER_SYSTEM) ?? "";
      const order = identifierValue(mr, ORDER_IN_RP_SYSTEM) ?? "";
      return [[`${rp}-${order}`, dose] as const];
    }),
  );
  const summary = summarizeInjectionServiceRequest(serviceRequest);
  const series = injectionSeriesOf(serviceRequest);
  const seriesLabel = injectionSeriesLabel(serviceRequest);
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
          <dd>
            {injectionDayOf(serviceRequest) || "-"}
            {seriesLabel && <span className="injection-series-label">{seriesLabel}</span>}
          </dd>
          {regimenRef && (
            <>
              <dt>化学療法</dt>
              <dd>
                {`${regimenRef.name} ${cycleDayLabel(regimenRef)}`}
                {regimenApplication?.bsa !== null && regimenApplication?.bsa !== undefined && (
                  <span className="injection-detail__body">
                    {[
                      `体表面積 ${regimenApplication.bsa} m²`,
                      regimenApplication.height !== null ? `身長 ${regimenApplication.height} cm` : "",
                      regimenApplication.weight !== null ? `体重 ${regimenApplication.weight} kg` : "",
                    ]
                      .filter(Boolean)
                      .join(" / ")}
                  </span>
                )}
                {regimenRef.reduction && (
                  <span className="injection-worklist__reduced">{`減量: ${regimenRef.reduction}`}</span>
                )}
              </dd>
            </>
          )}
          <dt>実施パターン</dt>
          {/* 束ねを持たない古いオーダーは単日なので「-」。期間はその束ねの登録時のもの。 */}
          <dd>
            {series
              ? `${scheduleLabel(series.schedule)}${
                  series.end > series.start ? `(${series.start} 〜 ${series.end})` : ""
                }`
              : "-"}
          </dd>
          <dt>進捗</dt>
          <dd>{injectionTaskStatusDisplay(injectionTaskStatus(task))}</dd>
          <dt>入外区分</dt>
          <dd>{summary.settingDisplay || "-"}</dd>
          <dt>注射区分</dt>
          <dd>{summary.categoryDisplay || "-"}</dd>
          <dt>依頼科 | 依頼医師</dt>
          <dd>{orderContextSummary(prescriptionRequester(serviceRequest)) || "-"}</dd>
          <dt>注射コメント</dt>
          <dd>{comment || "-"}</dd>
          <RegisteredAtRow authoredOn={serviceRequest.authoredOn} />
          <EnteredByRow serviceRequestId={serviceRequest.id} />
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
              {rp.medicines.map((med) => {
                const dose = doseByRp.get(`${rp.rpNumber}-${med.orderInRp}`);
                const perBsa = perBsaLabel(med.dose, med.unit, regimenApplication?.bsa ?? null);
                return (
                <tr key={med.orderInRp}>
                  <td>{med.name}</td>
                  <td>
                    {med.dose ?? "-"}
                    {/* 薬剤部の監査(§7.6 E-1)。指示は力価なので、レジメンの基準
                        (mg/m²)と突き合わせられるよう体表面積あたりを添える。 */}
                    {perBsa && <span className="injection-detail__per-bsa">{perBsa}</span>}
                    {dose && dose.ratio !== 100 && (
                      <span className="injection-worklist__reduced">{`${dose.ratio}%`}</span>
                    )}
                  </td>
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
                );
              })}
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
            <dt>開始・終了時刻</dt>
            {/* 日付は注射日なので時刻だけを並べる。終了が翌日に回る場合は「翌」を付ける。 */}
            <dd>{injectionTimesLabel(rp.times) || "-"}</dd>
            <dt>用法コメント</dt>
            <dd>{rp.usageComment || "-"}</dd>
          </dl>
        </fieldset>
      ))}

      {children}
    </div>
  );
}
