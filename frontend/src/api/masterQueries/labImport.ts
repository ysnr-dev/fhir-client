import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  bulkUpdateLabResultImportRows,
  createLabResultImport,
  deleteLabResultImport,
  fetchLabResultImport,
  fetchLabResultImports,
  type LabResultImportDetail,
  type LabResultImportRow,
  type LabResultImportRowPayload,
  resolveLabResultImport,
  updateLabResultImportRow,
} from "../masterClient";
import { LAB_RESULT_ITEMS_KEY } from "./medicine";

// ---- 検体検査結果の取込 ----

const LAB_RESULT_IMPORTS_KEY = ["master", "lab_result_imports"];

export function useLabResultImports(page: number) {
  return useQuery({
    queryKey: [...LAB_RESULT_IMPORTS_KEY, "list", page],
    queryFn: () => fetchLabResultImports(page),
    placeholderData: keepPreviousData,
  });
}

export function useLabResultImport(id: number | undefined) {
  return useQuery({
    queryKey: [...LAB_RESULT_IMPORTS_KEY, "detail", id],
    queryFn: () => fetchLabResultImport(id as number),
    enabled: Boolean(id),
  });
}

/**
 * 取込画面の書き込み一式。行の更新は 1 行の操作が同じ外部コードの他の行にも及ぶため、
 * 応答の行でキャッシュを差し替える(全体を引き直さない)。
 */
export function useLabResultImportMutations() {
  const queryClient = useQueryClient();

  const patchRows = (rows: LabResultImportRow[]) => {
    if (rows.length === 0) return;
    const importId = rows[0].lab_result_import_id;
    queryClient.setQueryData<LabResultImportDetail>(
      [...LAB_RESULT_IMPORTS_KEY, "detail", importId],
      (current) => {
        if (!current) return current;
        const updated = new Map(rows.map((row) => [row.id, row]));
        return { ...current, rows: current.rows.map((row) => updated.get(row.id) ?? row) };
      },
    );
    // 一覧の件数(保留 / 登録待ち / 登録済み)は行の状態で変わる。
    queryClient.invalidateQueries({ queryKey: [...LAB_RESULT_IMPORTS_KEY, "list"] });
  };

  const importFile = useMutation({
    mutationFn: ({ file, encoding }: { file: File; encoding: string }) =>
      createLabResultImport(file, encoding),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LAB_RESULT_IMPORTS_KEY });
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => deleteLabResultImport(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LAB_RESULT_IMPORTS_KEY });
    },
  });

  const resolve = useMutation({
    mutationFn: (id: number) => resolveLabResultImport(id),
    onSuccess: (result) => patchRows(result.rows),
  });

  const updateRow = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: LabResultImportRowPayload }) =>
      updateLabResultImportRow(id, payload),
    onSuccess: (result, variables) => {
      patchRows(result.rows);
      // マスタの JLAC を育てたときは結果項目のキャッシュも古くなる。
      if (variables.payload.write_to_master) {
        queryClient.invalidateQueries({ queryKey: LAB_RESULT_ITEMS_KEY });
      }
    },
  });

  const bulkUpdateRows = useMutation({
    mutationFn: ({ ids, payload }: { ids: number[]; payload: LabResultImportRowPayload }) =>
      bulkUpdateLabResultImportRows(ids, payload),
    onSuccess: (result) => patchRows(result.rows),
  });

  return { importFile, remove, resolve, updateRow, bulkUpdateRows };
}
