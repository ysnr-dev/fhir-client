import { useState } from "react";
import { FhirError } from "../api/fhirClient";
import { useCurrentPractitioner } from "../api/authQueries";
import { useClinicalNote, useCreateClinicalNote, useUpdateClinicalNote } from "../api/queries";
import { ClinicalNoteForm } from "./ClinicalNoteForm";
import { ErrorBanner } from "./ErrorBanner";
import {
  buildClinicalNote,
  emptyClinicalNoteForm,
  parseClinicalNoteForm,
  validateClinicalNote,
  type ClinicalNoteFormValues,
  type ClinicalNoteProblem,
} from "../fhir/clinicalNoteHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";

// 診療記録の登録・編集 UI。ページ(/patients/:id/clinical-notes/new など)と
// カルテ画面の右ペインの双方から使うため、保存後の遷移は onSaved に委ねる。

interface ClinicalNoteCreatePanelProps {
  patientId: string;
  // 開いた時点で対象にしておくプロブレム(カルテ画面でプロブレムを選んでいる場合)。
  defaultProblem?: ClinicalNoteProblem;
  onSaved: () => void;
}

export function ClinicalNoteCreatePanel({
  patientId,
  defaultProblem,
  onSaved,
}: ClinicalNoteCreatePanelProps) {
  const createNote = useCreateClinicalNote();
  // Composition.author(1..*)にログイン中の医療従事者の実参照を入れる。
  // administrator など Practitioner 未紐付けのアカウントでは validate で保存を止める。
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const [validationError, setValidationError] = useState<string | null>(null);

  function handleSubmit(values: ClinicalNoteFormValues) {
    const error = validateClinicalNote(values, practitionerId);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    createNote.mutate(buildClinicalNote(values, { patientId, practitioner }), {
      onSuccess: onSaved,
    });
  }

  return (
    <ClinicalNoteForm
      patientId={patientId}
      initialValues={emptyClinicalNoteForm(defaultProblem ?? null)}
      onSubmit={handleSubmit}
      submitting={createNote.isPending}
      submitError={createNote.error}
      validationError={validationError}
    />
  );
}

interface ClinicalNoteEditPanelProps {
  patientId: string;
  noteId: string;
  onSaved: () => void;
}

export function ClinicalNoteEditPanel({ patientId, noteId, onSaved }: ClinicalNoteEditPanelProps) {
  const { data: result, isLoading, error } = useClinicalNote(noteId);
  const note = result?.data;
  const patientMismatch = isPatientMismatch(patientId, note?.subject);

  return (
    <>
      <ErrorBanner error={error} />

      {isLoading ? (
        <p>読み込み中...</p>
      ) : patientMismatch ? (
        <p className="patient-table__empty">指定された診療記録は別の患者のものです。</p>
      ) : (
        note && (
          <EditForm
            patientId={patientId}
            note={note}
            etag={result?.etag ?? ""}
            onSaved={onSaved}
          />
        )
      )}
    </>
  );
}

// フォーム初期値を読み込み済みリソースから作るため、読込完了後にマウントする。
function EditForm({
  patientId,
  note,
  etag,
  onSaved,
}: {
  patientId: string;
  note: fhir4.Composition;
  etag: string;
  onSaved: () => void;
}) {
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
        onSuccess: onSaved,
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
