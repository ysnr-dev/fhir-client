import { useEffect, useMemo, useState } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import { FhirError } from "../api/fhirClient";
import {
  useClinicalNote,
  useEncounter,
  useNursingSummariesFor,
  useNursingSummarySources,
  usePatientAdmissions,
  useReturnedTasks,
  useReviewNursingSummary,
  useSaveNursingSummary,
} from "../api/queries";
import { clinicalNoteAttestation } from "../fhir/clinicalNoteHelpers";
import { ADMISSION_STATUS, admissionLabel } from "../fhir/encounterHelpers";
import {
  buildApprovedNursingSummary,
  buildNursingSummary,
  draftNursingSummaryForm,
  nursingSummaryApprover,
  canApproveNursingSummary,
  nursingSummaryKindOf,
  nursingSummaryStateOf,
  parseNursingSummaryForm,
  validateNursingSummary,
  type NursingSummaryFormValues,
  type NursingSummaryKind,
} from "../fhir/nursingSummaryHelpers";
import { nursingSummaryReturnReason } from "../fhir/nursingSummaryTaskHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";
import { useEditSnapshot } from "../hooks/useEditSnapshot";
import { useIsNursingLogin } from "../hooks/useIsNursingLogin";
import { ErrorBanner } from "./ErrorBanner";
import type { KartePaneState } from "./KarteRightPane";
import { NursingSummaryForm, type NursingSummarySubmitMode } from "./NursingSummaryForm";

// 看護サマリーの登録・編集・承認(カルテ右ペイン)。登録は入院と種別を選ぶところから始め、
// 退院の看護サマリーが既にあれば編集に切り替える(中間・転棟は何件でも書ける)。

export function NursingSummaryCreatePanel({
  patientId,
  defaultEncounterId,
  onSaved,
  onStateChange,
}: {
  patientId: string;
  defaultEncounterId?: string;
  onSaved: () => void;
  onStateChange: (state: KartePaneState) => void;
}) {
  const admissions = usePatientAdmissions(patientId);
  const [encounterId, setEncounterId] = useState(defaultEncounterId ?? "");
  const encounter = admissions.data?.find((e) => e.id === encounterId);
  const [kind, setKind] = useState<NursingSummaryKind | null>(null);
  const effectiveKind: NursingSummaryKind = kind ?? (encounter?.period?.end ? "discharge" : "interim");
  const summaries = useNursingSummariesFor(encounterId || undefined);

  useEffect(() => {
    if (encounterId || !admissions.data?.length) return;
    const current = admissions.data.find((e) => e.status === ADMISSION_STATUS);
    setEncounterId((current ?? admissions.data[0]).id ?? "");
  }, [admissions.data, encounterId]);

  const existingDischarge = (summaries.data ?? []).find((c) => nursingSummaryKindOf(c) === "discharge");
  useEffect(() => {
    if (effectiveKind === "discharge" && existingDischarge?.id) {
      onStateChange({ kind: "nursing-summary-edit", noteId: existingDischarge.id });
    }
  }, [effectiveKind, existingDischarge?.id, onStateChange]);

  return (
    <>
      <ErrorBanner error={admissions.error ?? summaries.error} />
      <div className="patient-form summary-admission-select">
        <label>
          対象の入院
          <select value={encounterId} onChange={(e) => setEncounterId(e.target.value)}>
            {(admissions.data ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {admissionLabel(e)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {admissions.isLoading || summaries.isLoading ? (
        <p>読み込み中...</p>
      ) : !admissions.data?.length ? (
        <p className="patient-table__empty">この患者に入院の記録がありません。</p>
      ) : (
        encounter &&
        !(effectiveKind === "discharge" && existingDischarge) && (
          <CreateForm
            key={`${encounter.id}:${effectiveKind}`}
            patientId={patientId}
            encounter={encounter}
            kind={effectiveKind}
            onKindChange={setKind}
            onSaved={onSaved}
          />
        )
      )}
    </>
  );
}

function CreateForm({
  patientId,
  encounter,
  kind,
  onKindChange,
  onSaved,
}: {
  patientId: string;
  encounter: fhir4.Encounter;
  kind: NursingSummaryKind;
  onKindChange: (kind: NursingSummaryKind) => void;
  onSaved: () => void;
}) {
  const sources = useNursingSummarySources(patientId, encounter);
  const save = useSaveNursingSummary();
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const [validationError, setValidationError] = useState("");
  const initialValues = useMemo(
    () => (sources.data ? draftNursingSummaryForm(sources.data, kind) : null),
    [sources.data, kind],
  );

  function handleSubmit(values: NursingSummaryFormValues, mode: NursingSummarySubmitMode) {
    const error = validateNursingSummary(values, practitionerId);
    setValidationError(error);
    if (error) return;
    save.mutate(
      {
        ...buildNursingSummary(values, {
          patientId,
          practitioner,
          ward: sources.data?.ward,
          mode: mode === "confirm" ? "confirm" : "draft",
        }),
        returnedTasks: [],
      },
      { onSuccess: onSaved },
    );
  }

  return (
    <>
      <ErrorBanner error={sources.error} />
      {!initialValues ? (
        <p>入院期間の情報を集めています...</p>
      ) : (
        <NursingSummaryForm
          patientId={patientId}
          encounter={encounter}
          initialValues={initialValues}
          sources={sources.data}
          onKindChange={onKindChange}
          role="author"
          onSubmit={handleSubmit}
          submitting={save.isPending}
          submitError={save.error}
          validationError={validationError}
        />
      )}
    </>
  );
}

export function NursingSummaryEditPanel({
  patientId,
  noteId,
  onSaved,
}: {
  patientId: string;
  noteId: string;
  onSaved: () => void;
}) {
  const { data: result, isLoading, error } = useEditSnapshot(useClinicalNote(noteId), noteId);
  const note = result?.data;
  const encounterId = note?.encounter?.reference?.split("/").pop();
  const encounter = useEncounter(encounterId);
  const patientMismatch = isPatientMismatch(patientId, note?.subject);

  return (
    <>
      <ErrorBanner error={error ?? encounter.error} />
      {isLoading || encounter.isLoading ? (
        <p>読み込み中...</p>
      ) : patientMismatch ? (
        <p className="patient-table__empty">指定された看護サマリーは別の患者のものです。</p>
      ) : !encounter.data ? (
        <p className="patient-table__empty">対象の入院が見つかりません。</p>
      ) : (
        note && (
          <EditForm
            patientId={patientId}
            note={note}
            encounter={encounter.data}
            etag={result?.etag ?? ""}
            onSaved={onSaved}
          />
        )
      )}
    </>
  );
}

function EditForm({
  patientId,
  note,
  encounter,
  etag,
  onSaved,
}: {
  patientId: string;
  note: fhir4.Composition;
  encounter: fhir4.Encounter;
  etag: string;
  onSaved: () => void;
}) {
  const [initialValues] = useState(() => parseNursingSummaryForm(note));
  const [validationError, setValidationError] = useState("");
  const [conflict, setConflict] = useState(false);
  const sources = useNursingSummarySources(patientId, encounter);
  const returned = useReturnedTasks([note.id ?? ""]);
  const save = useSaveNursingSummary();
  const review = useReviewNursingSummary();
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const nursing = useIsNursingLogin();

  const returnedTasks = returned.data ?? [];
  const state = nursingSummaryStateOf(note, returnedTasks.length > 0);
  // 承認できるのは看護職で、作成者・確定した人以外。承認待ちのときだけ承認者として開く。
  const role =
    state === "pending" && canApproveNursingSummary(note, practitionerId, nursing.isNursing) ? "approver" : "author";
  const attestation = clinicalNoteAttestation(note);
  const approver = nursingSummaryApprover(note);

  function onError(err: unknown) {
    if (err instanceof FhirError && err.status === 412) setConflict(true);
  }

  function handleSubmit(values: NursingSummaryFormValues, mode: NursingSummarySubmitMode) {
    const error = validateNursingSummary(values, practitionerId);
    setValidationError(error);
    if (error) return;
    setConflict(false);
    if (mode === "approve") {
      if (!practitioner) return;
      review.mutate({ original: note, next: buildApprovedNursingSummary(note, practitioner) }, { onSuccess: onSaved, onError });
      return;
    }
    save.mutate(
      {
        ...buildNursingSummary(values, {
          patientId,
          practitioner,
          existing: note,
          mode: mode === "approve-edited" ? "approve" : mode,
        }),
        etag,
        returnedTasks,
      },
      { onSuccess: onSaved, onError },
    );
  }

  if (!nursing.ready || returned.isLoading) return <p>読み込み中...</p>;
  return (
    <>
      {conflict && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">
            この看護サマリーは他の操作によって更新されています。画面を再読込してから再度編集してください。
          </p>
        </div>
      )}
      <NursingSummaryForm
        patientId={patientId}
        encounter={encounter}
        initialValues={initialValues}
        sources={sources.data}
        status={{
          author: note.author?.[0]?.display ?? "",
          attested: attestation?.time ? attestation.time.slice(0, 16).replace("T", " ") : "",
          approver: approver ? `${approver.name} (${approver.time.slice(0, 16).replace("T", " ")})` : "",
          returnReason: returnedTasks.map(nursingSummaryReturnReason).filter(Boolean).join(" / "),
        }}
        role={role}
        onSubmit={handleSubmit}
        submitting={save.isPending || review.isPending}
        submitError={conflict ? undefined : (save.error ?? review.error)}
        validationError={validationError}
      />
    </>
  );
}
