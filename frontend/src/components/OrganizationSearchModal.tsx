import { useState, type KeyboardEvent } from "react";
import {
  useOrganizationSearch,
  useSelfOrganization,
  type OrganizationSearchParams,
} from "../api/queries";
import {
  organizationDisplayName,
  organizationInstitutionNumber,
} from "../fhir/organizationHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { Pagination } from "./Pagination";

interface OrganizationSearchModalProps {
  onSelect: (organization: fhir4.Organization) => void;
  onClose: () => void;
  /** 自院を候補から外す(連携先医療機関だけを選ばせる場面で使う)。 */
  excludeSelf?: boolean;
  title?: string;
}

const emptySearch: OrganizationSearchParams = { name: "", identifier: "" };

// マスタ検索モーダル(病名・医薬品など)は打鍵ごとに backend を引くが、
// 医療機関は上流 FHIR サーバーへのリクエストになるため検索ボタンで確定する
// (医療機関一覧画面と同じ inputs / search の二段構え)。
export function OrganizationSearchModal({
  onSelect,
  onClose,
  excludeSelf = false,
  title = "医療機関を選択",
}: OrganizationSearchModalProps) {
  // 自院の除外は上流に任せる(_id:not)。取得後に落とすと total とページ内件数がずれる。
  const { selfOrganizationId } = useSelfOrganization();
  const [inputs, setInputs] = useState<OrganizationSearchParams>(emptySearch);
  const [search, setSearch] = useState<OrganizationSearchParams>(emptySearch);
  const [offset, setOffset] = useState(0);

  const { bundle, total, count, hasPrevious, hasNext, isFetching, error } = useOrganizationSearch(
    search,
    offset,
    excludeSelf ? selfOrganizationId : undefined,
  );
  const organizations =
    bundle?.entry?.map((e) => e.resource).filter((r): r is fhir4.Organization => Boolean(r)) ?? [];

  function runSearch() {
    setSearch(inputs);
    setOffset(0);
  }

  // 回答フォーム側が input 上の Enter による暗黙の submit を止めているため、
  // モーダル内では自前で Enter を検索に割り当てる。
  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      runSearch();
    }
  }

  return (
    <Modal title={title} onClose={onClose} className="modal--wide">
      <div className="master-search__form">
        <label>
          医療機関名(部分一致)
          <input
            type="text"
            value={inputs.name}
            onChange={(e) => setInputs({ ...inputs, name: e.target.value })}
            onKeyDown={handleKeyDown}
          />
        </label>
        <label>
          保険医療機関番号
          <input
            type="text"
            value={inputs.identifier}
            onChange={(e) => setInputs({ ...inputs, identifier: e.target.value })}
            onKeyDown={handleKeyDown}
          />
        </label>
        <button type="button" onClick={runSearch} disabled={isFetching}>
          検索
        </button>
      </div>
      <ErrorBanner error={error} />
      <div className="master-search__table-wrap">
        <table className="master-search__table">
          <thead>
            <tr>
              <th>保険医療機関番号</th>
              <th>医療機関名</th>
              <th>電話番号</th>
              <th>所在地</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {organizations.map((organization) => (
              <tr key={organization.id}>
                <td>{organizationInstitutionNumber(organization) || "-"}</td>
                <td>{organizationDisplayName(organization)}</td>
                <td>{organization.telecom?.find((t) => t.system === "phone")?.value ?? "-"}</td>
                <td>{organization.address?.[0]?.text ?? "-"}</td>
                <td className="master-search__actions">
                  <button type="button" onClick={() => onSelect(organization)}>
                    選択
                  </button>
                </td>
              </tr>
            ))}
            {!isFetching && organizations.length === 0 && (
              <tr>
                <td colSpan={5} className="master-search__empty">
                  該当する医療機関がありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination
        offset={offset}
        count={count}
        total={total}
        hasPrevious={hasPrevious}
        hasNext={hasNext}
        onPrevious={() => setOffset((o) => Math.max(0, o - count))}
        onNext={() => setOffset((o) => o + count)}
      />
    </Modal>
  );
}
