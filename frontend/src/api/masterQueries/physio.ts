import type { ExamItemFilters } from "./examItem";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createPhysioExamType,
  createPhysioItem,
  createPhysioSetItem,
  deletePhysioExamType,
  deletePhysioItem,
  deletePhysioSetItem,
  fetchPhysioItem,
  type MasterSearchResult,
  physioDatasetClient,
  type PhysioExamTypePayload,
  physioItemLayoutClient,
  type PhysioItemPayload,
  type PhysioItemSearchResult,
  type PhysioSetItem,
  type PhysioSetItemPayload,
  searchPhysioExamTypes,
  searchPhysioItems,
  searchPhysioSetItems,
  updatePhysioExamType,
  updatePhysioItem,
} from "../masterClient";
import { itemLayoutHooks } from "./itemLayout";
import { performDatasetHooks } from "./performDataset";

// ---- 生理検査オーダーのマスタ ----
//
// 放射線と同じ構成。JJ1017 の部品コード・頻用コードが無く、モダリティの位置に
// 検査種別(physio_exam_types)が入るぶん、引くものが少ない。

const PHYSIO_EXAM_TYPES_KEY = ["master", "physio_exam_types"];
const PHYSIO_ITEMS_KEY = ["master", "physio_items"];
// 1データセットの明細も、オーダーに紐付く全データセットの明細も、この上限で足りる。

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

export type PhysioItemFilters = ExamItemFilters;

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

export const physioItemLayoutHooks = itemLayoutHooks("physio_item_layouts", physioItemLayoutClient);

export const physioDatasetHooks = performDatasetHooks({
  name: "physio_datasets",
  client: physioDatasetClient,
  itemsKey: PHYSIO_ITEMS_KEY,
  searchItemsByCodes: (codes, per) => searchPhysioItems({ item_code: codes.join(","), per }),
});

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
