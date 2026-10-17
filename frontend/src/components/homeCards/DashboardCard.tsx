import { useMemo } from "react";
import { useDashboards, useExtractQueries, usePatientFolders } from "../../api/masterQueries";
import { normalizeDashboard } from "../../fhir/dashboardLayout";
import { useDashboardRun } from "../../hooks/useDashboardRun";
import { useDefinitionOwners } from "../../hooks/useDefinitionOwners";
import { useExtractRunContext } from "../../hooks/useExtractRunContext";
import { DashboardTile } from "../dashboard/DashboardTile";
import { ErrorBanner } from "../ErrorBanner";
import { HomeCardFrame, HomeCardLoading, type HomeCardProps } from "./shared";

const noop = () => {};

/**
 * 保存したダッシュボード 1 つをそのまま置く(閲覧のみ)。抽出条件は上流に重いので開いただけでは
 * 走らせず、「実行」で全タイルを実行する(ダッシュボードの画面と同じ)。
 */
export function DashboardCard({ card }: HomeCardProps<"dashboard">) {
  const { ready, departmentId, practitionerId, teamIds } = useDefinitionOwners("自分のダッシュボード");
  const list = useDashboards(departmentId, practitionerId, ready, teamIds);
  const dashboard = list.data?.items.find((d) => d.code === card.settings.code);
  const queryList = useExtractQueries(departmentId, practitionerId, ready, "all", teamIds);
  const queries = useMemo(() => queryList.data?.items ?? [], [queryList.data]);
  const folderList = usePatientFolders(departmentId, practitionerId);
  const folders = useMemo(() => folderList.data?.items ?? [], [folderList.data]);
  const context = useExtractRunContext();
  const run = useDashboardRun(queries, folders, context);
  const body = useMemo(() => (dashboard ? normalizeDashboard(dashboard.definition) : null), [dashboard]);

  return (
    <HomeCardFrame
      title={dashboard?.name ?? "ダッシュボード"}
      wide
      link={{ to: dashboard ? `/dashboards?id=${dashboard.id}` : "/dashboards", label: "ダッシュボード" }}
      actions={
        <button
          type="button"
          disabled={!body || body.tiles.length === 0 || run.running}
          onClick={() => body && void run.runTiles(body.tiles)}
        >
          {run.running ? "実行中..." : "実行"}
        </button>
      }
    >
      <ErrorBanner error={list.error ?? queryList.error ?? folderList.error} />
      {list.isPending || !ready ? (
        <HomeCardLoading />
      ) : !body ? (
        <p className="home__empty">ダッシュボードが見つかりません。</p>
      ) : body.tiles.length === 0 ? (
        <p className="home__empty">タイルはありません。</p>
      ) : (
        <div className="dashboard home__dashboard">
          <div className="dashboard__grid">
            {body.tiles.map((tile) => (
              <DashboardTile
                key={tile.id}
                tile={tile}
                query={queries.find((q) => q.code === tile.query_code)}
                state={run.states[tile.id] ?? { running: false, ranAt: null, outcome: null }}
                editing={false}
                onRun={() => void run.runTiles([tile])}
                onRemove={noop}
                onMoveStart={noop}
                onResizeStart={noop}
              />
            ))}
          </div>
        </div>
      )}
    </HomeCardFrame>
  );
}
