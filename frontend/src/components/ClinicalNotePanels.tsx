import { useState } from "react";
import { FhirError } from "../api/fhirClient";
import { useCurrentPractitioner } from "../api/authQueries";
import { useClinicalNoteTitles } from "../api/masterQueries";
import {
  useClinicalNote,
  useCountersignContext,
  useCreateClinicalNote,
  useNoteTasks,
  useUpdateClinicalNote,
} from "../api/queries";
import { ClinicalNoteForm } from "./ClinicalNoteForm";
import { ErrorBanner } from "./ErrorBanner";
import {
  buildClinicalNote,
  defaultSectionsForMode,
  emptyClinicalNoteForm,
  isCountersignNote,
  parseClinicalNoteForm,
  validateClinicalNote,
  type ClinicalNoteFormValues,
  type ClinicalNoteProblem,
} from "../fhir/clinicalNoteHelpers";
import {
  NOTE_COUNTERSIGN_NOTE,
  buildCountersignedNote,
  buildNoteCountersignEntries,
  closeNoteCountersignEntries,
  closeNoteReturnedEntries,
  noteAuthorId,
  noteLabelOf,
} from "../fhir/countersignHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";
import { isNursingRoleCode, parsePractitionerRole } from "../fhir/practitionerRoleHelpers";
import { useLoginAutofillSource } from "../hooks/useLoginAutofillSource";
import { useOrderContext } from "../hooks/useOrderContext";
import { useEditSnapshot } from "../hooks/useEditSnapshot";

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
  // 記録した診療科。ヘッダーで選択中の科を焼き付ける(オーダーの依頼科と同じ扱い)。
  const orderContext = useOrderContext();
  // 研修医・学生の記録は印を付け、確定したら指導医あての承認待ちを同じ transaction で作る。
  const countersign = useCountersignContext();
  const [validationError, setValidationError] = useState<string | null>(null);

  // 初期値のタイトルは、職種がログイン中の医療従事者と一致するマスタの先頭(表示順)。
  // 一致が無ければ既定(emptyClinicalNoteForm)のまま。フォームは初期値をマウント時に
  // 一度だけ使うので、マスタと職種が揃うまで描画しない。
  const titles = useClinicalNoteTitles();
  const login = useLoginAutofillSource();
  const roleCode = login.source?.role ? parsePractitionerRole(login.source.role).roleCode : "";
  const defaultTitle = roleCode
    ? titles.data?.items.find((t) => t.role_code === roleCode)
    : undefined;

  function handleSubmit(values: ClinicalNoteFormValues) {
    const error = validateClinicalNote(values, practitionerId);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    const trainee = Boolean(countersign.traineeLevel) && countersign.enterer;
    const save = buildClinicalNote(values, {
      patientId,
      practitioner,
      department: orderContext,
      nursing: isNursingRoleCode(roleCode),
      countersign: Boolean(trainee),
    });
    const fullUrl = `urn:uuid:${crypto.randomUUID()}`;
    const entries = [...save.entries];
    if (trainee && save.composition.status === "final") {
      entries.push(
        ...buildNoteCountersignEntries({
          focusReference: fullUrl,
          patientId,
          noteLabel: noteLabelOf(save.composition),
          trainee,
          supervisors: countersign.supervisors,
        }),
      );
    }
    createNote.mutate({ composition: save.composition, entries, fullUrl }, { onSuccess: onSaved });
  }

  if (titles.isLoading || !login.ready) return <p>読み込み中...</p>;

  const initialValues = emptyClinicalNoteForm(defaultProblem ?? null);
  if (defaultTitle) {
    initialValues.title = defaultTitle.title;
    initialValues.mode = defaultTitle.mode;
    initialValues.sections = defaultSectionsForMode(defaultTitle.mode);
  }

  return (
    <ClinicalNoteForm
      patientId={patientId}
      initialValues={initialValues}
      defaultTemplateCanonical={defaultTitle?.template_canonical ?? undefined}
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
  const { data: result, isLoading, error } = useEditSnapshot(useClinicalNote(noteId), noteId);
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
  // 署名(確定者)を修正した本人に更新するために使う。紐付けの無いアカウントでは
  // undefined になり、その場合は既存の署名をそのまま残す。
  const { practitioner } = useCurrentPractitioner();
  // 研修医の記録のカウンターサイン。研修医本人が確定し直せばまた承認待ちに、
  // 指導医が直して保存すればその内容で承認済みにする(修正承認)。
  const countersign = useCountersignContext();
  const noteTasks = useNoteTasks(isCountersignNote(note) ? note.id : undefined);

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
    // 編集でも医療従事者を渡す。作成者(author)は既存を保つが、確定の署名は
    // 「今その内容に責任を負う人」なので、修正した本人に更新する。
    const save = buildClinicalNote(values, { patientId, practitioner, existing: note });
    let composition = save.composition;
    const entries = [...save.entries];
    const actor = countersign.enterer;
    if (isCountersignNote(note) && actor && composition.status !== "preliminary") {
      const authorId = noteAuthorId(note);
      const tasks = noteTasks.data ?? [];
      if (authorId === actor.practitionerId) {
        // 研修医本人の確定し直し。差戻しを閉じ、前の承認待ちを取り下げて出し直す。
        entries.push(...closeNoteReturnedEntries(tasks, actor));
        entries.push(...closeNoteCountersignEntries(tasks, actor, NOTE_COUNTERSIGN_NOTE));
        entries.push(
          ...buildNoteCountersignEntries({
            focusReference: `Composition/${note.id}`,
            patientId,
            noteLabel: noteLabelOf(composition),
            trainee: actor,
            supervisors: countersign.supervisors,
            encounter: composition.encounter,
          }),
        );
      } else if (countersign.trainees.has(authorId)) {
        composition = buildCountersignedNote(composition, actor);
        entries.push(...closeNoteCountersignEntries(tasks, actor, NOTE_COUNTERSIGN_NOTE));
      }
    }
    updateNote.mutate(
      { composition, entries, etag },
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
          {isCountersignNote(note) &&
            countersign.practitionerId !== noteAuthorId(note) &&
            countersign.trainees.has(noteAuthorId(note)) &&
            "保存した内容でカウンターサインします。"}
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
