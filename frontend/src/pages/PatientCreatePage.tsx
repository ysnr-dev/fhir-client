import { Link, useNavigate } from "react-router-dom";
import { useCreatePatient } from "../api/queries";
import { PatientForm } from "../components/PatientForm";
import { buildPatient, type PatientFormValues } from "../fhir/patientHelpers";

export function PatientCreatePage() {
  const navigate = useNavigate();
  const createPatient = useCreatePatient();

  function handleSubmit(values: PatientFormValues) {
    createPatient.mutate(buildPatient(values), {
      onSuccess: () => navigate("/patients"),
    });
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>患者登録</h1>
        <Link to="/patients" className="button">
          ← 一覧に戻る
        </Link>
      </div>
      <PatientForm
        onSubmit={handleSubmit}
        submitting={createPatient.isPending}
        submitError={createPatient.error}
        submitLabel="登録"
        autoNumber
      />
    </div>
  );
}
