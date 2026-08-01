import { Link, useNavigate } from "react-router-dom";
import { useCreatePractitioner } from "../api/queries";
import { PractitionerForm } from "../components/PractitionerForm";
import { buildPractitioner, type PractitionerFormValues } from "../fhir/practitionerHelpers";

export function PractitionerCreatePage() {
  const navigate = useNavigate();
  const createPractitioner = useCreatePractitioner();

  function handleSubmit(values: PractitionerFormValues) {
    createPractitioner.mutate(buildPractitioner(values), {
      onSuccess: () => navigate("/practitioners"),
    });
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>医療従事者登録</h1>
        <Link to="/practitioners" className="button">
          ← 一覧に戻る
        </Link>
      </div>
      <PractitionerForm
        onSubmit={handleSubmit}
        submitting={createPractitioner.isPending}
        submitError={createPractitioner.error}
        submitLabel="登録"
      />
    </div>
  );
}
