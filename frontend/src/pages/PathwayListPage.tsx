import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { PathwaySearchParams, PathwaySetting, PathwayStatus } from "../api/masterClient";
import { usePathwaySearch } from "../api/masterQueries";
import { useSelfDepartments } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { departmentCode, departmentDisplayName } from "../fhir/departmentHelpers";
import {
  PATHWAY_SETTING_OPTIONS,
  PATHWAY_STATUS_OPTIONS,
  displayOfOption,
} from "../fhir/pathwayHelpers";

// クリニカルパス(施設パス)定義マスタの一覧。編集は 1 パス 1 ページ(/pathways/:id)。
// 設計は docs/clinical-pathway-design.md。
export function PathwayListPage() {
  const navigate = useNavigate();
  const [nameInput, setNameInput] = useState("");
  const [departmentInput, setDepartmentInput] = useState("");
  const [statusInput, setStatusInput] = useState<PathwayStatus | "">("");
  const [settingInput, setSettingInput] = useState<PathwaySetting | "">("");
  const [activeOnly, setActiveOnly] = useState(false);
  const [filters, setFilters] = useState<Omit<PathwaySearchParams, "page" | "per">>({});
  const [page, setPage] = useState(1);
  const { departments } = useSelfDepartments();

  const list = usePathwaySearch(filters, page);
  const hasNext = list.data ? page * list.data.per < list.data.total : false;

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setFilters({
      name: nameInput,
      department_code: departmentInput,
      status: statusInput,
      setting: settingInput,
      active: activeOnly,
    });
    setPage(1);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>パス定義</h1>
        <div className="page__header-actions">
          <Link to="/pathways/new" className="button">
            パスを追加
          </Link>
        </div>
      </div>

      <form className="patient-search-form" onSubmit={handleSearch}>
        <label>
          名称・カナ
          <input type="text" value={nameInput} onChange={(e) => setNameInput(e.target.value)} />
        </label>
        <label>
          診療科
          <select value={departmentInput} onChange={(e) => setDepartmentInput(e.target.value)}>
            <option value="">すべて</option>
            {departments.map((d) => (
              <option key={d.id} value={departmentCode(d)}>
                {departmentDisplayName(d)}
              </option>
            ))}
          </select>
        </label>
        <label>
          入外
          <select value={settingInput} onChange={(e) => setSettingInput(e.target.value as PathwaySetting | "")}>
            <option value="">すべて</option>
            {PATHWAY_SETTING_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
        <label>
          状態
          <select value={statusInput} onChange={(e) => setStatusInput(e.target.value as PathwayStatus | "")}>
            <option value="">すべて</option>
            {PATHWAY_STATUS_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
        <label className="dose-conversion__checkbox">
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
          有効期間内のみ
        </label>
        <div className="patient-search-form__actions">
          <button type="submit">検索</button>
          <button
            type="button"
            onClick={() => {
              setNameInput("");
              setDepartmentInput("");
              setStatusInput("");
              setSettingInput("");
              setActiveOnly(false);
              setFilters({});
              setPage(1);
            }}
          >
            クリア
          </button>
        </div>
      </form>

      <ErrorBanner error={list.error} />

      <table className="master-search__table">
        <thead>
          <tr>
            <th className="rad-item__compact">コード</th>
            <th>名称</th>
            <th>診療科</th>
            <th className="rad-item__compact">入外</th>
            <th className="rad-item__compact">予定日数</th>
            <th className="rad-item__compact">病日</th>
            <th className="rad-item__compact">版</th>
            <th className="rad-item__compact">状態</th>
            <th className="rad-item__compact">有効期間</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((pathway) => (
            <tr
              key={pathway.id}
              className="master-search__row"
              onClick={() => navigate(`/pathways/${pathway.id}`)}
            >
              <td className="rad-item__compact">{pathway.pathway_code}</td>
              <td>
                {pathway.name}
                {pathway.short_name && (
                  <span className="lab-order-item__code">（{pathway.short_name}）</span>
                )}
              </td>
              <td>{pathway.department_name ?? ""}</td>
              <td className="rad-item__compact">{displayOfOption(PATHWAY_SETTING_OPTIONS, pathway.setting)}</td>
              <td className="rad-item__compact">
                {pathway.scheduled_days !== null ? `${pathway.scheduled_days} 日` : ""}
              </td>
              <td className="rad-item__compact">
                {pathway.event_count ? `${pathway.event_count} 日分(〜${pathway.last_day} 日目)` : ""}
              </td>
              <td className="rad-item__compact">{pathway.version ?? ""}</td>
              <td className="rad-item__compact">
                <span className={`regimen-status regimen-status--${pathway.status}`}>
                  {displayOfOption(PATHWAY_STATUS_OPTIONS, pathway.status)}
                </span>
              </td>
              <td className="rad-item__compact">
                {(pathway.valid_from || pathway.valid_to) &&
                  `${pathway.valid_from ?? ""}〜${pathway.valid_to ?? ""}`}
              </td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr>
              <td colSpan={9} className="master-search__empty">
                パスがありません
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="master-search__pager">
        <button type="button" onClick={() => setPage((p) => p - 1)} disabled={page <= 1 || list.isFetching}>
          前へ
        </button>
        <span>
          {page} ページ目 (全 {list.data?.total ?? 0} 件)
        </span>
        <button type="button" onClick={() => setPage((p) => p + 1)} disabled={!hasNext || list.isFetching}>
          次へ
        </button>
      </div>
    </div>
  );
}
