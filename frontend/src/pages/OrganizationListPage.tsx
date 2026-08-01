import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useOrganizationSearch, type OrganizationSearchParams } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { OrganizationTable } from "../components/OrganizationTable";
import { Pagination } from "../components/Pagination";

const emptySearch: OrganizationSearchParams = { name: "", identifier: "" };

export function OrganizationListPage() {
  const [search, setSearch] = useState<OrganizationSearchParams>(emptySearch);
  const [inputs, setInputs] = useState<OrganizationSearchParams>(emptySearch);
  const [offset, setOffset] = useState(0);

  const { bundle, total, count, hasPrevious, hasNext, isLoading, error } = useOrganizationSearch(
    search,
    offset,
  );
  const organizations =
    bundle?.entry?.map((e) => e.resource).filter((r): r is fhir4.Organization => Boolean(r)) ?? [];

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setSearch(inputs);
    setOffset(0);
  }

  function handleReset() {
    setInputs(emptySearch);
    setSearch(emptySearch);
    setOffset(0);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>医療機関一覧</h1>
        <Link to="/organizations/new" className="button">
          新規登録
        </Link>
      </div>

      <form className="patient-search-form" onSubmit={handleSearch}>
        <label>
          医療機関名(部分一致)
          <input
            type="text"
            value={inputs.name}
            onChange={(e) => setInputs({ ...inputs, name: e.target.value })}
          />
        </label>
        <label>
          保険医療機関番号
          <input
            type="text"
            value={inputs.identifier}
            onChange={(e) => setInputs({ ...inputs, identifier: e.target.value })}
          />
        </label>
        <div className="patient-search-form__actions">
          <button type="submit">検索</button>
          <button type="button" onClick={handleReset}>
            クリア
          </button>
        </div>
      </form>

      <ErrorBanner error={error} />

      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <OrganizationTable organizations={organizations} />
          <Pagination
            offset={offset}
            count={count}
            total={total}
            hasPrevious={hasPrevious}
            hasNext={hasNext}
            onPrevious={() => setOffset((o) => Math.max(0, o - count))}
            onNext={() => setOffset((o) => o + count)}
          />
        </>
      )}
    </div>
  );
}
