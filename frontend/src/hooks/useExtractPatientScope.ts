import { useMemo, useState } from "react";
import { fetchPatientFolderMembers } from "../api/masterClient";
import { useExtractQueries, usePatientFolders } from "../api/masterQueries";
import { useExtractRun } from "../api/queries";
import { patientFolderPath } from "../components/patientFolderTree";
import { leafLabel } from "../fhir/extractQueryHelpers";
import { useDefinitionOwners } from "./useDefinitionOwners";

// データ抽出の記録を表にするタブ(テンプレート・検査結果)の患者の絞り込み。「患者」タブに保存した条件と
// 患者フォルダ(下位フォルダを含む)を選べ、両方なら両方に入る患者に絞る(docs/data-extract-design.md §8)。

interface ScopeSummary {
  query: { name: string; count: number } | null;
  folder: { name: string; count: number } | null;
}

export function useExtractPatientScope() {
  const owners = useDefinitionOwners("自分の条件");
  const queryList = useExtractQueries(owners.departmentId, owners.practitionerId, owners.ready);
  const queries = useMemo(() => queryList.data?.items ?? [], [queryList.data]);
  const folderList = usePatientFolders(owners.departmentId, owners.practitionerId);
  const folders = useMemo(() => folderList.data?.items ?? [], [folderList.data]);
  const patientExtract = useExtractRun();
  // 選んだ「患者」タブの条件は code で持つ(保存した記録タブの条件から、一覧が読める前でも指せるように)。
  const [queryCode, setQueryCode] = useState<string | null>(null);
  const queryId = queries.find((q) => q.code === queryCode)?.id ?? null;
  const setQueryId = (id: number | null) => setQueryCode(queries.find((q) => q.id === id)?.code ?? null);
  const [folderId, setFolderId] = useState<number | null>(null);
  const [folderError, setFolderError] = useState<unknown>(null);
  const [summary, setSummary] = useState<ScopeSummary>({ query: null, folder: null });

  /**
   * 選んだ条件・フォルダの患者。どちらも選んでいなければ undefined(全患者)、読めなければ null。
   * 患者の条件は実行のたびに抽出し直す。
   */
  async function resolve(): Promise<string[] | undefined | null> {
    const query = queries.find((q) => q.code === queryCode) ?? null;
    const folder = folders.find((f) => f.id === folderId) ?? null;
    const next: ScopeSummary = { query: null, folder: null };
    setSummary(next);
    setFolderError(null);
    let patientIds: string[] | undefined;
    if (folder) {
      try {
        const members = await fetchPatientFolderMembers({ patient_folder_id: folder.id, include_descendants: true });
        patientIds = [...new Set(members.items.map((m) => m.patient_id))];
        next.folder = { name: patientFolderPath(folders, folder.id), count: patientIds.length };
      } catch (error) {
        setFolderError(error);
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
    setSummary({ ...next });
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
    resolve,
    summary,
    cancel: patientExtract.cancel,
    running: patientExtract.running,
    requests: patientExtract.requests,
    listError: queryList.error ?? folderList.error,
    error: folderError ?? patientExtract.error,
  };
}

export type ExtractPatientScope = ReturnType<typeof useExtractPatientScope>;

/** 保存する条件のうち、患者の絞り込みの部分(docs/data-extract-design.md §17)。 */
export function scopeDefinition(scope: ExtractPatientScope): {
  patient_query_code?: string;
  patient_folder_id?: number;
} {
  return {
    patient_query_code: scope.queryCode ?? undefined,
    patient_folder_id: scope.folderId ?? undefined,
  };
}

/** 保存した条件の患者の絞り込みを戻す(null なら外す)。 */
export function applyScopeDefinition(
  scope: ExtractPatientScope,
  definition: { patient_query_code?: string; patient_folder_id?: number } | null,
) {
  scope.setQueryCode(definition?.patient_query_code ?? null);
  scope.setFolderId(definition?.patient_folder_id ?? null);
}
