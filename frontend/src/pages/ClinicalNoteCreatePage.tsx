import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useCurrentPractitioner } from "../api/authQueries";
import { useCreateClinicalNote } from "../api/queries";
import { ClinicalNoteForm } from "../components/ClinicalNoteForm";
import { PatientHeader } from "../components/PatientHeader";
import {
  buildClinicalNote,
  emptyClinicalNoteForm,
  validateClinicalNote,
  type ClinicalNoteFormValues,
} from "../fhir/clinicalNoteHelpers";

export function ClinicalNoteCreatePage() {
  const { patientId } = useParams<{ patientId: string }>();
  const navigate = useNavigate();
  const createNote = useCreateClinicalNote();
  // Composition.author(1..*)にログイン中の医療従事者の実参照を入れる。
  // administrator など Practitioner 未紐付けのアカウントでは validate で保存を止める。
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const [validationError, setValidationError] = useState<string | null>(null);

  function handleSubmit(values: ClinicalNoteFormValues) {
    if (!patientId) return;
    const error = validateClinicalNote(values, practitionerId);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    createNote.mutate(buildClinicalNote(values, { patientId, practitioner }), {
      onSuccess: () => navigate(`/patients/${patientId}/clinical-notes`),
    });
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>診療記録登録</h1>
        <Link to={`/patients/${patientId}/clinical-notes`} className="button">
          ← 診療記録一覧に戻る
        </Link>
      </div>

      <PatientHeader patientId={patientId} />

      <ClinicalNoteForm
        initialValues={emptyClinicalNoteForm()}
        onSubmit={handleSubmit}
        submitting={createNote.isPending}
        submitError={createNote.error}
        validationError={validationError}
      />
    </div>
  );
}
