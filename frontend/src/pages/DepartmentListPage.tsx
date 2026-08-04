import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  useDepartmentList,
  useDepartmentsOf,
  useOrganizationOptions,
  useSeedDepartments,
  type DepartmentSearchParams,
} from "../api/queries";
import { DepartmentTable } from "../components/DepartmentTable";
import { ErrorBanner } from "../components/ErrorBanner";
import { Pagination } from "../components/Pagination";
import { SSMIX2_DEPARTMENT_CODES } from "../fhir/departmentCodes";
import { buildDepartmentSeedBundle } from "../fhir/departmentHelpers";
import { organizationDisplayName } from "../fhir/organizationHelpers";

const emptySearch: DepartmentSearchParams = { name: "", partOfId: "" };

export function DepartmentListPage() {
  // 医療機関一覧から「診療科」で来たときは、その施設で絞った状態から始める。
  const [searchParams] = useSearchParams();
  const initialSearch: DepartmentSearchParams = {
    ...emptySearch,
    partOfId: searchParams.get("organization") ?? "",
  };
  const [search, setSearch] = useState<DepartmentSearchParams>(initialSearch);
  const [inputs, setInputs] = useState<DepartmentSearchParams>(initialSearch);
  const [offset, setOffset] = useState(0);
  const [seedMessage, setSeedMessage] = useState<string | null>(null);

  const { organizations } = useOrganizationOptions();
  // 診療科コード昇順は上流でソートできないため、全件取得して画面側で並べ替え・ページングする。
  const { departments: allDepartments, total, count, isLoading, error } = useDepartmentList(search);
  const departments = allDepartments.slice(offset, offset + count);

  // 一括登録は「どの医療機関の下に作るか」が決まって初めて実行できる。
  const seedTargetId = search.partOfId ?? "";
  const { data: existingDepartments, isFetching: loadingExisting } = useDepartmentsOf(seedTargetId);
  const seedDepartments = useSeedDepartments();

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setSearch(inputs);
    setOffset(0);
    setSeedMessage(null);
  }

  function handleReset() {
    setInputs(emptySearch);
    setSearch(emptySearch);
    setOffset(0);
    setSeedMessage(null);
  }

  function handleSeed() {
    if (!seedTargetId || !existingDepartments) return;
    const organization = organizations.find((o) => o.id === seedTargetId);
    const bundle = buildDepartmentSeedBundle(
      SSMIX2_DEPARTMENT_CODES,
      seedTargetId,
      existingDepartments,
    );
    const creating = bundle.entry?.length ?? 0;
    const skipped = SSMIX2_DEPARTMENT_CODES.length - creating;

    if (creating === 0) {
      setSeedMessage("コード表の診療科はすべて登録済みです。");
      return;
    }
    const label = organization ? organizationDisplayName(organization) : seedTargetId;
    if (!window.confirm(`${label} に診療科 ${creating} 件を登録します。よろしいですか?`)) return;

    setSeedMessage(null);
    seedDepartments.mutate(bundle, {
      onSuccess: () => {
        setOffset(0);
        setSeedMessage(
          `診療科 ${creating} 件を登録しました。${skipped > 0 ? `(登録済み ${skipped} 件はスキップ)` : ""}`,
        );
      },
    });
  }

  const newDepartmentPath = seedTargetId
    ? `/departments/new?organization=${seedTargetId}`
    : "/departments/new";

  return (
    <div className="page">
      <div className="page__header">
        <h1>診療科一覧</h1>
        <Link to={newDepartmentPath} className="button">
          新規登録
        </Link>
      </div>

      <form className="patient-search-form" onSubmit={handleSearch}>
        <label>
          所属医療機関
          <select
            value={inputs.partOfId}
            onChange={(e) => setInputs({ ...inputs, partOfId: e.target.value })}
          >
            <option value="">すべて</option>
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organizationDisplayName(organization)}
              </option>
            ))}
          </select>
        </label>
        <label>
          診療科名(部分一致)
          <input
            type="text"
            value={inputs.name}
            onChange={(e) => setInputs({ ...inputs, name: e.target.value })}
          />
        </label>
        <div className="patient-search-form__actions">
          <button type="submit">検索</button>
          <button type="button" onClick={handleReset}>
            クリア
          </button>
        </div>
      </form>

      <div className="department-seed">
        <button
          type="button"
          onClick={handleSeed}
          disabled={!seedTargetId || loadingExisting || seedDepartments.isPending}
        >
          {seedDepartments.isPending ? "登録中..." : "コード表から一括登録"}
        </button>
        <p>
          {seedTargetId
            ? `SS-MIX2 統一診療科コード表の 2 ケタ科 ${SSMIX2_DEPARTMENT_CODES.length} 件のうち、未登録のものを選択中の医療機関に登録します。`
            : "一括登録するには、所属医療機関を選んで検索してください。"}
        </p>
        {seedMessage && <p>{seedMessage}</p>}
      </div>

      <ErrorBanner error={error} />
      <ErrorBanner error={seedDepartments.error} />

      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <DepartmentTable departments={departments} />
          <Pagination
            offset={offset}
            count={count}
            total={total}
            hasPrevious={offset > 0}
            hasNext={offset + count < total}
            onPrevious={() => setOffset((o) => Math.max(0, o - count))}
            onNext={() => setOffset((o) => o + count)}
          />
        </>
      )}
    </div>
  );
}
