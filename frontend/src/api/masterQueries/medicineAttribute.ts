import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createMedicineAttribute,
  deleteMedicineAttribute,
  fetchMedicineAttributes,
  lookupMedicineAttributes,
  type MedicineAttributePayload,
  updateMedicineAttribute,
} from "../masterClient";

const MEDICINE_ATTRIBUTES_KEY = ["master", "medicine_attributes"];
const EMPTY_CODES: ReadonlySet<string> = new Set();

export function useMedicineAttributes(includeDefaults: boolean) {
  return useQuery({
    queryKey: [...MEDICINE_ATTRIBUTES_KEY, "list", includeDefaults],
    queryFn: () => fetchMedicineAttributes(includeDefaults),
  });
}

/**
 * 渡した薬のうち、ロット番号を記録する薬(薬剤付加情報の lot_required の実効値が真)のコード。
 * 実施入力の行にロット欄を出すかどうかに使う。設定は日に何度も変わらないのでしばらく持つ。
 */
export function useLotRequiredCodes(medicineCodes: string[]): ReadonlySet<string> {
  const codes = Array.from(new Set(medicineCodes.filter(Boolean))).sort();
  const { data } = useQuery({
    queryKey: [...MEDICINE_ATTRIBUTES_KEY, "lookup", codes],
    queryFn: async () => {
      const flags = await lookupMedicineAttributes(codes);
      return new Set(codes.filter((code) => flags.get(code)?.lot_required));
    },
    enabled: codes.length > 0,
    staleTime: 5 * 60 * 1000,
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
