import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createTreatmentItem,
  createTreatmentSetItem,
  deleteTreatmentItem,
  deleteTreatmentSetItem,
  fetchTreatmentItem,
  type MasterSearchResult,
  searchTreatmentItems,
  searchTreatmentSetItems,
  treatmentDatasetClient,
  treatmentItemLayoutClient,
  type TreatmentItemPayload,
  type TreatmentSetItem,
  type TreatmentSetItemPayload,
  updateTreatmentItem,
} from "../masterClient";
import { itemLayoutHooks } from "./itemLayout";
import { performDatasetHooks } from "./performDataset";

// ---- 処置オーダーのマスタ ----
//
// 生理検査と同じ構成から検査種別(分類軸)を落としたもの。

const TREATMENT_ITEMS_KEY = ["master", "treatment_items"];
// 1データセットの明細も、オーダーに紐付く全データセットの明細も、この上限で足りる。

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

export const treatmentItemLayoutHooks = itemLayoutHooks("treatment_item_layouts", treatmentItemLayoutClient);

export const treatmentDatasetHooks = performDatasetHooks({
  name: "treatment_datasets",
  client: treatmentDatasetClient,
  itemsKey: TREATMENT_ITEMS_KEY,
  searchItemsByCodes: (codes, per) => searchTreatmentItems({ item_code: codes.join(","), per }),
});

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
