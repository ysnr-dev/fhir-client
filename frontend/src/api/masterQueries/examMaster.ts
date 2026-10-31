import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ExamItemFilters } from "./examItem";
import type {
  examMasterClient,
  ExamItemPayload,
  ExamItemSearchResult,
  ExamSetItem,
  ExamSetItemPayload,
  ExamTypeBase,
  MasterSearchResult,
} from "../masterClient";
import { itemLayoutHooks } from "./itemLayout";
import { performDatasetHooks } from "./performDataset";

// ---- 検査種別を軸に持つ部門(生理検査・内視鏡)のオーダーマスタの hook ----
//
// 放射線と同じ構成。JJ1017 の部品コード・頻用コードが無く、モダリティの位置に
// 検査種別(<部門>_exam_types)が入るぶん、引くものが少ない。

// select はモジュールスコープに置く。ここで無名関数を渡すと呼び出しのたびに
// 別の関数になり、react-query が結果を再利用できず data が毎回別オブジェクトに
// なってしまう(それを依存に持つ effect が回り続ける)。
function toSetMemberMap(result: MasterSearchResult<ExamSetItem>): Map<string, string[]> {
  const members = new Map<string, string[]>();
  for (const member of result.items) {
    const list = members.get(member.set_item_code);
    if (list) list.push(member.member_item_code);
    else members.set(member.set_item_code, [member.member_item_code]);
  }
  return members;
}

/** 一覧APIが添えてくる検査種別の名称から、1 つ引く。 */
export function examTypeNameOf(
  result: ExamItemSearchResult | undefined,
  code: string | null | undefined,
): string {
  if (!code) return "";
  return result?.exam_types?.[code] ?? "";
}

/** 部門名(`physio` など)と masterClient の examMasterClient から、マスタ画面とオーダー画面の hook を組む。 */
export function examMasterHooks<T extends ExamTypeBase, P>(
  dept: string,
  client: ReturnType<typeof examMasterClient<T, P>>,
) {
  const EXAM_TYPES_KEY = ["master", `${dept}_exam_types`];
  const ITEMS_KEY = ["master", `${dept}_items`];

  /** 検査種別の検索(マスタ画面の一覧)。 */
  function useExamTypeSearch(filters: { name?: string; active?: boolean }, page: number, enabled = true) {
    return useQuery({
      queryKey: [...EXAM_TYPES_KEY, "list", filters, page],
      queryFn: () =>
        client.searchExamTypes({
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
  function useExamTypeOptions() {
    return useQuery({
      queryKey: [...EXAM_TYPES_KEY, "options"],
      staleTime: Infinity,
      queryFn: () => client.searchExamTypes({ per: 200 }),
    });
  }

  function useExamTypeMutations() {
    const queryClient = useQueryClient();
    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: EXAM_TYPES_KEY });
      // 種別の名称は項目一覧・詳細にも添えて返るので、項目側も引き直す。
      queryClient.invalidateQueries({ queryKey: ITEMS_KEY });
    };

    return {
      create: useMutation({
        mutationFn: (payload: P) => client.createExamType(payload),
        retry: false,
        onSuccess: invalidate,
      }),
      update: useMutation({
        mutationFn: ({ id, payload }: { id: number; payload: P }) => client.updateExamType(id, payload),
        retry: false,
        onSuccess: invalidate,
      }),
      remove: useMutation({
        mutationFn: (id: number) => client.deleteExamType(id),
        retry: false,
        onSuccess: invalidate,
      }),
    };
  }

  function useItemSearch(filters: ExamItemFilters, page: number, enabled = true) {
    return useQuery({
      queryKey: [...ITEMS_KEY, "list", filters, page],
      queryFn: () =>
        client.searchItems({
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
  function useItem(idOrCode: string | number | null) {
    return useQuery({
      queryKey: [...ITEMS_KEY, "detail", idOrCode],
      queryFn: () => client.fetchItem(idOrCode as string | number),
      enabled: idOrCode !== null,
    });
  }

  function useItemMutations() {
    const queryClient = useQueryClient();
    const invalidate = () => queryClient.invalidateQueries({ queryKey: ITEMS_KEY });

    return {
      create: useMutation({
        mutationFn: (payload: ExamItemPayload) => client.createItem(payload),
        retry: false,
        onSuccess: invalidate,
      }),
      update: useMutation({
        mutationFn: ({ id, payload }: { id: number; payload: ExamItemPayload }) =>
          client.updateItem(id, payload),
        retry: false,
        onSuccess: invalidate,
      }),
      remove: useMutation({
        mutationFn: (id: number) => client.deleteItem(id),
        retry: false,
        onSuccess: invalidate,
      }),
    };
  }

  function useSetItemMutations() {
    const queryClient = useQueryClient();
    // セット構成はオーダー項目詳細に添えて返るため、項目側のキーを破棄する。
    const invalidate = () => queryClient.invalidateQueries({ queryKey: ITEMS_KEY });

    return {
      create: useMutation({
        mutationFn: (payload: ExamSetItemPayload) => client.createSetItem(payload),
        retry: false,
        onSuccess: invalidate,
      }),
      remove: useMutation({
        mutationFn: (id: number) => client.deleteSetItem(id),
        retry: false,
        onSuccess: invalidate,
      }),
    };
  }

  // 選択中の項目コードからマスタの内容(名称・検査種別)を引き直す。
  // オーダー画面のプレビューと、保存時に FHIR へ写す値の取得元。
  // 検索APIが検査種別の名称(exam_types)も添えて返すので、種別名も同時に揃う。
  function useItemsByCodes(codes: string[]) {
    const sorted = Array.from(new Set(codes)).sort();

    return useQuery({
      queryKey: [...ITEMS_KEY, "by_codes", sorted],
      staleTime: Infinity,
      queryFn: () => client.searchItems({ item_code: sorted.join(","), per: 200 }),
      enabled: sorted.length > 0,
    });
  }

  // セットの構成。「セットコード → 構成項目の項目コード」で返す。
  // オーダー画面でセットを選んだときに、その構成項目もオーダーに入れるために引く。
  // セットでない項目コードを混ぜても結果が増えないだけなので、呼ぶ側で選別しない。
  function useSetMembers(setCodes: string[]) {
    const sorted = Array.from(new Set(setCodes)).sort();

    return useQuery({
      queryKey: [...ITEMS_KEY, "set_members", sorted],
      queryFn: () => client.searchSetItems({ set_item_code: sorted.join(","), per: 500 }),
      select: toSetMemberMap,
      enabled: sorted.length > 0,
    });
  }

  return {
    useExamTypeSearch,
    useExamTypeOptions,
    useExamTypeMutations,
    useItemSearch,
    useItem,
    useItemMutations,
    useSetItemMutations,
    useItemsByCodes,
    useSetMembers,
    itemLayoutHooks: itemLayoutHooks(`${dept}_item_layouts`, client.itemLayoutClient),
    datasetHooks: performDatasetHooks({
      name: `${dept}_datasets`,
      client: client.datasetClient,
      itemsKey: ITEMS_KEY,
      searchItemsByCodes: (codes, per) => client.searchItems({ item_code: codes.join(","), per }),
    }),
  };
}
