import { useEffect, useMemo, useState } from "react";
import { FhirError } from "../api/fhirClient";
import { useCurrentPractitioner } from "../api/authQueries";
import {
  useClinicalNote,
  useDischargeSummaryFor,
  useDischargeSummarySources,
  useDocumentDueTasks,
  useEncounter,
  usePatientAdmissions,
  useSaveDischargeSummary,
} from "../api/queries";
import {
  buildDischargeSummary,
  dischargeSummaryEncounterId,
  draftDischargeSummaryForm,
  parseDischargeSummaryForm,
  validateDischargeSummary,
  type DischargeSummaryFormValues,
} from "../fhir/dischargeSummaryHelpers";
import {
  ADMISSION_STATUS,
  encounterAdmissionDate,
  encounterDepartmentName,
  encounterDischargeDate,
} from "../fhir/encounterHelpers";
import { isPatientMismatch } from "../fhir/patientHelpers";
import { useOrderContext } from "../hooks/useOrderContext";
import type { KartePaneState } from "./KarteRightPane";
import { DischargeSummaryForm } from "./DischargeSummaryForm";
import { ErrorBanner } from "./ErrorBanner";

// 退院時サマリーの登録・編集(カルテ右ペイン)。
//
// 登録は対象の入院を選ぶところから始める。入院中・退院済のどちらでも書ける(退院前に
// 用意する運用のため)。選んだ入院に既にサマリーがあれば、その場で編集に切り替える
// (1 入院 1 サマリー)。無ければ入院期間のデータを集めて下書きを作る。

interface DischargeSummaryCreatePanelProps {
  patientId: string;
  /** 通知・入院患者一覧のリンクから開いたときの対象の入院。 */
  defaultEncounterId?: string;
  onSaved: () => void;
  onStateChange: (state: KartePaneState) => void;
}

export function DischargeSummaryCreatePanel({
  patientId,
  defaultEncounterId,
  onSaved,
  onStateChange,
}: DischargeSummaryCreatePanelProps) {
  const admissions = usePatientAdmissions(patientId);
  const [encounterId, setEncounterId] = useState(defaultEncounterId ?? "");

  // 既定は「今の入院」、無ければ最新の退院。
  useEffect(() => {
    if (encounterId || !admissions.data?.length) return;
    const current = admissions.data.find((e) => e.status === ADMISSION_STATUS);
    setEncounterId((current ?? admissions.data[0]).id ?? "");
  }, [admissions.data, encounterId]);

  const encounter = admissions.data?.find((e) => e.id === encounterId);
  const existing = useDischargeSummaryFor(encounterId || undefined);

  // 既にあれば編集へ(ペインの見出しも「編集」に変わる)。
  useEffect(() => {
    if (existing.data?.id) onStateChange({ kind: "summary-edit", noteId: existing.data.id });
  }, [existing.data?.id, onStateChange]);

  return (
    <>
      <ErrorBanner error={admissions.error} />
      <ErrorBanner error={existing.error} />
      <div className="patient-form">
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
      {admissions.isLoading ? (
        <p>読み込み中...</p>
      ) : !admissions.data?.length ? (
        <p className="patient-table__empty">この患者に入院の記録がありません。</p>
      ) : (
        encounter &&
        existing.isSuccess &&
        !existing.data && (
          <CreateForm key={encounter.id} patientId={patientId} encounter={encounter} onSaved={onSaved} />
        )
      )}
    </>
  );
}

function admissionLabel(encounter: fhir4.Encounter): string {
  const discharge = encounterDischargeDate(encounter);
  return `${encounterAdmissionDate(encounter)} 〜 ${discharge === "-" ? "入院中" : discharge} ${encounterDepartmentName(encounter)}`;
}

function CreateForm({
  patientId,
  encounter,
  onSaved,
}: {
  patientId: string;
  encounter: fhir4.Encounter;
  onSaved: () => void;
}) {
  const sources = useDischargeSummarySources(patientId, encounter);
  const dueTasks = useDocumentDueTasks(encounter.id);
  const save = useSaveDischargeSummary();
  const { practitionerId, practitioner } = useCurrentPractitioner();
  // 診療科は依頼科・依頼医の切替(ヘッダ)の値。診療記録・他科依頼回答と同じ扱い。
  const department = useOrderContext();
  const [validationError, setValidationError] = useState<string | null>(null);

  // 下書きは入院期間のデータが揃ってから作る(揃う前にフォームを出すと空のまま
  // 書き始めてしまい、あとから下書きが被さる)。
  const initialValues = useMemo(
    () => (sources.data ? draftDischargeSummaryForm(sources.data) : null),
    [sources.data],
  );

  function handleSubmit(values: DischargeSummaryFormValues) {
    const error = validateDischargeSummary(values, practitionerId);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    save.mutate(
      {
        ...buildDischargeSummary(values, { patientId, practitioner, encounter, department }),
        dueTasks: dueTasks.data ?? [],
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
        <DischargeSummaryForm
          patientId={patientId}
          encounter={encounter}
          initialValues={initialValues}
          sources={sources.data}
          onSubmit={handleSubmit}
          submitting={save.isPending}
          submitError={save.error}
          validationError={validationError}
        />
      )}
    </>
  );
}

interface DischargeSummaryEditPanelProps {
  patientId: string;
  noteId: string;
  onSaved: () => void;
}

export function DischargeSummaryEditPanel({ patientId, noteId, onSaved }: DischargeSummaryEditPanelProps) {
  const { data: result, isLoading, error } = useClinicalNote(noteId);
  const note = result?.data;
  const patientMismatch = isPatientMismatch(patientId, note?.subject);
  const encounterId = dischargeSummaryEncounterId(note);
  const encounter = useEncounter(encounterId || undefined);

  return (
    <>
      <ErrorBanner error={error} />
      <ErrorBanner error={encounter.error} />
      {isLoading || encounter.isLoading ? (
        <p>読み込み中...</p>
      ) : patientMismatch ? (
        <p className="patient-table__empty">指定された退院時サマリーは別の患者のものです。</p>
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
  const [initialValues] = useState(() => parseDischargeSummaryForm(note, encounter));
  const [validationError, setValidationError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const sources = useDischargeSummarySources(patientId, encounter);
  const dueTasks = useDocumentDueTasks(encounter.id);
  const save = useSaveDischargeSummary();
  const { practitioner } = useCurrentPractitioner();

  // 確定済み(final/amended)の編集は保存で amended になる。ステータス選択は出さない。
  const statusLocked = note.status !== "preliminary";

  function handleSubmit(values: DischargeSummaryFormValues) {
    const error = validateDischargeSummary(values, undefined);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    setConflict(false);
    save.mutate(
      {
        ...buildDischargeSummary(values, { patientId, practitioner, existing: note, encounter }),
        etag,
        dueTasks: dueTasks.data ?? [],
      },
      {
        onSuccess: onSaved,
        onError: (err) => {
          if (err instanceof FhirError && err.status === 412) setConflict(true);
        },
      },
    );
  }

  return (
    <>
      {conflict && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">
            この退院時サマリーは他の操作によって更新されています。画面を再読込してから再度編集してください。
          </p>
        </div>
      )}
      {statusLocked && (
        <p className="clinical-note-edit__hint">
          確定済みの記録です。保存するとステータスは「修正済み」になります。
        </p>
      )}
      <DischargeSummaryForm
        patientId={patientId}
        encounter={encounter}
        initialValues={initialValues}
        sources={sources.data}
        statusLocked={statusLocked}
        onSubmit={handleSubmit}
        submitting={save.isPending}
        submitError={conflict ? undefined : save.error}
        validationError={validationError}
        submitLabel="更新"
      />
    </>
  );
}
