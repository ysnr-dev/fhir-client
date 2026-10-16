import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createMedicineAttribute,
  deleteMedicineAttribute,
  fetchMedicineAttributes,
  lookupMedicineAttributes,
  type MedicineAttributeFlags,
  type MedicineAttributePayload,
  updateMedicineAttribute,
} from "../masterClient";

const MEDICINE_ATTRIBUTES_KEY = ["master", "medicine_attributes"];
const EMPTY_CODES: ReadonlySet<string> = new Set();
const EMPTY_FLAGS: ReadonlyMap<string, MedicineAttributeFlags> = new Map();

export function useMedicineAttributes(includeDefaults: boolean) {
  return useQuery({
    queryKey: [...MEDICINE_ATTRIBUTES_KEY, "list", includeDefaults],
    queryFn: () => fetchMedicineAttributes(includeDefaults),
  });
}

/** lookup のクエリキー。設定は日に何度も変わらないのでしばらく持つ。 */
function lookupQuery(codes: string[]) {
  return {
    queryKey: [...MEDICINE_ATTRIBUTES_KEY, "lookup", codes],
    queryFn: () => lookupMedicineAttributes(codes),
    enabled: codes.length > 0,
    staleTime: 5 * 60 * 1000,
  };
}

function normalizedCodes(medicineCodes: string[]): string[] {
  return Array.from(new Set(medicineCodes.filter(Boolean))).sort();
}

/** 渡した薬の項目の実効値(医薬品コード → 値)。処方・注射の警告と届出の通知が参照する。 */
export function useMedicineAttributeLookup(medicineCodes: string[]): ReadonlyMap<string, MedicineAttributeFlags> {
  const { data } = useQuery(lookupQuery(normalizedCodes(medicineCodes)));
  return data ?? EMPTY_FLAGS;
}

/**
 * 渡した薬のうち、ロット番号を記録する薬(薬剤付加情報の lot_required の実効値が真)のコード。
 * 実施入力の行にロット欄を出すかどうかに使う。
 */
export function useLotRequiredCodes(medicineCodes: string[]): ReadonlySet<string> {
  const codes = normalizedCodes(medicineCodes);
  const { data } = useQuery({
    ...lookupQuery(codes),
    select: (flags: Map<string, MedicineAttributeFlags>) =>
      new Set(codes.filter((code) => flags.get(code)?.lot_required)) as ReadonlySet<string>,
  });
  return data ?? EMPTY_CODES;
}

export function useMedicineAttributeMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: MEDICINE_ATTRIBUTES_KEY });

  return {
    create: useMutation({
      mutationFn: (payload: MedicineAttributePayload) => createMedicineAttribute(payload),
      retry: false,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, payload }: { id: number; payload: MedicineAttributePayload }) =>
        updateMedicineAttribute(id, payload),
      retry: false,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: number) => deleteMedicineAttribute(id),
      retry: false,
      onSuccess: invalidate,
    }),
  };
}
