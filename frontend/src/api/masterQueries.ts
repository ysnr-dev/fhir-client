import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createLabContainer,
  createLabOrderItem,
  createLabOrderItemLayout,
  createLabOrderItemLayoutCell,
  createLabPanelItem,
  createLabSpecimen,
  createMedicineDoseConversion,
  deleteLabContainer,
  deleteLabOrderItem,
  deleteLabOrderItemLayout,
  deleteLabOrderItemLayoutCell,
  deleteLabPanelItem,
  deleteLabSpecimen,
  deleteMedicineDoseConversion,
  fetchLabItemFilterOptions,
  fetchLabOrderItem,
  fetchLabOrderItemLayout,
  fetchLabOrderItemLayouts,
  fetchLabSpecimenCategories,
  fetchMedicineTypeOptions,
  fetchMedicineUsageCategories,
  generateMedicineDoseConversions,
  importMaster,
  searchDiseases,
  searchJfagyAllergens,
  searchLabContainers,
  searchLabItems,
  searchLabOrderItems,
  searchLabPanelItems,
  searchLabSpecimens,
  searchMedicineDoseConversions,
  searchMedicineUsages,
  searchMedicines,
  searchModifiers,
  searchUnmappedMedicines,
  updateLabContainer,
  updateLabOrderItem,
  updateLabOrderItemLayout,
  updateLabOrderItemLayoutCell,
  updateLabPanelItem,
  updateLabSpecimen,
  updateMedicineDoseConversion,
  type LabContainerPayload,
  type LabItemDrilldown,
  type LabPanelItem,
  type MasterSearchResult,
  type LabOrderItemLayoutCellPayload,
  type LabOrderItemLayoutPayload,
  type LabOrderItemPayload,
  type LabPanelItemPayload,
  type LabSpecimenPayload,
  type MasterType,
  type MedicineDoseConversionPayload,
} from "./masterClient";

export interface MedicineUsageFilters {
  basicUsageCategory?: string;
  detailedUsageCategory?: string;
  timingCategory?: string;
  doseCount?: string;
}

export interface MedicineDoseConversionFilters {
  name?: string;
  source?: string;
  dosageForm?: string;
  needsReview?: boolean;
}

const MASTER_SEARCH_PER = 10;
// メンテ画面は一覧をじっくり見る画面なので検索モーダルより多く出す。
const DOSE_CONVERSION_PER = 20;
// 換算行と未紐付け一覧はどちらも generate / CRUD で同時に変わるのでまとめて破棄する。
const DOSE_CONVERSIONS_KEY = ["master", "medicine_dose_conversions"];

export function useImportMaster() {
  return useMutation({
    mutationFn: ({ masterType, file }: { masterType: MasterType; file: File }) =>
      importMaster(masterType, file),
  });
}

export function useMedicineSearch(
  name: string,
  yakkoCode: string,
  page: number,
  enabled: boolean,
  dosageForm?: string,
) {
  return useQuery({
    queryKey: ["master", "medicines", name, yakkoCode, dosageForm ?? "", page],
    queryFn: () =>
      searchMedicines({
        name: name || undefined,
        yakko_code: yakkoCode || undefined,
        dosage_form: dosageForm || undefined,
        page,
        per: MASTER_SEARCH_PER,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

// 薬効分類の選択プルダウン用（全件・薬効分類番号順）。変化しないので無期限キャッシュ。
export function useMedicineTypeOptions(enabled: boolean) {
  return useQuery({
    queryKey: ["master", "medicine_types", "options"],
    queryFn: fetchMedicineTypeOptions,
    staleTime: Infinity,
    enabled,
  });
}

export function useMedicineUsageSearch(
  usageName: string,
  filters: MedicineUsageFilters,
  page: number,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["master", "medicine_usages", usageName, filters, page],
    queryFn: () =>
      searchMedicineUsages({
        usage_name: usageName || undefined,
        basic_usage_category: filters.basicUsageCategory || undefined,
        detailed_usage_category: filters.detailedUsageCategory || undefined,
        timing_category: filters.timingCategory || undefined,
        dose_count: filters.doseCount || undefined,
        page,
        per: MASTER_SEARCH_PER,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useMedicineUsageCategories(enabled: boolean) {
  return useQuery({
    queryKey: ["master", "medicine_usages", "categories"],
    queryFn: fetchMedicineUsageCategories,
    staleTime: Infinity,
    enabled,
  });
}

// 検査項目選択モーダルの結果一覧。名称検索は大項目リストの絞り込み専用なので
// ここには渡さない(一覧は区分名称・大項目・材料・測定法の選択だけで決まる)。
export function useLabItemSearch(drilldown: LabItemDrilldown, page: number, enabled: boolean) {
  return useQuery({
    queryKey: ["master", "lab_items", "search", drilldown, page],
    queryFn: () => searchLabItems({ ...drilldown, page, per: MASTER_SEARCH_PER }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

// 段階的絞り込みの選択肢。選択が変わるたびに引き直すため、リストが一瞬空に
// ならないよう前回値を保持する。
export function useLabItemFilterOptions(
  params: LabItemDrilldown & { name?: string },
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["master", "lab_items", "filter_options", params],
    queryFn: () => fetchLabItemFilterOptions(params),
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    enabled,
  });
}

export function useDiseaseSearch(name: string, page: number, enabled: boolean) {
  return useQuery({
    queryKey: ["master", "diseases", name, page],
    queryFn: () => searchDiseases({ name: name || undefined, page, per: MASTER_SEARCH_PER }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useModifierSearch(name: string, page: number, enabled: boolean) {
  return useQuery({
    queryKey: ["master", "modifiers", name, page],
    queryFn: () => searchModifiers({ name: name || undefined, page, per: MASTER_SEARCH_PER }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export interface JfagyAllergenFilters {
  // 領域(F:食品、M:医薬品、N:非食品・非医薬品)
  domain?: string;
  // 階層プレフィックス(例: J9FA=農産食品の配下)
  codePrefix?: string;
  // 主要品目(MAINFLAG=1)のみ
  mainOnly?: boolean;
}

export function useJfagyAllergenSearch(
  name: string,
  filters: JfagyAllergenFilters,
  page: number,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["master", "jfagy_allergens", name, filters, page],
    queryFn: () =>
      searchJfagyAllergens({
        name: name || undefined,
        domain: filters.domain || undefined,
        code_prefix: filters.codePrefix || undefined,
        main_only: filters.mainOnly || undefined,
        page,
        per: MASTER_SEARCH_PER,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

// 分類プルダウン用。レベル2(食品の群・非食品の群)を表示順のまま全件取得する。
export function useJfagyAllergenGroups(enabled: boolean) {
  return useQuery({
    queryKey: ["master", "jfagy_allergens", "groups"],
    queryFn: () => searchJfagyAllergens({ level: "2", per: 100 }),
    staleTime: Infinity,
    enabled,
  });
}

export function useMedicineDoseConversionSearch(
  filters: MedicineDoseConversionFilters,
  page: number,
) {
  return useQuery({
    queryKey: [...DOSE_CONVERSIONS_KEY, "list", filters, page],
    queryFn: () =>
      searchMedicineDoseConversions({
        name: filters.name || undefined,
        source: filters.source || undefined,
        dosage_form: filters.dosageForm || undefined,
        needs_review: filters.needsReview || undefined,
        page,
        per: DOSE_CONVERSION_PER,
      }),
    placeholderData: keepPreviousData,
  });
}

// 換算行を1件も持たない医薬品の一覧（手動メンテの対象）。
export function useUnmappedMedicineSearch(
  filters: MedicineDoseConversionFilters,
  page: number,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [...DOSE_CONVERSIONS_KEY, "unmapped", filters, page],
    queryFn: () =>
      searchUnmappedMedicines({
        name: filters.name || undefined,
        dosage_form: filters.dosageForm || undefined,
        page,
        per: DOSE_CONVERSION_PER,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useGenerateMedicineDoseConversions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: generateMedicineDoseConversions,
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DOSE_CONVERSIONS_KEY });
    },
  });
}

export function useCreateMedicineDoseConversion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: MedicineDoseConversionPayload) => createMedicineDoseConversion(payload),
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DOSE_CONVERSIONS_KEY });
    },
  });
}

export function useUpdateMedicineDoseConversion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: number;
      payload: Partial<MedicineDoseConversionPayload>;
    }) => updateMedicineDoseConversion(id, payload),
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DOSE_CONVERSIONS_KEY });
    },
  });
}

export function useDeleteMedicineDoseConversion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteMedicineDoseConversion(id),
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DOSE_CONVERSIONS_KEY });
    },
  });
}

// 注射オーダーの総投与量計算用。医薬品コード → 「1[薬価算定単位] が何 mL か」の係数。
// 換算行を持たない医薬品(粉末バイアル等、容量がマスタに無いもの)は Map に入らない。
export function useMedicineMlFactors(medicineCodes: string[]) {
  const codes = Array.from(new Set(medicineCodes)).sort();

  return useQuery({
    queryKey: ["master", "medicine_dose_conversions", "ml", codes],
    queryFn: async () => {
      const result = await searchMedicineDoseConversions({
        medicine_code: codes.join(","),
        from_unit: "mL",
        per: 100,
      });
      const factors = new Map<string, number>();
      for (const row of result.items) {
        const factor = Number(row.factor);
        if (factor > 0) factors.set(row.medicine_code, factor);
      }
      return factors;
    },
    staleTime: Infinity,
    enabled: codes.length > 0,
  });
}

// 検査結果の編集画面用。保存済みの JLAC11 コードからマスタ情報
// (コード型の選択肢など)を一括で引き直す。
export function useLabItemsByCodes(codes: string[]) {
  return useQuery({
    queryKey: ["master", "lab_items", "by_codes", codes],
    queryFn: () => searchLabItems({ jlac11_code: codes.join(","), per: 100 }),
    staleTime: Infinity,
    enabled: codes.length > 0,
  });
}

// 検体検査オーダーから検査結果の項目を展開する用。オーダー項目マスタの JLAC コードは
// JLAC11・JLAC10 のどちらの体系でも持てるため、体系ごとに引いて結果をまとめる。
export function useLabItemsByJlacCodes(jlac11Codes: string[], jlac10Codes: string[]) {
  return useQuery({
    queryKey: ["master", "lab_items", "by_jlac_codes", jlac11Codes, jlac10Codes],
    queryFn: async () => {
      const results = await Promise.all([
        jlac11Codes.length ? searchLabItems({ jlac11_code: jlac11Codes.join(","), per: 100 }) : null,
        jlac10Codes.length ? searchLabItems({ jlac10_code: jlac10Codes.join(","), per: 100 }) : null,
      ]);
      return results.flatMap((result) => result?.items ?? []);
    },
    staleTime: Infinity,
    enabled: jlac11Codes.length > 0 || jlac10Codes.length > 0,
  });
}

// 検体検査オーダーのマスタ群 ------------------------------------------------

// オーダー項目・パネル構成は同じ詳細画面で同時に変わるのでまとめて破棄する。
const LAB_ORDER_ITEMS_KEY = ["master", "lab_order_items"];
const LAB_SPECIMENS_KEY = ["master", "lab_specimens"];
const LAB_CONTAINERS_KEY = ["master", "lab_containers"];
const LAB_LAYOUTS_KEY = ["master", "lab_order_item_layouts"];

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
    queryFn: fetchLabSpecimenCategories,
  });
}

// 検体の選択プルダウン用(掲載順の全件)。取込・編集後は invalidate で引き直す。
export function useLabSpecimenOptions() {
  return useQuery({
    queryKey: [...LAB_SPECIMENS_KEY, "options"],
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
