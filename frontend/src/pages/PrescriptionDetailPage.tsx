import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useDeletePrescription, usePrescriptionDetail } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { JsonBlock } from "../components/JsonBlock";
import { PatientHeader } from "../components/PatientHeader";
import {
  groupByRp,
  orderContextSummary,
  prescriptionComment,
  prescriptionRequester,
  splitPrescriptionDetailBundle,
  summarizeServiceRequest,
} from "../fhir/prescriptionHelpers";

type JsonView = "bundle" | "resource";

export function PrescriptionDetailPage() {
  const { patientId, srId } = useParams<{ patientId: string; srId: string }>();
  const navigate = useNavigate();
  const [jsonView, setJsonView] = useState<JsonView>("bundle");

  const detail = usePrescriptionDetail(srId);
  const deletePrescription = useDeletePrescription();

  const isLoading = detail.isLoading;
  const error = detail.error ?? deletePrescription.error;

  function handleDelete() {
    if (!srId) return;
    if (!window.confirm("この処方を削除します。よろしいですか?")) return;
    deletePrescription.mutate(srId, {
      onSuccess: () => navigate(`/patients/${patientId}/prescriptions`),
    });
  }

  const { serviceRequest: sr, medicationRequests: mrs } = detail.data
    ? splitPrescriptionDetailBundle(detail.data.data)
    : { serviceRequest: undefined, medicationRequests: [] };
  const summary = sr ? summarizeServiceRequest(sr) : undefined;
  const rps = sr ? groupByRp(mrs) : [];

  return (
    <div className="page">
      <div className="page__header">
        <h1>処方内容</h1>
        <div>
          <Link to={`/patients/${patientId}/prescriptions/new?from=${srId}`} className="button">
            DO
          </Link>
          <Link to={`/patients/${patientId}/prescriptions/${srId}/edit`} className="button">
            編集
          </Link>
          <button type="button" onClick={handleDelete} disabled={deletePrescription.isPending}>
            削除
          </button>
          <Link to={`/patients/${patientId}/prescriptions`} className="button">
            ← 処方一覧に戻る
          </Link>
        </div>
      </div>

      <PatientHeader patientId={patientId} />

      <ErrorBanner error={error} />

      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        sr &&
        summary && (
          <div className="prescription-detail">
            <fieldset>
              <legend>処方共通</legend>
              <dl className="prescription-detail__common">
                <dt>処方日</dt>
                <dd>{summary.date}</dd>
                <dt>入外区分</dt>
                <dd>{summary.settingDisplay}</dd>
                <dt>処方区分</dt>
                <dd>{summary.categoryDisplay}</dd>
                <dt>依頼科 / 依頼医師</dt>
                <dd>{orderContextSummary(prescriptionRequester(sr)) || "-"}</dd>
                <dt>処方箋コメント</dt>
                <dd>{prescriptionComment(sr) || "-"}</dd>
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
