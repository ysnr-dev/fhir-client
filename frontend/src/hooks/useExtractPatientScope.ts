import { useMemo, useState } from "react";
import { fetchPatientFolderMembers, type ExtractQuery, type PatientFolder } from "../api/masterClient";
import { useExtractQueries, usePatientFolders } from "../api/masterQueries";
import { useExtractRun, type ExtractResult, type ExtractRunOptions } from "../api/queries";
import { patientFolderPath } from "../components/patientFolderTree";
import { leafLabel, validateExtractQuery, type ExtractQueryBody } from "../fhir/extractQueryHelpers";
import { resolvePeriod, type ExtractLeaf, type ExtractPeriod, type ResolvedPeriod } from "../fhir/extractQueryModel";
import {
  compactDefinition,
  isFolderStratum,
  stratumLeaf,
  type AttendingMode,
  type ExtractRecordDefinition,
  type ExtractStratum,
} from "../fhir/extractRecordQuery";
import { STRATUM_COLUMN } from "../fhir/recordTableHelpers";
import { today } from "../lib/dates";
import { useDefinitionOwners } from "./useDefinitionOwners";

// データ抽出の記録を表にするタブの患者の絞り込みと、患者ごとの属性(比較群・担当医)。
// 絞り込みは「患者」タブに保存した条件と患者フォルダ(下位フォルダを含む)で、両方なら両方に入る患者
// (docs/data-extract-design.md §8)。比較群と担当医は §21。クラスタタブ(§22)は比較群をクラスタとして使う。

export interface ScopeSummary {
  query: { name: string; count: number } | null;
  folder: { name: string; count: number } | null;
  strata: { name: string; count: number }[];
}

/** 実行したときの比較群と担当医の決め方(結果の表の属性の列はこれで組む)。 */
export interface RanScope {
  /** 患者 id → 入った比較群の名前(比較群の並び順)。比較群を使っていなければ null。 */
  groupsOf: Map<string, string[]> | null;
  attending: AttendingMode | null;
  /** タブの期間(担当医を決める記録の期間)。 */
  range: ResolvedPeriod | null;
  /** 比較群の呼び名(列の見出し。「比較群」か「クラスタ」)。 */
  groupLabel: string;
}

/** 比較群の名前。付けた名前、保存した条件の名前、患者フォルダの名前、条件の表示名の順。 */
export function stratumName(stratum: ExtractStratum, queries: ExtractQuery[], folders: PatientFolder[]): string {
  if (stratum.label?.trim()) return stratum.label.trim();
  if (stratum.query_code) return queries.find((q) => q.code === stratum.query_code)?.name ?? "保存した条件";
  if (isFolderStratum(stratum)) {
    const id = stratum.patient_folder_id;
    return (id != null && folders.some((f) => f.id === id) && patientFolderPath(folders, id)) || "患者フォルダ";
  }
  return stratum.kind ? leafLabel(stratum as ExtractLeaf) : "比較群";
}

/** 条件型の比較群か(保存した条件・患者フォルダでない)。 */
function isLeafStratum(stratum: ExtractStratum): boolean {
  return Boolean(stratum.kind) && !stratum.query_code && !isFolderStratum(stratum);
}

/** 比較群の入力の誤り(実行の前に確かめる)。名前が重なると列の値で区別できないので弾く。 */
export function strataErrors(
  strata: ExtractStratum[],
  queries: ExtractQuery[],
  folders: PatientFolder[],
  groupLabel: string,
): string[] {
  const errors: string[] = [];
  const names = strata.map((s) => stratumName(s, queries, folders));
  strata.forEach((s, i) => {
    if (isFolderStratum(s) && s.patient_folder_id == null) errors.push(`${groupLabel}「${names[i]}」: 患者フォルダを選んでください。`);
    if (!s.kind && !isFolderStratum(s) && !s.query_code) errors.push(`${groupLabel}「${names[i]}」: 条件を選んでください。`);
  });
  const duplicated = [...new Set(names.filter((name, i) => names.indexOf(name) !== i))];
  for (const name of duplicated) errors.push(`${groupLabel}の名前「${name}」が重なっています。名前を付けて分けてください。`);
  return errors;
}

/** 絞り込みを解いた結果(患者の id と、結果の表の属性の列に使う評価)。 */
export interface ResolvedPatientScope {
  /** 絞り込みが無ければ undefined(全患者)。 */
  patientIds: string[] | undefined;
  summary: ScopeSummary;
  ran: RanScope;
}

type PatientRun = (
  body: ExtractQueryBody,
  labelOf: (leaf: ExtractLeaf) => string,
  options?: ExtractRunOptions,
) => Promise<ExtractResult | null>;

/**
 * 比較群ごとの患者。条件型の比較群はまとめて 1 回で抽出し、保存した条件の比較群は 1 つずつ抽出し、
 * 患者フォルダの比較群は下位フォルダを含めた患者を読む。読めなければ null。
 */
async function resolveStrata(
  strata: ExtractStratum[],
  period: ExtractPeriod | null | undefined,
  queries: ExtractQuery[],
  folders: PatientFolder[],
  run: PatientRun,
  groupLabel: string,
): Promise<Set<string>[] | null> {
  const names = strata.map((s) => stratumName(s, queries, folders));
  const leaves = strata.flatMap((s, i) => (isLeafStratum(s) ? [stratumLeaf(s, period, `${groupLabel}「${names[i]}」`)] : []));
  const members: (Set<string> | null)[] = strata.map(() => null);
  if (leaves.length > 0) {
    const body: ExtractQueryBody = { schema_version: 1, root: { op: "or", children: leaves } };
    const errors = validateExtractQuery(body);
    if (errors.length > 0) throw new Error(errors.join("\n"));
    const result = await run(body, leafLabel, { skipPatients: true });
    if (!result) return null;
    strata.forEach((s, i) => {
      if (isLeafStratum(s)) members[i] = new Set(result.hits.get(s.key)?.keys() ?? []);
    });
  }
  for (const [i, s] of strata.entries()) {
    if (!isFolderStratum(s)) continue;
    const folder = folders.find((f) => f.id === s.patient_folder_id);
    if (!folder) throw new Error(`${groupLabel}「${names[i]}」: 患者フォルダが見つかりません。`);
    const folderMembers = await fetchPatientFolderMembers({ patient_folder_id: folder.id, include_descendants: true });
    members[i] = new Set(folderMembers.items.map((m) => m.patient_id));
  }
  for (const [i, s] of strata.entries()) {
    if (!s.query_code) continue;
    const query = queries.find((q) => q.code === s.query_code);
    if (!query) throw new Error(`${groupLabel}「${names[i]}」: 保存した条件が見つかりません。`);
    const result = await run(query.definition, leafLabel, { skipPatients: true });
    if (!result) return null;
    members[i] = new Set(result.rows.map((row) => row.patientId));
  }
  return members.map((m) => m ?? new Set());
}

/**
 * 保存した条件の患者の絞り込み(患者の条件・フォルダ・比較群)を解く。絞り込みの読み込みに失敗したら
 * 例外、患者の抽出が止まった(中止・エラー。run が null)なら null。patientIds は絞り込みが無ければ undefined(全患者)。
 * period はタブの期間(期間を入れていない比較群と担当医に使う)。groupLabel は比較群の呼び名(既定「比較群」)。
 */
export async function resolvePatientScope(
  definition: ScopeDefinition,
  period: ExtractPeriod | null | undefined,
  queries: ExtractQuery[],
  folders: PatientFolder[],
  run: PatientRun,
  options: { groupLabel?: string } = {},
): Promise<ResolvedPatientScope | null> {
  const groupLabel = options.groupLabel ?? STRATUM_COLUMN;
  const query = queries.find((q) => q.code === definition.patient_query_code) ?? null;
  const folder = folders.find((f) => f.id === definition.patient_folder_id) ?? null;
  const strata = definition.strata ?? [];
  const summary: ScopeSummary = { query: null, folder: null, strata: [] };
  let patientIds: string[] | undefined;
  if (folder) {
    const members = await fetchPatientFolderMembers({ patient_folder_id: folder.id, include_descendants: true });
    patientIds = [...new Set(members.items.map((m) => m.patient_id))];
    summary.folder = { name: patientFolderPath(folders, folder.id), count: patientIds.length };
  }
  if (query) {
    const result = await run(query.definition, leafLabel);
    if (!result) return null;
    const matched = new Set(result.rows.map((row) => row.patientId));
    patientIds = patientIds ? patientIds.filter((id) => matched.has(id)) : [...matched];
    summary.query = { name: query.name, count: matched.size };
  }
  let groupsOf: Map<string, string[]> | null = null;
  if (strata.length > 0) {
    const errors = strataErrors(strata, queries, folders, groupLabel);
    if (errors.length > 0) throw new Error(errors.join("\n"));
    const members = await resolveStrata(strata, period, queries, folders, run, groupLabel);
    if (!members) return null;
    groupsOf = new Map();
    strata.forEach((s, i) => {
      const name = stratumName(s, queries, folders);
      for (const id of members[i]) groupsOf!.set(id, [...(groupsOf!.get(id) ?? []), name]);
    });
    // 比較群の人数は、ほかの絞り込み(患者の条件・フォルダ)に入る患者で数える。
    const inScope = patientIds ? new Set(patientIds) : null;
    summary.strata = strata.map((s, i) => ({
      name: stratumName(s, queries, folders),
      count: inScope ? [...members[i]].filter((id) => inScope.has(id)).length : members[i].size,
    }));
    if (definition.strata_only) {
      const grouped = groupsOf;
      patientIds = patientIds ? patientIds.filter((id) => grouped.has(id)) : [...grouped.keys()];
    }
  }
  return {
    patientIds,
    summary,
    ran: { groupsOf, attending: definition.attending ?? null, range: resolvePeriod(period, today()), groupLabel },
  };
}

/**
 * 記録タブの患者の絞り込みと比較群・担当医の入力。groupLabel は比較群の呼び名、strataOnly を true にすると
 * 「比較群外を除く」を常に付ける(クラスタタブ)。
 */
export function useExtractPatientScope(options: { groupLabel?: string; strataOnly?: boolean } = {}) {
  const groupLabel = options.groupLabel ?? STRATUM_COLUMN;
  const fixedStrataOnly = options.strataOnly === true;
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
  const [strataOnlyState, setStrataOnly] = useState(false);
  const strataOnly = fixedStrataOnly || strataOnlyState;
  const [attending, setAttending] = useState<AttendingMode | "">("");
  const [scopeError, setScopeError] = useState<unknown>(null);
  const [summary, setSummary] = useState<ScopeSummary>({ query: null, folder: null, strata: [] });
  const [ran, setRan] = useState<RanScope | null>(null);

  /**
   * 選んだ条件・フォルダ・比較群の患者。絞り込みが無ければ undefined(全患者)、読めなければ null。
   * 患者の条件と比較群は実行のたびに抽出し直す。period はタブの期間(期間を入れていない比較群と担当医に使う)。
   */
  async function resolve(period?: ExtractPeriod | null): Promise<string[] | undefined | null> {
    setSummary({ query: null, folder: null, strata: [] });
    setScopeError(null);
    setRan(null);
    try {
      const resolved = await resolvePatientScope(
        {
          patient_query_code: queryCode ?? undefined,
          patient_folder_id: folderId ?? undefined,
          strata,
          strata_only: strataOnly,
          attending: attending || undefined,
        },
        period,
        queries,
        folders,
        patientExtract.run,
        { groupLabel },
      );
      if (!resolved) return null;
      setSummary(resolved.summary);
      setRan(resolved.ran);
      return resolved.patientIds;
    } catch (error) {
      setScopeError(error);
      return null;
    }
  }

  return {
    groupLabel,
    fixedStrataOnly,
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
