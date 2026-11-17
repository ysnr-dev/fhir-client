import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  haiJudgmentsByTarget,
  positiveCulturesOf,
  type HaiJudgment,
  type PositiveCulture,
} from "../../fhir/haiSurveillanceHelpers";
import {
  LINE_DRAIN_CATEGORY,
  LINE_DRAIN_CATEGORY_SYSTEM,
  parseLineDrain,
  type LineDrainRecord,
} from "../../fhir/lineDrainHelpers";
import { postBundle } from "../fhirClient";
import { searchExtractRecords } from "./extractRecords";
import { fetchMicroExtract } from "./microExtract";

// ---- 医療関連感染サーベイランス(docs/hai-surveillance-design.md) ----
// 手術部位感染の対象(手術の実施記録)と判定は NCD 症例登録と同じ検索(useNcdSurgeries)で届く
// (判定の Observation はハブを partOf で指すので、測定値と同じ _revinclude に乗る)。
// ここには術後の培養陽性、病棟 × 月の留置と判定、判定の保存を置く。

export interface SsiCultures {
  cultures: PositiveCulture[];
  truncated: boolean;
}

/** 候補の患者の、採取日が from〜to の細菌検査結果のうち分離菌のあるもの(判定の手がかり)。 */
export function useSsiCultures(patientIds: string[], from: string, to: string) {
  const ids = [...new Set(patientIds.filter(Boolean))].sort();
  return useQuery({
    queryKey: ["DiagnosticReport", "search", "ssi-cultures", from, to, ids.join(",")],
    queryFn: async (): Promise<SsiCultures> => {
      if (ids.length === 0) return { cultures: [], truncated: false };
      const result = await fetchMicroExtract({ from, to, patientIds: ids }, new AbortController().signal);
      return {
        cultures: positiveCulturesOf(result.reports, result.observations, result.specimens),
        truncated: result.truncated,
      };
    },
    enabled: Boolean(from) && Boolean(to),
    placeholderData: keepPreviousData,
  });
}

export interface WardDeviceInfections {
  records: LineDrainRecord[];
  /** 留置の id → 判定。 */
  judgments: Map<string, HaiJudgment>;
  truncated: boolean;
}

/**
 * 病棟に居た患者の、期間と重なる留置と感染の判定。デバイス日数(分母)と感染件数(分子)を同じ読み込みから
 * 数えるので、読み切れなかったら truncated を立てて表を出さない(呼ぶ側)。
 */
export function useWardDeviceInfections(patientIds: string[], from: string, to: string) {
  const ids = [...new Set(patientIds.filter(Boolean))].sort();
  return useQuery({
    queryKey: ["Procedure", "search", "line-drain", "hai", from, to, ids.join(",")],
    queryFn: async (): Promise<WardDeviceInfections> => {
      if (ids.length === 0) return { records: [], judgments: new Map(), truncated: false };
      const params = new URLSearchParams();
      params.set("category", `${LINE_DRAIN_CATEGORY_SYSTEM}|${LINE_DRAIN_CATEGORY.code}`);
      params.set("status:not", "entered-in-error");
      params.append("date", `ge${from}`);
      params.append("date", `le${to}`);
      params.append("_revinclude", "Observation:part-of");
      params.set("_sort", "-date");
      const { matches, included, truncated } = await searchExtractRecords<fhir4.Procedure>(
        "Procedure",
        params,
        ids,
        new AbortController().signal,
      );
      const observations = included.filter((r): r is fhir4.Observation => r.resourceType === "Observation");
      return {
        records: matches.map((p) => parseLineDrain(p, [])).filter((r): r is LineDrainRecord => r !== null),
        judgments: haiJudgmentsByTarget(observations),
        truncated,
      };
    },
    placeholderData: keepPreviousData,
  });
}

function invalidateJudgments(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["Procedure", "search"] });
  queryClient.invalidateQueries({ queryKey: ["Observation", "search"] });
}

/** 判定の登録・更新の transaction を送る(ビルダーが組んだ Bundle。更新は版が ifMatch に付いている)。 */
export function useSaveHaiJudgment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bundle: fhir4.Bundle) => postBundle(bundle),
    onSuccess: () => invalidateJudgments(queryClient),
  });
}

export function useDeleteHaiJudgment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      postBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: [{ request: { method: "DELETE", url: `Observation/${id}` } }],
      }),
    onSuccess: () => invalidateJudgments(queryClient),
  });
}
