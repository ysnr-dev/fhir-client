import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  PerformDatasetClient,
  PerformDatasetDetail,
  PerformDatasetDetailPayload,
  PerformDatasetPayload,
} from "../masterClient";

const DATASET_DETAIL_PER = 100;

// 実施入力用データセットの hook。放射線・生理・内視鏡・処置で同じ形なので、部門のクライアントと
// キャッシュの名前、紐付け元のオーダー項目マスタ(キャッシュのキーとコードでの引き方)を渡して作る。
export function performDatasetHooks<D extends PerformDatasetDetail>(config: {
  name: string;
  client: PerformDatasetClient<D>;
  itemsKey: readonly string[];
  searchItemsByCodes: (codes: string[], per: number) => Promise<{ items: { dataset_code: string | null }[] }>;
}) {
  const { client, itemsKey } = config;
  const key = ["master", config.name];

  return {
    /** 実施入力用データセットの検索。 */
    useSearch(filters: { name?: string; active?: boolean }, page: number, enabled = true) {
      return useQuery({
        queryKey: [...key, "list", filters, page],
        queryFn: () =>
          client.search({
            name: filters.name || undefined,
            active: filters.active || undefined,
            page,
            per: 20,
          }),
        placeholderData: keepPreviousData,
        enabled,
      });
    },

    /** オーダー項目に付けるデータセットの選択肢。件数が少ないので全件まとめて引く。 */
    useOptions() {
      return useQuery({
        queryKey: [...key, "options"],
        staleTime: Infinity,
        queryFn: () => client.search({ per: 200 }),
      });
    },

    /** 編集モーダル用の詳細(明細を名称付きで同梱)。データセットコードでも id でも引ける。 */
    useDataset(idOrCode: string | number | null) {
      return useQuery({
        queryKey: [...key, "detail", idOrCode],
        queryFn: () => client.fetch(idOrCode as string | number),
        enabled: idOrCode !== null,
      });
    },

    useMutations() {
      const queryClient = useQueryClient();
      const invalidate = () => queryClient.invalidateQueries({ queryKey: key });

      return {
        create: useMutation({
          mutationFn: (payload: PerformDatasetPayload) => client.create(payload),
          retry: false,
          onSuccess: invalidate,
        }),
        update: useMutation({
          mutationFn: ({ id, payload }: { id: number; payload: PerformDatasetPayload }) =>
            client.update(id, payload),
          retry: false,
          onSuccess: invalidate,
        }),
        remove: useMutation({
          mutationFn: (id: number) => client.remove(id),
          retry: false,
          onSuccess: () => {
            invalidate();
            // 削除で参照していた項目の dataset_code も外れるので、項目マスタ側も引き直す。
            queryClient.invalidateQueries({ queryKey: itemsKey });
          },
        }),
      };
    },

    /** 明細の編集。データセット詳細に同梱されているので詳細ごと破棄する。 */
    useDetailMutations() {
      const queryClient = useQueryClient();
      const invalidate = () => queryClient.invalidateQueries({ queryKey: key });

      return {
        create: useMutation({
          mutationFn: (payload: PerformDatasetDetailPayload) => client.createDetail(payload),
          retry: false,
          onSuccess: invalidate,
        }),
        update: useMutation({
          mutationFn: ({ id, payload }: { id: number; payload: PerformDatasetDetailPayload }) =>
            client.updateDetail(id, payload),
          retry: false,
          onSuccess: invalidate,
        }),
        remove: useMutation({
          mutationFn: (id: number) => client.removeDetail(id),
          retry: false,
          onSuccess: invalidate,
        }),
      };
    },

    /**
     * オーダー項目コード群が参照するデータセットの明細。実施入力の初期表示に使う。
     *
     * 項目 → 明細の2段。1つのデータセットは複数のオーダー項目から参照されるので、
     * 明細を引く前にデータセットコードを一意化する(同じデータセットを2回引かない)。
     */
    useLinesForItems(itemCodes: string[]) {
      const codes = Array.from(new Set(itemCodes.filter(Boolean))).sort();

      const items = useQuery({
        queryKey: [...itemsKey, "dataset-codes", codes],
        staleTime: Infinity,
        queryFn: () => config.searchItemsByCodes(codes, DATASET_DETAIL_PER),
        enabled: codes.length > 0,
      });

      const datasetCodes = Array.from(
        new Set((items.data?.items ?? []).map((item) => item.dataset_code).filter(Boolean)),
      ).sort() as string[];

      const details = useQuery({
        queryKey: [...key, "details-for", datasetCodes],
        queryFn: () =>
          client.searchDetails({
            dataset_code: datasetCodes.join(","),
            per: DATASET_DETAIL_PER,
          }),
        enabled: datasetCodes.length > 0,
      });

      return {
        details: details.data?.items ?? [],
        // データセットを持つ項目が1つも無いときは明細クエリが走らないので、その分は待たない。
        isLoading: items.isLoading || (datasetCodes.length > 0 && details.isLoading),
        error: items.error ?? details.error,
      };
    },
  };
}

export type PerformDatasetHooks<D extends PerformDatasetDetail> = ReturnType<typeof performDatasetHooks<D>>;
