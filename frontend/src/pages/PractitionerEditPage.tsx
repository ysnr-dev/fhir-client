import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FhirError } from "../api/fhirClient";
import { usePractitioner, useUpdatePractitioner } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { PractitionerForm } from "../components/PractitionerForm";
import {
  buildPractitioner,
  parsePractitioner,
  type PractitionerFormValues,
} from "../fhir/practitionerHelpers";

export function PractitionerEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: result, isLoading, error: loadError } = usePractitioner(id);
  const updatePractitioner = useUpdatePractitioner();
  const [conflict, setConflict] = useState(false);

  function handleSubmit(values: PractitionerFormValues) {
    if (!id || !result?.etag) return;
    setConflict(false);
    updatePractitioner.mutate(
      { practitioner: buildPractitioner(values, id), etag: result.etag },
      {
        onSuccess: () => navigate("/practitioners"),
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
          <h1>医療従事者編集</h1>
          <Link to="/practitioners" className="button">
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
        <h1>医療従事者編集</h1>
        <Link to="/practitioners" className="button">
          ← 一覧に戻る
        </Link>
      </div>
      {conflict && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">
            この医療従事者情報は他の操作によって更新されています。画面を再読込してから再度編集してください。
          </p>
        </div>
      )}
      <PractitionerForm
        initialValues={parsePractitioner(result.data)}
        onSubmit={handleSubmit}
        submitting={updatePractitioner.isPending}
        submitError={conflict ? undefined : updatePractitioner.error}
        submitLabel="更新"
      />
    </div>
  );
}
