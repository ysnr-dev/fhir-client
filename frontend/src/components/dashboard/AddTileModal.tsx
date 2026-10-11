import { useState } from "react";
import type { ExtractQuery } from "../../api/masterClient";
import { DASHBOARD_VIEWS, type DashboardView } from "../../fhir/dashboardLayout";
import { EXTRACT_TABS, type ExtractTab } from "../../fhir/extractRecordQuery";
import { ExtractQuerySelect } from "../extract/ExtractQuerySelect";
import { Modal } from "../Modal";

/** タイルを足す(タブ・保存した条件・表示・タイトル)。 */
export function AddTileModal({
  queries,
  onAdd,
  onClose,
}: {
  queries: ExtractQuery[];
  onAdd: (tile: { query_code: string; view: DashboardView; title?: string }) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<ExtractTab>("patient");
  const [queryId, setQueryId] = useState<number | null>(null);
  const [view, setView] = useState<DashboardView>("count");
  const [title, setTitle] = useState("");
  const candidates = queries.filter((q) => q.tab === tab);
  const query = candidates.find((q) => q.id === queryId) ?? null;

  return (
    <Modal title="タイルを追加" onClose={onClose}>
      <div className="data-extract__save">
        <label className="extract-field">
          タブ
          <select
            value={tab}
            onChange={(e) => {
              setTab(e.target.value as ExtractTab);
              setQueryId(null);
            }}
          >
            {EXTRACT_TABS.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="extract-field">
          条件
          <ExtractQuerySelect queries={candidates} value={queryId} emptyLabel="選択" onChange={(q) => setQueryId(q?.id ?? null)} />
        </label>
        <label className="extract-field">
          表示
          <select value={view} onChange={(e) => setView(e.target.value as DashboardView)}>
            {DASHBOARD_VIEWS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="extract-field">
          タイトル
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={query?.name ?? ""} />
        </label>
        <div className="lab-order-item__actions">
          <button
            type="button"
            disabled={!query}
            onClick={() => query && onAdd({ query_code: query.code, view, title: title.trim() || undefined })}
          >
            追加
          </button>
        </div>
      </div>
    </Modal>
  );
}
