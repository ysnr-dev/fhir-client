import { useState, type KeyboardEvent } from "react";
import {
  useOrganizationSearch,
  usePractitionerRoleSearch,
  usePractitionerSearch,
} from "../api/queries";
import { organizationDisplayName } from "../fhir/organizationHelpers";
import {
  practitionerDisplayKana,
  practitionerDisplayName,
  practitionerRegistrationNumber,
} from "../fhir/practitionerHelpers";
import {
  parsePractitionerRole,
  practitionerRoleLabel,
  PRACTITIONER_ROLE_OPTIONS,
  rolesByPractitionerId,
} from "../fhir/practitionerRoleHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { Pagination } from "./Pagination";

interface PractitionerSearchModalProps {
  onSelect: (practitioner: fhir4.Practitioner, role: fhir4.PractitionerRole | undefined) => void;
  onClose: () => void;
  /** 同じグループで選択済みの医療機関(id が分かっていればそれで絞り込む)。 */
  organizationId?: string;
  /** 医療機関名しか分からないとき(保存済み回答を開いた場合)の絞り込み手掛かり。 */
  organizationName?: string;
  /** テンプレートで指定された職種フィルタの初期値。 */
  defaultRoleCode?: string;
}

// 職種・所属医療機関は PractitionerRole が持つため、絞り込みの有無で検索対象を変える。
//   絞り込みあり: PractitionerRole を検索し _include で本体を取得(氏名は画面側で絞る)
//   絞り込みなし: Practitioner を検索(氏名・医籍登録番号は上流で絞る)
export function PractitionerSearchModal({
  onSelect,
  onClose,
  organizationId,
  organizationName,
  defaultRoleCode,
}: PractitionerSearchModalProps) {
  const [nameInput, setNameInput] = useState("");
  const [name, setName] = useState("");
  const [roleCode, setRoleCode] = useState(defaultRoleCode ?? "");
  const [organizationFilter, setOrganizationFilter] = useState(true);
  const [offset, setOffset] = useState(0);

  // 医療機関名しか分からない場合は、名称の完全一致で id を引き当てる
  // (同名が複数あるときは絞り込まない)。
  const resolveOrganization = useOrganizationSearch(
    { name: organizationName },
    0,
    !organizationId && Boolean(organizationName),
  );
  const resolvedOrganizations = (resolveOrganization.bundle?.entry ?? [])
    .map((e) => e.resource)
    .filter((r): r is fhir4.Organization => Boolean(r))
    .filter((o) => organizationDisplayName(o) === organizationName);
  const knownOrganizationId =
    organizationId ??
    (resolvedOrganizations.length === 1 ? resolvedOrganizations[0].id : undefined);

  const effectiveOrganizationId = organizationFilter ? knownOrganizationId : undefined;
  const filtered = Boolean(effectiveOrganizationId || roleCode);

  const roleSearch = usePractitionerRoleSearch(
    { organizationId: effectiveOrganizationId, roleCode: roleCode || undefined },
    filtered,
  );
  const practitionerSearch = usePractitionerSearch({ name }, offset, !filtered);

  function runSearch() {
    setName(nameInput);
    setOffset(0);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      runSearch();
    }
  }

  // 絞り込み中は氏名を画面側で照合する(PractitionerRole に name 検索が無いため)。
  const matchesName = (practitioner: fhir4.Practitioner) => {
    if (!nameInput) return true;
    const haystack = `${practitionerDisplayName(practitioner)}${practitionerDisplayKana(practitioner)}`;
    return haystack.includes(nameInput);
  };

  const practitioners = filtered
    ? roleSearch.practitioners.filter(matchesName)
    : practitionerSearch.practitioners;
  const roleByPractitioner = rolesByPractitionerId(
    filtered ? roleSearch.roles : practitionerSearch.roles,
  );
  const isFetching = filtered ? roleSearch.isFetching : practitionerSearch.isFetching;
  const error = filtered ? roleSearch.error : practitionerSearch.error;

  return (
    <Modal title="医療従事者を選択" onClose={onClose} className="modal--wide">
      <div className="master-search__form">
        <label>
          氏名(漢字・カナ部分一致)
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </label>
        <label>
          職種
          <select
            value={roleCode}
            onChange={(e) => {
              setRoleCode(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">すべて</option>
            {PRACTITIONER_ROLE_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={runSearch} disabled={isFetching}>
          検索
        </button>
      </div>

      {organizationName && (
        <p className="master-search__preset-hint">
          {knownOrganizationId ? (
            organizationFilter ? (
              <>
                所属医療機関「{organizationName}」の医療従事者だけを表示しています。
                <button type="button" onClick={() => setOrganizationFilter(false)}>
                  すべて表示
                </button>
              </>
            ) : (
              <>
                すべての医療従事者を表示しています。
                <button type="button" onClick={() => setOrganizationFilter(true)}>
                  「{organizationName}」で絞り込む
                </button>
              </>
            )
          ) : (
            <>選択済みの医療機関「{organizationName}」を特定できないため、絞り込んでいません。</>
          )}
        </p>
      )}

      <ErrorBanner error={error} />

      <div className="master-search__table-wrap">
        <table className="master-search__table">
          <thead>
            <tr>
              <th>氏名</th>
              <th>カナ</th>
              <th>医籍登録番号</th>
              <th>職種</th>
              <th>所属医療機関</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {practitioners.map((practitioner) => {
              const role = practitioner.id ? roleByPractitioner[practitioner.id] : undefined;
              const roleValues = role ? parsePractitionerRole(role) : undefined;
              return (
                <tr key={practitioner.id}>
                  <td>{practitionerDisplayName(practitioner)}</td>
                  <td>{practitionerDisplayKana(practitioner)}</td>
                  <td>{practitionerRegistrationNumber(practitioner) || "-"}</td>
                  <td>{practitionerRoleLabel(roleValues?.roleCode) || "-"}</td>
                  <td>{roleValues?.organizationName || "-"}</td>
                  <td className="master-search__actions">
                    <button type="button" onClick={() => onSelect(practitioner, role)}>
                      選択
                    </button>
                  </td>
                </tr>
              );
            })}
            {!isFetching && practitioners.length === 0 && (
              <tr>
                <td colSpan={6} className="master-search__empty">
                  該当する医療従事者がありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {filtered ? (
        <p className="master-search__preset-hint">
          {practitioners.length} 件
          {roleSearch.truncated && "(候補が多いため一部のみ表示しています。職種や氏名で絞り込んでください)"}
        </p>
      ) : (
        <Pagination
          offset={offset}
          count={practitionerSearch.count}
          total={practitionerSearch.total}
          hasPrevious={practitionerSearch.hasPrevious}
          hasNext={practitionerSearch.hasNext}
          onPrevious={() => setOffset((o) => Math.max(0, o - practitionerSearch.count))}
          onNext={() => setOffset((o) => o + practitionerSearch.count)}
        />
      )}
    </Modal>
  );
}
