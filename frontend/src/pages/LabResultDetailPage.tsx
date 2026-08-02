import { Link, useNavigate, useParams } from "react-router-dom";
import { useDeleteLabResult, useLabResultNavigation } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { LabResultDetailPanel } from "../components/LabResultDetailPanel";
import { PatientHeader } from "../components/PatientHeader";

export function LabResultDetailPage() {
  const { patientId, reportId } = useParams<{ patientId: string; reportId: string }>();
  const navigate = useNavigate();

  const deleteLabResult = useDeleteLabResult();
  const nav = useLabResultNavigation(patientId, reportId);

  function goToSibling(siblingId: string | undefined) {
    if (!siblingId) return;
    navigate(`/patients/${patientId}/lab-results/${siblingId}`);
  }

  function handleDelete() {
    if (!reportId) return;
    if (!window.confirm("この検査結果を削除します。よろしいですか?")) return;
    deleteLabResult.mutate(reportId, {
      onSuccess: () => navigate(`/patients/${patientId}/lab-results`),
    });
  }

  if (!patientId || !reportId) return null;

  return (
    <div className="page">
      <div className="page__header">
        <div className="page__header-title">
          <h1>検査結果内容</h1>
          <div className="record-nav">
            <button
              type="button"
              className="record-nav__button"
              onClick={() => goToSibling(nav.previousId)}
              disabled={!nav.previousId}
              title="前の検査結果（新しい順で1つ前）"
              aria-label="前の検査結果"
            >
              ＜
            </button>
            <span className="record-nav__status">
              {nav.position ? `${nav.position} / ${nav.total} 件` : "-"}
            </span>
            <button
              type="button"
              className="record-nav__button"
              onClick={() => goToSibling(nav.nextId)}
              disabled={!nav.nextId}
              title="次の検査結果（新しい順で1つ後）"
              aria-label="次の検査結果"
            >
              ＞
            </button>
          </div>
        </div>
        <div>
          <Link to={`/patients/${patientId}/lab-results/new?from=${reportId}`} className="button">
            DO
          </Link>
          <Link to={`/patients/${patientId}/lab-results/${reportId}/edit`} className="button">
            編集
          </Link>
          <button type="button" onClick={handleDelete} disabled={deleteLabResult.isPending}>
            削除
          </button>
          <Link to={`/patients/${patientId}/lab-results`} className="button">
            ← 検査結果一覧に戻る
          </Link>
        </div>
      </div>

      <PatientHeader patientId={patientId} />

      <ErrorBanner error={deleteLabResult.error} />

      <LabResultDetailPanel reportId={reportId} />
    </div>
  );
}
