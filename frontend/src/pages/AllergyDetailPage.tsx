import { Link, useNavigate, useParams } from "react-router-dom";
import { useDeleteAllergy } from "../api/queries";
import { AllergyDetailPanel } from "../components/AllergyDetailPanel";
import { ErrorBanner } from "../components/ErrorBanner";
import { PatientHeader } from "../components/PatientHeader";

export function AllergyDetailPage() {
  const { patientId, allergyId } = useParams<{ patientId: string; allergyId: string }>();
  const navigate = useNavigate();
  const deleteAllergy = useDeleteAllergy();

  function handleDelete() {
    if (!allergyId) return;
    if (!window.confirm("このアレルギーを削除します。よろしいですか?")) return;
    deleteAllergy.mutate(allergyId, {
      onSuccess: () => navigate(`/patients/${patientId}/allergies`),
    });
  }

  if (!patientId || !allergyId) return null;

  return (
    <div className="page">
      <div className="page__header">
        <h1>アレルギー詳細</h1>
        <div>
          <Link to={`/patients/${patientId}/allergies/${allergyId}/edit`} className="button">
            編集
          </Link>
          <button type="button" onClick={handleDelete} disabled={deleteAllergy.isPending}>
            削除
          </button>
          <Link to={`/patients/${patientId}/allergies`} className="button">
            ← アレルギー一覧に戻る
          </Link>
        </div>
      </div>

      <PatientHeader patientId={patientId} />

      <ErrorBanner error={deleteAllergy.error} />

      <AllergyDetailPanel patientId={patientId} allergyId={allergyId} />
    </div>
  );
}
