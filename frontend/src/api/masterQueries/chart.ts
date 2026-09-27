import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ChartDefinitionPayload,
  createChartDefinition,
  deleteChartDefinition,
  fetchChartDefinitions,
  fetchPatientChartPin,
  pinPatientChart,
  unpinPatientChart,
  updateChartDefinition,
} from "../masterClient";

// ---- チャート定義 ----

const CHART_DEFINITIONS_KEY = ["master", "chart_definitions"];

// 持ち主の組(院内共通 + 診療科 X + 医師 Y)ごとにキャッシュする。件数が少ないので
// 一覧で definition ごと持ち、カルテのチャートタブはこれだけで描ける。
export function useChartDefinitions(
  departmentId: string | undefined,
  practitionerId: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: [
      ...CHART_DEFINITIONS_KEY,
      "list",
      { departmentId: departmentId ?? "", practitionerId: practitionerId ?? "" },
    ],
    queryFn: () =>
      fetchChartDefinitions({ department_id: departmentId, practitioner_id: practitionerId }),
    enabled,
  });
}

export function useChartDefinitionMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: CHART_DEFINITIONS_KEY });
  };

  return {
    create: useMutation({
      mutationFn: (payload: ChartDefinitionPayload) => createChartDefinition(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: ChartDefinitionPayload }) =>
        updateChartDefinition(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteChartDefinition(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

// 患者ごとに最初に開くチャート(ピン留め)。チャート定義を消すとピンも外れるので、
// 定義と同じキーの下に置いて一緒に引き直す。
export function usePatientChartPin(patientId: string | undefined) {
  return useQuery({
    queryKey: [...CHART_DEFINITIONS_KEY, "pin", patientId ?? ""],
    queryFn: () => fetchPatientChartPin(patientId ?? ""),
    enabled: Boolean(patientId),
  });
}

export function usePatientChartPinMutation(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    /** chartDefinitionId が null なら外す。 */
    mutationFn: async ({
      chartDefinitionId,
      pinnedByName,
    }: {
      chartDefinitionId: number | null;
      pinnedByName: string | null;
    }): Promise<void> => {
      if (chartDefinitionId === null) await unpinPatientChart(patientId);
      else await pinPatientChart(patientId, chartDefinitionId, pinnedByName);
    },
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...CHART_DEFINITIONS_KEY, "pin", patientId] });
    },
  });
}
