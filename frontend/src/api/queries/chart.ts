import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { INJECTION_ORDER_TYPE } from "../../fhir/injectionHelpers";
import { ORDER_TYPE_SYSTEM } from "../../fhir/orderHeader";
import { PRESCRIPTION_CATEGORY_SYSTEM } from "../../fhir/prescriptionHelpers";
import { addDays } from "../../fhir/scheduleHelpers";
import { ORAL_LOOKBACK_DAYS, resourcesOfType, searchAllPages } from "./core";

// ---- チャート(数値の推移と治療イベントを重ねて読む画面) ----

const CHART_OBSERVATION_PAGE = 500;
const CHART_OBSERVATION_MAX_PAGES = 4;

async function fetchChartObservations(
  patientId: string,
  codeParam: string,
  rangeStart: string,
  rangeEnd: string,
): Promise<fhir4.Observation[]> {
  const params = new URLSearchParams();
  params.set("patient", `Patient/${patientId}`);
  // 項目のコードをまとめて OR で引く(検体検査・バイタル・テンプレート抽出が混ざる)。
  params.set("code", codeParam);
  // 日付だけの値は上流が施設のタイムゾーンで日の範囲に広げて解釈する。
  params.append("date", `ge${rangeStart}`);
  params.append("date", `le${rangeEnd}`);
  // グラフに出せない状態は上流で落とす。
  params.set("status:not", "entered-in-error,cancelled");
  // 新しい順に読み、上限で切れるときは古い側を落とす(返すのは古い順)。
  params.set("_sort", "-date");
  const { matches } = await searchAllPages<fhir4.Observation>("Observation", params, {
    page: CHART_OBSERVATION_PAGE,
    maxPages: CHART_OBSERVATION_MAX_PAGES,
  });
  return matches.reverse();
}

/**
 * チャートに出す Observation。項目の coding をまとめて 1 回の検索で引く。
 *
 * 検体検査の時系列表(useLabResultTimeline)は DiagnosticReport 起点だが、こちらは
 * バイタルやテンプレート抽出(報告書を持たない)も同じ表に載せるので Observation を直接引く。
 */
export function usePatientChartObservations(
  patientId: string | undefined,
  codings: fhir4.Coding[],
  rangeStart: string,
  rangeEnd: string,
) {
  const codeParam = codings.map((coding) => `${coding.system}|${coding.code}`).join(",");
  return useQuery({
    // 登録・更新・削除の invalidateQueries(["Observation", "search"]) でまとめて
    // 無効化されるよう search 配下のキーにしている。
    queryKey: ["Observation", "search", "patient-chart", patientId, codeParam, rangeStart, rangeEnd],
    queryFn: () => fetchChartObservations(patientId ?? "", codeParam, rangeStart, rangeEnd),
    enabled: Boolean(patientId) && Boolean(codeParam) && Boolean(rangeStart) && Boolean(rangeEnd),
    placeholderData: keepPreviousData,
  });
}

const CHART_PROCEDURE_PAGE = 500;
const CHART_PROCEDURE_MAX_PAGES = 4;

async function fetchChartProcedures(
  patientId: string,
  categoryParam: string,
  rangeStart: string,
  rangeEnd: string,
): Promise<fhir4.Procedure[]> {
  const params = new URLSearchParams();
  params.set("patient", `Patient/${patientId}`);
  params.set("category", categoryParam);
  params.append("date", `ge${rangeStart}`);
  params.append("date", `le${rangeEnd}`);
  // 2 件目以降の手技(partOf 付き)はハブと同じ日時なので、ハブだけをイベントにする。
  params.set("part-of:missing", "true");
  params.set("status:not", "entered-in-error,not-done");
  // 新しい順に読み、上限で切れるときは古い側を落とす(返すのは古い順)。
  params.set("_sort", "-date");
  const { matches } = await searchAllPages<fhir4.Procedure>("Procedure", params, {
    page: CHART_PROCEDURE_PAGE,
    maxPages: CHART_PROCEDURE_MAX_PAGES,
  });
  return matches.reverse();
}

/**
 * チャートのイベント帯に出す検査・注射の実施記録(ハブ Procedure)を種別ごとに引く。
 *
 * 経過表の usePatientExamOrders はオーダーから `_revinclude` で実施記録まで辿るが、
 * チャートは年単位の範囲を見るので件数が多く、実施記録そのものを検索してページングする。
 * ハブの code は 1 件目の手技(検査名)なので、名前はこれだけで出せる。
 */
export function usePatientPerformedProcedures(
  patientId: string | undefined,
  orderTypeCodes: string[],
  rangeStart: string,
  rangeEnd: string,
) {
  const categoryParam = orderTypeCodes.map((code) => `${ORDER_TYPE_SYSTEM}|${code}`).join(",");
  return useQuery({
    queryKey: ["Procedure", "search", "patient-chart", patientId, categoryParam, rangeStart, rangeEnd],
    queryFn: () => fetchChartProcedures(patientId ?? "", categoryParam, rangeStart, rangeEnd),
    enabled:
      Boolean(patientId) && Boolean(categoryParam) && Boolean(rangeStart) && Boolean(rangeEnd),
    placeholderData: keepPreviousData,
  });
}

const CHART_PRESCRIPTION_PAGE = 500;
const CHART_PRESCRIPTION_MAX_PAGES = 4;

export interface ChartPrescriptions {
  orders: fhir4.ServiceRequest[];
  medicationRequests: fhir4.MedicationRequest[];
  /** 進捗の Task(中止したオーダーを見分けるのに使う)。 */
  tasks: fhir4.Task[];
  /** 取得の上限に達し、期間の後ろのオーダーを取りこぼしている。 */
  truncated: boolean;
}

async function fetchChartMedicationOrders(
  patientId: string,
  category: string,
  lookbackDays: number,
  rangeStart: string,
  rangeEnd: string,
): Promise<ChartPrescriptions> {
  const params = new URLSearchParams();
  params.set("patient", `Patient/${patientId}`);
  params.set("category", category);
  params.append("occurrence", `ge${addDays(rangeStart, -lookbackDays)}`);
  params.append("occurrence", `le${rangeEnd}`);
  params.set("status:not", "revoked,entered-in-error");
  params.append("_revinclude", "MedicationRequest:based-on");
  params.append("_revinclude", "Task:focus");
  params.set("_sort", "occurrence");
  const { matches, bundles, truncated } = await searchAllPages<fhir4.ServiceRequest>("ServiceRequest", params, {
    page: CHART_PRESCRIPTION_PAGE,
    maxPages: CHART_PRESCRIPTION_MAX_PAGES,
  });
  return {
    orders: matches,
    medicationRequests: bundles.flatMap((bundle) =>
      resourcesOfType<fhir4.MedicationRequest>(bundle, "MedicationRequest"),
    ),
    tasks: bundles.flatMap((bundle) => resourcesOfType<fhir4.Task>(bundle, "Task")),
    truncated,
  };
}

/**
 * チャートのイベント帯に出す処方。投薬と検査値・血圧の前後関係を読むためのものなので、
 * 薬剤(MedicationRequest)まで引いて**飲んでいた期間**を出せるようにする。
 */
export function usePatientChartPrescriptions(
  patientId: string | undefined,
  rangeStart: string,
  rangeEnd: string,
) {
  return useQuery({
    queryKey: ["ServiceRequest", "search", "patient-chart-rx", patientId, rangeStart, rangeEnd],
    queryFn: () =>
      fetchChartMedicationOrders(
        patientId ?? "",
        // 処方はオーダー種別(order-type)を持たず、処方区分の system で見分ける。
        `${PRESCRIPTION_CATEGORY_SYSTEM}|`,
        // 飲み始めが範囲より前でも、範囲に掛かっていれば出したいので少し遡って引く。
        ORAL_LOOKBACK_DAYS,
        rangeStart,
        rangeEnd,
      ),
    enabled: Boolean(patientId) && Boolean(rangeStart) && Boolean(rangeEnd),
    placeholderData: keepPreviousData,
  });
}

/**
 * チャートの薬剤の行に出す注射オーダー(1 日 1 オーダー)。化学療法の日オーダーも
 * 注射オーダーなので含まれる。
 */
export function usePatientChartInjections(
  patientId: string | undefined,
  rangeStart: string,
  rangeEnd: string,
) {
  return useQuery({
    queryKey: ["ServiceRequest", "search", "patient-chart-injection", patientId, rangeStart, rangeEnd],
    queryFn: () =>
      fetchChartMedicationOrders(
        patientId ?? "",
        `${ORDER_TYPE_SYSTEM}|${INJECTION_ORDER_TYPE.code}`,
        0,
        rangeStart,
        rangeEnd,
      ),
    enabled: Boolean(patientId) && Boolean(rangeStart) && Boolean(rangeEnd),
    placeholderData: keepPreviousData,
  });
}
