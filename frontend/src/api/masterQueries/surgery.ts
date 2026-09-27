import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createSurgeryCategory,
  createSurgeryItem,
  createSurgeryRoomBlock,
  deleteSurgeryCategory,
  deleteSurgeryItem,
  deleteSurgeryRoomBlock,
  fetchAllSurgeryRoomBlocks,
  fetchSurgeryItem,
  searchSurgeryCategories,
  searchSurgeryItems,
  searchSurgeryRoomBlocks,
  type SurgeryCategoryPayload,
  type SurgeryItemPayload,
  type SurgeryRoomBlockPayload,
  updateSurgeryCategory,
  updateSurgeryItem,
  updateSurgeryRoomBlock,
} from "../masterClient";

// ---- 術式マスタ(手術オーダー) ----
//
// 処置と同じ構成からセット・レイアウト・データセットを落とし、既定値列を足したもの。

const SURGERY_ITEMS_KEY = ["master", "surgery_items"];
const SURGERY_CATEGORIES_KEY = ["master", "surgery_categories"];
// 種別は木に組み立てて出すので常に全件を引く。点数表の款・区分を seed した時点で
// 70 件前後になるため、他のマスタの選択肢(200)より広めに取る。
const SURGERY_CATEGORY_OPTIONS_PER = 500;

/** 術式の種別(分類)の検索。マスタ画面の一覧は木に組むので全件をまとめて引く。 */
export function useSurgeryCategorySearch(
  filters: { name?: string; active?: boolean },
  enabled = true,
) {
  return useQuery({
    queryKey: [...SURGERY_CATEGORIES_KEY, "list", filters],
    queryFn: () =>
      searchSurgeryCategories({
        name: filters.name || undefined,
        active: filters.active || undefined,
        per: SURGERY_CATEGORY_OPTIONS_PER,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/**
 * 種別の選択肢。術式マスタ・術式検索モーダルが共通で使う。親子関係を組み立てる
 * には全件が要るので、絞り込みはせずまとめて引いてキャッシュする。
 */
export function useSurgeryCategoryOptions() {
  return useQuery({
    queryKey: [...SURGERY_CATEGORIES_KEY, "options"],
    staleTime: Infinity,
    queryFn: () => searchSurgeryCategories({ per: SURGERY_CATEGORY_OPTIONS_PER }),
  });
}

export function useSurgeryCategoryMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: SURGERY_CATEGORIES_KEY });
    // 分類を消すと術式側の種別も外れるので、術式の一覧・詳細も引き直す。
    queryClient.invalidateQueries({ queryKey: SURGERY_ITEMS_KEY });
  };

  return {
    create: useMutation({
      mutationFn: (payload: SurgeryCategoryPayload) => createSurgeryCategory(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: SurgeryCategoryPayload }) =>
        updateSurgeryCategory(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteSurgeryCategory(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

export interface SurgeryItemFilters {
  name?: string;
  /** 名称・略称・カナをまとめて探す1つの語。 */
  keyword?: string;
  /** 種別。上位の分類を指定すると配下の分類の術式もまとめて出る。 */
  categoryCode?: string;
  active?: boolean;
}

export function useSurgeryItemSearch(filters: SurgeryItemFilters, page: number, enabled = true) {
  return useQuery({
    queryKey: [...SURGERY_ITEMS_KEY, "list", filters, page],
    queryFn: () =>
      searchSurgeryItems({
        name: filters.name || undefined,
        keyword: filters.keyword || undefined,
        category_code: filters.categoryCode || undefined,
        active: filters.active || undefined,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

// レセ電算コードの名称を添えた詳細(編集モーダル用)。
export function useSurgeryItem(idOrCode: string | number | null) {
  return useQuery({
    queryKey: [...SURGERY_ITEMS_KEY, "detail", idOrCode],
    queryFn: () => fetchSurgeryItem(idOrCode as string | number),
    enabled: idOrCode !== null,
  });
}

export function useSurgeryItemMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: SURGERY_ITEMS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: SurgeryItemPayload) => createSurgeryItem(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: SurgeryItemPayload }) =>
        updateSurgeryItem(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteSurgeryItem(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

// 手術オーダー画面用 --------------------------------------------------

// 選択中の項目コードからマスタの内容(名称・略称・Kコード・既定値)を引き直す。
// オーダー画面のプレビューと、保存時に FHIR へ写す値の取得元。
export function useSurgeryItemsByCodes(codes: string[]) {
  const sorted = Array.from(new Set(codes)).sort();

  return useQuery({
    queryKey: [...SURGERY_ITEMS_KEY, "by_codes", sorted],
    staleTime: Infinity,
    queryFn: () => searchSurgeryItems({ item_code: sorted.join(","), per: 200 }),
    enabled: sorted.length > 0,
  });
}

// ---- 手術室のブロックスケジュール ----

const SURGERY_ROOM_BLOCKS_KEY = ["master", "surgery_room_blocks"];

export interface SurgeryRoomBlockFilters {
  locationId?: string;
  weekday?: number;
}

export function useSurgeryRoomBlockSearch(
  filters: SurgeryRoomBlockFilters,
  page: number,
  enabled = true,
) {
  return useQuery({
    queryKey: [...SURGERY_ROOM_BLOCKS_KEY, "list", filters, page],
    queryFn: () =>
      searchSurgeryRoomBlocks({
        location_id: filters.locationId || undefined,
        weekday: filters.weekday,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/**
 * カレンダーの背景と申込フォームの警告が読む全件。
 *
 * date は有効期間の判定日。カレンダーは過去日・未来日も描くので、見ている日で
 * 判定する。日が変わるたびに引き直しになるが、行数の少ないマスタなので許す。
 */
export function useSurgeryRoomBlocks(date: string | undefined) {
  return useQuery({
    queryKey: [...SURGERY_ROOM_BLOCKS_KEY, "all", date ?? ""],
    queryFn: () => fetchAllSurgeryRoomBlocks({ active: true, date }),
    enabled: Boolean(date),
  });
}

export function useSurgeryRoomBlockMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: SURGERY_ROOM_BLOCKS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: SurgeryRoomBlockPayload) => createSurgeryRoomBlock(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: SurgeryRoomBlockPayload }) =>
        updateSurgeryRoomBlock(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteSurgeryRoomBlock(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}
