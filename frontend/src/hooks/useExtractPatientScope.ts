import { useMemo, useState } from "react";
import { fetchPatientFolderMembers, type ExtractQuery } from "../api/masterClient";
import { useExtractQueries, usePatientFolders } from "../api/masterQueries";
import { useExtractRun } from "../api/queries";
import { patientFolderPath } from "../components/patientFolderTree";
import { leafLabel, validateExtractQuery, type ExtractQueryBody } from "../fhir/extractQueryHelpers";
import { resolvePeriod, type ExtractLeaf, type ExtractPeriod, type ResolvedPeriod } from "../fhir/extractQueryModel";
import {
  compactDefinition,
  type AttendingMode,
  type ExtractRecordDefinition,
  type ExtractStratum,
} from "../fhir/extractRecordQuery";
import { today } from "../lib/dates";
import { useDefinitionOwners } from "./useDefinitionOwners";

// データ抽出の記録を表にするタブの患者の絞り込みと、患者ごとの属性(群・担当医)。
// 絞り込みは「患者」タブに保存した条件と患者フォルダ(下位フォルダを含む)で、両方なら両方に入る患者
// (docs/data-extract-design.md §8)。群分けと担当医は §21。

interface ScopeSummary {
  query: { name: string; count: number } | null;
  folder: { name: string; count: number } | null;
  strata: { name: string; count: number }[];
}

/** 実行したときの群分けと担当医の決め方(結果の表の属性の列はこれで組む)。 */
export interface RanScope {
  /** 患者 id → 入った群の名前(群の並び順)。群分けをしていなければ null。 */
  groupsOf: Map<string, string[]> | null;
  attending: AttendingMode | null;
  /** タブの期間(担当医を決める記録の期間)。 */
  range: ResolvedPeriod | null;
}

/** 群の名前。付けた名前、保存した条件の名前、条件の表示名の順。 */
export function stratumName(stratum: ExtractStratum, queries: ExtractQuery[]): string {
  if (stratum.label?.trim()) return stratum.label.trim();
  if (stratum.query_code) return queries.find((q) => q.code === stratum.query_code)?.name ?? "保存した条件";
  return stratum.kind ? leafLabel(stratum as ExtractLeaf) : "群";
}

/** 条件型の群を「患者」タブの条件にする。期間を入れていなければタブの期間で数える。 */
function stratumLeaf(stratum: ExtractStratum, period: ExtractPeriod | null | undefined, name: string): ExtractLeaf {
  const { query_code: _code, ...rest } = stratum;
  return { ...rest, kind: stratum.kind!, label: name, period: stratum.period ?? period ?? null };
}

export function useExtractPatientScope() {
  const owners = useDefinitionOwners("自分の条件");
  const queryList = useExtractQueries(owners.departmentId, owners.practitionerId, owners.ready, "patient", owners.teamIds);
  const queries = useMemo(() => queryList.data?.items ?? [], [queryList.data]);
  const folderList = usePatientFolders(owners.departmentId, owners.practitionerId);
  const folders = useMemo(() => folderList.data?.items ?? [], [folderList.data]);
  const patientExtract = useExtractRun();
  // 選んだ「患者」タブの条件は code で持つ(保存した記録タブの条件から、一覧が読める前でも指せるように)。
  const [queryCode, setQueryCode] = useState<string | null>(null);
  const queryId = queries.find((q) => q.code === queryCode)?.id ?? null;
  const setQueryId = (id: number | null) => setQueryCode(queries.find((q) => q.id === id)?.code ?? null);
  const [folderId, setFolderId] = useState<number | null>(null);
  const [strata, setStrata] = useState<ExtractStratum[]>([]);
  const [strataOnly, setStrataOnly] = useState(false);
  const [attending, setAttending] = useState<AttendingMode | "">("");
  const [scopeError, setScopeError] = useState<unknown>(null);
  const [summary, setSummary] = useState<ScopeSummary>({ query: null, folder: null, strata: [] });
  const [ran, setRan] = useState<RanScope | null>(null);

  /** 群ごとの患者。条件型の群はまとめて 1 回で抽出し、保存した条件の群は 1 つずつ抽出する。読めなければ null。 */
  async function resolveStrata(period: ExtractPeriod | null | undefined): Promise<Set<string>[] | null> {
    const names = strata.map((s) => stratumName(s, queries));
    const leaves = strata.flatMap((s, i) => (s.kind && !s.query_code ? [stratumLeaf(s, period, `群「${names[i]}」`)] : []));
    const members: (Set<string> | null)[] = strata.map(() => null);
    if (leaves.length > 0) {
      const body: ExtractQueryBody = { schema_version: 1, root: { op: "or", children: leaves } };
      const errors = validateExtractQuery(body);
      if (errors.length > 0) {
        setScopeError(new Error(errors.join("\n")));
        return null;
      }
      const result = await patientExtract.run(body, leafLabel, { skipPatients: true });
      if (!result) return null;
      strata.forEach((s, i) => {
        if (s.kind && !s.query_code) members[i] = new Set(result.hits.get(s.key)?.keys() ?? []);
      });
    }
    for (const [i, s] of strata.entries()) {
      if (!s.query_code) continue;
      const query = queries.find((q) => q.code === s.query_code);
      if (!query) {
        setScopeError(new Error(`群「${names[i]}」: 保存した条件が見つかりません。`));
        return null;
      }
      const result = await patientExtract.run(query.definition, leafLabel, { skipPatients: true });
      if (!result) return null;
      members[i] = new Set(result.rows.map((row) => row.patientId));
    }
    return members.map((m) => m ?? new Set());
  }

  /**
   * 選んだ条件・フォルダ・群の患者。絞り込みが無ければ undefined(全患者)、読めなければ null。
   * 患者の条件と群は実行のたびに抽出し直す。period はタブの期間(期間を入れていない群と担当医に使う)。
   */
  async function resolve(period?: ExtractPeriod | null): Promise<string[] | undefined | null> {
    const query = queries.find((q) => q.code === queryCode) ?? null;
    const folder = folders.find((f) => f.id === folderId) ?? null;
    const next: ScopeSummary = { query: null, folder: null, strata: [] };
    setSummary(next);
    setScopeError(null);
    setRan(null);
    let patientIds: string[] | undefined;
    if (folder) {
      try {
        const members = await fetchPatientFolderMembers({ patient_folder_id: folder.id, include_descendants: true });
        patientIds = [...new Set(members.items.map((m) => m.patient_id))];
        next.folder = { name: patientFolderPath(folders, folder.id), count: patientIds.length };
      } catch (error) {
        setScopeError(error);
        return null;
      }
    }
    if (query) {
      const result = await patientExtract.run(query.definition, leafLabel);
      if (!result) return null;
      const matched = new Set(result.rows.map((row) => row.patientId));
      patientIds = patientIds ? patientIds.filter((id) => matched.has(id)) : [...matched];
      next.query = { name: query.name, count: matched.size };
    }
    let groupsOf: Map<string, string[]> | null = null;
    if (strata.length > 0) {
      const members = await resolveStrata(period);
      if (!members) return null;
      groupsOf = new Map();
      strata.forEach((s, i) => {
        const name = stratumName(s, queries);
        for (const id of members[i]) groupsOf!.set(id, [...(groupsOf!.get(id) ?? []), name]);
      });
      // 群の人数は、ほかの絞り込み(患者の条件・フォルダ)に入る患者で数える。
      const inScope = patientIds ? new Set(patientIds) : null;
      next.strata = strata.map((s, i) => ({
        name: stratumName(s, queries),
        count: inScope ? [...members[i]].filter((id) => inScope.has(id)).length : members[i].size,
      }));
      if (strataOnly) {
        const grouped = groupsOf;
        patientIds = patientIds ? patientIds.filter((id) => grouped.has(id)) : [...grouped.keys()];
      }
    }
    setSummary({ ...next });
    setRan({ groupsOf, attending: attending || null, range: resolvePeriod(period, today()) });
    return patientIds;
  }

  return {
    owners,
    queries,
    folders,
    queryId,
    setQueryId,
    queryCode,
    setQueryCode,
    folderId,
    setFolderId,
    strata,
    setStrata,
    strataOnly,
    setStrataOnly,
    attending,
    setAttending,
    resolve,
    ran,
    summary,
    cancel: patientExtract.cancel,
    running: patientExtract.running,
    requests: patientExtract.requests,
    listError: queryList.error ?? folderList.error,
    error: scopeError ?? patientExtract.error,
  };
}

export type ExtractPatientScope = ReturnType<typeof useExtractPatientScope>;

type ScopeDefinition = Pick<
  ExtractRecordDefinition,
  "patient_query_code" | "patient_folder_id" | "strata" | "strata_only" | "attending"
>;

/** 保存する条件のうち、患者の絞り込みと属性の部分(docs/data-extract-design.md §17・§21)。 */
export function scopeDefinition(scope: ExtractPatientScope): ScopeDefinition {
  return {
    patient_query_code: scope.queryCode ?? undefined,
    patient_folder_id: scope.folderId ?? undefined,
    strata: scope.strata.length ? scope.strata.map((s) => compactDefinition(s)) : undefined,
    strata_only: (scope.strata.length > 0 && scope.strataOnly) || undefined,
    attending: scope.attending || undefined,
  };
}

/** 保存した条件の患者の絞り込みと属性を戻す(null なら外す)。 */
export function applyScopeDefinition(scope: ExtractPatientScope, definition: ScopeDefinition | null) {
  scope.setQueryCode(definition?.patient_query_code ?? null);
  scope.setFolderId(definition?.patient_folder_id ?? null);
  scope.setStrata(definition?.strata ?? []);
  scope.setStrataOnly(definition?.strata_only ?? false);
  scope.setAttending(definition?.attending ?? "");
}
