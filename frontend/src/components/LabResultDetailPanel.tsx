import { useLabOrderDetail, useLabResultDetail } from "../api/queries";
import {
  labOrderItemRequests,
  labOrderItems,
  labOrderLabel,
  serviceRequestsOf,
} from "../fhir/labOrderHelpers";
import {
  interpretationClass,
  observationLineDisplay,
  specimenNamesById,
  splitLabResultDetailBundle,
  summarizeDiagnosticReport,
} from "../fhir/labResultHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { FhirJsonView } from "./FhirJsonView";

// 検査結果の内容表示。詳細ページとカルテ画面の検査結果タブの双方から使う。
// DO・編集・削除の操作ボタンと前後移動は、遷移先が異なるので呼び出し側が持つ。

// 紐付いている検体検査オーダーの 1 行要約。オーダーが削除済みでも検査結果自体は
// 表示できるようにしたいので、引けなかった場合は id だけを見せる。
function useLabOrderLabel(orderId: string | undefined): string {
  const order = useLabOrderDetail(orderId);
  if (!orderId) return "";
  if (order.isLoading) return "読み込み中...";

  const serviceRequests = serviceRequestsOf(order.data?.data);
  const header = serviceRequests.find((sr) => sr.id === orderId);
  if (!header) return `${orderId} (削除済み)`;

  return labOrderLabel(
    header,
    labOrderItems(header, labOrderItemRequests(serviceRequests, orderId)),
  );
}

export function LabResultDetailPanel({ reportId }: { reportId: string }) {
  const detail = useLabResultDetail(reportId);

  const { report, observations, specimens } = detail.data
    ? splitLabResultDetailBundle(detail.data.data)
    : { report: undefined, observations: [], specimens: [] };
  const summary = report ? summarizeDiagnosticReport(report) : undefined;
  const specimenNames = specimenNamesById(specimens);
  const orderLabel = useLabOrderLabel(summary?.orderId);

  return (
    <>
      <ErrorBanner error={detail.error} />

      {detail.isLoading ? (
        <p>読み込み中...</p>
      ) : (
        report &&
        summary && (
          <div className="prescription-detail">
            <fieldset>
              <legend>検査共通</legend>
              <dl className="prescription-detail__common">
                <dt>検体採取日</dt>
                <dd>{summary.date}</dd>
                <dt>入外区分</dt>
                <dd>{summary.settingDisplay}</dd>
                <dt>検体検査オーダー</dt>
                <dd>{summary.orderId ? orderLabel : "紐付けなし"}</dd>
              </dl>
            </fieldset>

            <fieldset className="rp-card">
              <legend>検査項目</legend>
              <table className="rp-card__medicines rp-card__medicines--detail rp-card__medicines--lab">
                <thead>
                  <tr>
                    <th>検査項目</th>
                    <th>略称</th>
                    <th>材料</th>
                    <th className="rp-card__lab-value">結果値</th>
                    <th className="rp-card__lab-unit">単位</th>
                  </tr>
                </thead>
                <tbody>
                  {observations.map((obs, index) => {
                    const line = observationLineDisplay(obs, specimenNames);
                    return (
                      <tr key={line.id || index}>
                        <td>{line.name || "-"}</td>
                        <td>{line.abbreviation || "-"}</td>
                        <td>{line.specimen || "-"}</td>
                        <td className={interpretationClass(line.interpretation, "rp-card__lab-value")}>
                          {line.value || "-"}
                        </td>
                        <td className="rp-card__lab-unit">{line.unit || "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </fieldset>

            <details className="prescription-detail__raw">
              <summary>FHIR JSON を表示</summary>
              <FhirJsonView resource={detail.data?.data} />
            </details>
          </div>
        )
      )}
    </>
  );
}
