import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { RegimenSearchParams, RegimenStatus } from "../api/masterClient";
import { useRegimenSearch } from "../api/masterQueries";
import { useSelfDepartments } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { departmentCode, departmentDisplayName } from "../fhir/departmentHelpers";
import {
  REGIMEN_PURPOSE_OPTIONS,
  REGIMEN_SETTING_OPTIONS,
  REGIMEN_STATUS_OPTIONS,
  displayOfOption,
} from "../fhir/regimenHelpers";

// 化学療法レジメンマスタの一覧。編集は 1 レジメン 1 ページ(/regimens/:id)。
// 設計は docs/chemo-regimen-design.md。
export function RegimenListPage() {
  const navigate = useNavigate();
  const [nameInput, setNameInput] = useState("");
  const [departmentInput, setDepartmentInput] = useState("");
  const [statusInput, setStatusInput] = useState<RegimenStatus | "">("");
  const [activeOnly, setActiveOnly] = useState(false);
  const [filters, setFilters] = useState<Omit<RegimenSearchParams, "page" | "per">>({});
  const [page, setPage] = useState(1);
  const { departments } = useSelfDepartments();

  const list = useRegimenSearch(filters, page);
  const hasNext = list.data ? page * list.data.per < list.data.total : false;

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setFilters({
      name: nameInput,
      department_code: departmentInput,
      status: statusInput,
      active: activeOnly,
    });
    setPage(1);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>レジメン</h1>
        <div className="page__header-actions">
          <Link to="/regimens/new" className="button">
            レジメンを追加
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
          状態
          <select value={statusInput} onChange={(e) => setStatusInput(e.target.value as RegimenStatus | "")}>
            <option value="">すべて</option>
            {REGIMEN_STATUS_OPTIONS.map((o) => (
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
            <th className="rad-item__compact">治療目的</th>
            <th className="rad-item__compact">実施</th>
            <th className="rad-item__compact">1 クール</th>
            <th className="rad-item__compact">予定クール</th>
            <th className="rad-item__compact">状態</th>
            <th className="rad-item__compact">有効期間</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((regimen) => (
            <tr
              key={regimen.id}
              className="master-search__row"
              onClick={() => navigate(`/regimens/${regimen.id}`)}
            >
              <td className="rad-item__compact">{regimen.regimen_code}</td>
              <td>
                {regimen.name}
                {regimen.short_name && (
                  <span className="lab-order-item__code">（{regimen.short_name}）</span>
                )}
              </td>
              <td>{regimen.department_name ?? ""}</td>
              <td className="rad-item__compact">{displayOfOption(REGIMEN_PURPOSE_OPTIONS, regimen.purpose)}</td>
              <td className="rad-item__compact">{displayOfOption(REGIMEN_SETTING_OPTIONS, regimen.setting)}</td>
              <td className="rad-item__compact">
                {regimen.cycle_days > 0
                  ? `${regimen.cycle_days} 日(投与 ${regimen.treatment_days ?? 0}・休薬 ${regimen.rest_days ?? 0})`
                  : ""}
              </td>
              <td className="rad-item__compact">
                {regimen.planned_cycles !== null ? `${regimen.planned_cycles} クール` : "継続"}
              </td>
              <td className="rad-item__compact">
                <span className={`regimen-status regimen-status--${regimen.status}`}>
                  {displayOfOption(REGIMEN_STATUS_OPTIONS, regimen.status)}
                </span>
              </td>
              <td className="rad-item__compact">
                {(regimen.valid_from || regimen.valid_to) &&
                  `${regimen.valid_from ?? ""}〜${regimen.valid_to ?? ""}`}
              </td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr>
              <td colSpan={9} className="master-search__empty">
                レジメンがありません
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
