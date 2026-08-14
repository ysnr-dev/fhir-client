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
  bulkCreateRadItemsFromFrequent,
  createRadItem,
  createRadItemLayout,
  createRadItemLayoutCell,
  createRadJj1017Code,
  createRadSetItem,
  deleteRadItem,
  deleteRadItemLayout,
  deleteRadItemLayoutCell,
  deleteRadJj1017Code,
  deleteRadSetItem,
  fetchRadItem,
  fetchRadItemLayout,
  fetchRadItemLayouts,
  fetchRadJj1017Catalog,
  fetchRadJj1017Elements,
  createRadMaterial,
  deleteRadMaterial,
  fetchRadMaterial,
  searchMedicalMaterials,
  searchMedicalProcedures,
  searchRadFrequentCodes,
  searchRadMaterials,
  updateRadMaterial,
  searchRadItems,
  searchRadJj1017Codes,
  searchRadSetItems,
  updateRadItem,
  updateRadItemLayout,
  updateRadItemLayoutCell,
  updateRadJj1017Code,
  type RadItemLayoutCellPayload,
  type RadItemLayoutPayload,
  type RadItemPayload,
  type RadMaterialPayload,
  type RadJj1017CodePayload,
  type RadSetItemPayload,
  type RadItemSearchResult,
  type RadSetItem,
  createRadDataset,
  createRadDatasetDetail,
  createRadItemDataset,
  deleteRadDataset,
  deleteRadDatasetDetail,
  deleteRadItemDataset,
  fetchRadDataset,
  searchRadDatasetDetails,
  searchRadDatasets,
  searchRadItemDatasets,
  updateRadDataset,
  updateRadDatasetDetail,
  type RadDatasetDetailPayload,
  type RadDatasetPayload,
  createSchema,
  createSchemaCategory,
  deleteSchema,
  deleteSchemaCategory,
  fetchSchemaCategories,
  searchSchemas,
  updateSchema,
  updateSchemaCategory,
  type SchemaCategoryPayload,
  type SchemaPayload,
  createMicroAntimicrobial,
  createMicroCollectionMethod,
  createMicroCollectionSite,
  createMicroOrderItem,
  createMicroOrganism,
  createMicroSpecimenType,
  createMicroSusceptibilityMethod,
  deleteMicroAntimicrobial,
  deleteMicroCollectionMethod,
  deleteMicroCollectionSite,
  deleteMicroOrderItem,
  deleteMicroOrganism,
  deleteMicroSpecimenType,
  deleteMicroSusceptibilityMethod,
  fetchMicroCollectionMethods,
  fetchMicroCollectionSites,
  fetchMicroOrderItems,
  searchMicroAntimicrobials,
  searchMicroOrganisms,
  searchMicroSpecimenTypes,
  searchMicroSusceptibilityMethods,
  updateMicroAntimicrobial,
  updateMicroCollectionMethod,
  updateMicroCollectionSite,
  updateMicroOrderItem,
  updateMicroOrganism,
  updateMicroSpecimenType,
  updateMicroSusceptibilityMethod,
  type MicroAntimicrobialPayload,
  type MicroCollectionMethodPayload,
  type MicroCollectionSitePayload,
  type MicroOrderItemPayload,
  type MicroOrganismPayload,
  type MicroSpecimenTypePayload,
  type MicroSusceptibilityMethodPayload,
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
  contrastMedium?: boolean,
) {
  return useQuery({
    queryKey: [
      "master",
      "medicines",
      name,
      yakkoCode,
      dosageForm ?? "",
      contrastMedium ? "contrast" : "",
      page,
    ],
    queryFn: () =>
      searchMedicines({
        name: name || undefined,
        yakko_code: yakkoCode || undefined,
        dosage_form: dosageForm || undefined,
        contrast_medium: contrastMedium || undefined,
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


// 放射線検査オーダーのマスタ群 ----------------------------------------------

// オーダー項目・セット構成は同じ詳細画面で同時に変わるのでまとめて破棄する。
const RAD_JJ1017_CODES_KEY = ["master", "rad_jj1017_codes"];
const RAD_FREQUENT_CODES_KEY = ["master", "rad_frequent_codes"];
const RAD_ITEMS_KEY = ["master", "rad_items"];
const RAD_LAYOUTS_KEY = ["master", "rad_item_layouts"];
const MEDICAL_MATERIALS_KEY = ["master", "medical_materials"];

/** 特定器材の検索。実施入力で使った器材を選ぶために引く。 */
export function useMedicalMaterialSearch(
  filters: { name?: string; materialCategory?: string },
  page: number,
  enabled = true,
) {
  return useQuery({
    queryKey: [...MEDICAL_MATERIALS_KEY, "list", filters, page],
    queryFn: () =>
      searchMedicalMaterials({
        name: filters.name || undefined,
        material_category: filters.materialCategory || undefined,
        // 廃止済みの器材は選べても仕方がないので既定で除く。
        active: true,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** 保存済みの実施情報から器材名を復元するための一括取得。 */
export function useMedicalMaterialsByCodes(codes: string[]) {
  const unique = Array.from(new Set(codes.filter(Boolean))).sort();

  return useQuery({
    queryKey: [...MEDICAL_MATERIALS_KEY, "by-codes", unique],
    queryFn: () => searchMedicalMaterials({ material_code: unique.join(","), per: unique.length }),
    enabled: unique.length > 0,
  });
}

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

const MEDICAL_PROCEDURES_KEY = ["master", "medical_procedures"];

/** 医科診療行為(手技料)の検索。実施入力で手技を確定するために引く。 */
export function useMedicalProcedureSearch(
  filters: { name?: string; codeTableNumberAlpha?: string },
  page: number,
  enabled = true,
) {
  return useQuery({
    queryKey: [...MEDICAL_PROCEDURES_KEY, "list", filters, page],
    queryFn: () =>
      searchMedicalProcedures({
        name: filters.name || undefined,
        code_table_number_alpha: filters.codeTableNumberAlpha || undefined,
        // 廃止済みの診療行為は選べても仕方がないので既定で除く。
        active: true,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** 保存済みの実施情報から手技名を復元するための一括取得。 */
export function useMedicalProceduresByCodes(codes: string[]) {
  const unique = Array.from(new Set(codes.filter(Boolean))).sort();

  return useQuery({
    queryKey: [...MEDICAL_PROCEDURES_KEY, "by-codes", unique],
    queryFn: () => searchMedicalProcedures({ procedure_code: unique.join(","), per: unique.length }),
    enabled: unique.length > 0,
  });
}

const RAD_DATASETS_KEY = ["master", "rad_datasets"];
// 撮影項目への紐付けは項目マスタの詳細にも載るので、変更したら両方を破棄する。
const RAD_ITEM_DATASETS_KEY = ["master", "rad_item_datasets"];
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
        // 削除でぶら下がる紐付けも消えるので、項目マスタ側も引き直す。
        queryClient.invalidateQueries({ queryKey: RAD_ITEM_DATASETS_KEY });
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

/** 撮影項目とデータセットの紐付け。項目マスタの詳細画面から編集する。 */
export function useRadItemDatasetMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: RAD_ITEM_DATASETS_KEY });
    // 紐付けは項目マスタの詳細レスポンスにも載っている。
    queryClient.invalidateQueries({ queryKey: RAD_ITEMS_KEY });
  };

  return {
    create: useMutation({
      mutationFn: (payload: { item_code: string; dataset_code: string }) =>
        createRadItemDataset(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteRadItemDataset(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

/**
 * 撮影項目コード群に紐付く全データセットの明細。実施入力の初期表示に使う。
 *
 * 紐付け → 明細の2段。データセットは複数の撮影項目から使い回されるので、
 * 明細を引く前にデータセットコードを一意化する(同じデータセットを2回引かない)。
 */
export function useRadDatasetLinesForItems(itemCodes: string[]) {
  const codes = Array.from(new Set(itemCodes.filter(Boolean))).sort();

  const links = useQuery({
    queryKey: [...RAD_ITEM_DATASETS_KEY, "for-items", codes],
    queryFn: () =>
      searchRadItemDatasets({ item_code: codes.join(","), per: RAD_DATASET_DETAIL_PER }),
    enabled: codes.length > 0,
  });

  const datasetCodes = Array.from(
    new Set((links.data?.items ?? []).map((link) => link.dataset_code)),
  ).sort();

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
    links: links.data?.items ?? [],
    details: details.data?.items ?? [],
    // 紐付けが1件も無いときは明細クエリが走らないので、その分は待たない。
    isLoading: links.isLoading || (datasetCodes.length > 0 && details.isLoading),
    error: links.error ?? details.error,
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
  kind?: string;
  /** オーダー単位。"true"=グループ化のみ / "false"=単独オーダーのみ。 */
  groupable?: string;
  modalityCode?: string;
  active?: boolean;
}

export function useRadItemSearch(filters: RadItemFilters, page: number, enabled = true) {
  return useQuery({
    queryKey: [...RAD_ITEMS_KEY, "list", filters, page],
    queryFn: () =>
      searchRadItems({
        name: filters.name || undefined,
        kind: filters.kind || undefined,
        groupable: filters.groupable || undefined,
        modality_code: filters.modalityCode || undefined,
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

// ---- シェーマ(台紙画像)マスタ ----

const SCHEMA_CATEGORIES_KEY = ["master", "schema_categories"];
const SCHEMAS_KEY = ["master", "schemas"];

// カテゴリ全件。ツリーの組み立ては schemaCategoryTree.ts で行う。
export function useSchemaCategories() {
  return useQuery({
    queryKey: [...SCHEMA_CATEGORIES_KEY, "list"],
    queryFn: fetchSchemaCategories,
  });
}

export function useSchemaCategoryMutations() {
  const queryClient = useQueryClient();
  // カテゴリの削除・付け替えはシェーマ一覧のグループ分けにも効くので両方無効化する。
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: SCHEMA_CATEGORIES_KEY });
    queryClient.invalidateQueries({ queryKey: SCHEMAS_KEY });
  };

  return {
    create: useMutation({
      mutationFn: (payload: SchemaCategoryPayload) => createSchemaCategory(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: SchemaCategoryPayload }) =>
        updateSchemaCategory(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteSchemaCategory(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

// カテゴリ内のシェーマ一覧(image は含まない)。null は未分類、undefined は全件。
export function useSchemas(categoryId: number | null | undefined, name?: string) {
  return useQuery({
    queryKey: [
      ...SCHEMAS_KEY,
      "list",
      { categoryId: categoryId === undefined ? "all" : (categoryId ?? "none"), name: name ?? "" },
    ],
    queryFn: () => searchSchemas({ category_id: categoryId, name: name || undefined, per: 100 }),
    placeholderData: keepPreviousData,
  });
}

export function useSchemaMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: SCHEMAS_KEY });
  };

  return {
    create: useMutation({
      mutationFn: (payload: SchemaPayload) => createSchema(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: SchemaPayload }) =>
        updateSchema(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteSchema(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

// ---- 細菌検査(微生物検査)オーダーのマスタ ----

const MICRO_ORGANISMS_KEY = ["master", "micro_organisms"];
const MICRO_SPECIMEN_TYPES_KEY = ["master", "micro_specimen_types"];
const MICRO_ORDER_ITEMS_KEY = ["master", "micro_order_items"];
const MICRO_COLLECTION_SITES_KEY = ["master", "micro_collection_sites"];
const MICRO_COLLECTION_METHODS_KEY = ["master", "micro_collection_methods"];

export interface MicroOrganismFilters {
  name?: string;
  frequent?: boolean;
  source?: string;
}

export function useMicroOrganismSearch(filters: MicroOrganismFilters, page: number) {
  return useQuery({
    queryKey: [...MICRO_ORGANISMS_KEY, "list", filters, page],
    queryFn: () =>
      searchMicroOrganisms({
        name: filters.name || undefined,
        frequent: filters.frequent || undefined,
        source: filters.source || undefined,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
  });
}

export function useMicroOrganismMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: MICRO_ORGANISMS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: MicroOrganismPayload) => createMicroOrganism(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: MicroOrganismPayload }) =>
        updateMicroOrganism(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteMicroOrganism(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

export interface MicroSpecimenTypeFilters {
  name?: string;
  source?: string;
}

export function useMicroSpecimenTypeSearch(filters: MicroSpecimenTypeFilters, page: number) {
  return useQuery({
    queryKey: [...MICRO_SPECIMEN_TYPES_KEY, "list", filters, page],
    queryFn: () =>
      searchMicroSpecimenTypes({
        name: filters.name || undefined,
        source: filters.source || undefined,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
  });
}

export function useMicroSpecimenTypeMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: MICRO_SPECIMEN_TYPES_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: MicroSpecimenTypePayload) => createMicroSpecimenType(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: MicroSpecimenTypePayload }) =>
        updateMicroSpecimenType(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteMicroSpecimenType(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

export function useMicroOrderItems() {
  return useQuery({
    queryKey: [...MICRO_ORDER_ITEMS_KEY, "list"],
    queryFn: fetchMicroOrderItems,
  });
}

export function useMicroOrderItemMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: MICRO_ORDER_ITEMS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: MicroOrderItemPayload) => createMicroOrderItem(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: MicroOrderItemPayload }) =>
        updateMicroOrderItem(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteMicroOrderItem(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

export function useMicroCollectionSites() {
  return useQuery({
    queryKey: [...MICRO_COLLECTION_SITES_KEY, "list"],
    queryFn: fetchMicroCollectionSites,
  });
}

export function useMicroCollectionSiteMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: MICRO_COLLECTION_SITES_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: MicroCollectionSitePayload) => createMicroCollectionSite(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: MicroCollectionSitePayload }) =>
        updateMicroCollectionSite(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteMicroCollectionSite(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

export function useMicroCollectionMethods() {
  return useQuery({
    queryKey: [...MICRO_COLLECTION_METHODS_KEY, "list"],
    queryFn: fetchMicroCollectionMethods,
  });
}

export function useMicroCollectionMethodMutations() {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: MICRO_COLLECTION_METHODS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: MicroCollectionMethodPayload) => createMicroCollectionMethod(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: MicroCollectionMethodPayload }) =>
        updateMicroCollectionMethod(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteMicroCollectionMethod(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

// 細菌検査オーダー画面用: 検体種別の選択肢(全件。標準50件+施設追加の想定)。
export function useMicroSpecimenTypeOptions() {
  return useQuery({
    queryKey: [...MICRO_SPECIMEN_TYPES_KEY, "options"],
    queryFn: () => searchMicroSpecimenTypes({ per: 100 }),
  });
}

// 細菌検査オーダー画面用: 頻用菌(オーダー画面に直接並べる目的菌)の一覧。
export function useFrequentMicroOrganisms() {
  return useQuery({
    queryKey: [...MICRO_ORGANISMS_KEY, "frequent"],
    queryFn: () => searchMicroOrganisms({ frequent: true, per: 100 }),
  });
}

// ---- 細菌検査結果のマスタ ----

const MICRO_ANTIMICROBIALS_KEY = ["master", "micro_antimicrobials"];
const MICRO_SUSCEPTIBILITY_METHODS_KEY = ["master", "micro_susceptibility_methods"];

export interface MicroAntimicrobialFilters {
  name?: string;
  frequent?: boolean;
  source?: string;
}

export function useMicroAntimicrobialSearch(filters: MicroAntimicrobialFilters, page: number) {
  return useQuery({
    queryKey: [...MICRO_ANTIMICROBIALS_KEY, "list", filters, page],
    queryFn: () =>
      searchMicroAntimicrobials({
        name: filters.name || undefined,
        frequent: filters.frequent || undefined,
        source: filters.source || undefined,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
  });
}

export function useMicroAntimicrobialMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: MICRO_ANTIMICROBIALS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: MicroAntimicrobialPayload) => createMicroAntimicrobial(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: MicroAntimicrobialPayload }) =>
        updateMicroAntimicrobial(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteMicroAntimicrobial(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

export interface MicroSusceptibilityMethodFilters {
  name?: string;
  source?: string;
}

export function useMicroSusceptibilityMethodSearch(
  filters: MicroSusceptibilityMethodFilters,
  page: number,
) {
  return useQuery({
    queryKey: [...MICRO_SUSCEPTIBILITY_METHODS_KEY, "list", filters, page],
    queryFn: () =>
      searchMicroSusceptibilityMethods({
        name: filters.name || undefined,
        source: filters.source || undefined,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
  });
}

export function useMicroSusceptibilityMethodMutations() {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: MICRO_SUSCEPTIBILITY_METHODS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: MicroSusceptibilityMethodPayload) =>
        createMicroSusceptibilityMethod(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: MicroSusceptibilityMethodPayload }) =>
        updateMicroSusceptibilityMethod(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteMicroSusceptibilityMethod(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

// 細菌検査結果画面用: 頻用抗菌薬(感受性欄に直接並べる薬)の一覧。
export function useFrequentMicroAntimicrobials() {
  return useQuery({
    queryKey: [...MICRO_ANTIMICROBIALS_KEY, "frequent"],
    queryFn: () => searchMicroAntimicrobials({ frequent: true, per: 100 }),
  });
}

// 細菌検査結果画面用: 感受性測定法の選択肢(全件。標準33件+施設追加の想定)。
export function useMicroSusceptibilityMethodOptions() {
  return useQuery({
    queryKey: [...MICRO_SUSCEPTIBILITY_METHODS_KEY, "options"],
    queryFn: () => searchMicroSusceptibilityMethods({ per: 100 }),
  });
}
