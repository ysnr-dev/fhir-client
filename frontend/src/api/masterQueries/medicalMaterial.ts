import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  type CommentRelation,
  fetchCommentRelations,
  searchMedicalMaterials,
  searchMedicalProcedures,
} from "../masterClient";

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

const MEDICAL_PROCEDURES_KEY = ["master", "medical_procedures"];

/** 医科診療行為(手技料)の検索。実施入力で手技を確定するために引く。 */
const EMPTY_COMMENT_RELATIONS: CommentRelation[] = [];

/**
 * 診療行為コードに関係するコメントコードの候補(コメント関連テーブル)。
 * 9 桁のコードが 1 つも無ければ問い合わせない。
 */
export function useCommentRelations(procedureCodes: string[]) {
  const codes = Array.from(new Set(procedureCodes.filter((c) => /^\d{9}$/.test(c)))).sort();
  const query = useQuery({
    queryKey: ["master", "comment_relations", codes],
    queryFn: () => fetchCommentRelations(codes),
    enabled: codes.length > 0,
    staleTime: Infinity,
  });
  return { ...query, items: query.data?.items ?? EMPTY_COMMENT_RELATIONS };
}

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
