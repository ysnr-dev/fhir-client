import { useState } from "react";
import { useSaveVitalEntry, useVitalEntry } from "../api/queries";
import type { ProblemRef } from "../fhir/conditionHelpers";
import {
  buildVitalObservations,
  emptyVitalFormValues,
  parseVitalEntry,
  toDateTimeLocal,
  validateVitalForm,
  vitalEntryProblem,
  type VitalEntry,
  type VitalFormValues,
} from "../fhir/vitalHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { useProblemOptions } from "../hooks/useProblemOptions";
import { VitalForm } from "./VitalForm";

// バイタルの登録・編集 UI。1 回の測定を 1 枚のフォームで扱い、保存では項目ごとの
// Observation を transaction でまとめて書く。

interface VitalCreatePanelProps {
  patientId: string;
  /** 開いた時点で対象にしておくプロブレム(カルテ画面でプロブレムを選んでいる場合)。 */
  defaultProblem?: ProblemRef;
  onSaved: () => void;
}

export function VitalCreatePanel({ patientId, defaultProblem, onSaved }: VitalCreatePanelProps) {
  // 測定日時の既定は「いま」。過去分の入力もあるので変更できる。
  const [values, setValues] = useState<VitalFormValues>(() => ({
    ...emptyVitalFormValues(),
    measuredAt: toDateTimeLocal(new Date().toISOString()),
  }));
  const [problem, setProblem] = useState<ProblemRef | null>(defaultProblem ?? null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const problemOptions = useProblemOptions(patientId);
  const save = useSaveVitalEntry();

  function handleSubmit() {
    const error = validateVitalForm(values);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    save.mutate(
      {
        observations: buildVitalObservations({
          values,
          patientId,
          entryId: crypto.randomUUID(),
          problem,
        }),
      },
      { onSuccess: onSaved },
    );
  }

  return (
    <>
      <ErrorBanner error={save.error} />
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <VitalForm
        values={values}
        onChange={setValues}
        problem={problem}
        problemOptions={problemOptions}
        onProblemChange={setProblem}
        onSubmit={handleSubmit}
        submitLabel="登録"
        submitting={save.isPending}
      />
    </>
  );
}

interface VitalEditPanelProps {
  patientId: string;
  entryId: string;
  onSaved: () => void;
}

export function VitalEditPanel({ patientId, entryId, onSaved }: VitalEditPanelProps) {
  const { data: entry, isLoading, error } = useVitalEntry(entryId);

  return (
    <>
      <ErrorBanner error={error} />
      {isLoading ? (
        <p>読み込み中...</p>
      ) : entry ? (
        <EditForm patientId={patientId} entry={entry} onSaved={onSaved} />
      ) : (
        <p className="patient-table__empty">この測定は見つかりませんでした。</p>
      )}
    </>
  );
}

// 初期値を読み込み済みの測定から作るため、読込完了後にマウントする。
function EditForm({
  patientId,
  entry,
  onSaved,
}: {
  patientId: string;
  entry: VitalEntry;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<VitalFormValues>(() => parseVitalEntry(entry));
  const [problem, setProblem] = useState<ProblemRef | null>(() => vitalEntryProblem(entry));
  const [validationError, setValidationError] = useState<string | null>(null);
  const problemOptions = useProblemOptions(patientId);
  const save = useSaveVitalEntry();

  function handleSubmit() {
    const error = validateVitalForm(values);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    save.mutate(
      {
        // identifier は測定を束ねる鍵なので、作り直しても同じ値を使い回す。
        observations: buildVitalObservations({
          values,
          patientId,
          entryId: entry.entryId,
          problem,
        }),
        existingObservationIds: entry.observations
          .map((observation) => observation.id ?? "")
          .filter(Boolean),
      },
      { onSuccess: onSaved },
    );
  }

  return (
    <>
      <ErrorBanner error={save.error} />
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <VitalForm
        values={values}
        onChange={setValues}
        problem={problem}
        problemOptions={problemOptions}
        onProblemChange={setProblem}
        onSubmit={handleSubmit}
        submitLabel="更新"
        submitting={save.isPending}
      />
    </>
  );
}
