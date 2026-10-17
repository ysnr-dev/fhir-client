import type { QueryClient } from "@tanstack/react-query";
import { fetchPatientFolderMembers, type ExtractQuery, type PatientFolder } from "../masterClient";
import { leafLabel, validateExtractQuery, withBucketPeriod, type ExtractQueryBody } from "../../fhir/extractQueryHelpers";
import { isFolderStratum, stratumLeaf, type ExtractStratum } from "../../fhir/extractRecordQuery";
import type { PeriodBucket } from "../../fhir/recordBreakdownHelpers";
import {
  EXTRACT_DETAIL_MAX_REQUESTS,
  EXTRACT_MAX_PATIENTS,
  ExtractLimitError,
  runExtract,
  type RunContext,
} from "./extractQuery";
import { fetchMissingPatients, useRecordExtract } from "./extractRecords";

// データ抽出の「指標」タブ(docs/data-extract-design.md §23)の読み込み。期間の刻みごとに、分母(患者の集団)と
// 分子(そのうち条件に当たる患者)の条件を「その刻みを期間にして」評価し、患者の集合を持つ。
// 同じ検索は queryClient が 5 分覚えるので、条件を少し直しての再実行は軽い。

/** 1 回の実行で評価する刻みの上限(月なら 5 年)。 */
export const MAX_INDICATOR_BUCKETS = 60;

export interface IndicatorExtractCriteria {
  buckets: PeriodBucket[];
  denominator: ExtractStratum;
  numerator: ExtractStratum;
  /** 「患者」タブに保存した条件(分母・分子が query_code で指すもの)。 */
  queries: ExtractQuery[];
  folders: PatientFolder[];
  queryClient?: QueryClient;
  /** タブの患者の絞り込み(無ければ全患者)。分母をこれで絞る。 */
  patientIds?: string[];
}

export interface IndicatorBucketResult extends PeriodBucket {
  denominator: Set<string>;
  numerator: Set<string>;
}

export interface IndicatorExtractResult {
  patients: Map<string, fhir4.Patient>;
  buckets: IndicatorBucketResult[];
}

interface Source {
  stratum: ExtractStratum;
  label: string;
}

/** 分母・分子 1 つの、刻み 1 つでの患者の集合。 */
async function membersOf(
  source: Source,
  bucket: PeriodBucket,
  criteria: IndicatorExtractCriteria,
  context: RunContext,
  folderCache: Map<number, Set<string>>,
): Promise<Set<string>> {
  const { stratum, label } = source;
  if (isFolderStratum(stratum)) {
    const folderId = stratum.patient_folder_id;
    if (folderId == null) throw new Error(`${label}: 患者フォルダを選んでください。`);
    let members = folderCache.get(folderId);
    if (!members) {
      const folder = await fetchPatientFolderMembers({ patient_folder_id: folderId, include_descendants: true });
      members = new Set(folder.items.map((m) => m.patient_id));
      folderCache.set(folderId, members);
    }
    return members;
  }
  let body: ExtractQueryBody;
  let key: string | null = null;
  if (stratum.query_code) {
    const query = criteria.queries.find((q) => q.code === stratum.query_code);
    if (!query) throw new Error(`${label}: 保存した条件が見つかりません。`);
    body = { ...query.definition, root: withBucketPeriod(query.definition.root, bucket) };
  } else {
    if (!stratum.kind) throw new Error(`${label}: 条件を選んでください。`);
    const leaf = withBucketPeriod(stratumLeaf(stratum, null, label), bucket);
    key = leaf.key;
    body = { schema_version: 1, root: { op: "or", children: [leaf] } };
  }
  const errors = validateExtractQuery(body);
  if (errors.length > 0) throw new Error(`${label}: ${errors.join(" ")}`);
  const result = await runExtract(body, leafLabel, context, { skipPatients: true });
  return key ? new Set(result.hits.get(key)?.keys() ?? []) : new Set(result.rows.map((row) => row.patientId));
}

export async function fetchIndicatorExtract(
  criteria: IndicatorExtractCriteria,
  signal: AbortSignal,
): Promise<IndicatorExtractResult> {
  if (criteria.buckets.length > MAX_INDICATOR_BUCKETS) {
    throw new ExtractLimitError(`期間の刻みは ${MAX_INDICATOR_BUCKETS} 個までです。期間を短くするか刻みを粗くしてください。`);
  }
  const context: RunContext = {
    queryClient: criteria.queryClient,
    signal,
    requests: { count: 0 },
    maxRequests: EXTRACT_DETAIL_MAX_REQUESTS,
    onRequest: () => undefined,
  };
  const scope = criteria.patientIds ? new Set(criteria.patientIds) : null;
  const folderCache = new Map<number, Set<string>>();
  const denominator: Source = { stratum: criteria.denominator, label: "分母" };
  const numerator: Source = { stratum: criteria.numerator, label: "分子" };
  const buckets: IndicatorBucketResult[] = [];
  const all = new Set<string>();
  try {
    for (const bucket of criteria.buckets) {
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      let inDenominator = await membersOf(denominator, bucket, criteria, context, folderCache);
      if (scope) inDenominator = new Set([...inDenominator].filter((id) => scope.has(id)));
      let inNumerator = new Set<string>();
      if (inDenominator.size > 0) {
        const hit = await membersOf(numerator, bucket, criteria, context, folderCache);
        inNumerator = new Set([...inDenominator].filter((id) => hit.has(id)));
      }
      for (const id of inDenominator) all.add(id);
      if (all.size > EXTRACT_MAX_PATIENTS) {
        throw new ExtractLimitError(`分母の患者が ${EXTRACT_MAX_PATIENTS} 人を超えました。期間か条件を絞ってください。`);
      }
      buckets.push({ ...bucket, denominator: inDenominator, numerator: inNumerator });
    }
  } catch (error) {
    if (error instanceof ExtractLimitError && context.requests.count >= context.maxRequests) {
      throw new ExtractLimitError("検索の回数が上限に達しました。期間を短くするか刻みを粗くしてやり直してください。");
    }
    throw error;
  }
  const patients = new Map<string, fhir4.Patient>();
  await fetchMissingPatients([...all], patients, signal);
  return { patients, buckets };
}

export function useIndicatorExtract() {
  return useRecordExtract(fetchIndicatorExtract);
}
