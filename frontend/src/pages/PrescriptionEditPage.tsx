import { Link, useNavigate, useParams } from "react-router-dom";
import { useUpdatePrescription } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { PatientHeader } from "../components/PatientHeader";
import { PrescriptionForm } from "../components/PrescriptionForm";
import {
  buildPrescriptionUpdateBundle,
  type PrescriptionFormValues,
} from "../fhir/prescriptionHelpers";
import { usePrescriptionInitialValues } from "../hooks/usePrescriptionInitialValues";

export function PrescriptionEditPage() {
  const { patientId, srId } = useParams<{ patientId: string; srId: string }>();
  const navigate = useNavigate();
  const updatePrescription = useUpdatePrescription();

  const {
    serviceRequest: sr,
    medicationRequests: mrs,
    initialValues,
    ready,
    patientMismatch,
    error,
  } = usePrescriptionInitialValues(srId, patientId);

  function handleSubmit(values: PrescriptionFormValues) {
    // 別患者の処方を更新すると subject が URL の患者に書き換わり、処方が付け替わってしまう。
    if (!patientId || !srId || !sr || patientMismatch) return;
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

      <ErrorBanner error={error} />

      {!ready ? (
        <p>読み込み中...</p>
      ) : (
        sr &&
        initialValues && (
          <PrescriptionForm
            initialValues={initialValues}
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
