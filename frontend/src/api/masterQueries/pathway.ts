import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  copyPathway,
  createPathway,
  deletePathway,
  fetchPathway,
  type PathwayPayload,
  type PathwaySearchParams,
  searchPathways,
  updatePathway,
} from "../masterClient";

// ---- クリニカルパス(施設パス)定義マスタ ----

const PATHWAYS_KEY = ["master", "pathways"];

export function usePathwaySearch(filters: Omit<PathwaySearchParams, "page" | "per">, page: number) {
  return useQuery({
    queryKey: [...PATHWAYS_KEY, "list", filters, page],
    queryFn: () => searchPathways({ ...filters, page, per: 20 }),
    placeholderData: keepPreviousData,
  });
}

export function usePathway(idOrCode: number | string | null) {
  return useQuery({
    queryKey: [...PATHWAYS_KEY, "detail", idOrCode],
    queryFn: () => fetchPathway(idOrCode as number | string),
    enabled: idOrCode !== null,
    retry: false,
  });
}

/** 適用の候補にするパス(承認済かつ有効期間内)。 */
export function useApplicablePathways(name: string) {
  return useQuery({
    queryKey: [...PATHWAYS_KEY, "applicable", name],
    queryFn: () => searchPathways({ name, status: "approved", active: true, per: 100 }),
    placeholderData: keepPreviousData,
  });
}

/** 状態を問わないパス定義(データ抽出の絞り込みの選択肢。古い版や廃止したパスの適用も探せるように)。 */
export function usePathwayOptions() {
  return useQuery({
    queryKey: [...PATHWAYS_KEY, "options"],
    queryFn: () => searchPathways({ per: 100 }),
  });
}

export function usePathwayMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: PATHWAYS_KEY });
  };

  return {
    create: useMutation({
      mutationFn: (payload: PathwayPayload) => createPathway(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: PathwayPayload }) => updatePathway(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    copy: useMutation({
      mutationFn: ({ id, name }: { id: number; name?: string }) => copyPathway(id, name),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deletePathway(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}
