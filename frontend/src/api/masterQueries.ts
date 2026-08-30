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
  searchJfagyDrugs,
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
  deleteRadDataset,
  deleteRadDatasetDetail,
  fetchRadDataset,
  searchRadDatasetDetails,
  searchRadDatasets,
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
  searchPhysioExamTypes,
  createPhysioExamType,
  updatePhysioExamType,
  deletePhysioExamType,
  searchPhysioItems,
  fetchPhysioItem,
  createPhysioItem,
  updatePhysioItem,
  deletePhysioItem,
  searchPhysioSetItems,
  createPhysioSetItem,
  deletePhysioSetItem,
  fetchPhysioItemLayouts,
  fetchPhysioItemLayout,
  createPhysioItemLayout,
  updatePhysioItemLayout,
  deletePhysioItemLayout,
  createPhysioItemLayoutCell,
  updatePhysioItemLayoutCell,
  deletePhysioItemLayoutCell,
  searchPhysioDatasets,
  fetchPhysioDataset,
  createPhysioDataset,
  updatePhysioDataset,
  deletePhysioDataset,
  searchPhysioDatasetDetails,
  createPhysioDatasetDetail,
  updatePhysioDatasetDetail,
  deletePhysioDatasetDetail,
  type PhysioExamTypePayload,
  type PhysioItemPayload,
  type PhysioItemSearchResult,
  type PhysioSetItem,
  type PhysioSetItemPayload,
  type PhysioItemLayoutPayload,
  type PhysioItemLayoutCellPayload,
  type PhysioDatasetPayload,
  type PhysioDatasetDetailPayload,
  searchEndoscopyExamTypes,
  createEndoscopyExamType,
  updateEndoscopyExamType,
  deleteEndoscopyExamType,
  searchEndoscopyItems,
  fetchEndoscopyItem,
  createEndoscopyItem,
  updateEndoscopyItem,
  deleteEndoscopyItem,
  searchEndoscopySetItems,
  createEndoscopySetItem,
  deleteEndoscopySetItem,
  fetchEndoscopyItemLayouts,
  fetchEndoscopyItemLayout,
  createEndoscopyItemLayout,
  updateEndoscopyItemLayout,
  deleteEndoscopyItemLayout,
  createEndoscopyItemLayoutCell,
  updateEndoscopyItemLayoutCell,
  deleteEndoscopyItemLayoutCell,
  searchEndoscopyDatasets,
  fetchEndoscopyDataset,
  createEndoscopyDataset,
  updateEndoscopyDataset,
  deleteEndoscopyDataset,
  searchEndoscopyDatasetDetails,
  createEndoscopyDatasetDetail,
  updateEndoscopyDatasetDetail,
  deleteEndoscopyDatasetDetail,
  type EndoscopyExamTypePayload,
  type EndoscopyItemPayload,
  type EndoscopyItemSearchResult,
  type EndoscopySetItem,
  type EndoscopySetItemPayload,
  type EndoscopyItemLayoutPayload,
  type EndoscopyItemLayoutCellPayload,
  type EndoscopyDatasetPayload,
  type EndoscopyDatasetDetailPayload,
  searchTreatmentItems,
  fetchTreatmentItem,
  createTreatmentItem,
  updateTreatmentItem,
  deleteTreatmentItem,
  searchTreatmentSetItems,
  createTreatmentSetItem,
  deleteTreatmentSetItem,
  fetchTreatmentItemLayouts,
  fetchTreatmentItemLayout,
  createTreatmentItemLayout,
  updateTreatmentItemLayout,
  deleteTreatmentItemLayout,
  createTreatmentItemLayoutCell,
  updateTreatmentItemLayoutCell,
  deleteTreatmentItemLayoutCell,
  searchTreatmentDatasets,
  fetchTreatmentDataset,
  createTreatmentDataset,
  updateTreatmentDataset,
  deleteTreatmentDataset,
  searchTreatmentDatasetDetails,
  createTreatmentDatasetDetail,
  updateTreatmentDatasetDetail,
  deleteTreatmentDatasetDetail,
  type TreatmentItemPayload,
  type TreatmentSetItem,
  type TreatmentSetItemPayload,
  type TreatmentItemLayoutPayload,
  type TreatmentItemLayoutCellPayload,
  type TreatmentDatasetPayload,
  type TreatmentDatasetDetailPayload,
  searchMealItems,
  fetchMealItem,
  createMealItem,
  updateMealItem,
  deleteMealItem,
  type MealItem,
  type MealItemPayload,
  searchMealCategories,
  createMealCategory,
  updateMealCategory,
  deleteMealCategory,
  type MealCategoryPayload,
  searchNursingActs,
  searchNursingActActions,
  fetchNursingActLevels,
  searchNursingObservations,
  type NursingObservation,
  searchTransfusionProducts,
  fetchTransfusionProduct,
  createTransfusionProduct,
  updateTransfusionProduct,
  deleteTransfusionProduct,
  type TransfusionProductPayload,
  searchSurgeryItems,
  fetchSurgeryItem,
  createSurgeryItem,
  updateSurgeryItem,
  deleteSurgeryItem,
  type SurgeryItemPayload,
  searchSurgeryCategories,
  createSurgeryCategory,
  updateSurgeryCategory,
  deleteSurgeryCategory,
  type SurgeryCategoryPayload,
  searchSurgeryRoomBlocks,
  fetchAllSurgeryRoomBlocks,
  createSurgeryRoomBlock,
  updateSurgeryRoomBlock,
  deleteSurgeryRoomBlock,
  type SurgeryRoomBlockPayload,
  searchPathoOrgans,
  createPathoOrgan,
  updatePathoOrgan,
  deletePathoOrgan,
  fetchPathoCollectionMethods,
  createPathoCollectionMethod,
  updatePathoCollectionMethod,
  deletePathoCollectionMethod,
  type PathoOrganPayload,
  type PathoCollectionMethodPayload,
} from "./masterClient";
import type { MealItemRef } from "../fhir/mealOrderHelpers";

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
  generic?: boolean,
) {
  return useQuery({
    queryKey: [
      "master",
      "medicines",
      name,
      yakkoCode,
      dosageForm ?? "",
      contrastMedium ? "contrast" : "",
      generic ? "generic" : "",
      page,
    ],
    queryFn: () =>
      searchMedicines({
        name: name || undefined,
        yakko_code: yakkoCode || undefined,
        dosage_form: dosageForm || undefined,
        contrast_medium: contrastMedium || undefined,
        generic: generic || undefined,
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

export function useJfagyDrugSearch(name: string, page: number, enabled: boolean) {
  return useQuery({
    queryKey: ["master", "jfagy_drugs", name, page],
    queryFn: () => searchJfagyDrugs({ name: name || undefined, page, per: MASTER_SEARCH_PER }),
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


// ---- 処置オーダーのマスタ ----
//
// 生理検査と同じ構成から検査種別(分類軸)を落としたもの。

const TREATMENT_ITEMS_KEY = ["master", "treatment_items"];
const TREATMENT_LAYOUTS_KEY = ["master", "treatment_item_layouts"];
const TREATMENT_DATASETS_KEY = ["master", "treatment_datasets"];
// 1データセットの明細も、オーダーに紐付く全データセットの明細も、この上限で足りる。
const TREATMENT_DATASET_DETAIL_PER = 100;

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

export function useTreatmentItemLayouts() {
  return useQuery({
    queryKey: [...TREATMENT_LAYOUTS_KEY, "list"],
    queryFn: fetchTreatmentItemLayouts,
  });
}

export function useTreatmentItemLayout(id: number | undefined) {
  return useQuery({
    queryKey: [...TREATMENT_LAYOUTS_KEY, "detail", id],
    queryFn: () => fetchTreatmentItemLayout(id as number),
    enabled: id !== undefined,
  });
}

export function useTreatmentItemLayoutMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: TREATMENT_LAYOUTS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: TreatmentItemLayoutPayload) => createTreatmentItemLayout(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: TreatmentItemLayoutPayload }) =>
        updateTreatmentItemLayout(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteTreatmentItemLayout(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

export function useTreatmentItemLayoutCellMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: TREATMENT_LAYOUTS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: TreatmentItemLayoutCellPayload) => createTreatmentItemLayoutCell(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: Partial<TreatmentItemLayoutCellPayload> }) =>
        updateTreatmentItemLayoutCell(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteTreatmentItemLayoutCell(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

/** 実施入力用データセットの検索。 */
export function useTreatmentDatasetSearch(
  filters: { name?: string; active?: boolean },
  page: number,
  enabled = true,
) {
  return useQuery({
    queryKey: [...TREATMENT_DATASETS_KEY, "list", filters, page],
    queryFn: () =>
      searchTreatmentDatasets({
        name: filters.name || undefined,
        active: filters.active || undefined,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** 処置項目に付けるデータセットの選択肢。件数が少ないので全件まとめて引く。 */
export function useTreatmentDatasetOptions() {
  return useQuery({
    queryKey: [...TREATMENT_DATASETS_KEY, "options"],
    queryFn: () => searchTreatmentDatasets({ per: 200 }),
  });
}

/** 編集モーダル用の詳細(明細を名称付きで同梱)。データセットコードでも id でも引ける。 */
export function useTreatmentDataset(idOrCode: string | number | null) {
  return useQuery({
    queryKey: [...TREATMENT_DATASETS_KEY, "detail", idOrCode],
    queryFn: () => fetchTreatmentDataset(idOrCode as string | number),
    enabled: idOrCode !== null,
  });
}

export function useTreatmentDatasetMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: TREATMENT_DATASETS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: TreatmentDatasetPayload) => createTreatmentDataset(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: TreatmentDatasetPayload }) =>
        updateTreatmentDataset(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteTreatmentDataset(id),
      retry: false,
      onSuccess: () => {
        invalidate();
        // 削除で参照していた項目の dataset_code も外れるので、項目マスタ側も引き直す。
        queryClient.invalidateQueries({ queryKey: TREATMENT_ITEMS_KEY });
      },
    }),
  };
}

/** 明細の編集。データセット詳細に同梱されているので詳細ごと破棄する。 */
export function useTreatmentDatasetDetailMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: TREATMENT_DATASETS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: TreatmentDatasetDetailPayload) => createTreatmentDatasetDetail(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: TreatmentDatasetDetailPayload }) =>
        updateTreatmentDatasetDetail(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteTreatmentDatasetDetail(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

/**
 * 処置項目コード群が参照するデータセットの明細。実施入力の初期表示に使う。
 *
 * 項目 → 明細の2段。1つのデータセットは複数の処置項目から参照されるので、
 * 明細を引く前にデータセットコードを一意化する(同じデータセットを2回引かない)。
 */
export function useTreatmentDatasetLinesForItems(itemCodes: string[]) {
  const codes = Array.from(new Set(itemCodes.filter(Boolean))).sort();

  const items = useQuery({
    queryKey: [...TREATMENT_ITEMS_KEY, "dataset-codes", codes],
    queryFn: () =>
      searchTreatmentItems({ item_code: codes.join(","), per: TREATMENT_DATASET_DETAIL_PER }),
    enabled: codes.length > 0,
  });

  const datasetCodes = Array.from(
    new Set((items.data?.items ?? []).map((item) => item.dataset_code).filter(Boolean)),
  ).sort() as string[];

  const details = useQuery({
    queryKey: [...TREATMENT_DATASETS_KEY, "details-for", datasetCodes],
    queryFn: () =>
      searchTreatmentDatasetDetails({
        dataset_code: datasetCodes.join(","),
        per: TREATMENT_DATASET_DETAIL_PER,
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

// 処置オーダー画面用 --------------------------------------------------

// 選択中の項目コードからマスタの内容(名称・略称)を引き直す。
// オーダー画面のプレビューと、保存時に FHIR へ写す値の取得元。
export function useTreatmentItemsByCodes(codes: string[]) {
  const sorted = Array.from(new Set(codes)).sort();

  return useQuery({
    queryKey: [...TREATMENT_ITEMS_KEY, "by_codes", sorted],
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


// ---- 食事オーダーのマスタ ----
//
// 食種(diet)・主食(staple)・副食形態(side_dish_form)は同じテーブルなのでキーも
// 1 つ。オーダー画面は useMealItemOptions(kind) でそれぞれの選択肢を引く。

const MEAL_ITEMS_KEY = ["master", "meal_items"];
const MEAL_CATEGORIES_KEY = ["master", "meal_categories"];

/** 食種の種別(分類)の検索(マスタ画面の一覧)。 */
export function useMealCategorySearch(
  filters: { name?: string; active?: boolean },
  page: number,
  enabled = true,
) {
  return useQuery({
    queryKey: [...MEAL_CATEGORIES_KEY, "list", filters, page],
    queryFn: () =>
      searchMealCategories({
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
 * 種別の選択肢。食事オーダー項目マスタと食事オーダー画面が共通で使う。
 * 数件にしかならないマスタなので全件まとめて引く。
 */
export function useMealCategoryOptions() {
  return useQuery({
    queryKey: [...MEAL_CATEGORIES_KEY, "options"],
    queryFn: () => searchMealCategories({ per: 100 }),
  });
}

export function useMealCategoryMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: MEAL_CATEGORIES_KEY });
    // 分類を消すと食種側の種別も外れるので、項目の一覧・選択肢も引き直す。
    queryClient.invalidateQueries({ queryKey: MEAL_ITEMS_KEY });
  };

  return {
    create: useMutation({
      mutationFn: (payload: MealCategoryPayload) => createMealCategory(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: MealCategoryPayload }) =>
        updateMealCategory(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteMealCategory(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

export interface MealItemFilters {
  name?: string;
  /** "diet"=食種 / "staple"=主食。 */
  kind?: string;
  /** 種別(食種だけが持つ)。 */
  categoryCode?: string;
  active?: boolean;
}

export function useMealItemSearch(filters: MealItemFilters, page: number, enabled = true) {
  return useQuery({
    queryKey: [...MEAL_ITEMS_KEY, "list", filters, page],
    queryFn: () =>
      searchMealItems({
        name: filters.name || undefined,
        kind: filters.kind || undefined,
        category_code: filters.categoryCode || undefined,
        active: filters.active || undefined,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useMealItem(idOrCode: string | number | null) {
  return useQuery({
    queryKey: [...MEAL_ITEMS_KEY, "detail", idOrCode],
    queryFn: () => fetchMealItem(idOrCode as string | number),
    enabled: idOrCode !== null,
  });
}

/**
 * オーダー画面の食種・主食・副食形態の選択肢。施設ごとに数十件で収まるマスタなので、
 * 検索モーダルを作らず有効期間内の全件をまとめて引いてセレクトに並べる。
 */
export function useMealItemOptions(kind: "diet" | "staple" | "side_dish_form") {
  return useQuery({
    queryKey: [...MEAL_ITEMS_KEY, "options", kind],
    queryFn: () => searchMealItems({ kind, active: true, per: 200 }),
  });
}

/**
 * 食止めの食種(is_fasting の先頭)。外出泊の連動が食止めオーダーを作るのに使う。
 * 登録が無ければ null(連動は食止めオーダーを省く)。
 */
export function fastingDietOf(items: MealItem[] | undefined): MealItemRef | null {
  const item = items?.find((i) => i.is_fasting);
  return item ? { code: item.item_code, name: item.name } : null;
}

export async function fetchFastingDiet(): Promise<MealItemRef | null> {
  const result = await searchMealItems({ kind: "diet", active: true, per: 200 });
  return fastingDietOf(result.items);
}

export function useFastingDiet() {
  const diets = useMealItemOptions("diet");
  return { ...diets, fastingDiet: fastingDietOf(diets.data?.items) };
}

/**
 * 保存済みオーダーの食種・主食コードから項目を引き直す。マスタから消えた項目でも
 * オーダーには名称を写してあるので、これは編集画面がセレクトの選択肢に無い項目を
 * 補うためだけに使う。
 */
export function useMealItemsByCodes(codes: string[]) {
  const key = [...codes].sort().join(",");
  return useQuery({
    queryKey: [...MEAL_ITEMS_KEY, "by-codes", key],
    queryFn: () => searchMealItems({ item_code: key, per: 100 }),
    enabled: key.length > 0,
  });
}

export function useMealItemMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: MEAL_ITEMS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: MealItemPayload) => createMealItem(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: MealItemPayload }) =>
        updateMealItem(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteMealItem(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

// ---- 輸血製剤マスタ ----
//
// 食事オーダーのマスタと同じ形。施設ごとに数十件で収まるので、オーダー画面の
// 選択肢は検索モーダルを作らず有効期間内の全件をまとめて引く。

const TRANSFUSION_PRODUCTS_KEY = ["master", "transfusion_products"];

export interface TransfusionProductFilters {
  name?: string;
  /** 製剤区分(rbc / ffp / plt / auto / other)。 */
  category?: string;
  active?: boolean;
}

export function useTransfusionProductSearch(
  filters: TransfusionProductFilters,
  page: number,
  enabled = true,
) {
  return useQuery({
    queryKey: [...TRANSFUSION_PRODUCTS_KEY, "list", filters, page],
    queryFn: () =>
      searchTransfusionProducts({
        name: filters.name || undefined,
        category: filters.category || undefined,
        active: filters.active || undefined,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useTransfusionProduct(idOrCode: string | number | null) {
  return useQuery({
    queryKey: [...TRANSFUSION_PRODUCTS_KEY, "detail", idOrCode],
    queryFn: () => fetchTransfusionProduct(idOrCode as string | number),
    enabled: idOrCode !== null,
  });
}

/** オーダー画面の製剤の選択肢(有効期間内の全件)。 */
export function useTransfusionProductOptions() {
  return useQuery({
    queryKey: [...TRANSFUSION_PRODUCTS_KEY, "options"],
    queryFn: () => searchTransfusionProducts({ active: true, per: 200 }),
  });
}

/**
 * 保存済みオーダーの製剤コードから製剤を引き直す。オーダーには名称を写してあるので、
 * これは編集画面がセレクトの選択肢に無い(有効期間切れの)製剤を補うためだけに使う。
 */
export function useTransfusionProductsByCodes(codes: string[]) {
  const key = [...codes].sort().join(",");
  return useQuery({
    queryKey: [...TRANSFUSION_PRODUCTS_KEY, "by-codes", key],
    queryFn: () => searchTransfusionProducts({ item_code: key, per: 100 }),
    enabled: key.length > 0,
  });
}

export function useTransfusionProductMutations() {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: TRANSFUSION_PRODUCTS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: TransfusionProductPayload) => createTransfusionProduct(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: TransfusionProductPayload }) =>
        updateTransfusionProduct(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteTransfusionProduct(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

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

// ---- 病理検査オーダーのマスタ ----

const PATHO_ORGANS_KEY = ["master", "patho_organs"];
const PATHO_COLLECTION_METHODS_KEY = ["master", "patho_collection_methods"];

export interface PathoOrganFilters {
  name?: string;
  frequent?: boolean;
  source?: string;
}

export function usePathoOrganSearch(filters: PathoOrganFilters, page: number) {
  return useQuery({
    queryKey: [...PATHO_ORGANS_KEY, "list", filters, page],
    queryFn: () =>
      searchPathoOrgans({
        name: filters.name || undefined,
        frequent: filters.frequent || undefined,
        source: filters.source || undefined,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
  });
}

export function usePathoOrganMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: PATHO_ORGANS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: PathoOrganPayload) => createPathoOrgan(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: PathoOrganPayload }) =>
        updatePathoOrgan(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deletePathoOrgan(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

// 病理検査オーダー画面用: 頻用臓器(検索する前に並べる候補)。
export function useFrequentPathoOrgans() {
  return useQuery({
    queryKey: [...PATHO_ORGANS_KEY, "frequent"],
    queryFn: () => searchPathoOrgans({ frequent: true, per: 100 }),
  });
}

export function usePathoCollectionMethods() {
  return useQuery({
    queryKey: [...PATHO_COLLECTION_METHODS_KEY, "list"],
    queryFn: fetchPathoCollectionMethods,
  });
}

export function usePathoCollectionMethodMutations() {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: PATHO_COLLECTION_METHODS_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: PathoCollectionMethodPayload) => createPathoCollectionMethod(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: PathoCollectionMethodPayload }) =>
        updatePathoCollectionMethod(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deletePathoCollectionMethod(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}

// ---- 看護マスタ(MEDIS 看護実践用語標準マスター) ----

const NURSING_ACTS_KEY = ["master", "nursing_acts"];
const NURSING_OBSERVATIONS_KEY = ["master", "nursing_observations"];

export interface NursingActFilters {
  name: string;
  level1_code: string;
  level2_code: string;
}

export function useNursingActSearch(filters: NursingActFilters, page: number, enabled = true) {
  return useQuery({
    queryKey: [...NURSING_ACTS_KEY, "list", filters, page],
    queryFn: () =>
      searchNursingActs({
        name: filters.name || undefined,
        level1_code: filters.level1_code || undefined,
        level2_code: filters.level2_code || undefined,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** 行為(第 3 階層)の一覧。用語選択モーダルは行為までを出し、修飾語は選択後に選ばせる。 */
export function useNursingActActionSearch(filters: NursingActFilters, page: number, enabled = true) {
  return useQuery({
    queryKey: [...NURSING_ACTS_KEY, "actions", filters, page],
    queryFn: () =>
      searchNursingActActions({
        name: filters.name || undefined,
        level1_code: filters.level1_code || undefined,
        level2_code: filters.level2_code || undefined,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/**
 * ある行為の修飾語(第 4 階層)。行を選ばせるのではなく、選んだ行為の中で
 * 修飾語をセレクトから選ぶために使う。1 行為あたい多くても数十件なので全件引く。
 */
export function useNursingActModifiers(level3Code: string | undefined) {
  return useQuery({
    queryKey: [...NURSING_ACTS_KEY, "modifiers", level3Code],
    queryFn: () => searchNursingActs({ level3_code: level3Code as string, per: 100 }),
    enabled: Boolean(level3Code),
    staleTime: Infinity,
  });
}

// 第 1・第 2 階層の一覧。検索の絞り込みと指示簿の見出し名に使う。
// 取込でしか変わらないので使い回す。
export function useNursingActLevels() {
  return useQuery({
    queryKey: [...NURSING_ACTS_KEY, "levels"],
    queryFn: fetchNursingActLevels,
    staleTime: Infinity,
  });
}

export interface NursingObservationFilters {
  name: string;
  category: string;
}

/**
 * 管理番号でまとめて引く(実施入力が、その患者の観察指示ぶんの表現タイプ・単位・
 * 選択肢を 1 往復で揃えるため)。管理番号は一意でない(用語の統合で番号が再利用される)が、
 * サーバー既定の active 絞り込みで旧行は落ちるので、残ったものの先頭を採る。
 * 引けなかった番号は実施入力側で文字入力に落とす。
 */
export function useNursingObservationsByManageNos(manageNos: string[]) {
  const sorted = [...new Set(manageNos)].sort();
  return useQuery({
    queryKey: [...NURSING_OBSERVATIONS_KEY, "by-manage-no", sorted.join(",")],
    queryFn: async () => {
      // サーバーの max_per は 500。指示がそれを超えることは現実的に無い。
      const result = await searchNursingObservations({ manage_no: sorted.join(","), per: 500 });
      const byManageNo = new Map<string, NursingObservation>();
      for (const obs of result.items) {
        if (!byManageNo.has(obs.manage_no)) byManageNo.set(obs.manage_no, obs);
      }
      return byManageNo;
    },
    enabled: sorted.length > 0,
    staleTime: Infinity,
  });
}

export function useNursingObservationSearch(
  filters: NursingObservationFilters,
  page: number,
  enabled = true,
) {
  return useQuery({
    queryKey: [...NURSING_OBSERVATIONS_KEY, "list", filters, page],
    queryFn: () =>
      searchNursingObservations({
        name: filters.name || undefined,
        category: filters.category || undefined,
        page,
        per: 20,
      }),
    placeholderData: keepPreviousData,
    enabled,
  });
}
