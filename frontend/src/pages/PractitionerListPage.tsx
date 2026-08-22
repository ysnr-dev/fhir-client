import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  usePractitionerRoleSearch,
  usePractitionerSearch,
  useSelfOrganization,
  type PractitionerSearchParams,
} from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Pagination } from "../components/Pagination";
import { PractitionerTable } from "../components/PractitionerTable";

const emptySearch: PractitionerSearchParams = { name: "", identifier: "" };

// 自院スタッフの一覧。所属ロール(organization = 自院)を引くので、他院の医師
// (連携先医師の画面で登録するもの)は出てこない。自院未設定の環境では従来どおり
// Practitioner を直接検索して全員を出す。
export function PractitionerListPage() {
  const [search, setSearch] = useState<PractitionerSearchParams>(emptySearch);
  const [inputs, setInputs] = useState<PractitionerSearchParams>(emptySearch);
  const [offset, setOffset] = useState(0);

  const self = useSelfOrganization();
  const byOrganization = Boolean(self.selfOrganizationId);
  const roleSearch = usePractitionerRoleSearch(
    { organizationId: self.selfOrganizationId ?? undefined, ...search },
    offset,
    byOrganization,
  );
  const practitionerSearch = usePractitionerSearch(search, offset, !byOrganization);
  const result = byOrganization ? roleSearch : practitionerSearch;

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

      <ErrorBanner error={result.error} />

      {result.isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <PractitionerTable practitioners={result.practitioners} roles={result.roles} />
          <Pagination
            offset={offset}
            count={result.count}
            total={result.total}
            hasPrevious={result.hasPrevious}
            hasNext={result.hasNext}
            onPrevious={() => setOffset((o) => Math.max(0, o - result.count))}
            onNext={() => setOffset((o) => o + result.count)}
          />
        </>
      )}
    </div>
  );
}
