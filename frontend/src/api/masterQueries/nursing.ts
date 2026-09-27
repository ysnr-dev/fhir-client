import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import {
  fetchNursingActLevels,
  type NursingObservation,
  searchNursingActActions,
  searchNursingActs,
  searchNursingObservations,
  searchPostalCodes,
} from "../masterClient";

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
 * サーバー既定の active 絞り込みで無効になった行は落ちるので、残ったものの先頭を採る。
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

/**
 * 郵便番号から住所を引く。入力のたびではなくボタンで引くので mutation にする
 * (同じ郵便番号をもう一度押したときも引き直せる)。
 * 1 つの郵便番号が複数の町域を表すことがあるので、返るのは常に一覧。
 */
export function usePostalCodeLookup() {
  return useMutation({
    mutationFn: (digits: string) => searchPostalCodes({ postal_code: digits, per: 100 }),
  });
}
