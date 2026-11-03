import { useMemo } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { readResource, searchResource, updateResource } from "../fhirClient";
import { endFlag } from "../../fhir/flagHelpers";
import {
  type AdvisoryRuleMaintenance,
  HEALTH_MAINTENANCE_FLAG_CATEGORY,
  type MaintenanceRecord,
  type MaintenanceRecords,
  maintenanceFlagRuleCode,
} from "../../fhir/healthMaintenanceHelpers";
import { RESULT_ITEM_SYSTEM } from "../../fhir/labResultHelpers";
import { localDay } from "../../lib/dates";
import { resourcesOfType } from "./core";

// 定期検査・検診(docs/advisory-design.md §2.10)の材料。規則の定期項目ごとに最終実施日を 1 件だけ引き、
// 延期・対象外の Flag を 1 回の検索で取る。

/** 項目の最終実施日。種類ごとに引くリソースが違う。記録が無ければ null。 */
async function fetchLastMaintenanceDate(
  patientId: string,
  maintenance: AdvisoryRuleMaintenance,
): Promise<string | null> {
  const params = new URLSearchParams();
  params.set("patient", `Patient/${patientId}`);
  params.set("_sort", "-date");
  params.set("_count", "1");
  switch (maintenance.kind) {
    case "lab": {
      // 結果項目マスタの施設コードで引く(%labs と同じ。施設コードを持たない旧い結果は拾わない)。
      params.set("code", `${RESULT_ITEM_SYSTEM}|${maintenance.code}`);
      params.set("status:not", "entered-in-error,cancelled");
      const result = await searchResource<fhir4.Observation>("Observation", params);
      const obs = resourcesOfType<fhir4.Observation>(result.data, "Observation")[0];
      return obs?.effectiveDateTime ? localDay(obs.effectiveDateTime) : null;
    }
    case "procedure": {
      params.set("code", maintenance.code);
      params.set("status", "completed");
      const result = await searchResource<fhir4.Procedure>("Procedure", params);
      const procedure = resourcesOfType<fhir4.Procedure>(result.data, "Procedure")[0];
      const performed = procedure?.performedDateTime ?? procedure?.performedPeriod?.start;
      return performed ? localDay(performed) : null;
    }
    case "immunization": {
      params.set("vaccine-code", maintenance.code);
      params.set("status", "completed");
      const result = await searchResource<fhir4.Immunization>("Immunization", params);
      const immunization = resourcesOfType<fhir4.Immunization>(result.data, "Immunization")[0];
      return immunization?.occurrenceDateTime ? localDay(immunization.occurrenceDateTime) : null;
    }
  }
}

/** 患者の有効な延期・対象外の Flag。 */
export function useHealthMaintenanceFlags(patientId: string | undefined) {
  const params = new URLSearchParams();
  if (patientId) params.set("patient", `Patient/${patientId}`);
  params.set("category", HEALTH_MAINTENANCE_FLAG_CATEGORY);
  params.set("status", "active");
  params.set("_count", "100");
  const query = useQuery({
    // 注意の登録・終了の invalidate(["Flag", "search"])でこちらも引き直す。
    queryKey: ["Flag", "search", patientId, HEALTH_MAINTENANCE_FLAG_CATEGORY],
    queryFn: () => searchResource<fhir4.Flag>("Flag", params),
    enabled: Boolean(patientId),
    staleTime: 30 * 1000,
  });
  return { ...query, flags: resourcesOfType<fhir4.Flag>(query.data?.data, "Flag") };
}

const NO_RECORDS: MaintenanceRecords = new Map();

/**
 * 定期項目を持つ規則の材料(最終実施日と Flag)を規則のコードごとに揃える。定期項目の無い規則は読まない。
 * 揃うまでは空の Map で isLoading が true。
 */
export function useMaintenanceRecords(
  patientId: string,
  rules: readonly { code: string; maintenance: AdvisoryRuleMaintenance | null }[],
) {
  const items = useMemo(
    () =>
      rules.flatMap((rule) => (rule.maintenance ? [{ code: rule.code, maintenance: rule.maintenance }] : [])),
    [rules],
  );
  const active = Boolean(patientId) && items.length > 0;
  const dates = useQueries({
    queries: items.map((item) => ({
      queryKey: ["health-maintenance", "last", patientId, item.maintenance.kind, item.maintenance.code],
      queryFn: () => fetchLastMaintenanceDate(patientId, item.maintenance),
      enabled: active,
      staleTime: 30 * 1000,
    })),
  });
  const flags = useHealthMaintenanceFlags(active ? patientId : undefined);
  const isLoading = active && (dates.some((query) => query.isPending) || flags.isPending);
  const error = dates.find((query) => query.error)?.error ?? flags.error ?? null;
  // useQueries の結果配列は毎回作り直されるので、更新時刻の並びが変わったときだけ組み直す。
  const datesKey = dates.map((query) => query.dataUpdatedAt).join(",");
  const flagBundle = flags.data?.data;
  const records = useMemo(() => {
    if (!active || isLoading) return NO_RECORDS;
    const activeFlags = resourcesOfType<fhir4.Flag>(flagBundle, "Flag");
    const map = new Map<string, MaintenanceRecord>();
    items.forEach((item, index) => {
      map.set(item.code, {
        lastDate: dates[index].data ?? null,
        flag: activeFlags.find((flag) => maintenanceFlagRuleCode(flag) === item.code) ?? null,
      });
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, isLoading, items, datesKey, flagBundle]);
  return { records, isLoading, error };
}

/** 延期・対象外を解除する(Flag を終了にする)。読み直した版で更新する。 */
export function useEndFlag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (flagId: string) => {
      const current = await readResource<fhir4.Flag>("Flag", flagId);
      return updateResource(endFlag(current.data), current.etag ?? "");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["Flag", "search"] });
    },
  });
}
