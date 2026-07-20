import { Link, useNavigate, useParams } from "react-router-dom";
import { usePrescriptionDetail, useUpdatePrescription } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { PatientHeader } from "../components/PatientHeader";
import { PrescriptionForm } from "../components/PrescriptionForm";
import {
  buildPrescriptionUpdateBundle,
  parsePrescriptionForm,
  splitPrescriptionDetailBundle,
  type PrescriptionFormValues,
} from "../fhir/prescriptionHelpers";

export function PrescriptionEditPage() {
  const { patientId, srId } = useParams<{ patientId: string; srId: string }>();
  const navigate = useNavigate();
  const detail = usePrescriptionDetail(srId);
  const updatePrescription = useUpdatePrescription();

  const { serviceRequest: sr, medicationRequests: mrs } = detail.data
    ? splitPrescriptionDetailBundle(detail.data.data)
    : { serviceRequest: undefined, medicationRequests: [] };

  function handleSubmit(values: PrescriptionFormValues) {
    if (!patientId || !srId || !sr) return;
    const originalIds = mrs.map((mr) => mr.id).filter((id): id is string => Boolean(id));
    updatePrescription.mutate(buildPrescriptionUpdateBundle(values, patientId, srId, originalIds), {
      onSuccess: () => navigate(`/patients/${patientId}/prescriptions/${srId}`),
    });
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>処方編集</h1>
        <Link to={`/patients/${patientId}/prescriptions/${srId}`} className="button">
          ← 処方詳細に戻る
        </Link>
      </div>

      <PatientHeader patientId={patientId} />

      <ErrorBanner error={detail.error} />

      {detail.isLoading ? (
        <p>読み込み中...</p>
      ) : (
        sr && (
          <PrescriptionForm
            initialValues={parsePrescriptionForm(sr, mrs)}
            onSubmit={handleSubmit}
            submitting={updatePrescription.isPending}
            submitError={updatePrescription.error}
            submitLabel="更新"
          />
        )
      )}
    </div>
  );
}
