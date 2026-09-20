import { Link } from "react-router-dom";
import type { ExternalSystemSummary } from "../api/adminClient";
import { useExternalSystems, useUpdateExternalSystem } from "../api/adminQueries";
import { ErrorBanner } from "../components/ErrorBanner";

/** 外部システム連携の一覧。システム名から、そのシステムの設定ページへ入る。 */
export function ExternalSystemListPage() {
  const { data, isLoading, error } = useExternalSystems();

  return (
    <div className="page">
      <div className="page__header">
        <h1>外部システム連携</h1>
      </div>
      <ErrorBanner error={error} />
      {isLoading && <p>読み込み中...</p>}
      {data && (
        <table className="external-systems__table">
          <thead>
            <tr>
              <th>システム</th>
              <th>種別</th>
              <th>状態</th>
              <th>有効</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((system) => (
              <SystemRow key={system.key} system={system} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SystemRow({ system }: { system: ExternalSystemSummary }) {
  const update = useUpdateExternalSystem(system.key);

  return (
    <tr>
      <td>
        <Link to={`/external-systems/${system.key}`}>{system.label}</Link>
        {system.description && (
          <span className="external-systems__description">{system.description}</span>
        )}
      </td>
      <td>{system.system_type || "—"}</td>
      <td className={system.usable ? undefined : "external-systems__status--incomplete"}>
        {system.enabled ? (system.usable ? "設定済み" : "設定が足りません") : "無効"}
      </td>
      <td>
        <input
          type="checkbox"
          checked={system.enabled}
          disabled={update.isPending}
          onChange={(e) => update.mutate({ enabled: e.target.checked })}
        />
      </td>
    </tr>
  );
}
