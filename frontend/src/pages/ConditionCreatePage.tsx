import { Link, useNavigate, useParams } from "react-router-dom";
import { useCreateCondition } from "../api/queries";
import { ConditionForm } from "../components/ConditionForm";
import { PatientHeader } from "../components/PatientHeader";
import { buildCondition, type ConditionFormValues } from "../fhir/conditionHelpers";

export function ConditionCreatePage() {
  const { patientId } = useParams<{ patientId: string }>();
  const navigate = useNavigate();
  const createCondition = useCreateCondition();

  function handleSubmit(values: ConditionFormValues) {
    if (!patientId) return;
    createCondition.mutate(buildCondition(values, patientId), {
      onSuccess: () => navigate(`/patients/${patientId}/conditions`),
    });
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>病名登録</h1>
        <Link to={`/patients/${patientId}/conditions`} className="button">
          ← 病名一覧に戻る
        </Link>
      </div>

      <PatientHeader patientId={patientId} />

      <ConditionForm
        onSubmit={handleSubmit}
        submitting={createCondition.isPending}
        submitError={createCondition.error}
      />
    </div>
  );
}
