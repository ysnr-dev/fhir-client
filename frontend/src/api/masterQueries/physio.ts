import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createPhysioDataset,
  createPhysioDatasetDetail,
  createPhysioExamType,
  createPhysioItem,
  createPhysioItemLayout,
  createPhysioItemLayoutCell,
  createPhysioSetItem,
  deletePhysioDataset,
  deletePhysioDatasetDetail,
  deletePhysioExamType,
  deletePhysioItem,
  deletePhysioItemLayout,
  deletePhysioItemLayoutCell,
  deletePhysioSetItem,
  fetchPhysioDataset,
  fetchPhysioItem,
  fetchPhysioItemLayout,
  fetchPhysioItemLayouts,
  type MasterSearchResult,
  type PhysioDatasetDetailPayload,
  type PhysioDatasetPayload,
  type PhysioExamTypePayload,
  type PhysioItemLayoutCellPayload,
  type PhysioItemLayoutPayload,
  type PhysioItemPayload,
  type PhysioItemSearchResult,
  type PhysioSetItem,
  type PhysioSetItemPayload,
  searchPhysioDatasetDetails,
  searchPhysioDatasets,
  searchPhysioExamTypes,
  searchPhysioItems,
  searchPhysioSetItems,
  updatePhysioDataset,
  updatePhysioDatasetDetail,
  updatePhysioExamType,
  updatePhysioItem,
  updatePhysioItemLayout,
  updatePhysioItemLayoutCell,
} from "../masterClient";

// ---- 生理検査オーダーのマスタ ----
//
// 放射線と同じ構成。JJ1017 の部品コード・頻用コードが無く、モダリティの位置に
// 検査種別(physio_exam_types)が入るぶん、引くものが少ない。

const PHYSIO_EXAM_TYPES_KEY = ["master", "physio_exam_types"];
const PHYSIO_ITEMS_KEY = ["master", "physio_items"];
const PHYSIO_LAYOUTS_KEY = ["master", "physio_item_layouts"];
const PHYSIO_DATASETS_KEY = ["master", "physio_datasets"];
// 1データセットの明細も、オーダーに紐付く全データセットの明細も、この上限で足りる。
const PHYSIO_DATASET_DETAIL_PER = 100;

/** 検査種別の検索(マスタ画面の一覧)。 */
export function usePhysioExamTypeSearch(
  filters: { name?: string; active?: boolean },
  page: number,
  enabled = true,
) {
  return useQuery({
    queryKey: [...PHYSIO_EXAM_TYPES_KEY, "list", filters, page],
    queryFn: () =>
      searchPhysioExamTypes({
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
export function usePhysioExamTypeOptions() {
  return useQuery({
    queryKey: [...PHYSIO_EXAM_TYPES_KEY, "options"],
    staleTime: Infinity,
    queryFn: () => searchPhysioExamTypes({ per: 200 }),
  });
}

export function usePhysioExamTypeMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: PHYSIO_EXAM_TYPES_KEY });
    // 種別の名称は項目一覧・詳細にも添えて返るので、項目側も引き直す。
    queryClient.invalidateQueries({ queryKey: PHYSIO_ITEMS_KEY });
  };

  return {
    create: useMutation({
      mutationFn: (payload: PhysioExamTypePayload) => createPhysioExamType(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: PhysioExamTypePayload }) =>
        updatePhysioExamType(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deletePhysioExamType(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

export interface PhysioItemFilters {
  name?: string;
  /** 名称・検査種別をまとめて探す1つの語。 */
  keyword?: string;
  kind?: string;
  /** オーダー単位。"true"=グループ化のみ / "false"=単独オーダーのみ。 */
  groupable?: string;
  examTypeCode?: string;
  active?: boolean;
}

export function usePhysioItemSearch(filters: PhysioItemFilters, page: number, enabled = true) {
  return useQuery({
    queryKey: [...PHYSIO_ITEMS_KEY, "list", filters, page],
    queryFn: () =>
      searchPhysioItems({
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
export function usePhysioItem(idOrCode: string | number | null) {
  return useQuery({
    queryKey: [...PHYSIO_ITEMS_KEY, "detail", idOrCode],
    queryFn: () => fetchPhysioItem(idOrCode as string | number),
    enabled: idOrCode !== null,
  });
}

export function usePhysioItemMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: PHYSIO_ITEMS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: PhysioItemPayload) => createPhysioItem(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: PhysioItemPayload }) =>
        updatePhysioItem(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deletePhysioItem(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

export function usePhysioSetItemMutations() {
  const queryClient = useQueryClient();
  // セット構成はオーダー項目詳細に添えて返るため、項目側のキーを破棄する。
  const invalidate = () => queryClient.invalidateQueries({ queryKey: PHYSIO_ITEMS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: PhysioSetItemPayload) => createPhysioSetItem(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deletePhysioSetItem(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

export function usePhysioItemLayouts() {
  return useQuery({
    queryKey: [...PHYSIO_LAYOUTS_KEY, "list"],
    staleTime: Infinity,
    queryFn: fetchPhysioItemLayouts,
  });
}

export function usePhysioItemLayout(id: number | undefined) {
  return useQuery({
    queryKey: [...PHYSIO_LAYOUTS_KEY, "detail", id],
    queryFn: () => fetchPhysioItemLayout(id as number),
    enabled: id !== undefined,
  });
}

export function usePhysioItemLayoutMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: PHYSIO_LAYOUTS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: PhysioItemLayoutPayload) => createPhysioItemLayout(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: PhysioItemLayoutPayload }) =>
        updatePhysioItemLayout(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deletePhysioItemLayout(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

export function usePhysioItemLayoutCellMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: PHYSIO_LAYOUTS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: PhysioItemLayoutCellPayload) => createPhysioItemLayoutCell(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: Partial<PhysioItemLayoutCellPayload> }) =>
        updatePhysioItemLayoutCell(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deletePhysioItemLayoutCell(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

/** 実施入力用データセットの検索。 */
export function usePhysioDatasetSearch(
  filters: { name?: string; active?: boolean },
  page: number,
  enabled = true,
) {
  return useQuery({
    queryKey: [...PHYSIO_DATASETS_KEY, "list", filters, page],
    queryFn: () =>
      searchPhysioDatasets({
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
export function usePhysioDatasetOptions() {
  return useQuery({
    queryKey: [...PHYSIO_DATASETS_KEY, "options"],
    staleTime: Infinity,
    queryFn: () => searchPhysioDatasets({ per: 200 }),
  });
}

/** 編集モーダル用の詳細(明細を名称付きで同梱)。データセットコードでも id でも引ける。 */
export function usePhysioDataset(idOrCode: string | number | null) {
  return useQuery({
    queryKey: [...PHYSIO_DATASETS_KEY, "detail", idOrCode],
    queryFn: () => fetchPhysioDataset(idOrCode as string | number),
    enabled: idOrCode !== null,
  });
}

export function usePhysioDatasetMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: PHYSIO_DATASETS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: PhysioDatasetPayload) => createPhysioDataset(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: PhysioDatasetPayload }) =>
        updatePhysioDataset(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deletePhysioDataset(id),
      retry: false,
      onSuccess: () => {
        invalidate();
        // 削除で参照していた項目の dataset_code も外れるので、項目マスタ側も引き直す。
        queryClient.invalidateQueries({ queryKey: PHYSIO_ITEMS_KEY });
      },
    }),
  };
}

/** 明細の編集。データセット詳細に同梱されているので詳細ごと破棄する。 */
export function usePhysioDatasetDetailMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: PHYSIO_DATASETS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: PhysioDatasetDetailPayload) => createPhysioDatasetDetail(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: PhysioDatasetDetailPayload }) =>
        updatePhysioDatasetDetail(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deletePhysioDatasetDetail(id),
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
export function usePhysioDatasetLinesForItems(itemCodes: string[]) {
  const codes = Array.from(new Set(itemCodes.filter(Boolean))).sort();

  const items = useQuery({
    queryKey: [...PHYSIO_ITEMS_KEY, "dataset-codes", codes],
    staleTime: Infinity,
    queryFn: () =>
      searchPhysioItems({ item_code: codes.join(","), per: PHYSIO_DATASET_DETAIL_PER }),
    enabled: codes.length > 0,
  });

  const datasetCodes = Array.from(
    new Set((items.data?.items ?? []).map((item) => item.dataset_code).filter(Boolean)),
  ).sort() as string[];

  const details = useQuery({
    queryKey: [...PHYSIO_DATASETS_KEY, "details-for", datasetCodes],
    queryFn: () =>
      searchPhysioDatasetDetails({
        dataset_code: datasetCodes.join(","),
        per: PHYSIO_DATASET_DETAIL_PER,
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

// 生理検査オーダー画面用 --------------------------------------------------

// 選択中の項目コードからマスタの内容(名称・検査種別)を引き直す。
// オーダー画面のプレビューと、保存時に FHIR へ写す値の取得元。
// 検索APIが検査種別の名称(exam_types)も添えて返すので、種別名も同時に揃う。
export function usePhysioItemsByCodes(codes: string[]) {
  const sorted = Array.from(new Set(codes)).sort();

  return useQuery({
    queryKey: [...PHYSIO_ITEMS_KEY, "by_codes", sorted],
    staleTime: Infinity,
    queryFn: () => searchPhysioItems({ item_code: sorted.join(","), per: 200 }),
    enabled: sorted.length > 0,
  });
}

// select はモジュールスコープに置く。ここで無名関数を渡すと呼び出しのたびに
// 別の関数になり、react-query が結果を再利用できず data が毎回別オブジェクトに
// なってしまう(それを依存に持つ effect が回り続ける)。
function toPhysioSetMemberMap(
  result: MasterSearchResult<PhysioSetItem>,
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
export function usePhysioSetMembers(setCodes: string[]) {
  const sorted = Array.from(new Set(setCodes)).sort();

  return useQuery({
    queryKey: [...PHYSIO_ITEMS_KEY, "set_members", sorted],
    queryFn: () => searchPhysioSetItems({ set_item_code: sorted.join(","), per: 500 }),
    select: toPhysioSetMemberMap,
    enabled: sorted.length > 0,
  });
}

/** 一覧APIが添えてくる検査種別の名称から、1 つ引く。 */
export function physioExamTypeName(
  result: PhysioItemSearchResult | undefined,
  code: string | null | undefined,
): string {
  if (!code) return "";
  return result?.exam_types?.[code] ?? "";
}
