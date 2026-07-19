import { Link, useNavigate, useParams } from "react-router-dom";
import { useCreatePrescription } from "../api/queries";
import { PrescriptionForm } from "../components/PrescriptionForm";
import { buildPrescriptionBundle, type PrescriptionFormValues } from "../fhir/prescriptionHelpers";

export function PrescriptionCreatePage() {
  const { patientId } = useParams<{ patientId: string }>();
  const navigate = useNavigate();
  const createPrescription = useCreatePrescription();

  function handleSubmit(values: PrescriptionFormValues) {
    if (!patientId) return;
    createPrescription.mutate(buildPrescriptionBundle(values, patientId), {
      onSuccess: () => navigate(`/patients/${patientId}/prescriptions`),
    });
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>処方登録</h1>
        <Link to={`/patients/${patientId}/prescriptions`} className="button">
          ← 処方一覧に戻る
        </Link>
      </div>
      <PrescriptionForm
        onSubmit={handleSubmit}
        submitting={createPrescription.isPending}
        submitError={createPrescription.error}
      />
    </div>
  );
}
