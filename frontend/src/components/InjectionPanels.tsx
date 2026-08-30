import { useMemo, useState } from "react";
import { useCreatePrescription, useInjectionSeriesLater, useUpdatePrescription } from "../api/queries";
import { ErrorBanner } from "./ErrorBanner";
import { InjectionForm } from "./InjectionForm";
import type { ProblemRef } from "../fhir/conditionHelpers";
import {
  buildDoInjectionForm,
  buildInjectionBundle,
  buildInjectionSeriesUpdateBundle,
  buildInjectionUpdateBundle,
  injectionSeriesLabel,
  emptyInjectionForm,
  type InjectionFormValues,
} from "../fhir/injectionHelpers";
import { prescriptionRequester, withOrderWard } from "../fhir/prescriptionHelpers";
import { useOrderContext } from "../hooks/useOrderContext";
import { useInjectionInitialValues } from "../hooks/useInjectionInitialValues";
import { useDefaultOrderSetting } from "../hooks/useDefaultOrderSetting";

// 注射オーダーの登録・編集 UI。カルテ画面の右ペインから使う。
// 送信は処方と同じ transaction Bundle の POST なので mutation(useCreatePrescription /
// useUpdatePrescription)を共用する(無効化キーも ServiceRequest 検索で共通)。

interface InjectionCreatePanelProps {
  patientId: string;
  /** DO(内容を流用して新規登録)する元の ServiceRequest id。 */
  sourceSrId?: string;
  defaultProblem?: ProblemRef;
  onSaved: () => void;
}

export function InjectionCreatePanel({
  patientId,
  sourceSrId,
  defaultProblem,
  onSaved,
}: InjectionCreatePanelProps) {
  const createInjection = useCreatePrescription();
  const source = useInjectionInitialValues(sourceSrId, patientId);
  // 入外区分の初期値は入院中なら「入院」。DO でも DO 元ではなくいまの状態に合わせる。
  const defaultSetting = useDefaultOrderSetting(patientId);
  // DO 元と入院かどうかの読み込み完了を待ってからフォームを描画する
  // (初期値は初回描画時のみ反映される)。
  const waiting = (sourceSrId && !source.ready) || !defaultSetting.ready;
  // DO も新しいオーダーなので、依頼元は DO 元ではなくヘッダーで選択中のものを使う。
  const requester = useOrderContext();

  const initialValues = useMemo(
    () =>
      source.initialValues
        ? buildDoInjectionForm(source.initialValues, defaultSetting.setting)
        : emptyInjectionForm(defaultProblem ?? null, defaultSetting.setting),
    [source.initialValues, defaultProblem, defaultSetting.setting],
  );

  function handleSubmit(values: InjectionFormValues) {
    // 新規オーダーには登録時点の入院病棟も焼き付ける(部門の一覧が入院を引き直さずに済む)。
    const attribution = withOrderWard(requester, values.setting, defaultSetting);
    createInjection.mutate(buildInjectionBundle(values, patientId, attribution), {
      onSuccess: onSaved,
    });
  }

  return (
    <>
      <ErrorBanner error={source.error} />

      {waiting ? (
        <p>読み込み中...</p>
      ) : (
        <InjectionForm
          patientId={patientId}
          initialValues={initialValues}
          onSubmit={handleSubmit}
          submitting={createInjection.isPending}
          submitError={createInjection.error}
        />
      )}
    </>
  );
}

interface InjectionEditPanelProps {
  patientId: string;
  srId: string;
  onSaved: () => void;
}

export function InjectionEditPanel({ patientId, srId, onSaved }: InjectionEditPanelProps) {
  const updateInjection = useUpdatePrescription();
  // 反映範囲。連日オーダーで後続日があるときだけ「この日以降」を選べる。
  const [scope, setScope] = useState<"one" | "following">("one");

  const {
    serviceRequest: sr,
    medicationRequests: mrs,
    initialValues,
    ready,
    patientMismatch,
    error,
  } = useInjectionInitialValues(srId, patientId);
  const later = useInjectionSeriesLater(patientMismatch ? undefined : sr);
  const laterTargets = later.data ?? [];

  function handleSubmit(values: InjectionFormValues) {
    // 別患者の注射を更新すると subject が URL の患者に書き換わってしまうので防ぐ。
    if (!sr || patientMismatch) return;
    // 依頼科・依頼医師は登録時のものを引き継ぐ(処方の編集と同じ考え方)。
    const requester = prescriptionRequester(sr);
    const bundle =
      scope === "following" && laterTargets.length
        ? buildInjectionSeriesUpdateBundle(
            values,
            patientId,
            [{ serviceRequest: sr, medicationRequests: mrs }, ...laterTargets],
            requester,
          )
        : buildInjectionUpdateBundle(
            values,
            patientId,
            srId,
            mrs.map((mr) => mr.id).filter((id): id is string => Boolean(id)),
            requester,
          );
    updateInjection.mutate(bundle, { onSuccess: onSaved });
  }

  const seriesLabel = sr ? injectionSeriesLabel(sr) : "";

  return (
    <>
      <ErrorBanner error={error ?? later.error} />

      {!ready ? (
        <p>読み込み中...</p>
      ) : (
        sr &&
        initialValues && (
          <>
            {laterTargets.length > 0 && (
              <fieldset className="injection-scope">
                <legend>反映範囲</legend>
                <p className="injection-scope__note">
                  {seriesLabel || "連日オーダー"}
                  {`。この後に ${laterTargets.length} 日分(〜${
                    laterTargets[laterTargets.length - 1].serviceRequest.authoredOn?.slice(0, 10) ?? ""
                  })があります。`}
                </p>
                <label className="injection-scope__option">
                  <input
                    type="radio"
                    name="injection-scope"
                    checked={scope === "one"}
                    onChange={() => setScope("one")}
                  />
                  この日のみ
                </label>
                <label className="injection-scope__option">
                  <input
                    type="radio"
                    name="injection-scope"
                    checked={scope === "following"}
                    onChange={() => setScope("following")}
                  />
                  {`この日以降の ${laterTargets.length + 1} 日分すべて(注射日以外を同じ内容に書き換え)`}
                </label>
              </fieldset>
            )}
            <InjectionForm
              patientId={patientId}
              initialValues={initialValues}
              onSubmit={handleSubmit}
              submitting={updateInjection.isPending}
              submitError={updateInjection.error}
              submitLabel="更新"
              mode="edit"
            />
          </>
        )
      )}
    </>
  );
}
