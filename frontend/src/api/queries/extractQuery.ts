import { useCallback, useRef, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  applyRelation,
  collectLeaves,
  combineSets,
  detailLeaves,
  extractDetailCsv,
  extractRows,
  isUnfiltered,
  leafHitsOf,
  leafRecordsOf,
  leafSearch,
  patientFilterLeaves,
  patientMatches,
  type ExtractDetail,
  type ExtractLeaf,
  type ExtractQueryBody,
  type ExtractRecord,
  type ExtractRow,
  type LeafHits,
  type LeafRecord,
} from "../../fhir/extractQueryHelpers";
import { runWithConcurrency } from "../../lib/concurrency";
import { today } from "../../lib/dates";
import { downloadBlob } from "../../lib/download";
import { MEDICINE_CODE_SYSTEM } from "../../fhir/prescriptionHelpers";
import { FhirError, searchResource } from "../fhirClient";
import { fetchMedicineCodesByClass } from "../masterClient";
import { hasNextPage } from "./core";

// データ抽出(docs/data-extract-design.md)の実行。条件ごとに上流を引いて患者の集合を作り、
// fhir/extractQueryHelpers.ts の集合演算で組み合わせる。データ源を差し替えるときはこの
// ファイルだけを入れ替える(条件のモデル・結果の行・画面は extractQueryHelpers の形にしか
// 依存しない)。
//
// 検索はすべて strict(未知の条件を上流が黙って読み飛ばすと、絞り込み無しの全件が結果に
// 混ざる)。どの条件も読み切れなければ結果を出さない(欠けた集合で AND・除外を計算すると
// 該当者が嘘になる)。

export const EXTRACT_PAGE = 500;
/** 条件 1 つ(コードの塊 1 つ)で読むページの上限(1 万件)。 */
export const EXTRACT_MAX_PAGES = 20;
/** 1 回の実行で上流へ送る検索の上限(レート制限は全利用者の合計で 300 件/分)。 */
export const EXTRACT_MAX_REQUESTS = 120;
export const EXTRACT_MAX_PATIENTS = 5000;
const LEAF_CONCURRENCY = 2;
/** 明細の検索で 1 回に指定する患者の数(URL の長さ)。 */
const DETAIL_PATIENT_CHUNK = 100;
/** 明細の書き出し 1 回で上流へ送る検索の上限。 */
export const EXTRACT_DETAIL_MAX_REQUESTS = 200;
const PATIENT_CHUNK = 50;
const RATE_LIMIT_WAIT_MS = 20_000;

export class ExtractLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractLimitError";
  }
}

export type LeafState = "pending" | "running" | "done" | "error";

export interface LeafProgress {
  state: LeafState;
  /** 読んだ行の数。 */
  records: number;
  /** 該当した患者の数(患者属性を兄弟に当てる条件は当てた後の数)。 */
  patients: number;
}

export interface ExtractResult {
  rows: ExtractRow[];
  leaves: ExtractLeaf[];
  hits: Map<string, LeafHits>;
  /** 条件ごとの記録の要約(内訳の月別・診療科別に使う)。患者属性の条件は持たない。 */
  records: Map<string, LeafRecord[]>;
  ranAt: string;
}

interface RunContext {
  queryClient: QueryClient;
  signal: AbortSignal;
  requests: { count: number };
  maxRequests: number;
  onRequest: () => void;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    });
  });
}

/** 1 ページを引く。429(レート制限)は少し待って 1 回だけやり直す。 */
async function fetchPage(
  resourceType: string,
  params: URLSearchParams,
  context: RunContext,
): Promise<fhir4.Bundle> {
  if (context.requests.count >= context.maxRequests) {
    throw new ExtractLimitError("検索の回数が上限に達しました。条件や期間を絞ってやり直してください。");
  }
  context.requests.count += 1;
  context.onRequest();
  try {
    return (await searchResource(resourceType, params, { strict: true, signal: context.signal })).data;
  } catch (error) {
    if (!(error instanceof FhirError) || error.status !== 429) throw error;
    await sleep(RATE_LIMIT_WAIT_MS, context.signal);
    return (await searchResource(resourceType, params, { strict: true, signal: context.signal })).data;
  }
}

/** 検索 1 つを読み切る。上限で切れたら例外(欠けた集合は使わない)。 */
async function fetchAll(
  resourceType: string,
  base: URLSearchParams,
  context: RunContext,
  label: string,
): Promise<ExtractRecord[]> {
  if (isUnfiltered(base)) throw new ExtractLimitError(`${label}: 絞り込みの条件がありません。`);
  const records: ExtractRecord[] = [];
  for (let page = 0; page < EXTRACT_MAX_PAGES; page += 1) {
    const params = new URLSearchParams(base);
    params.set("_count", String(EXTRACT_PAGE));
    params.set("_offset", String(page * EXTRACT_PAGE));
    params.set("_total", "none");
    const bundle = await fetchPage(resourceType, params, context);
    for (const entry of bundle.entry ?? []) {
      if (entry.search?.mode === "include") continue;
      if (entry.resource?.resourceType === resourceType) records.push(entry.resource as ExtractRecord);
    }
    if (!hasNextPage(bundle)) return records;
  }
  throw new ExtractLimitError(`${label}: 該当が多すぎて読み切れません。期間や項目を絞ってください。`);
}

/**
 * 薬効分類で指定した処方・注射の条件を、医薬品コードに展開した条件にする。展開は実行のたびに
 * 医薬品マスタから引く(保存した条件に新しい薬も入る)。
 */
async function resolveLeaf(leaf: ExtractLeaf, context: RunContext): Promise<ExtractLeaf> {
  const classes = leaf.kind === "medication" ? (leaf.drug_classes ?? []) : [];
  if (classes.length === 0) return leaf;
  const prefixes = classes.map((c) => c.code).sort();
  const codes = await context.queryClient.fetchQuery({
    queryKey: ["ExtractDrugClass", prefixes],
    queryFn: () => fetchMedicineCodesByClass(prefixes),
    staleTime: 30 * 60 * 1000,
  });
  const known = new Set((leaf.codes ?? []).map((c) => `${c.system}|${c.code}`));
  const expanded = codes
    .map((code) => ({ system: MEDICINE_CODE_SYSTEM, code }))
    .filter((c) => !known.has(`${c.system}|${c.code}`));
  return { ...leaf, codes: [...(leaf.codes ?? []), ...expanded] };
}

/**
 * 条件 1 つの行。同じ検索(条件を 1 つ直して再実行したときの他の条件)はしばらく覚えておき、
 * 引き直さない。相対の期間は今日に直してから検索にするので、日が変わればキーも変わる。
 */
async function fetchLeaf(leaf: ExtractLeaf, context: RunContext, label: string): Promise<ExtractRecord[]> {
  const resolved = await resolveLeaf(leaf, context);
  if (resolved.kind === "medication" && (resolved.codes ?? []).length === 0) return [];
  const search = leafSearch(resolved, today());
  const chunks = await Promise.all(
    search.paramsList.map((params) =>
      context.queryClient.fetchQuery({
        queryKey: ["ExtractLeaf", search.resourceType, params.toString()],
        queryFn: () => fetchAll(search.resourceType, params, context, label),
        staleTime: 5 * 60 * 1000,
      }),
    ),
  );
  return chunks.flat();
}

function referencePatientId(record: ExtractRecord): string {
  if (record.resourceType === "Patient") return record.id ?? "";
  return record.subject?.reference?.split("/").pop() ?? "";
}

/** 患者を id で引く(一覧の患者番号・氏名と、患者属性の条件を当てるため)。 */
async function fetchPatients(
  ids: string[],
  context: RunContext,
  known: Map<string, fhir4.Patient>,
): Promise<void> {
  const missing = ids.filter((id) => !known.has(id));
  const chunks: string[][] = [];
  for (let i = 0; i < missing.length; i += PATIENT_CHUNK) chunks.push(missing.slice(i, i + PATIENT_CHUNK));
  await runWithConcurrency(
    chunks.map((chunk) => async () => {
      const params = new URLSearchParams();
      params.set("_id", chunk.join(","));
      params.set("_count", String(PATIENT_CHUNK));
      const bundle = await fetchPage("Patient", params, context);
      for (const entry of bundle.entry ?? []) {
        const patient = entry.resource as fhir4.Patient | undefined;
        if (patient?.resourceType === "Patient" && patient.id) known.set(patient.id, patient);
      }
    }),
    LEAF_CONCURRENCY,
  );
}

export interface ExtractRunState {
  running: boolean;
  progress: Record<string, LeafProgress>;
  requests: number;
  error: unknown;
  result: ExtractResult | null;
}

const IDLE: ExtractRunState = { running: false, progress: {}, requests: 0, error: null, result: null };

/** データ抽出の実行。実行は明示のボタンだけで、条件を変えても自動では走らせない。 */
export function useExtractRun() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<ExtractRunState>(IDLE);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(
    async (body: ExtractQueryBody, labelOf: (leaf: ExtractLeaf) => string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const leaves = collectLeaves(body.root);
      const filterKeys = patientFilterLeaves(body.root);
      const progress: Record<string, LeafProgress> = Object.fromEntries(
        leaves.map((leaf) => [leaf.key, { state: "pending" as LeafState, records: 0, patients: 0 }]),
      );
      const requests = { count: 0 };
      const publish = (patch: Partial<ExtractRunState> = {}) =>
        setState((prev) => ({ ...prev, ...patch, progress: { ...progress }, requests: requests.count }));
      setState({ ...IDLE, running: true, progress: { ...progress } });

      const context: RunContext = {
        queryClient,
        signal: controller.signal,
        requests,
        maxRequests: EXTRACT_MAX_REQUESTS,
        onRequest: () => publish(),
      };
      try {
        const hits = new Map<string, LeafHits>();
        const recordsByLeaf = new Map<string, LeafRecord[]>();
        const resourcesByLeaf = new Map<string, ExtractRecord[]>();
        await runWithConcurrency(
          leaves
            .filter((leaf) => !filterKeys.has(leaf.key))
            .map((leaf) => async () => {
              progress[leaf.key] = { ...progress[leaf.key], state: "running" };
              publish();
              try {
                const records = await fetchLeaf(leaf, context, labelOf(leaf));
                resourcesByLeaf.set(leaf.key, records);
                const leafHits = leafHitsOf(leaf, records);
                hits.set(leaf.key, leafHits);
                if (leaf.kind !== "patient") recordsByLeaf.set(leaf.key, leafRecordsOf(leaf, records));
                progress[leaf.key] = { state: "done", records: records.length, patients: leafHits.size };
              } catch (error) {
                progress[leaf.key] = { ...progress[leaf.key], state: "error" };
                throw error;
              } finally {
                publish();
              }
            }),
          LEAF_CONCURRENCY,
        );

        // 時間関係は基準の条件の記録と突き合わせて絞る(上流では表せない)。基準は min_count を
        // 満たした患者の記録だけを使う。
        for (const leaf of leaves.filter((l) => l.relation && resourcesByLeaf.has(l.key))) {
          const anchor = leaves.find((l) => l.key === leaf.relation!.key);
          if (!anchor) continue;
          const anchorPatients = hits.get(anchor.key) ?? new Map();
          const anchorRecords = (resourcesByLeaf.get(anchor.key) ?? []).filter((r) =>
            anchorPatients.has(referencePatientId(r)),
          );
          const filtered = applyRelation(leaf, resourcesByLeaf.get(leaf.key) ?? [], anchor, anchorRecords);
          const leafHits = leafHitsOf(leaf, filtered);
          hits.set(leaf.key, leafHits);
          recordsByLeaf.set(leaf.key, leafRecordsOf(leaf, filtered));
          progress[leaf.key] = { state: "done", records: filtered.length, patients: leafHits.size };
        }
        publish();

        const setOf = (leaf: ExtractLeaf) => {
          const leafHits = hits.get(leaf.key);
          return leafHits ? new Set(leafHits.keys()) : null;
        };
        // 患者属性を兄弟に当てる条件は、いったん外して絞った患者に当ててから組み直す。
        let ids = combineSets(body.root, setOf);
        if (ids.size > EXTRACT_MAX_PATIENTS) {
          throw new ExtractLimitError(`該当者が ${EXTRACT_MAX_PATIENTS} 人を超えました。条件を絞ってください。`);
        }
        const patients = new Map<string, fhir4.Patient>();
        await fetchPatients([...ids], context, patients);
        if (filterKeys.size > 0) {
          const day = today();
          for (const leaf of leaves.filter((l) => filterKeys.has(l.key))) {
            const matched: LeafHits = new Map();
            for (const id of ids) {
              if (patientMatches(leaf, patients.get(id), day)) matched.set(id, { count: 1, first: "", last: "", latest: "" });
            }
            hits.set(leaf.key, matched);
            progress[leaf.key] = { state: "done", records: ids.size, patients: matched.size };
          }
          ids = combineSets(body.root, setOf);
        }

        const result: ExtractResult = {
          rows: extractRows(ids, patients, leaves, hits),
          leaves,
          hits,
          records: recordsByLeaf,
          ranAt: new Date().toISOString(),
        };
        publish({ running: false, result });
      } catch (error) {
        if (controller.signal.aborted) {
          publish({ running: false });
          return;
        }
        publish({ running: false, error });
      }
    },
    [queryClient],
  );

  const cancel = useCallback(() => abortRef.current?.abort(), []);
  const reset = useCallback(() => setState(IDLE), []);
  /** 覚えている条件の検索結果を捨てる(登録が増えた直後に引き直したいとき)。 */
  const clearCache = useCallback(() => queryClient.removeQueries({ queryKey: ["ExtractLeaf"] }), [queryClient]);

  return { ...state, run, cancel, reset, clearCache };
}

/**
 * 明細(条件に当たった記録を 1 件 1 行)を引く。抽出のときは列に要る項目だけを読んでいるので、
 * 書き出すときに結果の患者に絞って記録を丸ごと引き直す(検索の条件は抽出と同じ)。
 */
async function fetchExtractDetails(result: ExtractResult, context: RunContext): Promise<ExtractDetail[]> {
  const ids = result.rows.map((row) => row.patientId);
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += DETAIL_PATIENT_CHUNK) chunks.push(ids.slice(i, i + DETAIL_PATIENT_CHUNK));
  const day = today();
  const details: ExtractDetail[] = [];
  for (const leaf of detailLeaves(result.leaves)) {
    const resolved = await resolveLeaf(leaf, context);
    const search = leafSearch(resolved, day);
    const tasks = search.paramsList.flatMap((base) =>
      chunks.map((chunk) => () => {
        const params = new URLSearchParams(base);
        params.delete("_elements");
        params.set("subject", chunk.map((id) => `Patient/${id}`).join(","));
        return fetchAll(search.resourceType, params, context, leaf.label || leaf.kind);
      }),
    );
    const records = (await runWithConcurrency(tasks, LEAF_CONCURRENCY)).flat();
    details.push({ leaf, records });
  }
  // 時間関係は抽出と同じく基準の条件の記録で絞る(基準は除外でも患者属性でもないので明細にある)。
  return details.map((detail) => {
    const anchorKey = detail.leaf.relation?.key;
    const anchor = anchorKey ? details.find((d) => d.leaf.key === anchorKey) : undefined;
    return anchor
      ? { ...detail, records: applyRelation(detail.leaf, detail.records, anchor.leaf, anchor.records) }
      : detail;
  });
}

/** 明細 CSV の書き出し。 */
export function useExtractDetailExport() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<{ exporting: boolean; requests: number; error: unknown }>({
    exporting: false,
    requests: 0,
    error: null,
  });
  const abortRef = useRef<AbortController | null>(null);

  const exportCsv = useCallback(
    async (result: ExtractResult, fileName: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const requests = { count: 0 };
      setState({ exporting: true, requests: 0, error: null });
      const context: RunContext = {
        queryClient,
        signal: controller.signal,
        requests,
        maxRequests: EXTRACT_DETAIL_MAX_REQUESTS,
        onRequest: () => setState((prev) => ({ ...prev, requests: requests.count })),
      };
      try {
        const details = await fetchExtractDetails(result, context);
        downloadBlob(extractDetailCsv(result.rows, details), fileName);
        setState({ exporting: false, requests: requests.count, error: null });
      } catch (error) {
        setState({ exporting: false, requests: requests.count, error: controller.signal.aborted ? null : error });
      }
    },
    [queryClient],
  );

  const cancel = useCallback(() => abortRef.current?.abort(), []);
  return { ...state, exportCsv, cancel };
}
