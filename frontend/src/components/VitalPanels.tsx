import { nowDateTimeInput } from "../lib/dates";
import { useState } from "react";
import {
  useActiveFlags,
  useEarlyWarningSettings,
  usePatientAdmission,
  useSaveVitalEntry,
  useVitalEntry,
  type VitalEarlyWarningArgs,
} from "../api/queries";
import { SPO2_SCALE2_CAUTION_CODE, type EarlyWarningSettings } from "../fhir/earlyWarningHelpers";
import { cautionCoding } from "../fhir/flagHelpers";
import type { ProblemRef } from "../fhir/conditionHelpers";
import {
  buildVitalObservations,
  emptyVitalFormValues,
  parseVitalEntry,
  validateVitalForm,
  vitalEntryDepartment,
  vitalEntryProblem,
  type VitalEntry,
  type VitalFormValues,
} from "../fhir/vitalHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { useOrderContext } from "../hooks/useOrderContext";
import { useProblemOptions } from "../hooks/useProblemOptions";
import { VitalForm } from "./VitalForm";

// バイタルの登録・編集 UI。1 回の測定を 1 枚のフォームで扱い、保存では項目ごとの
// Observation を transaction でまとめて書く。早期警告スコア(NEWS2)が有効なら同じ transaction に
// NEWS2 と主治医あての通知を積む(docs/early-warning-design.md)。

/** NEWS2 の算出に要る、測定の外側の情報。入院・注意区分・施設設定を引く。 */
function useVitalEarlyWarning(patientId: string): {
  settings: EarlyWarningSettings;
  spo2Scale2: boolean;
  encounter: fhir4.Encounter | null;
  ready: boolean;
} {
  const settings = useEarlyWarningSettings();
  const admission = usePatientAdmission(settings.enabled ? patientId : undefined);
  const flags = useActiveFlags(settings.enabled ? patientId : undefined);
  const spo2Scale2 = (flags.flags ?? []).some((flag) => cautionCoding(flag)?.code === SPO2_SCALE2_CAUTION_CODE);
  return {
    settings,
    spo2Scale2,
    encounter: admission.data?.encounter ?? null,
    ready: !settings.enabled || (!admission.isPending && !flags.isPending),
  };
}

function earlyWarningArgs(
  patientId: string,
  values: VitalFormValues,
  context: ReturnType<typeof useVitalEarlyWarning>,
): VitalEarlyWarningArgs | undefined {
  if (!context.settings.enabled) return undefined;
  return {
    values,
    patientId,
    context: { settings: context.settings, encounter: context.encounter, spo2Scale2: context.spo2Scale2 },
  };
}

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
    measuredAt: nowDateTimeInput(),
  }));
  const [problem, setProblem] = useState<ProblemRef | null>(defaultProblem ?? null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const problemOptions = useProblemOptions(patientId);
  // 記録した診療科。ヘッダーで選択中の科を焼き付ける(オーダーの依頼科と同じ扱い)。
  const orderContext = useOrderContext();
  const save = useSaveVitalEntry();
  const earlyWarning = useVitalEarlyWarning(patientId);

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
          department: orderContext,
          encounter: encounterReference(earlyWarning.encounter),
        }),
        earlyWarning: earlyWarningArgs(patientId, values, earlyWarning),
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
        submitting={save.isPending || !earlyWarning.ready}
        earlyWarning={earlyWarning.settings.enabled ? earlyWarning : undefined}
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
  const earlyWarning = useVitalEarlyWarning(patientId);

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
          // 作り直しでも記録した科は保存済みのものを引き継ぐ。
          department: vitalEntryDepartment(entry),
          encounter: entry.observations.find((o) => o.encounter)?.encounter,
        }),
        earlyWarning: earlyWarningArgs(patientId, values, earlyWarning),
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
        submitting={save.isPending || !earlyWarning.ready}
        earlyWarning={earlyWarning.settings.enabled ? earlyWarning : undefined}
      />
    </>
  );
}

function encounterReference(encounter: fhir4.Encounter | null): fhir4.Reference | undefined {
  return encounter?.id ? { reference: `Encounter/${encounter.id}` } : undefined;
}
