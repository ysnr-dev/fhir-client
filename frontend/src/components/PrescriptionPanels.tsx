import { useMemo, useState } from "react";
import type { OrderContext } from "../orderContext";
import { useCurrentPractitioner } from "../api/authQueries";
import {
  useBroughtMedicationsByIds,
  useBroughtMedTasks,
  useCreatePrescription,
  usePatientBroughtMedications,
  usePrescriptionCategoryDefaults,
  useUpdatePrescription,
} from "../api/queries";
import {
  buildConversionEntries,
  buildPrescriptionFormFromBrought,
  isAwaitingDecision,
} from "../fhir/broughtMedicationHelpers";
import { completeBroughtMedIdentifiedEntries } from "../fhir/broughtMedTaskHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { PrescriptionForm } from "./PrescriptionForm";
import type { ProblemRef } from "../fhir/conditionHelpers";
import {
  buildDoPrescriptionForm,
  buildPrescriptionBundle,
  buildPrescriptionUpdateBundle,
  emptyPrescriptionForm,
  prescriptionRequester,
  withOrderWard,
  type PrescriptionFormValues,
} from "../fhir/prescriptionHelpers";
import { preserveRegimenStamp } from "../fhir/regimenOrderHelpers";
import { useOrderContext } from "../hooks/useOrderContext";
import { usePrescriptionInitialValues } from "../hooks/usePrescriptionInitialValues";
import { useDefaultOrderSetting } from "../hooks/useDefaultOrderSetting";

// 処方の登録・編集 UI。ページとカルテ画面の右ペインの双方から使う。

interface PrescriptionCreatePanelProps {
  patientId: string;
  /** DO(内容を流用して新規登録)する元の ServiceRequest id。 */
  sourceSrId?: string;
  // 開いた時点で対象にしておくプロブレム(カルテ画面でプロブレムを選んでいる場合)。
  // DO では元の処方の対象プロブレムをそのまま引き継ぐので使わない。
  defaultProblem?: ProblemRef;
  /** 継続する持参薬(MedicationStatement.id)。その持参薬から初期値を作る。 */
  broughtIds?: string[];
  onSaved: () => void;
}

export function PrescriptionCreatePanel({
  patientId,
  sourceSrId,
  defaultProblem,
  broughtIds,
  onSaved,
}: PrescriptionCreatePanelProps) {
  const createPrescription = useCreatePrescription();
  const source = usePrescriptionInitialValues(sourceSrId, patientId);
  const brought = useBroughtConversion(patientId, broughtIds);
  // 入外区分の初期値は入院中なら「入院」。DO でも DO 元ではなくいまの状態に合わせる。
  const defaultSetting = useDefaultOrderSetting(patientId);
  // 処方区分の初期値(施設設定)はフォームが初回描画で入れるので、読み込みを待つ。
  const categoryDefaults = usePrescriptionCategoryDefaults();
  // DO 元と入院かどうか・施設設定の読み込み完了を待ってからフォームを描画する
  // (初期値は初回描画時のみ反映される)。
  const waiting =
    (sourceSrId && !source.ready) ||
    (broughtIds?.length && !brought.ready) ||
    !defaultSetting.ready ||
    !categoryDefaults.ready;
  // DO も新しいオーダーなので、依頼元は DO 元ではなくヘッダーで選択中のものを使う。
  const requester = useOrderContext();

  const initialValues = useMemo(
    () =>
      brought.statements.length
        ? buildPrescriptionFormFromBrought(brought.statements)
        : source.initialValues
          ? buildDoPrescriptionForm(source.initialValues, defaultSetting.setting)
          : emptyPrescriptionForm(defaultProblem ?? null, defaultSetting.setting),
    [brought.statements, source.initialValues, defaultProblem, defaultSetting.setting],
  );

  function handleSubmit(values: PrescriptionFormValues) {
    // 新規オーダーには登録時点の入院病棟も焼き付ける(部門の一覧が入院を引き直さずに済む)。
    const attribution = withOrderWard(requester, values.setting, defaultSetting);
    const bundle = buildPrescriptionBundle(values, patientId, attribution);
    // 持参薬の継続は、持参薬を「継続」にする更新を処方と同じ transaction で送る。
    const extraEntries = brought.entriesFor(bundle, values, attribution);
    if (extraEntries === null) return;
    createPrescription.mutate(
      { ...bundle, entry: [...(bundle.entry ?? []), ...extraEntries] },
      { onSuccess: onSaved },
    );
  }

  return (
    <>
      <ErrorBanner error={source.error ?? brought.error} />

      {waiting ? (
        <p>読み込み中...</p>
      ) : (
        <PrescriptionForm
          patientId={patientId}
          initialValues={initialValues}
          onSubmit={handleSubmit}
          submitting={createPrescription.isPending}
          submitError={createPrescription.error ?? brought.submitError}
        />
      )}
    </>
  );
}

/**
 * 持参薬の継続。選んだ持参薬を読み、処方の登録に足す entry(持参薬を「継続」にする更新と、
 * 判断が出揃ったら鑑別済の通知を閉じる更新)を作る。
 */
function useBroughtConversion(patientId: string, broughtIds: string[] | undefined) {
  const { statements, isLoading, error } = useBroughtMedicationsByIds(broughtIds);
  const encounterId = statements[0]?.context?.reference?.split("/").pop();
  const encounterStatements = usePatientBroughtMedications(
    encounterId ? patientId : undefined,
    encounterId,
  );
  const { tasks } = useBroughtMedTasks(encounterId);
  const { practitionerId, practitioner } = useCurrentPractitioner();
  const [noActorError, setNoActorError] = useState<Error | undefined>(undefined);

  // 継続を判断したのは処方の指示医師(代行入力なら選んだ医師)。選ばれていなければログイン中の本人。
  function entriesFor(
    bundle: fhir4.Bundle,
    values: PrescriptionFormValues,
    requester: OrderContext,
  ): fhir4.BundleEntry[] | null {
    if (!broughtIds?.length) return [];
    const actor = requester.practitionerId
      ? { practitionerId: requester.practitionerId, display: requester.practitionerName }
      : practitionerId && practitioner
        ? { practitionerId, display: practitionerDisplayName(practitioner) }
        : null;
    if (!actor) {
      setNoActorError(new Error("持参薬の継続には指示医師を選んでください。"));
      return null;
    }
    setNoActorError(undefined);
    // フォームで行を消した持参薬は継続にしない(未判断のまま残る)。
    const kept = new Set(
      values.rps.flatMap((rp) => rp.medicines.map((m) => m.broughtMedicationId).filter(Boolean)),
    );
    const converting = statements.filter((s) => s.id && kept.has(s.id));
    const entries = buildConversionEntries(bundle, converting, actor);
    const convertingIds = new Set(converting.map((s) => s.id));
    const stillAwaiting = encounterStatements.statements.some(
      (s) => isAwaitingDecision(s) && !convertingIds.has(s.id),
    );
    if (!stillAwaiting) entries.push(...completeBroughtMedIdentifiedEntries(tasks, actor));
    return entries;
  }

  return {
    statements,
    ready: !isLoading && !encounterStatements.isLoading,
    error,
    submitError: noActorError,
    entriesFor,
  };
}

interface PrescriptionEditPanelProps {
  patientId: string;
  srId: string;
  onSaved: () => void;
}

export function PrescriptionEditPanel({ patientId, srId, onSaved }: PrescriptionEditPanelProps) {
  const updatePrescription = useUpdatePrescription();

  const {
    serviceRequest: sr,
    medicationRequests: mrs,
    initialValues,
    ready,
    patientMismatch,
    error,
  } = usePrescriptionInitialValues(srId, patientId);

  function handleSubmit(values: PrescriptionFormValues) {
    // 別患者の処方を更新すると subject が URL の患者に書き換わり、処方が付け替わってしまう。
    if (!sr || patientMismatch) return;
    // 依頼科・依頼医師は登録時のものを引き継ぐ(編集した人・その時のヘッダーの選択で
    // 上書きしない)。診療記録の author と同じ考え方。
    const originalIds = mrs.map((mr) => mr.id).filter((id): id is string => Boolean(id));
    const bundle = buildPrescriptionUpdateBundle(values, patientId, sr, originalIds, prescriptionRequester(sr));
    // レジメンの内服の日オーダーなら、フォームが持たないレジメンの印を元のオーダーから写す
    // (注射の編集と同じ。写さないと化学療法の暦から消える)。
    updatePrescription.mutate(
      { ...bundle, entry: preserveRegimenStamp(bundle.entry ?? [], sr, mrs) },
      { onSuccess: onSaved },
    );
  }

  return (
    <>
      <ErrorBanner error={error} />

      {!ready ? (
        <p>読み込み中...</p>
      ) : (
        sr &&
        initialValues && (
          <PrescriptionForm
            patientId={patientId}
            initialValues={initialValues}
            onSubmit={handleSubmit}
            submitting={updatePrescription.isPending}
            submitError={updatePrescription.error}
            submitLabel="更新"
            orderId={srId}
          />
        )
      )}
    </>
  );
}
