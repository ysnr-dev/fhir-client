import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createEndoscopyDataset,
  createEndoscopyDatasetDetail,
  createEndoscopyExamType,
  createEndoscopyItem,
  createEndoscopyItemLayout,
  createEndoscopyItemLayoutCell,
  createEndoscopySetItem,
  deleteEndoscopyDataset,
  deleteEndoscopyDatasetDetail,
  deleteEndoscopyExamType,
  deleteEndoscopyItem,
  deleteEndoscopyItemLayout,
  deleteEndoscopyItemLayoutCell,
  deleteEndoscopySetItem,
  type EndoscopyDatasetDetailPayload,
  type EndoscopyDatasetPayload,
  type EndoscopyExamTypePayload,
  type EndoscopyItemLayoutCellPayload,
  type EndoscopyItemLayoutPayload,
  type EndoscopyItemPayload,
  type EndoscopyItemSearchResult,
  type EndoscopySetItem,
  type EndoscopySetItemPayload,
  fetchEndoscopyDataset,
  fetchEndoscopyItem,
  fetchEndoscopyItemLayout,
  fetchEndoscopyItemLayouts,
  type MasterSearchResult,
  searchEndoscopyDatasetDetails,
  searchEndoscopyDatasets,
  searchEndoscopyExamTypes,
  searchEndoscopyItems,
  searchEndoscopySetItems,
  updateEndoscopyDataset,
  updateEndoscopyDatasetDetail,
  updateEndoscopyExamType,
  updateEndoscopyItem,
  updateEndoscopyItemLayout,
  updateEndoscopyItemLayoutCell,
} from "../masterClient";

// ---- 内視鏡オーダーのマスタ ----
//
// 生理検査と同じ構成。

const ENDOSCOPY_EXAM_TYPES_KEY = ["master", "endoscopy_exam_types"];
const ENDOSCOPY_ITEMS_KEY = ["master", "endoscopy_items"];
const ENDOSCOPY_LAYOUTS_KEY = ["master", "endoscopy_item_layouts"];
const ENDOSCOPY_DATASETS_KEY = ["master", "endoscopy_datasets"];
// 1データセットの明細も、オーダーに紐付く全データセットの明細も、この上限で足りる。
const ENDOSCOPY_DATASET_DETAIL_PER = 100;

/** 検査種別の検索(マスタ画面の一覧)。 */
export function useEndoscopyExamTypeSearch(
  filters: { name?: string; active?: boolean },
  page: number,
  enabled = true,
) {
  return useQuery({
    queryKey: [...ENDOSCOPY_EXAM_TYPES_KEY, "list", filters, page],
    queryFn: () =>
      searchEndoscopyExamTypes({
        name: filters.name || undefined,
        active: filters.active || undefined,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/**
 * 検査種別の選択肢。項目マスタ・オーダー画面・部門一覧が共通で使う。
 * 10件前後にしかならないマスタなので全件まとめて引く(放射線が JJ1017 の
 * catalog API を引いていたところに相当する)。
 */
export function useEndoscopyExamTypeOptions() {
  return useQuery({
    queryKey: [...ENDOSCOPY_EXAM_TYPES_KEY, "options"],
    staleTime: Infinity,
    queryFn: () => searchEndoscopyExamTypes({ per: 200 }),
  });
}

export function useEndoscopyExamTypeMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ENDOSCOPY_EXAM_TYPES_KEY });
    // 種別の名称は項目一覧・詳細にも添えて返るので、項目側も引き直す。
    queryClient.invalidateQueries({ queryKey: ENDOSCOPY_ITEMS_KEY });
  };

  return {
    create: useMutation({
      mutationFn: (payload: EndoscopyExamTypePayload) => createEndoscopyExamType(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: EndoscopyExamTypePayload }) =>
        updateEndoscopyExamType(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteEndoscopyExamType(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

export interface EndoscopyItemFilters {
  name?: string;
  /** 名称・検査種別をまとめて探す1つの語。 */
  keyword?: string;
  kind?: string;
  /** オーダー単位。"true"=グループ化のみ / "false"=単独オーダーのみ。 */
  groupable?: string;
  examTypeCode?: string;
  active?: boolean;
}

export function useEndoscopyItemSearch(filters: EndoscopyItemFilters, page: number, enabled = true) {
  return useQuery({
    queryKey: [...ENDOSCOPY_ITEMS_KEY, "list", filters, page],
    queryFn: () =>
      searchEndoscopyItems({
        name: filters.name || undefined,
        keyword: filters.keyword || undefined,
        kind: filters.kind || undefined,
        groupable: filters.groupable || undefined,
        exam_type_code: filters.examTypeCode || undefined,
        active: filters.active || undefined,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

// 検査種別の名称とセット構成を添えた詳細(編集モーダル用)。
export function useEndoscopyItem(idOrCode: string | number | null) {
  return useQuery({
    queryKey: [...ENDOSCOPY_ITEMS_KEY, "detail", idOrCode],
    queryFn: () => fetchEndoscopyItem(idOrCode as string | number),
    enabled: idOrCode !== null,
  });
}

export function useEndoscopyItemMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ENDOSCOPY_ITEMS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: EndoscopyItemPayload) => createEndoscopyItem(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: EndoscopyItemPayload }) =>
        updateEndoscopyItem(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteEndoscopyItem(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

export function useEndoscopySetItemMutations() {
  const queryClient = useQueryClient();
  // セット構成はオーダー項目詳細に添えて返るため、項目側のキーを破棄する。
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ENDOSCOPY_ITEMS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: EndoscopySetItemPayload) => createEndoscopySetItem(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteEndoscopySetItem(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

export function useEndoscopyItemLayouts() {
  return useQuery({
    queryKey: [...ENDOSCOPY_LAYOUTS_KEY, "list"],
    staleTime: Infinity,
    queryFn: fetchEndoscopyItemLayouts,
  });
}

export function useEndoscopyItemLayout(id: number | undefined) {
  return useQuery({
    queryKey: [...ENDOSCOPY_LAYOUTS_KEY, "detail", id],
    queryFn: () => fetchEndoscopyItemLayout(id as number),
    enabled: id !== undefined,
  });
}

export function useEndoscopyItemLayoutMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ENDOSCOPY_LAYOUTS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: EndoscopyItemLayoutPayload) => createEndoscopyItemLayout(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: EndoscopyItemLayoutPayload }) =>
        updateEndoscopyItemLayout(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteEndoscopyItemLayout(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

export function useEndoscopyItemLayoutCellMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ENDOSCOPY_LAYOUTS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: EndoscopyItemLayoutCellPayload) => createEndoscopyItemLayoutCell(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: Partial<EndoscopyItemLayoutCellPayload> }) =>
        updateEndoscopyItemLayoutCell(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteEndoscopyItemLayoutCell(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

/** 実施入力用データセットの検索。 */
export function useEndoscopyDatasetSearch(
  filters: { name?: string; active?: boolean },
  page: number,
  enabled = true,
) {
  return useQuery({
    queryKey: [...ENDOSCOPY_DATASETS_KEY, "list", filters, page],
    queryFn: () =>
      searchEndoscopyDatasets({
        name: filters.name || undefined,
        active: filters.active || undefined,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** 検査項目に付けるデータセットの選択肢。件数が少ないので全件まとめて引く。 */
export function useEndoscopyDatasetOptions() {
  return useQuery({
    queryKey: [...ENDOSCOPY_DATASETS_KEY, "options"],
    staleTime: Infinity,
    queryFn: () => searchEndoscopyDatasets({ per: 200 }),
  });
}

/** 編集モーダル用の詳細(明細を名称付きで同梱)。データセットコードでも id でも引ける。 */
export function useEndoscopyDataset(idOrCode: string | number | null) {
  return useQuery({
    queryKey: [...ENDOSCOPY_DATASETS_KEY, "detail", idOrCode],
    queryFn: () => fetchEndoscopyDataset(idOrCode as string | number),
    enabled: idOrCode !== null,
  });
}

export function useEndoscopyDatasetMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ENDOSCOPY_DATASETS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: EndoscopyDatasetPayload) => createEndoscopyDataset(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: EndoscopyDatasetPayload }) =>
        updateEndoscopyDataset(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteEndoscopyDataset(id),
      retry: false,
      onSuccess: () => {
        invalidate();
        // 削除で参照していた項目の dataset_code も外れるので、項目マスタ側も引き直す。
        queryClient.invalidateQueries({ queryKey: ENDOSCOPY_ITEMS_KEY });
      },
    }),
  };
}

/** 明細の編集。データセット詳細に同梱されているので詳細ごと破棄する。 */
export function useEndoscopyDatasetDetailMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ENDOSCOPY_DATASETS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: EndoscopyDatasetDetailPayload) => createEndoscopyDatasetDetail(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: EndoscopyDatasetDetailPayload }) =>
        updateEndoscopyDatasetDetail(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteEndoscopyDatasetDetail(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

/**
 * 検査項目コード群が参照するデータセットの明細。実施入力の初期表示に使う。
 *
 * 項目 → 明細の2段。1つのデータセットは複数の検査項目から参照されるので、
 * 明細を引く前にデータセットコードを一意化する(同じデータセットを2回引かない)。
 */
export function useEndoscopyDatasetLinesForItems(itemCodes: string[]) {
  const codes = Array.from(new Set(itemCodes.filter(Boolean))).sort();

  const items = useQuery({
    queryKey: [...ENDOSCOPY_ITEMS_KEY, "dataset-codes", codes],
    staleTime: Infinity,
    queryFn: () =>
      searchEndoscopyItems({ item_code: codes.join(","), per: ENDOSCOPY_DATASET_DETAIL_PER }),
    enabled: codes.length > 0,
  });

  const datasetCodes = Array.from(
    new Set((items.data?.items ?? []).map((item) => item.dataset_code).filter(Boolean)),
  ).sort() as string[];

  const details = useQuery({
    queryKey: [...ENDOSCOPY_DATASETS_KEY, "details-for", datasetCodes],
    queryFn: () =>
      searchEndoscopyDatasetDetails({
        dataset_code: datasetCodes.join(","),
        per: ENDOSCOPY_DATASET_DETAIL_PER,
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

// 内視鏡オーダー画面用 --------------------------------------------------

// 選択中の項目コードからマスタの内容(名称・検査種別)を引き直す。
// オーダー画面のプレビューと、保存時に FHIR へ写す値の取得元。
// 検索APIが検査種別の名称(exam_types)も添えて返すので、種別名も同時に揃う。
export function useEndoscopyItemsByCodes(codes: string[]) {
  const sorted = Array.from(new Set(codes)).sort();

  return useQuery({
    queryKey: [...ENDOSCOPY_ITEMS_KEY, "by_codes", sorted],
    staleTime: Infinity,
    queryFn: () => searchEndoscopyItems({ item_code: sorted.join(","), per: 200 }),
    enabled: sorted.length > 0,
  });
}

// select はモジュールスコープに置く。ここで無名関数を渡すと呼び出しのたびに
// 別の関数になり、react-query が結果を再利用できず data が毎回別オブジェクトに
// なってしまう(それを依存に持つ effect が回り続ける)。
function toEndoscopySetMemberMap(
  result: MasterSearchResult<EndoscopySetItem>,
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
export function useEndoscopySetMembers(setCodes: string[]) {
  const sorted = Array.from(new Set(setCodes)).sort();

  return useQuery({
    queryKey: [...ENDOSCOPY_ITEMS_KEY, "set_members", sorted],
    queryFn: () => searchEndoscopySetItems({ set_item_code: sorted.join(","), per: 500 }),
    select: toEndoscopySetMemberMap,
    enabled: sorted.length > 0,
  });
}

/** 一覧APIが添えてくる検査種別の名称から、1 つ引く。 */
export function endoscopyExamTypeName(
  result: EndoscopyItemSearchResult | undefined,
  code: string | null | undefined,
): string {
  if (!code) return "";
  return result?.exam_types?.[code] ?? "";
}
