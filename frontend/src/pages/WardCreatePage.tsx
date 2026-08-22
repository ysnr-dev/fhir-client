import { Link, useNavigate } from "react-router-dom";
import { useCreateLocation } from "../api/queries";
import { WardForm } from "../components/WardForm";
import { buildWard, type WardFormValues } from "../fhir/wardHelpers";

export function WardCreatePage() {
  const navigate = useNavigate();
  const createWard = useCreateLocation();

  function handleSubmit(values: WardFormValues) {
    createWard.mutate(buildWard(values), {
      onSuccess: () => navigate("/wards"),
    });
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>病棟登録</h1>
        <Link to="/wards" className="button">
          ← 一覧に戻る
        </Link>
      </div>
      <WardForm
        onSubmit={handleSubmit}
        submitting={createWard.isPending}
        submitError={createWard.error}
        submitLabel="登録"
      />
    </div>
  );
}
