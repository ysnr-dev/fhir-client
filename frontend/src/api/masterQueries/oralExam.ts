import { useQuery } from "@tanstack/react-query";
import { fetchOralExamCodes } from "../masterClient";
import { buildOralExamCodeBook } from "../../fhir/oralExamHelpers";

// ---- 口腔診査情報のコード表 ----

// 固定の標準コード表で変わらないので、長めに使い回す。
export function useOralExamCodes() {
  return useQuery({
    queryKey: ["master", "oral_exam_codes", "list"],
    queryFn: fetchOralExamCodes,
    select: (result) => buildOralExamCodeBook(result.items),
    staleTime: 30 * 60 * 1000,
  });
}
