import type { ExtractPatientScope } from "../../hooks/useExtractPatientScope";
import { ExtractQuerySelect } from "./ExtractQuerySelect";
import { PatientFolderSelect } from "./PatientFolderSelect";

// 記録を表にするタブの患者の絞り込みの入力欄と、実行したときの該当人数(hooks/useExtractPatientScope)。

export function PatientScopeFields({ scope }: { scope: ExtractPatientScope }) {
  return (
    <>
      <label className="extract-field">
        患者
        <ExtractQuerySelect
          queries={scope.queries}
          value={scope.queryId}
          emptyLabel="すべて"
          onChange={(next) => scope.setQueryId(next?.id ?? null)}
        />
      </label>
      <label className="extract-field">
        患者フォルダ
        <PatientFolderSelect
          folders={scope.folders}
          value={scope.folderId}
          emptyLabel="すべて"
          onChange={(next) => scope.setFolderId(next?.id ?? null)}
        />
      </label>
    </>
  );
}

export function PatientScopeSummary({ scope }: { scope: ExtractPatientScope }) {
  const { query, folder } = scope.summary;
  return (
    <>
      {query && <span className="order-select__muted">{`「${query.name}」に該当 ${query.count} 人`}</span>}
      {folder && <span className="order-select__muted">{`フォルダ「${folder.name}」に ${folder.count} 人`}</span>}
    </>
  );
}

export function PatientScopeProgress({ scope }: { scope: ExtractPatientScope }) {
  if (!scope.running) return null;
  return <span className="order-select__muted">{`患者を抽出中(検索 ${scope.requests} 回)`}</span>;
}
