import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MedicineDoseConversionMap } from "../../fhir/doseConversionHelpers";
import {
  createMedicineDoseConversion,
  deleteMedicineDoseConversion,
  fetchMedicineTypeOptions,
  fetchMedicineUsageCategories,
  generateMedicineDoseConversions,
  fetchYakkaCodes,
  type MedicineDoseConversionPayload,
  searchMedicineDoseConversions,
  searchMedicines,
  searchMedicineUsages,
  searchUnmappedMedicines,
  updateMedicineDoseConversion,
} from "../masterClient";

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

export const MASTER_SEARCH_PER = 10;
// メンテ画面は一覧をじっくり見る画面なので検索モーダルより多く出す。
const DOSE_CONVERSION_PER = 20;
// 換算行と未紐付け一覧はどちらも generate / CRUD で同時に変わるのでまとめて破棄する。
const DOSE_CONVERSIONS_KEY = ["master", "medicine_dose_conversions"];

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

/** レセプト電算コード → 薬価基準コード(`fetchYakkaCodes`)。コードが無ければ引かない。 */
export function useYakkaCodes(medicineCodes: string[]) {
  const codes = Array.from(new Set(medicineCodes)).sort();
  return useQuery({
    queryKey: ["master", "medicines", "yakka-codes", codes],
    queryFn: () => fetchYakkaCodes(codes),
    staleTime: Infinity,
    enabled: codes.length > 0,
  });
}

/**
 * 医薬品コード → 入力単位(mg・g・mL…)→ 1 [薬価算定単位] あたりの量と、薬価算定単位。
 * 化学療法の投与量(mg/m² から出した mg)を製剤数に直す払出、注射の総投与量・経過表の
 * 水分出納(製剤数・力価 → mL)が使う。mL 行も含めて全単位を引く。
 */
export function useMedicineDoseFactors(medicineCodes: string[]) {
  const codes = Array.from(new Set(medicineCodes)).sort();

  return useQuery({
    queryKey: ["master", "medicine_dose_conversions", "all-units", codes],
    queryFn: async (): Promise<MedicineDoseConversionMap> => {
      const result = await searchMedicineDoseConversions({ medicine_code: codes.join(","), per: 100 });
      const factors = new Map<string, Map<string, number>>();
      const packUnits = new Map<string, string>();
      for (const row of result.items) {
        const factor = Number(row.factor);
        if (!(factor > 0)) continue;
        const byUnit = factors.get(row.medicine_code) ?? new Map<string, number>();
        byUnit.set(row.from_unit, factor);
        factors.set(row.medicine_code, byUnit);
        if (row.to_unit) packUnits.set(row.medicine_code, row.to_unit);
      }
      return { factors, packUnits };
    },
    staleTime: Infinity,
    enabled: codes.length > 0,
  });
}

// 検体検査オーダーのマスタ群 ------------------------------------------------

// オーダー項目・パネル構成は同じ詳細画面で同時に変わるのでまとめて破棄する。
export const LAB_ORDER_ITEMS_KEY = ["master", "lab_order_items"];
export const LAB_RESULT_ITEMS_KEY = ["master", "lab_result_items"];
export const LAB_SPECIMENS_KEY = ["master", "lab_specimens"];
export const LAB_CONTAINERS_KEY = ["master", "lab_containers"];
export const LAB_LAYOUTS_KEY = ["master", "lab_order_item_layouts"];
