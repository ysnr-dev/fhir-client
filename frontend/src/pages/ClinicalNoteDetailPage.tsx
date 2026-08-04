import { Link, useNavigate, useParams } from "react-router-dom";
import { useClinicalNote, useDeleteClinicalNote } from "../api/queries";
import { ClinicalNoteDetailPanel } from "../components/ClinicalNoteDetailPanel";
import { ErrorBanner } from "../components/ErrorBanner";
import { FhirJsonView } from "../components/FhirJsonView";
import { PatientHeader } from "../components/PatientHeader";
import { isPatientMismatch } from "../fhir/patientHelpers";

export function ClinicalNoteDetailPage() {
  const { patientId, noteId } = useParams<{ patientId: string; noteId: string }>();
  const navigate = useNavigate();

  const { data: result, isLoading, error: loadError } = useClinicalNote(noteId);
  const deleteNote = useDeleteClinicalNote();

  const note = result?.data;
  // URL の患者と Composition.subject の患者が食い違う場合は他患者の記録なので表示しない。
  const patientMismatch = isPatientMismatch(patientId, note?.subject);
  const error =
    loadError ??
    deleteNote.error ??
    (patientMismatch ? new Error("指定された診療記録は別の患者のものです。") : undefined);

  function handleDelete() {
    if (!noteId) return;
    if (!window.confirm("この診療記録を削除します。よろしいですか?")) return;
    deleteNote.mutate(noteId, {
      onSuccess: () => navigate(`/patients/${patientId}/clinical-notes`),
    });
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>診療記録詳細</h1>
        <div>
          <Link to={`/patients/${patientId}/clinical-notes/${noteId}/edit`} className="button">
            編集
          </Link>
          <button type="button" onClick={handleDelete} disabled={deleteNote.isPending}>
            削除
          </button>
          <Link to={`/patients/${patientId}/clinical-notes`} className="button">
            ← 診療記録一覧に戻る
          </Link>
        </div>
      </div>

      <PatientHeader patientId={patientId} />

      <ErrorBanner error={error} />

      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        note &&
        !patientMismatch && (
          <ClinicalNoteDetailPanel note={note}>
            <details className="prescription-detail__raw">
              <summary>FHIR JSON を表示</summary>
              <FhirJsonView resource={note} />
            </details>
          </ClinicalNoteDetailPanel>
        )
      )}
    </div>
  );
}
