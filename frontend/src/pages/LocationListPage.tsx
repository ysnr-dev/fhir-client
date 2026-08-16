import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useLocationSearch, type LocationSearchParams } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { LocationTable } from "../components/LocationTable";
import { Pagination } from "../components/Pagination";
import { LOCATION_STATUS_OPTIONS } from "../fhir/locationHelpers";

const emptySearch: LocationSearchParams = { name: "", status: "" };

export function LocationListPage() {
  const [search, setSearch] = useState<LocationSearchParams>(emptySearch);
  const [inputs, setInputs] = useState<LocationSearchParams>(emptySearch);
  const [offset, setOffset] = useState(0);

  const { locations, total, count, hasPrevious, hasNext, isLoading, error } = useLocationSearch(
    search,
    offset,
  );

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
        <h1>診察室・撮影室一覧</h1>
        <Link to="/locations/new" className="button">
          新規登録
        </Link>
      </div>

      <form className="patient-search-form" onSubmit={handleSearch}>
        <label>
          名称(前方一致)
          <input
            type="text"
            value={inputs.name}
            onChange={(e) => setInputs({ ...inputs, name: e.target.value })}
          />
        </label>
        <label>
          状態
          <select
            value={inputs.status}
            onChange={(e) => setInputs({ ...inputs, status: e.target.value })}
          >
            <option value="">すべて</option>
            {LOCATION_STATUS_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
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
          <LocationTable locations={locations} />
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
