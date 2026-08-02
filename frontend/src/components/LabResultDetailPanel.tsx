import { useState } from "react";
import { useLabResultDetail } from "../api/queries";
import {
  interpretationClass,
  observationLineDisplay,
  specimenNamesById,
  splitLabResultDetailBundle,
  summarizeDiagnosticReport,
} from "../fhir/labResultHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { JsonBlock } from "./JsonBlock";

// 検査結果の内容表示。詳細ページとカルテ画面の検査結果タブの双方から使う。
// DO・編集・削除の操作ボタンと前後移動は、遷移先が異なるので呼び出し側が持つ。

type JsonView = "bundle" | "resource";

export function LabResultDetailPanel({ reportId }: { reportId: string }) {
  const [jsonView, setJsonView] = useState<JsonView>("bundle");
  const detail = useLabResultDetail(reportId);

  const { report, observations, specimens } = detail.data
    ? splitLabResultDetailBundle(detail.data.data)
    : { report: undefined, observations: [], specimens: [] };
  const summary = report ? summarizeDiagnosticReport(report) : undefined;
  const specimenNames = specimenNamesById(specimens);

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
              </dl>
            </fieldset>

            <fieldset className="rp-card">
              <legend>検査項目</legend>
              <table className="rp-card__medicines rp-card__medicines--detail">
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
              <div className="prescription-detail__raw-toggle">
                <label>
                  <input
                    type="radio"
                    name="json-view"
                    checked={jsonView === "bundle"}
                    onChange={() => setJsonView("bundle")}
                  />
                  Bundle
                </label>
                <label>
                  <input
                    type="radio"
                    name="json-view"
                    checked={jsonView === "resource"}
                    onChange={() => setJsonView("resource")}
                  />
                  リソース単位
                </label>
              </div>

              {jsonView === "bundle" ? (
                <JsonBlock value={detail.data?.data} />
              ) : (
                <div className="prescription-detail__raw-resources">
                  {detail.data?.data.entry?.map((entry, index) => (
                    <div className="prescription-detail__raw-resource" key={entry.resource?.id ?? index}>
                      <h3>
                        {entry.resource?.resourceType}
                        {entry.resource?.id ? ` / ${entry.resource.id}` : ""}
                      </h3>
                      <JsonBlock value={entry.resource} />
                    </div>
                  ))}
                </div>
              )}
            </details>
          </div>
        )
      )}
    </>
  );
}
