import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ItemLayoutCellPayload, ItemLayoutClient, ItemLayoutPayload } from "../masterClient";

// オーダーレイアウトの hook。検体検査・放射線・生理・内視鏡・処置で同じ形なので、
// 部門のクライアントとキャッシュの名前を渡して作る。
export function itemLayoutHooks<K extends string>(name: string, client: ItemLayoutClient<K>) {
  const key = ["master", name];

  return {
    codeKey: client.codeKey,
    useLayouts() {
      return useQuery({
        queryKey: [...key, "list"],
        staleTime: Infinity,
        queryFn: client.fetchLayouts,
      });
    },
    useLayout(id: number | undefined) {
      return useQuery({
        queryKey: [...key, "detail", id],
        queryFn: () => client.fetchLayout(id as number),
        enabled: id !== undefined,
      });
    },
    useLayoutMutations() {
      const queryClient = useQueryClient();
      const invalidate = () => queryClient.invalidateQueries({ queryKey: key });

      return {
        create: useMutation({
          mutationFn: (payload: ItemLayoutPayload) => client.createLayout(payload),
          retry: false,
          onSuccess: invalidate,
        }),
        update: useMutation({
          mutationFn: ({ id, payload }: { id: number; payload: ItemLayoutPayload }) =>
            client.updateLayout(id, payload),
          retry: false,
          onSuccess: invalidate,
        }),
        remove: useMutation({
          mutationFn: (id: number) => client.deleteLayout(id),
          retry: false,
          onSuccess: invalidate,
        }),
      };
    },
    useCellMutations() {
      const queryClient = useQueryClient();
      const invalidate = () => queryClient.invalidateQueries({ queryKey: key });

      return {
        create: useMutation({
          mutationFn: (payload: ItemLayoutCellPayload) => client.createCell(payload),
          retry: false,
          onSuccess: invalidate,
        }),
        update: useMutation({
          mutationFn: ({ id, payload }: { id: number; payload: Partial<ItemLayoutCellPayload> }) =>
            client.updateCell(id, payload),
          retry: false,
          onSuccess: invalidate,
        }),
        remove: useMutation({
          mutationFn: (id: number) => client.deleteCell(id),
          retry: false,
          onSuccess: invalidate,
        }),
      };
    },
  };
}

export type ItemLayoutHooks<K extends string> = ReturnType<typeof itemLayoutHooks<K>>;
