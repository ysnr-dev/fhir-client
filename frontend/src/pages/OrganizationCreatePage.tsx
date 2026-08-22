import { Link, useNavigate } from "react-router-dom";
import { useCreateOrganization } from "../api/queries";
import { OrganizationForm } from "../components/OrganizationForm";
import { buildOrganization, type OrganizationFormValues } from "../fhir/organizationHelpers";

interface OrganizationCreatePageProps {
  /** 登録後・「一覧に戻る」の戻り先。連携先医療機関の登録で差し替える。 */
  backTo?: string;
  title?: string;
}

export function OrganizationCreatePage({
  backTo = "/organizations",
  title = "医療機関登録",
}: OrganizationCreatePageProps = {}) {
  const navigate = useNavigate();
  const createOrganization = useCreateOrganization();

  function handleSubmit(values: OrganizationFormValues) {
    createOrganization.mutate(buildOrganization(values), {
      onSuccess: () => navigate(backTo),
    });
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>{title}</h1>
        <Link to={backTo} className="button">
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
