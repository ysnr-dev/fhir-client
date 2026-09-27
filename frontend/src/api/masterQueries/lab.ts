import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { jlac11AliasKey } from "../../fhir/labResultHelpers";
import {
  createLabContainer,
  createLabOrderItem,
  createLabOrderItemLayout,
  createLabOrderItemLayoutCell,
  createLabOrderItemResult,
  createLabPanelItem,
  createLabReferenceRange,
  createLabResultItem,
  createLabSpecimen,
  deleteLabContainer,
  deleteLabOrderItem,
  deleteLabOrderItemLayout,
  deleteLabOrderItemLayoutCell,
  deleteLabOrderItemResult,
  deleteLabPanelItem,
  deleteLabReferenceRange,
  deleteLabResultItem,
  deleteLabSpecimen,
  fetchLabOrderItem,
  fetchLabOrderItemLayout,
  fetchLabOrderItemLayouts,
  fetchLabResultItem,
  fetchLabSpecimenCategories,
  type LabContainerPayload,
  type LabOrderItemLayoutCellPayload,
  type LabOrderItemLayoutPayload,
  type LabOrderItemPayload,
  type LabOrderItemResultPayload,
  type LabPanelItem,
  type LabPanelItemPayload,
  type LabReferenceRangePayload,
  type LabResultItemPayload,
  type LabSpecimenPayload,
  type MasterSearchResult,
  searchLabContainers,
  searchLabOrderItemResults,
  searchLabOrderItems,
  searchLabPanelItems,
  searchLabResultItems,
  searchLabSpecimens,
  updateLabContainer,
  updateLabOrderItem,
  updateLabOrderItemLayout,
  updateLabOrderItemLayoutCell,
  updateLabOrderItemResult,
  updateLabPanelItem,
  updateLabReferenceRange,
  updateLabResultItem,
  updateLabSpecimen,
} from "../masterClient";
import {
  LAB_CONTAINERS_KEY,
  LAB_LAYOUTS_KEY,
  LAB_ORDER_ITEMS_KEY,
  LAB_RESULT_ITEMS_KEY,
  LAB_SPECIMENS_KEY,
} from "./medicine";

export interface LabOrderItemFilters {
  name?: string;
  kind?: string;
  category?: string;
  active?: boolean;
}

export function useLabOrderItemSearch(filters: LabOrderItemFilters, page: number, enabled = true) {
  return useQuery({
    queryKey: [...LAB_ORDER_ITEMS_KEY, "list", filters, page],
    queryFn: () =>
      searchLabOrderItems({
        name: filters.name || undefined,
        kind: filters.kind || undefined,
        category: filters.category || undefined,
        active: filters.active || undefined,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

// 検体・採取管・パネル構成を添えた詳細(編集モーダル用)。
export function useLabOrderItem(idOrCode: string | number | null) {
  return useQuery({
    queryKey: [...LAB_ORDER_ITEMS_KEY, "detail", idOrCode],
    queryFn: () => fetchLabOrderItem(idOrCode as string | number),
    enabled: idOrCode !== null,
  });
}

export function useLabOrderItemMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: LAB_ORDER_ITEMS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: LabOrderItemPayload) => createLabOrderItem(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: LabOrderItemPayload }) =>
        updateLabOrderItem(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteLabOrderItem(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

export function useLabPanelItemMutations() {
  const queryClient = useQueryClient();
  // パネル構成はオーダー項目詳細に添えて返るため、項目側のキーを破棄する。
  const invalidate = () => queryClient.invalidateQueries({ queryKey: LAB_ORDER_ITEMS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: LabPanelItemPayload) => createLabPanelItem(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: Partial<LabPanelItemPayload> }) =>
        updateLabPanelItem(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteLabPanelItem(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

// 検体検査の結果項目(施設マスタ) ----------------------------------------------

export interface LabResultItemFilters {
  name?: string;
  category?: string;
  data_type?: string;
  active?: boolean;
}

export function useLabResultItemSearch(filters: LabResultItemFilters, page: number, enabled = true) {
  return useQuery({
    queryKey: [...LAB_RESULT_ITEMS_KEY, "list", filters, page],
    queryFn: () =>
      searchLabResultItems({
        name: filters.name || undefined,
        category: filters.category || undefined,
        data_type: filters.data_type || undefined,
        active: filters.active || undefined,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

// 材料名と、この項目を返すオーダー項目を添えた詳細(編集モーダル用)。
export function useLabResultItem(idOrCode: string | number | null) {
  return useQuery({
    queryKey: [...LAB_RESULT_ITEMS_KEY, "detail", idOrCode],
    queryFn: () => fetchLabResultItem(idOrCode as string | number),
    enabled: idOrCode !== null,
  });
}

export function useLabResultItemMutations() {
  const queryClient = useQueryClient();
  // 対応表はオーダー項目詳細にも入れ子で返るため、両方のキーを破棄する。
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: LAB_RESULT_ITEMS_KEY });
    queryClient.invalidateQueries({ queryKey: LAB_ORDER_ITEMS_KEY });
  };

  return {
    create: useMutation({
      mutationFn: (payload: LabResultItemPayload) => createLabResultItem(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: LabResultItemPayload }) =>
        updateLabResultItem(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteLabResultItem(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

// 検査結果の編集画面用。保存済みの結果項目コードからマスタ情報
// (コード型の選択肢など)を一括で引き直す。1 レポートぶんを 1 回で引く。
export function useLabResultItemsByCodes(codes: string[]) {
  const sorted = Array.from(new Set(codes)).sort();

  return useQuery({
    queryKey: [...LAB_RESULT_ITEMS_KEY, "by_codes", sorted],
    queryFn: () => searchLabResultItems({ result_item_code: sorted.join(","), per: 500 }),
    staleTime: Infinity,
    enabled: sorted.length > 0,
  });
}

// 施設コードを持たない検査結果(Observation.code が JLAC11 だけ)から
// 結果項目を引き当てる用。保存済みの 17 桁は試薬・機器単位で、マスタの代表コードとは
// 測定法・結果単位が違うことが多いので、測定物・識別・材料の 12 桁の前方一致で引く。
// 引き当て(どの結果項目に読み替えるか)は使う側の resultItemAliases が決める。
export function useLabResultItemsByJlac11Codes(codes: string[]) {
  const prefixes = Array.from(new Set(codes.map(jlac11AliasKey).filter(Boolean))).sort();

  return useQuery({
    queryKey: [...LAB_RESULT_ITEMS_KEY, "by_jlac11", prefixes],
    queryFn: () => searchLabResultItems({ jlac11_prefix: prefixes.join(","), per: 500 }),
    staleTime: Infinity,
    enabled: prefixes.length > 0,
  });
}

// オーダー項目 → 結果項目の対応(結果項目を入れ子で持つ)。検体検査オーダーから
// 検査結果の項目を展開するときに、オーダーの項目コードをまとめて引く。
// 対応が無い項目はパネル構成をたどって解決する(セットの中のパネルは明細に展開されないため)。
// 並びはサーバーが解決した順なので、画面側で並べ替えない。
export function useLabOrderItemResults(orderItemCodes: string[]) {
  const codes = Array.from(new Set(orderItemCodes));

  return useQuery({
    queryKey: [...LAB_RESULT_ITEMS_KEY, "order_item_results", codes],
    queryFn: () =>
      searchLabOrderItemResults({ order_item_code: codes.join(","), expand_panels: true, per: 500 }),
    staleTime: Infinity,
    enabled: codes.length > 0,
  });
}

export function useLabOrderItemResultMutations() {
  const queryClient = useQueryClient();
  // 対応表はオーダー項目詳細と結果項目詳細の両方に添えて返るため、両方のキーを破棄する。
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: LAB_ORDER_ITEMS_KEY });
    queryClient.invalidateQueries({ queryKey: LAB_RESULT_ITEMS_KEY });
  };

  return {
    create: useMutation({
      mutationFn: (payload: LabOrderItemResultPayload) => createLabOrderItemResult(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: Partial<LabOrderItemResultPayload> }) =>
        updateLabOrderItemResult(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteLabOrderItemResult(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

// 基準値は結果項目の詳細・一覧・対応表の入れ子に添えて返るため、結果項目側のキーを破棄する。
export function useLabReferenceRangeMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: LAB_RESULT_ITEMS_KEY });
    queryClient.invalidateQueries({ queryKey: LAB_ORDER_ITEMS_KEY });
  };

  return {
    create: useMutation({
      mutationFn: (payload: LabReferenceRangePayload) => createLabReferenceRange(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: Partial<LabReferenceRangePayload> }) =>
        updateLabReferenceRange(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteLabReferenceRange(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

export interface LabSpecimenFilters {
  name?: string;
  category?: string;
  recommendedOnly?: boolean;
}

export function useLabSpecimenSearch(filters: LabSpecimenFilters, page: number) {
  return useQuery({
    queryKey: [...LAB_SPECIMENS_KEY, "list", filters, page],
    queryFn: () =>
      searchLabSpecimens({
        name: filters.name || undefined,
        category: filters.category || undefined,
        recommended: filters.recommendedOnly || undefined,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
  });
}

export function useLabSpecimenCategories() {
  return useQuery({
    queryKey: [...LAB_SPECIMENS_KEY, "categories"],
    staleTime: Infinity,
    queryFn: fetchLabSpecimenCategories,
  });
}

// 検体の選択プルダウン用(掲載順の全件)。取込・編集後は invalidate で引き直す。
export function useLabSpecimenOptions() {
  return useQuery({
    queryKey: [...LAB_SPECIMENS_KEY, "options"],
    staleTime: Infinity,
    queryFn: () => searchLabSpecimens({ per: 500 }),
  });
}

export function useLabSpecimenMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: LAB_SPECIMENS_KEY });
    // オーダー項目詳細が検体名・既定採取管を添えて返すため、そちらも破棄する。
    queryClient.invalidateQueries({ queryKey: LAB_ORDER_ITEMS_KEY });
  };

  return {
    create: useMutation({
      mutationFn: (payload: LabSpecimenPayload) => createLabSpecimen(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: LabSpecimenPayload }) =>
        updateLabSpecimen(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteLabSpecimen(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

// 採取管の一覧(全件)。選択プルダウンと一覧画面の両方で使う。
export function useLabContainers() {
  return useQuery({
    queryKey: [...LAB_CONTAINERS_KEY, "list"],
    staleTime: Infinity,
    queryFn: () => searchLabContainers({ per: 100 }),
  });
}

export function useLabContainerMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: LAB_CONTAINERS_KEY });
    queryClient.invalidateQueries({ queryKey: LAB_ORDER_ITEMS_KEY });
  };

  return {
    create: useMutation({
      mutationFn: (payload: LabContainerPayload) => createLabContainer(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: LabContainerPayload }) =>
        updateLabContainer(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteLabContainer(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

export function useLabOrderItemLayouts() {
  return useQuery({
    queryKey: [...LAB_LAYOUTS_KEY, "list"],
    staleTime: Infinity,
    queryFn: fetchLabOrderItemLayouts,
  });
}

export function useLabOrderItemLayout(id: number | undefined) {
  return useQuery({
    queryKey: [...LAB_LAYOUTS_KEY, "detail", id],
    queryFn: () => fetchLabOrderItemLayout(id as number),
    enabled: id !== undefined,
  });
}

export function useLabOrderItemLayoutMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: LAB_LAYOUTS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: LabOrderItemLayoutPayload) => createLabOrderItemLayout(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: LabOrderItemLayoutPayload }) =>
        updateLabOrderItemLayout(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteLabOrderItemLayout(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

export function useLabOrderItemLayoutCellMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: LAB_LAYOUTS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: LabOrderItemLayoutCellPayload) => createLabOrderItemLayoutCell(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: Partial<LabOrderItemLayoutCellPayload> }) =>
        updateLabOrderItemLayoutCell(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteLabOrderItemLayoutCell(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

// 検体検査オーダー画面用 --------------------------------------------------

// 選択中の項目コードからマスタの内容(名称・検体・採取管)を引き直す。
// オーダー画面のプレビューと、保存時に FHIR へ写す値の取得元。
export function useLabOrderItemsByCodes(codes: string[]) {
  const sorted = Array.from(new Set(codes)).sort();

  return useQuery({
    queryKey: [...LAB_ORDER_ITEMS_KEY, "by_codes", sorted],
    staleTime: Infinity,
    queryFn: () => searchLabOrderItems({ order_item_code: sorted.join(","), per: 200 }),
    enabled: sorted.length > 0,
  });
}

// select はモジュールスコープに置く。ここで無名関数を渡すと呼び出しのたびに
// 別の関数になり、react-query が結果を再利用できず data が毎回別オブジェクトに
// なってしまう(それを依存に持つ effect が回り続ける)。
function toPanelMemberMap(result: MasterSearchResult<LabPanelItem>): Map<string, string[]> {
  const members = new Map<string, string[]>();
  for (const member of result.items) {
    const list = members.get(member.panel_item_code);
    if (list) list.push(member.member_item_code);
    else members.set(member.panel_item_code, [member.member_item_code]);
  }
  return members;
}

// パネルの構成。「パネルコード → 構成項目の項目コード」で返す。
// オーダー画面でパネルを選んだときに、その構成項目もオーダーに入れるために引く。
// パネルでない項目コードを混ぜても結果が増えないだけなので、呼ぶ側で選別しない。
export function useLabPanelMembers(panelCodes: string[]) {
  const sorted = Array.from(new Set(panelCodes)).sort();

  return useQuery({
    queryKey: [...LAB_ORDER_ITEMS_KEY, "panel_members", sorted],
    queryFn: () => searchLabPanelItems({ panel_item_code: sorted.join(","), per: 500 }),
    select: toPanelMemberMap,
    enabled: sorted.length > 0,
  });
}
