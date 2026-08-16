import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FhirError } from "../api/fhirClient";
import { useLocation, useUpdateLocation } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { LocationForm } from "../components/LocationForm";
import { buildLocation, parseLocation, type LocationFormValues } from "../fhir/locationHelpers";

export function LocationEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: result, isLoading, error: loadError } = useLocation(id);
  const updateLocation = useUpdateLocation();
  const [conflict, setConflict] = useState(false);

  function handleSubmit(values: LocationFormValues) {
    if (!id || !result?.etag) return;
    setConflict(false);
    updateLocation.mutate(
      { location: buildLocation(values, id), etag: result.etag },
      {
        onSuccess: () => navigate("/locations"),
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
          <h1>診察室・撮影室編集</h1>
          <Link to="/locations" className="button">
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
        <h1>診察室・撮影室編集</h1>
        <Link to="/locations" className="button">
          ← 一覧に戻る
        </Link>
      </div>
      {conflict && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">
            この場所は他の操作によって更新されています。画面を再読込してから再度編集してください。
          </p>
        </div>
      )}
      <LocationForm
        initialValues={parseLocation(result.data)}
        onSubmit={handleSubmit}
        submitting={updateLocation.isPending}
        submitError={conflict ? undefined : updateLocation.error}
        submitLabel="更新"
      />
    </div>
  );
}
