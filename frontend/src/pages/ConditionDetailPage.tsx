import { Link, useNavigate, useParams } from "react-router-dom";
import { useDeleteCondition } from "../api/queries";
import { ConditionDetailPanel } from "../components/ConditionDetailPanel";
import { ErrorBanner } from "../components/ErrorBanner";
import { PatientHeader } from "../components/PatientHeader";

export function ConditionDetailPage() {
  const { patientId, conditionId } = useParams<{ patientId: string; conditionId: string }>();
  const navigate = useNavigate();
  const deleteCondition = useDeleteCondition();

  function handleDelete() {
    if (!conditionId) return;
    if (!window.confirm("この病名を削除します。よろしいですか?")) return;
    deleteCondition.mutate(conditionId, {
      onSuccess: () => navigate(`/patients/${patientId}/conditions`),
    });
  }

  if (!patientId || !conditionId) return null;

  return (
    <div className="page">
      <div className="page__header">
        <h1>病名詳細</h1>
        <div>
          <Link to={`/patients/${patientId}/conditions/${conditionId}/edit`} className="button">
            編集
          </Link>
          <button type="button" onClick={handleDelete} disabled={deleteCondition.isPending}>
            削除
          </button>
          <Link to={`/patients/${patientId}/conditions`} className="button">
            ← 病名一覧に戻る
          </Link>
        </div>
      </div>

      <PatientHeader patientId={patientId} />

      <ErrorBanner error={deleteCondition.error} />

      <ConditionDetailPanel patientId={patientId} conditionId={conditionId} />
    </div>
  );
}
