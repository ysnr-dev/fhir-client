import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FhirError } from "../api/fhirClient";
import { usePatient, useUpdatePatient } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { PatientForm } from "../components/PatientForm";
import { buildPatient, parsePatient, type PatientFormValues } from "../fhir/patientHelpers";

export function PatientEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: result, isLoading, error: loadError } = usePatient(id);
  const updatePatient = useUpdatePatient();
  const [conflict, setConflict] = useState(false);

  function handleSubmit(values: PatientFormValues) {
    if (!id || !result?.etag) return;
    setConflict(false);
    updatePatient.mutate(
      { patient: buildPatient(values, id), etag: result.etag },
      {
        onSuccess: () => navigate("/patients"),
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
          <h1>患者編集</h1>
          <Link to="/patients" className="button">
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
        <h1>患者編集</h1>
        <Link to="/patients" className="button">
          ← 一覧に戻る
        </Link>
      </div>
      {conflict && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">
            この患者情報は他の操作によって更新されています。画面を再読込してから再度編集してください。
          </p>
        </div>
      )}
      <PatientForm
        initialValues={parsePatient(result.data)}
        onSubmit={handleSubmit}
        submitting={updatePatient.isPending}
        submitError={conflict ? undefined : updatePatient.error}
        submitLabel="更新"
      />
    </div>
  );
}
