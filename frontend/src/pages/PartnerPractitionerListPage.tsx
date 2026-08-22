import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  useOrganizationOptions,
  usePractitionerRoleSearch,
  useSelfOrganization,
} from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Pagination } from "../components/Pagination";
import { PractitionerTable } from "../components/PractitionerTable";
import { organizationDisplayName } from "../fhir/organizationHelpers";

interface PartnerSearch {
  name: string;
  identifier: string;
  organizationId: string;
}

const emptySearch: PartnerSearch = { name: "", identifier: "", organizationId: "" };

// 連携先医師(他院の医師)の一覧。診療情報提供書の宛先候補として登録するもので、
// 自院スタッフ(医療従事者一覧)とは画面を分ける。FHIR 上の表現は同じ
// Practitioner + PractitionerRole で、所属ロールの organization が他院になる。
export function PartnerPractitionerListPage() {
  const [search, setSearch] = useState<PartnerSearch>(emptySearch);
  const [inputs, setInputs] = useState<PartnerSearch>(emptySearch);
  const [offset, setOffset] = useState(0);

  const { selfOrganizationId } = useSelfOrganization();
  const { organizations } = useOrganizationOptions();
  const partnerOrganizations = organizations.filter((o) => o.id !== selfOrganizationId);

  // 上流の Organization 検索に「自院を除く」条件は無いので、「すべて」のときは
  // 連携先の id を列挙して渡す(複数値 = OR)。こうすると画面側で間引かずに済み、
  // 件数とページ送りが上流の結果とずれない。
  const partnerIds = partnerOrganizations
    .map((organization) => organization.id)
    .filter((id): id is string => Boolean(id));
  const result = usePractitionerRoleSearch(
    {
      organizationId: search.organizationId || undefined,
      organizationIds: search.organizationId ? undefined : partnerIds,
      name: search.name || undefined,
      identifier: search.identifier || undefined,
    },
    offset,
    Boolean(search.organizationId) || partnerIds.length > 0,
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
        <h1>連携先医師一覧</h1>
        <Link to="/partner-practitioners/new" className="button">
          新規登録
        </Link>
      </div>

      <form className="patient-search-form" onSubmit={handleSearch}>
        <label>
          連携先医療機関
          <select
            value={inputs.organizationId}
            onChange={(e) => setInputs({ ...inputs, organizationId: e.target.value })}
          >
            <option value="">すべて</option>
            {partnerOrganizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organizationDisplayName(organization)}
              </option>
            ))}
          </select>
        </label>
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
          <PractitionerTable
            practitioners={result.practitioners}
            roles={result.roles}
            basePath="/partner-practitioners"
          />
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
