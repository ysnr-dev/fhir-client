import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FhirError } from "../api/fhirClient";
import { useOrganization, useUpdateOrganization } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { OrganizationForm } from "../components/OrganizationForm";
import {
  buildOrganization,
  parseOrganization,
  type OrganizationFormValues,
} from "../fhir/organizationHelpers";

export function OrganizationEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: result, isLoading, error: loadError } = useOrganization(id);
  const updateOrganization = useUpdateOrganization();
  const [conflict, setConflict] = useState(false);

  function handleSubmit(values: OrganizationFormValues) {
    if (!id || !result?.etag) return;
    setConflict(false);
    updateOrganization.mutate(
      { organization: buildOrganization(values, id), etag: result.etag },
      {
        onSuccess: () => navigate("/organizations"),
        onError: (error) => {
          if (error instanceof FhirError && error.status === 412) {
            setConflict(true);
          }
        },
      },
    );
  }

  if (isLoading) return <div className="page">読み込み中...</div>;

  if (loadError || !result) {
    return (
      <div className="page">
        <div className="page__header">
          <h1>医療機関編集</h1>
          <Link to="/organizations" className="button">
            ← 一覧に戻る
          </Link>
        </div>
        <ErrorBanner error={loadError} />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>医療機関編集</h1>
        <Link to="/organizations" className="button">
          ← 一覧に戻る
        </Link>
      </div>
      {conflict && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">
            この医療機関情報は他の操作によって更新されています。画面を再読込してから再度編集してください。
          </p>
        </div>
      )}
      <OrganizationForm
        initialValues={parseOrganization(result.data)}
        onSubmit={handleSubmit}
        submitting={updateOrganization.isPending}
        submitError={conflict ? undefined : updateOrganization.error}
        submitLabel="更新"
      />
    </div>
  );
}
