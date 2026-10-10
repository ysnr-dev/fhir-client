import { useMemo } from "react";
import { useCareTeams, useCreatePrescription, useUpdateTeamRequest } from "../api/queries";
import { careTeamKind, careTeamName } from "../fhir/careTeamHelpers";
import type { ProblemRef } from "../fhir/conditionHelpers";
import { orderRequester, withOrderWard } from "../fhir/orderHeader";
import {
  buildDoTeamRequestForm,
  buildTeamRequestBundle,
  buildTeamRequestUpdateBundle,
  emptyTeamRequestForm,
  type TeamRequestFormValues,
} from "../fhir/teamRequestHelpers";
import { useDefaultOrderSetting } from "../hooks/useDefaultOrderSetting";
import { useOrderContext } from "../hooks/useOrderContext";
import { useTeamRequestInitialValues } from "../hooks/useTeamRequestInitialValues";
import { ErrorBanner } from "./ErrorBanner";
import { TeamRequestForm } from "./TeamRequestForm";

// チーム依頼の登録・編集 UI。カルテ画面の右ペインから使う(他科依頼のパネルと同じ作り)。

interface TeamRequestCreatePanelProps {
  patientId: string;
  sourceSrId?: string;
  defaultProblem?: ProblemRef;
  /** 宛先を選択済みで開く(スクリーニング一覧・褥瘡管理からのリンク)。 */
  teamId?: string;
  onSaved: () => void;
}

export function TeamRequestCreatePanel({ patientId, sourceSrId, defaultProblem, teamId, onSaved }: TeamRequestCreatePanelProps) {
  const create = useCreatePrescription();
  const source = useTeamRequestInitialValues(sourceSrId, patientId);
  const defaultSetting = useDefaultOrderSetting(patientId);
  const teams = useCareTeams();
  const waiting = (sourceSrId && !source.ready) || !defaultSetting.ready || (teamId && teams.isPending);
  const requester = useOrderContext();

  const initialValues = useMemo(() => {
    if (source.initialValues) return buildDoTeamRequestForm(source.initialValues, defaultSetting.setting);
    const team = teamId ? teams.data?.find((t) => t.id === teamId) : undefined;
    return {
      ...emptyTeamRequestForm(defaultSetting.setting),
      problem: defaultProblem ?? null,
      teamId: team?.id ?? "",
      teamName: team ? careTeamName(team) : "",
      teamKind: team ? careTeamKind(team) : "",
    };
  }, [source.initialValues, defaultProblem, defaultSetting.setting, teamId, teams.data]);

  function handleSubmit(values: TeamRequestFormValues) {
    const attribution = withOrderWard(requester, values.setting, defaultSetting);
    create.mutate(buildTeamRequestBundle(values, patientId, attribution), { onSuccess: onSaved });
  }

  return (
    <>
      <ErrorBanner error={source.error} />
      {waiting ? (
        <p>読み込み中...</p>
      ) : (
        <TeamRequestForm
          patientId={patientId}
          initialValues={initialValues}
          onSubmit={handleSubmit}
          submitting={create.isPending}
          submitError={create.error}
        />
      )}
    </>
  );
}

interface TeamRequestEditPanelProps {
  patientId: string;
  srId: string;
  onSaved: () => void;
}

export function TeamRequestEditPanel({ patientId, srId, onSaved }: TeamRequestEditPanelProps) {
  const update = useUpdateTeamRequest();
  const { serviceRequest, initialValues, ready, patientMismatch, error } = useTeamRequestInitialValues(srId, patientId);

  function handleSubmit(values: TeamRequestFormValues) {
    if (!serviceRequest || patientMismatch) return;
    update.mutate(buildTeamRequestUpdateBundle(values, patientId, serviceRequest, orderRequester(serviceRequest)), {
      onSuccess: onSaved,
    });
  }

  return (
    <>
      <ErrorBanner error={error} />
      {!ready ? (
        <p>読み込み中...</p>
      ) : (
        serviceRequest &&
        initialValues && (
          <TeamRequestForm
            patientId={patientId}
            initialValues={initialValues}
            onSubmit={handleSubmit}
            submitting={update.isPending}
            submitError={update.error}
            submitLabel="更新"
          />
        )
      )}
    </>
  );
}
