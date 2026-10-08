import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  fetchDpcClassifications,
  fetchDpcEditions,
  fetchDpcIcdCodes,
  postDpcCoding,
  type DpcCodingInputs,
  type DpcCodingOverrides,
} from "../masterClient";

// サーバーと同じ表記(半角大文字・小数点なし)にそろえる。返る icd10 がこの表記なので、
// 呼び出し側もこの表記で結果を引く。
export function normalizeDpcIcd10(icd10: string): string {
  return icd10
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * ICD-10 → 診断群分類上6桁の配列。キーは normalizeDpcIcd10 でそろえた ICD-10 で、
 * 対応表に無いコードはキーごと出ない。icd10s が空なら問い合わせない。
 */
export function useDpcMdc6(icd10s: string[]) {
  const codes = [...new Set(icd10s.map(normalizeDpcIcd10).filter(Boolean))].sort();

  return useQuery({
    queryKey: ["master", "dpc_icd_codes", codes],
    queryFn: async () => {
      const byIcd: Record<string, string[]> = {};
      for (const item of await fetchDpcIcdCodes(codes)) {
        const list = (byIcd[item.icd10] ??= []);
        if (!list.includes(item.mdc6)) list.push(item.mdc6);
      }
      return byIcd;
    },
    staleTime: Infinity,
    enabled: codes.length > 0,
  });
}

/**
 * 入院 1 件の診断群分類の判定。様式1 の値・上書きが変わるたびに引き直す(呼び出し側で
 * 入力を間引く)。引き直している間は前の結果を出したままにする。
 */
export function useDpcCoding(
  encounterId: string | undefined,
  inputs: DpcCodingInputs,
  overrides: DpcCodingOverrides,
  active = true,
) {
  return useQuery({
    queryKey: ["master", "dpc_coding", encounterId, inputs, overrides],
    queryFn: () => postDpcCoding({ encounter_id: encounterId ?? "", inputs, overrides }),
    enabled: Boolean(encounterId) && active,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export function useDpcEditions() {
  return useQuery({ queryKey: ["master", "dpc_tables"], queryFn: fetchDpcEditions });
}

export function useDpcClassifications(params: { q?: string; mdc6?: string; on?: string }) {
  return useQuery({
    queryKey: ["master", "dpc_classifications", params],
    queryFn: () => fetchDpcClassifications(params),
    enabled: Boolean(params.q || params.mdc6),
    placeholderData: keepPreviousData,
  });
}
