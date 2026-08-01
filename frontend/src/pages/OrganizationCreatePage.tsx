import { Link, useNavigate } from "react-router-dom";
import { useCreateOrganization } from "../api/queries";
import { OrganizationForm } from "../components/OrganizationForm";
import { buildOrganization, type OrganizationFormValues } from "../fhir/organizationHelpers";

export function OrganizationCreatePage() {
  const navigate = useNavigate();
  const createOrganization = useCreateOrganization();

  function handleSubmit(values: OrganizationFormValues) {
    createOrganization.mutate(buildOrganization(values), {
      onSuccess: () => navigate("/organizations"),
    });
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>医療機関登録</h1>
        <Link to="/organizations" className="button">
          ← 一覧に戻る
        </Link>
      </div>
      <OrganizationForm
        onSubmit={handleSubmit}
        submitting={createOrganization.isPending}
        submitError={createOrganization.error}
        submitLabel="登録"
      />
    </div>
  );
}
