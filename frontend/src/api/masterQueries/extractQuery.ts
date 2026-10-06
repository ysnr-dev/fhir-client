import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createExtractQuery,
  createExtractQueryRun,
  fetchExtractQueryRuns,
  deleteExtractQuery,
  fetchExtractQueries,
  type ExtractQueryPayload,
  updateExtractQuery,
} from "../masterClient";

const EXTRACT_QUERIES_KEY = ["master", "extract_queries"];

export function useExtractQueries(departmentId: string | undefined, practitionerId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: [...EXTRACT_QUERIES_KEY, "list", { departmentId: departmentId ?? "", practitionerId: practitionerId ?? "" }],
    queryFn: () => fetchExtractQueries({ department_id: departmentId, practitioner_id: practitionerId }),
    enabled,
  });
}

export function useExtractQueryMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: EXTRACT_QUERIES_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: ExtractQueryPayload) => createExtractQuery(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: ExtractQueryPayload }) => updateExtractQuery(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteExtractQuery(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

const runsKey = (queryId: number | null) => [...EXTRACT_QUERIES_KEY, "runs", queryId ?? 0];

/** 保存した条件の実行の記録(新しい順)。 */
export function useExtractQueryRuns(queryId: number | null) {
  return useQuery({
    queryKey: runsKey(queryId),
    queryFn: () => fetchExtractQueryRuns(queryId!),
    enabled: queryId != null,
  });
}

export function useRecordExtractRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      queryId,
      payload,
    }: {
      queryId: number;
      payload: Parameters<typeof createExtractQueryRun>[1];
    }) => createExtractQueryRun(queryId, payload),
    retry: false,
    onSuccess: (_run, { queryId }) => queryClient.invalidateQueries({ queryKey: runsKey(queryId) }),
  });
}
