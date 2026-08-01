import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { FhirError } from "../api/fhirClient";
import { useClinicalNote, useUpdateClinicalNote } from "../api/queries";
import { ClinicalNoteForm } from "../components/ClinicalNoteForm";
import { ErrorBanner } from "../components/ErrorBanner";
import { PatientHeader } from "../components/PatientHeader";
import {
  buildClinicalNote,
  parseClinicalNoteForm,
  validateClinicalNote,
  type ClinicalNoteFormValues,
} from "../fhir/clinicalNoteHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";

export function ClinicalNoteEditPage() {
  const { patientId, noteId } = useParams<{ patientId: string; noteId: string }>();

  const { data: result, isLoading, error } = useClinicalNote(noteId);
  const note = result?.data;
  const etag = result?.etag;
  const patientMismatch = isPatientMismatch(patientId, note?.subject);

  return (
    <div className="page">
      <div className="page__header">
        <h1>診療記録編集</h1>
        <Link to={`/patients/${patientId}/clinical-notes`} className="button">
          ← 診療記録一覧に戻る
        </Link>
      </div>

      <PatientHeader patientId={patientId} />

      <ErrorBanner error={error} />

      {isLoading ? (
        <p>読み込み中...</p>
      ) : patientMismatch ? (
        <p className="patient-table__empty">指定された診療記録は別の患者のものです。</p>
      ) : (
        note && <EditForm patientId={patientId as string} note={note} etag={etag ?? ""} />
      )}
    </div>
  );
}

// フォーム初期値を読み込み済みリソースから作るため、読込完了後にマウントする。
function EditForm({
  patientId,
  note,
  etag,
}: {
  patientId: string;
  note: fhir4.Composition;
  etag: string;
}) {
  const navigate = useNavigate();
  const [initialValues] = useState(() => parseClinicalNoteForm(note));
  const [validationError, setValidationError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const updateNote = useUpdateClinicalNote();

  // 確定済み(final/amended)の編集は保存で amended になる。ステータス選択は出さない。
  const statusLocked = note.status !== "preliminary";

  function handleSubmit(values: ClinicalNoteFormValues) {
    // 編集は既存 author を引き継ぐため practitioner 紐付けチェックは不要(undefined でスキップ)。
    const error = validateClinicalNote(values, undefined);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    setConflict(false);
    updateNote.mutate(
      { ...buildClinicalNote(values, { patientId, existing: note }), etag },
      {
        onSuccess: () => navigate(`/patients/${patientId}/clinical-notes`),
        onError: (err) => {
          if (err instanceof FhirError && err.status === 412) {
            setConflict(true);
          }
        },
      },
    );
  }

  return (
    <>
      {conflict && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">
            この診療記録は他の操作によって更新されています。画面を再読込してから再度編集してください。
          </p>
        </div>
      )}
      {statusLocked && (
        <p className="clinical-note-edit__hint">
          確定済みの記録です。保存するとステータスは「修正済み」になります。
        </p>
      )}
      <ClinicalNoteForm
        patientId={patientId}
        initialValues={initialValues}
        statusLocked={statusLocked}
        onSubmit={handleSubmit}
        submitting={updateNote.isPending}
        submitError={conflict ? undefined : updateNote.error}
        validationError={validationError}
        submitLabel="更新"
      />
    </>
  );
}
