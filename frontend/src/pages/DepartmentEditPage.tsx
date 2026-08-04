import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FhirError } from "../api/fhirClient";
import { useOrganization, useUpdateOrganization } from "../api/queries";
import { DepartmentForm } from "../components/DepartmentForm";
import { ErrorBanner } from "../components/ErrorBanner";
import {
  buildDepartment,
  parseDepartment,
  type DepartmentFormValues,
} from "../fhir/departmentHelpers";

export function DepartmentEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: result, isLoading, error: loadError } = useOrganization(id);
  const updateDepartment = useUpdateOrganization();
  const [conflict, setConflict] = useState(false);

  function handleSubmit(values: DepartmentFormValues) {
    if (!id || !result?.etag) return;
    setConflict(false);
    updateDepartment.mutate(
      { organization: buildDepartment(values, id), etag: result.etag },
      {
        onSuccess: () => navigate("/departments"),
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
          <h1>診療科編集</h1>
          <Link to="/departments" className="button">
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
        <h1>診療科編集</h1>
        <Link to="/departments" className="button">
          ← 一覧に戻る
        </Link>
      </div>
      {conflict && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">
            この診療科情報は他の操作によって更新されています。画面を再読込してから再度編集してください。
          </p>
        </div>
      )}
      <DepartmentForm
        initialValues={parseDepartment(result.data)}
        onSubmit={handleSubmit}
        submitting={updateDepartment.isPending}
        submitError={conflict ? undefined : updateDepartment.error}
        submitLabel="更新"
      />
    </div>
  );
}
