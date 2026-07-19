import { useMutation } from "@tanstack/react-query";
import { importMaster, type MasterType } from "./masterClient";

export function useImportMaster() {
  return useMutation({
    mutationFn: ({ masterType, file }: { masterType: MasterType; file: File }) =>
      importMaster(masterType, file),
  });
}
