import { Link, useParams } from "react-router-dom";
import { useMedicationRequests, useServiceRequest } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import {
  groupByRp,
  medicationRequestIds,
  prescriptionComment,
  summarizeServiceRequest,
} from "../fhir/prescriptionHelpers";

export function PrescriptionDetailPage() {
  const { patientId, srId } = useParams<{ patientId: string; srId: string }>();

  const serviceRequest = useServiceRequest(srId);
  const mrIds = serviceRequest.data ? medicationRequestIds(serviceRequest.data.data) : [];
  const medicationRequests = useMedicationRequests(mrIds);

  const isLoading = serviceRequest.isLoading || medicationRequests.some((q) => q.isLoading);
  const error = serviceRequest.error ?? medicationRequests.find((q) => q.error)?.error;

  const sr = serviceRequest.data?.data;
  const summary = sr ? summarizeServiceRequest(sr) : undefined;
  const mrs = medicationRequests
    .map((q) => q.data?.data)
    .filter((r): r is fhir4.MedicationRequest => Boolean(r));
  const rps = mrs.length === mrIds.length ? groupByRp(mrs) : [];

  return (
    <div className="page">
      <div className="page__header">
        <h1>処方内容</h1>
        <Link to={`/patients/${patientId}/prescriptions`} className="button">
          ← 処方一覧に戻る
        </Link>
      </div>

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
                <dl className="prescription-detail__common">
                  <dt>用法</dt>
                  <dd>{rp.usageName ?? "-"}</dd>
                  {rp.basicCategory === "内服" && (
                    <>
                      <dt>投与日数</dt>
                      <dd>{rp.doseDays ?? "-"}</dd>
                    </>
                  )}
                  {rp.basicCategory === "頓服" && (
                    <>
                      <dt>投与回数</dt>
                      <dd>{rp.doseCount ?? "-"}</dd>
                    </>
                  )}
                  <dt>用法コメント</dt>
                  <dd>{rp.usageComment || "-"}</dd>
                </dl>
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
              </fieldset>
            ))}
          </div>
        )
      )}
    </div>
  );
}
