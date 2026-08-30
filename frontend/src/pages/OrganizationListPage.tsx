import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  useOrganizationSearch,
  useSelfOrganization,
  type OrganizationSearchParams,
} from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { OrganizationTable } from "../components/OrganizationTable";
import { Pagination } from "../components/Pagination";

const emptySearch: OrganizationSearchParams = { name: "", identifier: "" };

// 自院の医療機関情報。自院が設定済みならその 1 件だけを扱う画面で、検索も
// ページングも要らない。連携先(他院)は /partner-organizations 側で管理する。
export function OrganizationListPage() {
  const self = useSelfOrganization();

  if (self.isLoading) return <div className="page">読み込み中...</div>;
  return self.selfOrganizationId ? <SelfOrganizationView /> : <UnsetOrganizationView />;
}

function SelfOrganizationView() {
  const { organization } = useSelfOrganization();

  return (
    <div className="page">
      <div className="page__header">
        <h1>医療機関</h1>
      </div>
      <p className="connection-settings__lead">
        自院として設定されている医療機関です。別の医療機関を自院にするには「管理 &gt; 施設設定」で
        切り替えてください。
      </p>
      <OrganizationTable organizations={organization ? [organization] : []} />
    </div>
  );
}

// 自院が未設定(初期セットアップ前)。従来どおり全医療機関を扱えるようにして、
// ここから登録 →「管理 > 施設設定」で自院を選ぶ流れにする。
function UnsetOrganizationView() {
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

      <div className="error-banner" role="status">
        <p className="error-banner__line">
          自院が未設定です。自院の医療機関を登録したうえで、「管理 &gt; 施設設定」で選択してください。
          設定するまで、診療科・診察室・医療従事者の所属は手動で選ぶ従来の動作になります。
        </p>
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
