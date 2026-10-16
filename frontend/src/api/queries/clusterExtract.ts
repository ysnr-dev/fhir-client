import { leafHitsOf, leafSearch, type ExtractLeaf, type ExtractRecord, type LeafHits } from "../../fhir/extractQueryHelpers";
import { runWithConcurrency } from "../../lib/concurrency";
import { today } from "../../lib/dates";
import {
  DETAIL_PATIENT_CHUNK,
  EXTRACT_DETAIL_MAX_REQUESTS,
  ExtractLimitError,
  LEAF_CONCURRENCY,
  fetchAll,
  resolveLeaf,
  type RunContext,
} from "./extractQuery";
import { fetchMissingPatients, useRecordExtract } from "./extractRecords";

// データ抽出の「クラスタ」タブ(docs/data-extract-design.md §22)の読み込み。クラスタの患者は先に
// resolvePatientScope で解いておき、ここでは患者を読み、指標(「患者」タブの条件 1 件ずつ)の記録を
// その患者に絞って読み切る(subject= に 100 人ずつ。検索の条件は「患者」タブと同じ)。
// 読み切れない指標があれば、件数・該当の割合が嘘になるので結果を出さない。

export interface ClusterExtractCriteria {
  patientIds: string[];
  metrics: { leaf: ExtractLeaf; name: string }[];
}

export interface ClusterMetricResult {
  leaf: ExtractLeaf;
  name: string;
  /** 患者ごとの件数・最初・最後・最新。 */
  hits: LeafHits;
  /** 検査結果の患者ごとの最新の数値(数値でない結果の患者は持たない)。検査結果の指標だけ。 */
  values?: Map<string, number>;
  /** 検査結果の単位(最も多いもの)。 */
  unit?: string;
}

export interface ClusterExtractResult {
  patients: Map<string, fhir4.Patient>;
  patientIds: string[];
  metrics: ClusterMetricResult[];
}

function patientIdOf(record: ExtractRecord): string {
  return record.resourceType === "Patient" ? (record.id ?? "") : (record.subject?.reference?.split("/").pop() ?? "");
}

/** 検査結果の患者ごとの最新の数値と、最も多い単位。 */
export function latestObservationValues(records: ExtractRecord[]): { values: Map<string, number>; unit: string } {
  const latest = new Map<string, { date: string; value: number }>();
  const units = new Map<string, number>();
  for (const record of records) {
    if (record.resourceType !== "Observation") continue;
    const value = record.valueQuantity?.value;
    const patientId = patientIdOf(record);
    if (value == null || !patientId) continue;
    const unit = record.valueQuantity?.unit ?? "";
    if (unit) units.set(unit, (units.get(unit) ?? 0) + 1);
    const date = record.effectiveDateTime ?? "";
    const current = latest.get(patientId);
    if (!current || date >= current.date) latest.set(patientId, { date, value });
  }
  const unit = [...units].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  return { values: new Map([...latest].map(([id, v]) => [id, v.value])), unit };
}

async function fetchMetric(
  metric: { leaf: ExtractLeaf; name: string },
  chunks: string[][],
  context: RunContext,
): Promise<ClusterMetricResult> {
  const resolved = await resolveLeaf(metric.leaf, context);
  let records: ExtractRecord[] = [];
  if (!(resolved.kind === "medication" && (resolved.codes ?? []).length === 0)) {
    const search = leafSearch(resolved, today());
    const tasks = search.paramsList.flatMap((base) =>
      chunks.map((chunk) => () => {
        const params = new URLSearchParams(base);
        params.set("subject", chunk.map((id) => `Patient/${id}`).join(","));
        return fetchAll(search.resourceType, params, context, metric.name);
      }),
    );
    records = (await runWithConcurrency(tasks, LEAF_CONCURRENCY)).flat();
  }
  const hits = leafHitsOf(metric.leaf, records);
  if (metric.leaf.kind !== "observation") return { leaf: metric.leaf, name: metric.name, hits };
  const { values, unit } = latestObservationValues(records.filter((r) => hits.has(patientIdOf(r))));
  return { leaf: metric.leaf, name: metric.name, hits, values, unit };
}

export async function fetchClusterExtract(
  criteria: ClusterExtractCriteria,
  signal: AbortSignal,
): Promise<ClusterExtractResult> {
  const patients = new Map<string, fhir4.Patient>();
  await fetchMissingPatients(criteria.patientIds, patients, signal);
  const chunks: string[][] = [];
  for (let i = 0; i < criteria.patientIds.length; i += DETAIL_PATIENT_CHUNK) {
    chunks.push(criteria.patientIds.slice(i, i + DETAIL_PATIENT_CHUNK));
  }
  const context: RunContext = { signal, requests: { count: 0 }, maxRequests: EXTRACT_DETAIL_MAX_REQUESTS, onRequest: () => {} };
  const metrics: ClusterMetricResult[] = [];
  if (chunks.length > 0) {
    for (const metric of criteria.metrics) {
      try {
        metrics.push(await fetchMetric(metric, chunks, context));
      } catch (error) {
        if (error instanceof ExtractLimitError && context.requests.count >= context.maxRequests) {
          throw new ExtractLimitError("検索の回数が上限に達しました。クラスタの患者か指標を減らしてやり直してください。");
        }
        throw error;
      }
    }
  } else {
    for (const metric of criteria.metrics) metrics.push({ leaf: metric.leaf, name: metric.name, hits: new Map() });
  }
  return { patients, patientIds: criteria.patientIds, metrics };
}

export function useClusterExtract() {
  return useRecordExtract(fetchClusterExtract);
}
