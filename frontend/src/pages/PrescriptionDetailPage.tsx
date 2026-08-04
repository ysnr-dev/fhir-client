import { Link, useNavigate, useParams } from "react-router-dom";
import { useDeletePrescription, usePrescriptionDetail } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { FhirJsonView } from "../components/FhirJsonView";
import { PatientHeader } from "../components/PatientHeader";
import { PrescriptionDetailPanel } from "../components/PrescriptionDetailPanel";
import { splitPrescriptionDetailBundle } from "../fhir/prescriptionHelpers";

export function PrescriptionDetailPage() {
  const { patientId, srId } = useParams<{ patientId: string; srId: string }>();
  const navigate = useNavigate();

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
        sr && (
          // 対象プロブレムの表示名は保存時点のもの。カルテ画面のバッジと違い、
          // この画面はプロブレム一覧を取得しないため引き直さない。
          <PrescriptionDetailPanel serviceRequest={sr} medicationRequests={mrs}>
            <details className="prescription-detail__raw">
              <summary>FHIR JSON を表示</summary>
              <FhirJsonView resource={detail.data?.data} />
            </details>
          </PrescriptionDetailPanel>
        )
      )}
    </div>
  );
}
