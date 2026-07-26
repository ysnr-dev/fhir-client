import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useDeleteLabResult, useLabResultDetail } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { JsonBlock } from "../components/JsonBlock";
import { PatientHeader } from "../components/PatientHeader";
import {
  observationLineDisplay,
  splitLabResultDetailBundle,
  summarizeDiagnosticReport,
} from "../fhir/labResultHelpers";

type JsonView = "bundle" | "resource";

export function LabResultDetailPage() {
  const { patientId, reportId } = useParams<{ patientId: string; reportId: string }>();
  const navigate = useNavigate();
  const [jsonView, setJsonView] = useState<JsonView>("bundle");

  const detail = useLabResultDetail(reportId);
  const deleteLabResult = useDeleteLabResult();

  const isLoading = detail.isLoading;
  const error = detail.error ?? deleteLabResult.error;

  function handleDelete() {
    if (!reportId) return;
    if (!window.confirm("この検査結果を削除します。よろしいですか?")) return;
    deleteLabResult.mutate(reportId, {
      onSuccess: () => navigate(`/patients/${patientId}/lab-results`),
    });
  }

  const { report, observations } = detail.data
    ? splitLabResultDetailBundle(detail.data.data)
    : { report: undefined, observations: [] };
  const summary = report ? summarizeDiagnosticReport(report) : undefined;

  return (
    <div className="page">
      <div className="page__header">
        <h1>検査結果内容</h1>
        <div>
          <Link to={`/patients/${patientId}/lab-results/${reportId}/edit`} className="button">
            編集
          </Link>
          <button type="button" onClick={handleDelete} disabled={deleteLabResult.isPending}>
            削除
          </button>
          <Link to={`/patients/${patientId}/lab-results`} className="button">
            ← 検査結果一覧に戻る
          </Link>
        </div>
      </div>

      <PatientHeader patientId={patientId} />

      <ErrorBanner error={error} />

      {isLoading ? (
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
                    <th>結果値</th>
                    <th>単位</th>
                  </tr>
                </thead>
                <tbody>
                  {observations.map((obs, index) => {
                    const line = observationLineDisplay(obs);
                    return (
                      <tr key={line.id || index}>
                        <td>{line.name || "-"}</td>
                        <td>{line.abbreviation || "-"}</td>
                        <td>{line.value || "-"}</td>
                        <td>{line.unit || "-"}</td>
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
    </div>
  );
}
