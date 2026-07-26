import { Link, useNavigate, useParams } from "react-router-dom";
import { useCreateLabResult } from "../api/queries";
import { LabResultForm } from "../components/LabResultForm";
import { PatientHeader } from "../components/PatientHeader";
import { buildLabResultBundle, type LabResultFormValues } from "../fhir/labResultHelpers";

export function LabResultCreatePage() {
  const { patientId } = useParams<{ patientId: string }>();
  const navigate = useNavigate();
  const createLabResult = useCreateLabResult();

  function handleSubmit(values: LabResultFormValues) {
    if (!patientId) return;
    createLabResult.mutate(buildLabResultBundle(values, patientId), {
      onSuccess: () => navigate(`/patients/${patientId}/lab-results`),
    });
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>検査結果登録</h1>
        <Link to={`/patients/${patientId}/lab-results`} className="button">
          ← 検査結果一覧に戻る
        </Link>
      </div>

      <PatientHeader patientId={patientId} />

      <LabResultForm
        onSubmit={handleSubmit}
        submitting={createLabResult.isPending}
        submitError={createLabResult.error}
      />
    </div>
  );
}
