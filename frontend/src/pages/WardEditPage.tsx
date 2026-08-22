import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FhirError } from "../api/fhirClient";
import { useLocation, useUpdateLocation } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { WardForm } from "../components/WardForm";
import { buildWard, parseWard, type WardFormValues } from "../fhir/wardHelpers";

export function WardEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: result, isLoading, error: loadError } = useLocation(id);
  const updateWard = useUpdateLocation();
  const [conflict, setConflict] = useState(false);

  function handleSubmit(values: WardFormValues) {
    if (!id || !result?.etag) return;
    setConflict(false);
    updateWard.mutate(
      { location: buildWard(values, id), etag: result.etag },
      {
        onSuccess: () => navigate("/wards"),
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
          <h1>病棟編集</h1>
          <Link to="/wards" className="button">
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
        <h1>病棟編集</h1>
        <Link to="/wards" className="button">
          ← 一覧に戻る
        </Link>
      </div>
      {conflict && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">
            この病棟は他の操作によって更新されています。画面を再読込してから再度編集してください。
          </p>
        </div>
      )}
      <WardForm
        initialValues={parseWard(result.data)}
        onSubmit={handleSubmit}
        submitting={updateWard.isPending}
        submitError={conflict ? undefined : updateWard.error}
        submitLabel="更新"
      />
    </div>
  );
}
