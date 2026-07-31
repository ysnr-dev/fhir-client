import { Link, useNavigate, useParams } from "react-router-dom";
import { useCreateAllergy } from "../api/queries";
import { AllergyForm } from "../components/AllergyForm";
import { PatientHeader } from "../components/PatientHeader";
import { buildAllergy, type AllergyFormValues } from "../fhir/allergyHelpers";

export function AllergyCreatePage() {
  const { patientId } = useParams<{ patientId: string }>();
  const navigate = useNavigate();
  const createAllergy = useCreateAllergy();

  function handleSubmit(values: AllergyFormValues) {
    if (!patientId) return;
    createAllergy.mutate(buildAllergy(values, patientId), {
      onSuccess: () => navigate(`/patients/${patientId}/allergies`),
    });
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>アレルギー登録</h1>
        <Link to={`/patients/${patientId}/allergies`} className="button">
          ← アレルギー一覧に戻る
        </Link>
      </div>

      <PatientHeader patientId={patientId} />

      <AllergyForm
        onSubmit={handleSubmit}
        submitting={createAllergy.isPending}
        submitError={createAllergy.error}
      />
    </div>
  );
}
