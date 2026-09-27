import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  bulkCreateRadItemsFromFrequent,
  createRadDataset,
  createRadDatasetDetail,
  createRadItem,
  createRadItemLayout,
  createRadItemLayoutCell,
  createRadJj1017Code,
  createRadMaterial,
  createRadSetItem,
  deleteRadDataset,
  deleteRadDatasetDetail,
  deleteRadItem,
  deleteRadItemLayout,
  deleteRadItemLayoutCell,
  deleteRadJj1017Code,
  deleteRadMaterial,
  deleteRadSetItem,
  fetchRadDataset,
  fetchRadItem,
  fetchRadItemLayout,
  fetchRadItemLayouts,
  fetchRadJj1017Catalog,
  fetchRadJj1017Elements,
  fetchRadMaterial,
  type MasterSearchResult,
  type RadDatasetDetailPayload,
  type RadDatasetPayload,
  type RadItemLayoutCellPayload,
  type RadItemLayoutPayload,
  type RadItemPayload,
  type RadItemSearchResult,
  type RadJj1017CodePayload,
  type RadMaterialPayload,
  type RadSetItem,
  type RadSetItemPayload,
  searchRadDatasetDetails,
  searchRadDatasets,
  searchRadFrequentCodes,
  searchRadItems,
  searchRadJj1017Codes,
  searchRadMaterials,
  searchRadSetItems,
  updateRadDataset,
  updateRadDatasetDetail,
  updateRadItem,
  updateRadItemLayout,
  updateRadItemLayoutCell,
  updateRadJj1017Code,
  updateRadMaterial,
} from "../masterClient";

// 放射線検査オーダーのマスタ群 ----------------------------------------------

// オーダー項目・セット構成は同じ詳細画面で同時に変わるのでまとめて破棄する。
const RAD_JJ1017_CODES_KEY = ["master", "rad_jj1017_codes"];
const RAD_FREQUENT_CODES_KEY = ["master", "rad_frequent_codes"];
const RAD_ITEMS_KEY = ["master", "rad_items"];
const RAD_LAYOUTS_KEY = ["master", "rad_item_layouts"];

const RAD_MATERIALS_KEY = ["master", "rad_materials"];

export interface RadMaterialFilters {
  name?: string;
  maker?: string;
  /** 紐付けのないものだけ(算定できない器材の点検用)。 */
  unlinked?: boolean;
  active?: boolean;
}

/** 放射線検査で使う器材(施設マスタ)の検索。 */
export function useRadMaterialSearch(filters: RadMaterialFilters, page: number, enabled = true) {
  return useQuery({
    queryKey: [...RAD_MATERIALS_KEY, "list", filters, page],
    queryFn: () =>
      searchRadMaterials({
        name: filters.name || undefined,
        maker: filters.maker || undefined,
        unlinked: filters.unlinked || undefined,
        active: filters.active || undefined,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** 編集モーダル用の詳細。器材コードでも id でも引ける。 */
export function useRadMaterial(idOrCode: string | number | null) {
  return useQuery({
    queryKey: [...RAD_MATERIALS_KEY, "detail", idOrCode],
    queryFn: () => fetchRadMaterial(idOrCode as string | number),
    enabled: idOrCode !== null,
  });
}

export function useRadMaterialMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: RAD_MATERIALS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: RadMaterialPayload) => createRadMaterial(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: RadMaterialPayload }) =>
        updateRadMaterial(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteRadMaterial(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

const RAD_DATASETS_KEY = ["master", "rad_datasets"];
// 1データセットの明細も、オーダーに紐付く全データセットの明細も、この上限で足りる。
const RAD_DATASET_DETAIL_PER = 100;

/** 実施入力用データセットの検索。 */
export function useRadDatasetSearch(
  filters: { name?: string; active?: boolean },
  page: number,
  enabled = true,
) {
  return useQuery({
    queryKey: [...RAD_DATASETS_KEY, "list", filters, page],
    queryFn: () =>
      searchRadDatasets({
        name: filters.name || undefined,
        active: filters.active || undefined,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** 撮影項目に付けるデータセットの選択肢。件数が少ないので全件まとめて引く。 */
export function useRadDatasetOptions() {
  return useQuery({
    queryKey: [...RAD_DATASETS_KEY, "options"],
    staleTime: Infinity,
    queryFn: () => searchRadDatasets({ per: 200 }),
  });
}

/** 編集モーダル用の詳細(明細を名称付きで同梱)。データセットコードでも id でも引ける。 */
export function useRadDataset(idOrCode: string | number | null) {
  return useQuery({
    queryKey: [...RAD_DATASETS_KEY, "detail", idOrCode],
    queryFn: () => fetchRadDataset(idOrCode as string | number),
    enabled: idOrCode !== null,
  });
}

export function useRadDatasetMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: RAD_DATASETS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: RadDatasetPayload) => createRadDataset(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: RadDatasetPayload }) =>
        updateRadDataset(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteRadDataset(id),
      retry: false,
      onSuccess: () => {
        invalidate();
        // 削除で参照していた項目の dataset_code も外れるので、項目マスタ側も引き直す。
        queryClient.invalidateQueries({ queryKey: RAD_ITEMS_KEY });
      },
    }),
  };
}

/** 明細の編集。データセット詳細に同梱されているので詳細ごと破棄する。 */
export function useRadDatasetDetailMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: RAD_DATASETS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: RadDatasetDetailPayload) => createRadDatasetDetail(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: RadDatasetDetailPayload }) =>
        updateRadDatasetDetail(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteRadDatasetDetail(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

/**
 * 撮影項目コード群が参照するデータセットの明細。実施入力の初期表示に使う。
 *
 * 項目 → 明細の2段。1つのデータセットは複数の撮影項目から参照されるので、
 * 明細を引く前にデータセットコードを一意化する(同じデータセットを2回引かない)。
 */
export function useRadDatasetLinesForItems(itemCodes: string[]) {
  const codes = Array.from(new Set(itemCodes.filter(Boolean))).sort();

  const items = useQuery({
    queryKey: [...RAD_ITEMS_KEY, "dataset-codes", codes],
    staleTime: Infinity,
    queryFn: () => searchRadItems({ item_code: codes.join(","), per: RAD_DATASET_DETAIL_PER }),
    enabled: codes.length > 0,
  });

  const datasetCodes = Array.from(
    new Set((items.data?.items ?? []).map((item) => item.dataset_code).filter(Boolean)),
  ).sort() as string[];

  const details = useQuery({
    queryKey: [...RAD_DATASETS_KEY, "details-for", datasetCodes],
    queryFn: () =>
      searchRadDatasetDetails({
        dataset_code: datasetCodes.join(","),
        per: RAD_DATASET_DETAIL_PER,
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

export interface RadJj1017CodeFilters {
  element?: string;
  source?: string;
  name?: string;
}

export function useRadJj1017CodeSearch(filters: RadJj1017CodeFilters, page: number, enabled = true) {
  return useQuery({
    queryKey: [...RAD_JJ1017_CODES_KEY, "list", filters, page],
    queryFn: () =>
      searchRadJj1017Codes({
        element: filters.element || undefined,
        source: filters.source || undefined,
        name: filters.name || undefined,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

// 要素の定義(32桁コード内の位置・桁数・施設拡張の範囲)。滅多に変わらないので
// 拡張コードの登録で破棄されるまで使い回す。
export function useRadJj1017Elements() {
  return useQuery({
    queryKey: [...RAD_JJ1017_CODES_KEY, "elements"],
    queryFn: fetchRadJj1017Elements,
    staleTime: Infinity,
  });
}

// 全要素の部品コード(要素名でまとめたもの)。編集モーダルは11要素すべての
// 選択肢を同時に使うので、要素ごとに引かずまとめて取る。
// 拡張コードの登録・削除で破棄されるまで使い回す。
export function useRadJj1017Catalog() {
  return useQuery({
    queryKey: [...RAD_JJ1017_CODES_KEY, "catalog"],
    queryFn: fetchRadJj1017Catalog,
    staleTime: Infinity,
  });
}

export function useRadJj1017CodeMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: RAD_JJ1017_CODES_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: RadJj1017CodePayload) => createRadJj1017Code(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: RadJj1017CodePayload }) =>
        updateRadJj1017Code(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteRadJj1017Code(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

export interface RadFrequentCodeFilters {
  category?: string;
  modalityCode?: string;
  name?: string;
  unregisteredOnly?: boolean;
}

export function useRadFrequentCodeSearch(
  filters: RadFrequentCodeFilters,
  page: number,
  enabled = true,
) {
  return useQuery({
    queryKey: [...RAD_FREQUENT_CODES_KEY, "list", filters, page],
    queryFn: () =>
      searchRadFrequentCodes({
        category: filters.category || undefined,
        modality_code: filters.modalityCode || undefined,
        name: filters.name || undefined,
        unregistered: filters.unregisteredOnly || undefined,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export interface RadItemFilters {
  name?: string;
  /** 名称・種別(モダリティ)・部位をまとめて探す1つの語。 */
  keyword?: string;
  kind?: string;
  /** オーダー単位。"true"=グループ化のみ / "false"=単独オーダーのみ。 */
  groupable?: string;
  modalityCode?: string;
  bodyPartCode?: string;
  active?: boolean;
}

export function useRadItemSearch(filters: RadItemFilters, page: number, enabled = true) {
  return useQuery({
    queryKey: [...RAD_ITEMS_KEY, "list", filters, page],
    queryFn: () =>
      searchRadItems({
        name: filters.name || undefined,
        keyword: filters.keyword || undefined,
        kind: filters.kind || undefined,
        groupable: filters.groupable || undefined,
        modality_code: filters.modalityCode || undefined,
        body_part_code: filters.bodyPartCode || undefined,
        active: filters.active || undefined,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

// 要素の名称とセット構成を添えた詳細(編集モーダル用)。
export function useRadItem(idOrCode: string | number | null) {
  return useQuery({
    queryKey: [...RAD_ITEMS_KEY, "detail", idOrCode],
    queryFn: () => fetchRadItem(idOrCode as string | number),
    enabled: idOrCode !== null,
  });
}

export function useRadItemMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: RAD_ITEMS_KEY });
    // 頻用コード一覧は「未登録のみ」で絞れるため、項目が増減したら引き直す。
    queryClient.invalidateQueries({ queryKey: RAD_FREQUENT_CODES_KEY });
  };

  return {
    create: useMutation({
      mutationFn: (payload: RadItemPayload) => createRadItem(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: RadItemPayload }) =>
        updateRadItem(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteRadItem(id),
      retry: false,
      onSuccess: invalidate,
    }),
    bulkCreateFromFrequent: useMutation({
      mutationFn: (frequentCodeIds: number[]) => bulkCreateRadItemsFromFrequent(frequentCodeIds),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

export function useRadSetItemMutations() {
  const queryClient = useQueryClient();
  // セット構成はオーダー項目詳細に添えて返るため、項目側のキーを破棄する。
  const invalidate = () => queryClient.invalidateQueries({ queryKey: RAD_ITEMS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: RadSetItemPayload) => createRadSetItem(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteRadSetItem(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

export function useRadItemLayouts() {
  return useQuery({
    queryKey: [...RAD_LAYOUTS_KEY, "list"],
    staleTime: Infinity,
    queryFn: fetchRadItemLayouts,
  });
}

export function useRadItemLayout(id: number | undefined) {
  return useQuery({
    queryKey: [...RAD_LAYOUTS_KEY, "detail", id],
    queryFn: () => fetchRadItemLayout(id as number),
    enabled: id !== undefined,
  });
}

export function useRadItemLayoutMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: RAD_LAYOUTS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: RadItemLayoutPayload) => createRadItemLayout(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: RadItemLayoutPayload }) =>
        updateRadItemLayout(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteRadItemLayout(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

export function useRadItemLayoutCellMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: RAD_LAYOUTS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: RadItemLayoutCellPayload) => createRadItemLayoutCell(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: Partial<RadItemLayoutCellPayload> }) =>
        updateRadItemLayoutCell(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteRadItemLayoutCell(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

// 放射線オーダー画面用 --------------------------------------------------

// 選択中の項目コードからマスタの内容(名称・JJ1017 の要素)を引き直す。
// オーダー画面のプレビューと、保存時に FHIR へ写す値の取得元。
// 検索APIが要素コードの名称(elements)も添えて返すので、種別・部位の名称も同時に揃う。
export function useRadItemsByCodes(codes: string[]) {
  const sorted = Array.from(new Set(codes)).sort();

  return useQuery({
    queryKey: [...RAD_ITEMS_KEY, "by_codes", sorted],
    staleTime: Infinity,
    queryFn: () => searchRadItems({ item_code: sorted.join(","), per: 200 }),
    enabled: sorted.length > 0,
  });
}

// select はモジュールスコープに置く。ここで無名関数を渡すと呼び出しのたびに
// 別の関数になり、react-query が結果を再利用できず data が毎回別オブジェクトに
// なってしまう(それを依存に持つ effect が回り続ける)。
function toSetMemberMap(result: MasterSearchResult<RadSetItem>): Map<string, string[]> {
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
export function useRadSetMembers(setCodes: string[]) {
  const sorted = Array.from(new Set(setCodes)).sort();

  return useQuery({
    queryKey: [...RAD_ITEMS_KEY, "set_members", sorted],
    queryFn: () => searchRadSetItems({ set_item_code: sorted.join(","), per: 500 }),
    select: toSetMemberMap,
    enabled: sorted.length > 0,
  });
}

/** 一覧APIが添えてくる要素コードの名称から、1 つ引く。 */
export function elementName(
  result: RadItemSearchResult | undefined,
  element: string,
  code: string | null | undefined,
): string {
  if (!code) return "";
  return result?.elements?.[element]?.[code] ?? "";
}
