import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createTreatmentDataset,
  createTreatmentDatasetDetail,
  createTreatmentItem,
  createTreatmentItemLayout,
  createTreatmentItemLayoutCell,
  createTreatmentSetItem,
  deleteTreatmentDataset,
  deleteTreatmentDatasetDetail,
  deleteTreatmentItem,
  deleteTreatmentItemLayout,
  deleteTreatmentItemLayoutCell,
  deleteTreatmentSetItem,
  fetchTreatmentDataset,
  fetchTreatmentItem,
  fetchTreatmentItemLayout,
  fetchTreatmentItemLayouts,
  type MasterSearchResult,
  searchTreatmentDatasetDetails,
  searchTreatmentDatasets,
  searchTreatmentItems,
  searchTreatmentSetItems,
  type TreatmentDatasetDetailPayload,
  type TreatmentDatasetPayload,
  type TreatmentItemLayoutCellPayload,
  type TreatmentItemLayoutPayload,
  type TreatmentItemPayload,
  type TreatmentSetItem,
  type TreatmentSetItemPayload,
  updateTreatmentDataset,
  updateTreatmentDatasetDetail,
  updateTreatmentItem,
  updateTreatmentItemLayout,
  updateTreatmentItemLayoutCell,
} from "../masterClient";

// ---- 処置オーダーのマスタ ----
//
// 生理検査と同じ構成から検査種別(分類軸)を落としたもの。

const TREATMENT_ITEMS_KEY = ["master", "treatment_items"];
const TREATMENT_LAYOUTS_KEY = ["master", "treatment_item_layouts"];
const TREATMENT_DATASETS_KEY = ["master", "treatment_datasets"];
// 1データセットの明細も、オーダーに紐付く全データセットの明細も、この上限で足りる。
const TREATMENT_DATASET_DETAIL_PER = 100;

export interface TreatmentItemFilters {
  name?: string;
  /** 名称・略称・カナをまとめて探す1つの語。 */
  keyword?: string;
  kind?: string;
  /** オーダー単位。"true"=グループ化のみ / "false"=単独オーダーのみ。 */
  groupable?: string;
  active?: boolean;
}

export function useTreatmentItemSearch(filters: TreatmentItemFilters, page: number, enabled = true) {
  return useQuery({
    queryKey: [...TREATMENT_ITEMS_KEY, "list", filters, page],
    queryFn: () =>
      searchTreatmentItems({
        name: filters.name || undefined,
        keyword: filters.keyword || undefined,
        kind: filters.kind || undefined,
        groupable: filters.groupable || undefined,
        active: filters.active || undefined,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

// セット構成を添えた詳細(編集モーダル用)。
export function useTreatmentItem(idOrCode: string | number | null) {
  return useQuery({
    queryKey: [...TREATMENT_ITEMS_KEY, "detail", idOrCode],
    queryFn: () => fetchTreatmentItem(idOrCode as string | number),
    enabled: idOrCode !== null,
  });
}

export function useTreatmentItemMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: TREATMENT_ITEMS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: TreatmentItemPayload) => createTreatmentItem(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: TreatmentItemPayload }) =>
        updateTreatmentItem(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteTreatmentItem(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

export function useTreatmentSetItemMutations() {
  const queryClient = useQueryClient();
  // セット構成はオーダー項目詳細に添えて返るため、項目側のキーを破棄する。
  const invalidate = () => queryClient.invalidateQueries({ queryKey: TREATMENT_ITEMS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: TreatmentSetItemPayload) => createTreatmentSetItem(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteTreatmentSetItem(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

export function useTreatmentItemLayouts() {
  return useQuery({
    queryKey: [...TREATMENT_LAYOUTS_KEY, "list"],
    staleTime: Infinity,
    queryFn: fetchTreatmentItemLayouts,
  });
}

export function useTreatmentItemLayout(id: number | undefined) {
  return useQuery({
    queryKey: [...TREATMENT_LAYOUTS_KEY, "detail", id],
    queryFn: () => fetchTreatmentItemLayout(id as number),
    enabled: id !== undefined,
  });
}

export function useTreatmentItemLayoutMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: TREATMENT_LAYOUTS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: TreatmentItemLayoutPayload) => createTreatmentItemLayout(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: TreatmentItemLayoutPayload }) =>
        updateTreatmentItemLayout(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteTreatmentItemLayout(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

export function useTreatmentItemLayoutCellMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: TREATMENT_LAYOUTS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: TreatmentItemLayoutCellPayload) => createTreatmentItemLayoutCell(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: Partial<TreatmentItemLayoutCellPayload> }) =>
        updateTreatmentItemLayoutCell(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteTreatmentItemLayoutCell(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

/** 実施入力用データセットの検索。 */
export function useTreatmentDatasetSearch(
  filters: { name?: string; active?: boolean },
  page: number,
  enabled = true,
) {
  return useQuery({
    queryKey: [...TREATMENT_DATASETS_KEY, "list", filters, page],
    queryFn: () =>
      searchTreatmentDatasets({
        name: filters.name || undefined,
        active: filters.active || undefined,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** 処置項目に付けるデータセットの選択肢。件数が少ないので全件まとめて引く。 */
export function useTreatmentDatasetOptions() {
  return useQuery({
    queryKey: [...TREATMENT_DATASETS_KEY, "options"],
    staleTime: Infinity,
    queryFn: () => searchTreatmentDatasets({ per: 200 }),
  });
}

/** 編集モーダル用の詳細(明細を名称付きで同梱)。データセットコードでも id でも引ける。 */
export function useTreatmentDataset(idOrCode: string | number | null) {
  return useQuery({
    queryKey: [...TREATMENT_DATASETS_KEY, "detail", idOrCode],
    queryFn: () => fetchTreatmentDataset(idOrCode as string | number),
    enabled: idOrCode !== null,
  });
}

export function useTreatmentDatasetMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: TREATMENT_DATASETS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: TreatmentDatasetPayload) => createTreatmentDataset(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: TreatmentDatasetPayload }) =>
        updateTreatmentDataset(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteTreatmentDataset(id),
      retry: false,
      onSuccess: () => {
        invalidate();
        // 削除で参照していた項目の dataset_code も外れるので、項目マスタ側も引き直す。
        queryClient.invalidateQueries({ queryKey: TREATMENT_ITEMS_KEY });
      },
    }),
  };
}

/** 明細の編集。データセット詳細に同梱されているので詳細ごと破棄する。 */
export function useTreatmentDatasetDetailMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: TREATMENT_DATASETS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: TreatmentDatasetDetailPayload) => createTreatmentDatasetDetail(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: TreatmentDatasetDetailPayload }) =>
        updateTreatmentDatasetDetail(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteTreatmentDatasetDetail(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

/**
 * 処置項目コード群が参照するデータセットの明細。実施入力の初期表示に使う。
 *
 * 項目 → 明細の2段。1つのデータセットは複数の処置項目から参照されるので、
 * 明細を引く前にデータセットコードを一意化する(同じデータセットを2回引かない)。
 */
export function useTreatmentDatasetLinesForItems(itemCodes: string[]) {
  const codes = Array.from(new Set(itemCodes.filter(Boolean))).sort();

  const items = useQuery({
    queryKey: [...TREATMENT_ITEMS_KEY, "dataset-codes", codes],
    staleTime: Infinity,
    queryFn: () =>
      searchTreatmentItems({ item_code: codes.join(","), per: TREATMENT_DATASET_DETAIL_PER }),
    enabled: codes.length > 0,
  });

  const datasetCodes = Array.from(
    new Set((items.data?.items ?? []).map((item) => item.dataset_code).filter(Boolean)),
  ).sort() as string[];

  const details = useQuery({
    queryKey: [...TREATMENT_DATASETS_KEY, "details-for", datasetCodes],
    queryFn: () =>
      searchTreatmentDatasetDetails({
        dataset_code: datasetCodes.join(","),
        per: TREATMENT_DATASET_DETAIL_PER,
      }),
    enabled: datasetCodes.length > 0,
  });

  return {
    details: details.data?.items ?? [],
    // データセットを持つ項目が1つも無いときは明細クエリが走らないので、その分は待たない。
    isLoading: items.isLoading || (datasetCodes.length > 0 && details.isLoading),
    error: items.error ?? details.error,
  };
}

// 処置オーダー画面用 --------------------------------------------------

// 選択中の項目コードからマスタの内容(名称・略称)を引き直す。
// オーダー画面のプレビューと、保存時に FHIR へ写す値の取得元。
export function useTreatmentItemsByCodes(codes: string[]) {
  const sorted = Array.from(new Set(codes)).sort();

  return useQuery({
    queryKey: [...TREATMENT_ITEMS_KEY, "by_codes", sorted],
    staleTime: Infinity,
    queryFn: () => searchTreatmentItems({ item_code: sorted.join(","), per: 200 }),
    enabled: sorted.length > 0,
  });
}

// select はモジュールスコープに置く。ここで無名関数を渡すと呼び出しのたびに
// 別の関数になり、react-query が結果を再利用できず data が毎回別オブジェクトに
// なってしまう(それを依存に持つ effect が回り続ける)。
function toTreatmentSetMemberMap(
  result: MasterSearchResult<TreatmentSetItem>,
): Map<string, string[]> {
  const members = new Map<string, string[]>();
  for (const member of result.items) {
    const list = members.get(member.set_item_code);
    if (list) list.push(member.member_item_code);
    else members.set(member.set_item_code, [member.member_item_code]);
  }
  return members;
}

// セットの構成。「セットコード → 構成項目の項目コード」で返す。
// オーダー画面でセットを選んだときに、その構成項目もオーダーに入れるために引く。
// セットでない項目コードを混ぜても結果が増えないだけなので、呼ぶ側で選別しない。
export function useTreatmentSetMembers(setCodes: string[]) {
  const sorted = Array.from(new Set(setCodes)).sort();

  return useQuery({
    queryKey: [...TREATMENT_ITEMS_KEY, "set_members", sorted],
    queryFn: () => searchTreatmentSetItems({ set_item_code: sorted.join(","), per: 500 }),
    select: toTreatmentSetMemberMap,
    enabled: sorted.length > 0,
  });
}
