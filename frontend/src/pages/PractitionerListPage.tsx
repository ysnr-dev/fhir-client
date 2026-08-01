import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { usePractitionerSearch, type PractitionerSearchParams } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Pagination } from "../components/Pagination";
import { PractitionerTable } from "../components/PractitionerTable";

const emptySearch: PractitionerSearchParams = { name: "", identifier: "" };

export function PractitionerListPage() {
  const [search, setSearch] = useState<PractitionerSearchParams>(emptySearch);
  const [inputs, setInputs] = useState<PractitionerSearchParams>(emptySearch);
  const [offset, setOffset] = useState(0);

  const { practitioners, roles, total, count, hasPrevious, hasNext, isLoading, error } =
    usePractitionerSearch(search, offset);

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
        <h1>医療従事者一覧</h1>
        <Link to="/practitioners/new" className="button">
          新規登録
        </Link>
      </div>

      <form className="patient-search-form" onSubmit={handleSearch}>
        <label>
          氏名(漢字・カナ部分一致)
          <input
            type="text"
            value={inputs.name}
            onChange={(e) => setInputs({ ...inputs, name: e.target.value })}
          />
        </label>
        <label>
          医籍登録番号
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
          <PractitionerTable practitioners={practitioners} roles={roles} />
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
