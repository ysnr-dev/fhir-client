import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  DEFAULT_EARLY_WARNING,
  earlyWarningFromObservation,
  type EarlyWarningSummary,
} from "../../fhir/earlyWarningHelpers";
import { EWS_ALERT_TASK_CODE } from "../../fhir/earlyWarningTaskHelpers";
import { TASK_CODE_SYSTEM } from "../../fhir/taskHelpers";
import { EARLY_WARNING_SCORE_SYSTEM, NEWS2_CODE } from "../../fhir/vitalHelpers";
import { addDays, today } from "../../lib/dates";
import { searchResource } from "../fhirClient";
import { resourcesOfType } from "./core";
import { useFacilitySettings } from "./organization";

// 早期警告スコア(NEWS2)。測定セットに同梱した NEWS2 の Observation と、早期警告の通知を引く。
// 設計は docs/early-warning-design.md。

const NEWS2_CODE_PARAM = `${EARLY_WARNING_SCORE_SYSTEM}|${NEWS2_CODE}`;
const EWS_ALERT_CODE_PARAM = `${TASK_CODE_SYSTEM}|${EWS_ALERT_TASK_CODE.code}`;

/** 一覧・患者帯に出す NEWS2 の鮮度。これより古い測定は「最新」として出さない。 */
const LATEST_DAYS = 3;
/** 患者を OR で並べる塊の大きさ(URL の長さと 1 応答の件数を抑える)。 */
const PATIENT_CHUNK = 10;

export function useEarlyWarningSettings() {
  const settings = useFacilitySettings();
  return settings.data?.early_warning ?? DEFAULT_EARLY_WARNING;
}

/** 入院ごとの未対応の早期警告(入院 id → Task)。測定の保存で出し直す・取り下げるのに使う。 */
export async function fetchOpenEwsAlertTasks(encounterIds: string[]): Promise<Map<string, fhir4.Task>> {
  const result = new Map<string, fhir4.Task>();
  const ids = [...new Set(encounterIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += PATIENT_CHUNK) {
    const chunk = ids.slice(i, i + PATIENT_CHUNK);
    const params = new URLSearchParams();
    params.set("code", EWS_ALERT_CODE_PARAM);
    params.set("encounter", chunk.map((id) => `Encounter/${id}`).join(","));
    params.set("status", "requested");
    params.set("_count", String(chunk.length * 5));
    const { data } = await searchResource<fhir4.Task>("Task", params);
    for (const task of resourcesOfType<fhir4.Task>(data, "Task")) {
      const encounterId = task.encounter?.reference?.match(/^Encounter\/(.+)$/)?.[1];
      if (!encounterId) continue;
      const current = result.get(encounterId);
      if (!current || (task.authoredOn ?? "") > (current.authoredOn ?? "")) result.set(encounterId, task);
    }
  }
  return result;
}

/** この NEWS2 を指す未対応の早期警告。測定を消すときに取り下げる。 */
export async function fetchOpenEwsAlertTasksByFocus(observationIds: string[]): Promise<fhir4.Task[]> {
  if (observationIds.length === 0) return [];
  const params = new URLSearchParams();
  params.set("code", EWS_ALERT_CODE_PARAM);
  params.set("focus", observationIds.map((id) => `Observation/${id}`).join(","));
  params.set("status", "requested");
  params.set("_count", "20");
  const { data } = await searchResource<fhir4.Task>("Task", params);
  return resourcesOfType<fhir4.Task>(data, "Task");
}

function latestParams(params: URLSearchParams) {
  params.set("code", NEWS2_CODE_PARAM);
  params.set("date", `ge${addDays(today(), -LATEST_DAYS)}`);
  params.set("_sort", "-date");
}

/** 患者の最新の NEWS2(直近 3 日)。患者帯のピクトグラムが読む。 */
export function useLatestEarlyWarning(patientId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["Observation", "search", "early-warning-latest", patientId],
    queryFn: async (): Promise<EarlyWarningSummary | null> => {
      const params = new URLSearchParams();
      params.set("patient", `Patient/${patientId}`);
      latestParams(params);
      params.set("_count", "1");
      const { data } = await searchResource<fhir4.Observation>("Observation", params);
      const observation = resourcesOfType<fhir4.Observation>(data, "Observation")[0];
      return observation ? earlyWarningFromObservation(observation) : null;
    },
    enabled: Boolean(patientId) && enabled,
  });
}

/** 患者ごとの最新の NEWS2(直近 3 日)。入院患者一覧の列が読む。 */
export function useLatestEarlyWarningByPatient(patientIds: string[]) {
  const ids = [...new Set(patientIds)].sort();
  return useQuery({
    queryKey: ["Observation", "search", "early-warning-latest-by-patient", ids],
    queryFn: async (): Promise<Map<string, EarlyWarningSummary>> => {
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += PATIENT_CHUNK) chunks.push(ids.slice(i, i + PATIENT_CHUNK));
      const bundles = await Promise.all(
        chunks.map((chunk) => {
          const params = new URLSearchParams();
          params.set("patient", chunk.map((id) => `Patient/${id}`).join(","));
          latestParams(params);
          params.set("_count", "500");
          return searchResource<fhir4.Observation>("Observation", params);
        }),
      );
      const result = new Map<string, EarlyWarningSummary>();
      for (const { data } of bundles) {
        // 新しい順に並んでいるので、患者ごとに最初の 1 件を採る。
        for (const observation of resourcesOfType<fhir4.Observation>(data, "Observation")) {
          const patientId = observation.subject?.reference?.match(/^Patient\/(.+)$/)?.[1];
          if (!patientId || result.has(patientId)) continue;
          const summary = earlyWarningFromObservation(observation);
          if (summary) result.set(patientId, summary);
        }
      }
      return result;
    },
    enabled: ids.length > 0,
    placeholderData: keepPreviousData,
  });
}
