import { useCallback, useRef, useState } from "react";
import type { ExtractQuery, PatientFolder } from "../api/masterClient";
import { useExtractRun, type ExtractResult } from "../api/queries";
import { fetchAttendingPhysicians } from "../api/queries/extractAttending";
import type { DashboardTile } from "../fhir/dashboardLayout";
import { leafLabel, resolvePeriod, validateExtractQuery } from "../fhir/extractQueryHelpers";
import { recordDefinitionOf, type ExtractRecordDefinition, type ExtractRecordTab } from "../fhir/extractRecordQuery";
import { EXTRACT_TAB_RUNNERS, type ExtractRunContext, type RecordTable } from "../fhir/extractTabRunners";
import type { PatientAttribute } from "../fhir/recordTableHelpers";
import { today } from "../lib/dates";
import { resolvePatientScope, type ScopeSummary } from "./useExtractPatientScope";
import { patientAttributesOf } from "./useRecordPatientAttributes";

// ダッシュボードのタイルの実行(docs/dashboard-design.md §4)。タイルを上から順に 1 つずつ実行し、
// 同じ条件を置いたタイルは 1 回の実行を共有する。結果はこのフックの状態にだけ持つ(DB には残さない)。

export type TileOutcome =
  | { kind: "patient"; result: ExtractResult }
  | {
      kind: "record";
      tab: ExtractRecordTab;
      definition: ExtractRecordDefinition;
      table: RecordTable;
      truncated: boolean;
      summary: ScopeSummary;
      /** 比較群・担当医の列。 */
      attributes: PatientAttribute[];
      /** 担当医を決める記録を読み切れなかった。 */
      attendingTruncated: boolean;
    }
  | { kind: "error"; error: unknown };

export interface TileState {
  running: boolean;
  ranAt: string | null;
  outcome: TileOutcome | null;
}

const IDLE_TILE: TileState = { running: false, ranAt: null, outcome: null };

export function useDashboardRun(queries: ExtractQuery[], folders: PatientFolder[], context: ExtractRunContext) {
  const patientExtract = useExtractRun();
  const [states, setStates] = useState<Record<string, TileState>>({});
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // 直近の一覧・参照データ(実行中に差し替わっても、その回は始めたときのもので続ける)。
  const latest = useRef({ queries, folders, context });
  latest.current = { queries, folders, context };

  const runQuery = useCallback(
    async (query: ExtractQuery, signal: AbortSignal): Promise<TileOutcome> => {
      const { queries: allQueries, folders: allFolders, context: runContext } = latest.current;
      const run = (body: Parameters<typeof patientExtract.run>[0], labelOf: Parameters<typeof patientExtract.run>[1], options = {}) =>
        patientExtract.run(body, labelOf, { ...options, rethrow: true });
      if (query.tab === "patient") {
        const errors = validateExtractQuery(query.definition);
        if (errors.length > 0) throw new Error(errors.join("\n"));
        const result = await run(query.definition, leafLabel);
        return { kind: "patient", result: result! };
      }
      const tab = query.tab as ExtractRecordTab;
      const runner = EXTRACT_TAB_RUNNERS[tab];
      const definition = recordDefinitionOf<ExtractRecordDefinition>(query);
      const patientQueries = allQueries.filter((q) => q.tab === "patient");
      const scope = await resolvePatientScope(definition, definition.period, patientQueries, allFolders, run);
      if (!scope) throw new DOMException("aborted", "AbortError");
      const range = resolvePeriod(definition.period, today());
      const criteria = runner.criteria(definition, { range, patientIds: scope.patientIds }, runContext);
      if (criteria === null) throw new Error("条件が足りないため実行できません。データ抽出で条件を直してください。");
      const result = await runner.fetch(criteria, signal);
      const table = runner.table(result, definition, runContext);
      let names: Map<string, string> | null = null;
      let attendingTruncated = false;
      if (scope.ran.attending) {
        const patientIds = [...new Set(table.rows.map((row) => row.patient.patientId))].sort();
        const attending = await fetchAttendingPhysicians(scope.ran.attending, scope.ran.range, patientIds, signal);
        names = attending.names;
        attendingTruncated = attending.truncated;
      }
      return {
        kind: "record",
        tab,
        definition,
        table,
        truncated: (result as { truncated?: boolean }).truncated ?? false,
        summary: scope.summary,
        attributes: patientAttributesOf(scope.ran.groupsOf, scope.ran.attending, names),
        attendingTruncated,
      };
    },
    [patientExtract],
  );

  /** タイルを上から順に実行する。実行中なら前の実行を止めてから始める。 */
  const runTiles = useCallback(
    async (tiles: DashboardTile[]) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const signal = controller.signal;
      const ordered = [...tiles].sort((a, b) => a.y - b.y || a.x - b.x);
      setRunning(true);
      setStates((prev) => ({
        ...prev,
        ...Object.fromEntries(ordered.map((tile) => [tile.id, { ...(prev[tile.id] ?? IDLE_TILE), running: true }])),
      }));
      const shared = new Map<string, Promise<TileOutcome>>();
      try {
        for (const tile of ordered) {
          if (signal.aborted) break;
          const query = latest.current.queries.find((q) => q.code === tile.query_code);
          let outcome: TileOutcome;
          if (!query) {
            outcome = { kind: "error", error: new Error("条件が見つかりません(削除されたか、見えない持ち主の条件です)。") };
          } else {
            let pending = shared.get(query.code);
            if (!pending) {
              pending = runQuery(query, signal).catch((error: unknown): TileOutcome => ({ kind: "error", error }));
              shared.set(query.code, pending);
            }
            outcome = await pending;
          }
          if (signal.aborted) break;
          setStates((prev) => ({
            ...prev,
            [tile.id]: { running: false, ranAt: new Date().toISOString(), outcome },
          }));
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setRunning(false);
        }
        // 止めたタイルは実行中の印を外す(結果は前のまま)。
        setStates((prev) =>
          Object.fromEntries(Object.entries(prev).map(([id, state]) => [id, state.running ? { ...state, running: false } : state])),
        );
      }
    },
    [runQuery],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    patientExtract.cancel();
  }, [patientExtract]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    patientExtract.cancel();
    setStates({});
    setRunning(false);
  }, [patientExtract]);

  return { states, running, runTiles, cancel, reset, requests: patientExtract.requests };
}
