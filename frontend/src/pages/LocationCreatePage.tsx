import { Link, useNavigate } from "react-router-dom";
import { useCreateLocation } from "../api/queries";
import { LocationForm } from "../components/LocationForm";
import { buildLocation, type LocationFormValues } from "../fhir/locationHelpers";

export function LocationCreatePage() {
  const navigate = useNavigate();
  const createLocation = useCreateLocation();

  function handleSubmit(values: LocationFormValues) {
    createLocation.mutate(buildLocation(values), {
      onSuccess: () => navigate("/locations"),
    });
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>診察室・撮影室登録</h1>
        <Link to="/locations" className="button">
          ← 一覧に戻る
        </Link>
      </div>
      <LocationForm
        onSubmit={handleSubmit}
        submitting={createLocation.isPending}
        submitError={createLocation.error}
        submitLabel="登録"
      />
    </div>
  );
}
