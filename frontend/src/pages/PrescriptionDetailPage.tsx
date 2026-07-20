import { Link, useParams } from "react-router-dom";
import { usePrescriptionDetail } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { JsonBlock } from "../components/JsonBlock";
import { PatientHeader } from "../components/PatientHeader";
import {
  groupByRp,
  prescriptionComment,
  splitPrescriptionDetailBundle,
  summarizeServiceRequest,
} from "../fhir/prescriptionHelpers";

export function PrescriptionDetailPage() {
  const { patientId, srId } = useParams<{ patientId: string; srId: string }>();

  const detail = usePrescriptionDetail(srId);

  const isLoading = detail.isLoading;
  const error = detail.error;

  const { serviceRequest: sr, medicationRequests: mrs } = detail.data
    ? splitPrescriptionDetailBundle(detail.data.data)
    : { serviceRequest: undefined, medicationRequests: [] };
  const summary = sr ? summarizeServiceRequest(sr) : undefined;
  const rps = sr ? groupByRp(mrs) : [];

  return (
    <div className="page">
      <div className="page__header">
        <h1>処方内容</h1>
        <Link to={`/patients/${patientId}/prescriptions`} className="button">
          ← 処方一覧に戻る
        </Link>
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
                <dt>処方箋コメント</dt>
                <dd>{prescriptionComment(sr) || "-"}</dd>
              </dl>
            </fieldset>

            {rps.map((rp) => (
              <fieldset className="rp-card" key={rp.rpNumber}>
                <legend>{`RP${rp.rpNumber}`}</legend>
                <table className="rp-card__medicines">
                  <thead>
                    <tr>
                      <th>医薬品</th>
                      <th>用量</th>
                      <th>単位</th>
                      <th>薬剤コメント</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rp.medicines.map((med) => (
                      <tr key={med.orderInRp}>
                        <td>{med.name}</td>
                        <td>{med.dose ?? "-"}</td>
                        <td>{med.unit ?? "-"}</td>
                        <td>{med.comment || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <dl className="prescription-detail__common">
                  <dt>用法</dt>
                  <dd>{rp.usageName ?? "-"}</dd>
                  {rp.basicCategory === "内服" && (
                    <>
                      <dt>投与日数</dt>
                      <dd>{rp.doseDays != null ? `${rp.doseDays}日分` : "-"}</dd>
                    </>
                  )}
                  {rp.basicCategory === "頓服" && (
                    <>
                      <dt>投与回数</dt>
                      <dd>{rp.doseCount != null ? `${rp.doseCount}回分` : "-"}</dd>
                    </>
                  )}
                  <dt>用法コメント</dt>
                  <dd>{rp.usageComment || "-"}</dd>
                </dl>
              </fieldset>
            ))}

            <details className="prescription-detail__raw">
              <summary>FHIR JSON を表示</summary>
              <JsonBlock value={detail.data?.data} />
            </details>
          </div>
        )
      )}
    </div>
  );
}
