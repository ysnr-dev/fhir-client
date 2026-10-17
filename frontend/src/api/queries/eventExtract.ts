import { extractKindDef } from "../../fhir/extractKinds";
import { leafHitsOf, leafSearch, type ExtractLeaf, type ExtractRecord } from "../../fhir/extractQueryHelpers";
import { runWithConcurrency } from "../../lib/concurrency";
import { addDays, diffDays, localDay, today } from "../../lib/dates";
import {
  DETAIL_PATIENT_CHUNK,
  EXTRACT_DETAIL_MAX_REQUESTS,
  EXTRACT_MAX_PATIENTS,
  ExtractLimitError,
  LEAF_CONCURRENCY,
  fetchAll,
  resolveLeaf,
  type RunContext,
} from "./extractQuery";
import { fetchMissingPatients, useRecordExtract } from "./extractRecords";

// データ抽出の「イベント」タブ(docs/data-extract-design.md §25)の読み込み。基準イベントの条件をタブの期間で読み、
// 患者ごとに最初の記録の日(基準日)を取り、結果イベント(条件 1 件か死亡)をその患者に絞って読んで、基準日の後の
// 最初の記録の日(イベント日)を取る。読み切れなければ日数・発生率が嘘になるので結果を出さない。

export interface EventExtractCriteria {
  /** 基準イベント(期間はタブの期間)。 */
  index: ExtractLeaf;
  indexAnchor: "start" | "end";
  /** 結果イベント。null なら死亡(Patient.deceasedDateTime)。 */
  outcome: ExtractLeaf | null;
  /** 基準日の何日後から結果を数えるか。 */
  fromDays: number;
  /** 最大の追跡日数(無ければ今日まで)。 */
  followDays?: number;
  /** タブの患者の絞り込み(無ければ全患者)。 */
  patientIds?: string[];
}

export interface EventSubject {
  patientId: string;
  indexDay: string;
  /** 結果イベントの日。無ければ観察の終わりで打ち切り。 */
  eventDay: string | null;
  /** 観察の終わり(今日か、基準日 + 最大の追跡日数)。 */
  endDay: string;
  /** 基準日からイベント日(無ければ観察の終わり)までの日数。 */
  days: number;
}

export interface EventExtractResult {
  patients: Map<string, fhir4.Patient>;
  subjects: EventSubject[];
}

function patientIdOf(record: ExtractRecord): string {
  return record.resourceType === "Patient" ? (record.id ?? "") : (record.subject?.reference?.split("/").pop() ?? "");
}

/** 条件の記録を読む(患者を渡せばその患者に絞って 100 人ずつ)。 */
async function fetchLeafRecords(
  leaf: ExtractLeaf,
  patientIds: string[] | undefined,
  context: RunContext,
  label: string,
): Promise<ExtractRecord[]> {
  const resolved = await resolveLeaf(leaf, context);
  if (resolved.kind === "medication" && (resolved.codes ?? []).length === 0) return [];
  const search = leafSearch(resolved, today());
  const chunks: (string[] | null)[] = [];
  if (patientIds) {
    if (patientIds.length === 0) return [];
    for (let i = 0; i < patientIds.length; i += DETAIL_PATIENT_CHUNK) chunks.push(patientIds.slice(i, i + DETAIL_PATIENT_CHUNK));
  } else {
    chunks.push(null);
  }
  const tasks = search.paramsList.flatMap((base) =>
    chunks.map((chunk) => () => {
      const params = new URLSearchParams(base);
      if (chunk) params.set("subject", chunk.map((id) => `Patient/${id}`).join(","));
      return fetchAll(search.resourceType, params, context, label);
    }),
  );
  return (await runWithConcurrency(tasks, LEAF_CONCURRENCY)).flat();
}

export async function fetchEventExtract(criteria: EventExtractCriteria, signal: AbortSignal): Promise<EventExtractResult> {
  const context: RunContext = { signal, requests: { count: 0 }, maxRequests: EXTRACT_DETAIL_MAX_REQUESTS, onRequest: () => undefined };
  const day = today();
  try {
    // 基準: 患者ごとに最初の記録(開始日の最も早いもの)の日。件数(以上)は従う。
    const indexDef = extractKindDef(criteria.index.kind);
    const indexRecords = await fetchLeafRecords(criteria.index, criteria.patientIds, context, "基準イベント");
    const hits = leafHitsOf(criteria.index, indexRecords);
    const firstOf = new Map<string, { start: string; record: ExtractRecord }>();
    for (const record of indexRecords) {
      const patientId = patientIdOf(record);
      if (!hits.has(patientId)) continue;
      const start = localDay(indexDef.recordDate(criteria.index, record));
      if (!start) continue;
      const current = firstOf.get(patientId);
      if (!current || start < current.start) firstOf.set(patientId, { start, record });
    }
    if (firstOf.size > EXTRACT_MAX_PATIENTS) {
      throw new ExtractLimitError(`基準イベントの患者が ${EXTRACT_MAX_PATIENTS} 人を超えました。期間か条件を絞ってください。`);
    }
    const indexDays = new Map<string, string>();
    for (const [patientId, { start, record }] of firstOf) {
      const end = criteria.indexAnchor === "end" ? indexDef.endDay?.(record) || start : start;
      indexDays.set(patientId, end);
    }
    const ids = [...indexDays.keys()].sort();

    // 結果: 基準日 + fromDays 以降の最初の記録。死亡は患者の deceasedDateTime。
    const patients = new Map<string, fhir4.Patient>();
    await fetchMissingPatients(ids, patients, signal);
    const eventDays = new Map<string, string>();
    if (criteria.outcome && ids.length > 0) {
      const earliest = [...indexDays.values()].sort()[0];
      const outcome: ExtractLeaf = {
        ...criteria.outcome,
        period: { mode: "absolute", from: addDays(earliest, criteria.fromDays), to: day },
      };
      const outcomeDef = extractKindDef(outcome.kind);
      const records = await fetchLeafRecords(outcome, ids, context, "結果イベント");
      for (const record of records) {
        const patientId = patientIdOf(record);
        const indexDay = indexDays.get(patientId);
        if (!indexDay) continue;
        const recordDay = localDay(outcomeDef.recordDate(outcome, record));
        if (!recordDay || recordDay < addDays(indexDay, criteria.fromDays)) continue;
        const current = eventDays.get(patientId);
        if (!current || recordDay < current) eventDays.set(patientId, recordDay);
      }
    } else if (!criteria.outcome) {
      for (const id of ids) {
        const deceased = localDay(patients.get(id)?.deceasedDateTime);
        const indexDay = indexDays.get(id)!;
        if (deceased && deceased >= addDays(indexDay, criteria.fromDays)) eventDays.set(id, deceased);
      }
    }

    const subjects: EventSubject[] = ids.map((patientId) => {
      const indexDay = indexDays.get(patientId)!;
      const limit = criteria.followDays != null ? addDays(indexDay, criteria.followDays) : day;
      const endDay = limit < day ? limit : day;
      const occurred = eventDays.get(patientId) ?? null;
      const eventDay = occurred && occurred <= endDay ? occurred : null;
      const until = eventDay ?? endDay;
      return { patientId, indexDay, eventDay, endDay, days: Math.max(0, diffDays(indexDay, until)) };
    });
    return { patients, subjects };
  } catch (error) {
    if (error instanceof ExtractLimitError && context.requests.count >= context.maxRequests) {
      throw new ExtractLimitError("検索の回数が上限に達しました。期間か条件を絞ってやり直してください。");
    }
    throw error;
  }
}

export function useEventExtract() {
  return useRecordExtract(fetchEventExtract);
}
