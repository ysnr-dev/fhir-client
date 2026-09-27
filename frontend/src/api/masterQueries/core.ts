import { useMutation, useQueryClient } from "@tanstack/react-query";
import { importMaster, type MasterType } from "../masterClient";

export function useImportMaster() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ masterType, file }: { masterType: MasterType; file: File }) =>
      importMaster(masterType, file),
    // 取込は複数のマスタに波及しうる(頻用コードと部品コードなど)ので、選択肢の
    // キャッシュ(staleTime: Infinity)ごとマスタ全体を引き直させる。
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["master"] });
    },
  });
}
