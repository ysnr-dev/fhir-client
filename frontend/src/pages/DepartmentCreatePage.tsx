import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useCreateOrganization } from "../api/queries";
import { DepartmentForm } from "../components/DepartmentForm";
import { buildDepartment, type DepartmentFormValues } from "../fhir/departmentHelpers";

export function DepartmentCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const createDepartment = useCreateOrganization();

  function handleSubmit(values: DepartmentFormValues) {
    createDepartment.mutate(buildDepartment(values), {
      onSuccess: () => navigate("/departments"),
    });
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>診療科登録</h1>
        <Link to="/departments" className="button">
          ← 一覧に戻る
        </Link>
      </div>
      <DepartmentForm
        defaultPartOfId={searchParams.get("organization") ?? undefined}
        onSubmit={handleSubmit}
        submitting={createDepartment.isPending}
        submitError={createDepartment.error}
        submitLabel="登録"
      />
    </div>
  );
}
