import { useMemo, useState } from "react";
import type { FavoriteCondition } from "../api/masterClient";
import { useFavoriteConditionMutations, useFavoriteConditions } from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { FavoriteConditionEditorModal } from "../components/FavoriteConditionEditorModal";
import { TrashIcon } from "../components/icons/TrashIcon";
import { definitionOwnerKey, useDefinitionOwners, type DefinitionOwnerOption } from "../hooks/useDefinitionOwners";
import { formatDateTime } from "../lib/dates";

type Editing = { mode: "new" } | { mode: "edit"; item: FavoriteCondition } | null;

// 頻用病名(病名+修飾語の組み合わせ)の登録画面。持ち主(院内共通 / 診療科 / 自分)をタブで切り替え、
// 病名フォームの入力方法「頻用病名」で選ぶものをここで育てる(docs/features/patient-profile.md「頻用病名」)。
// 院内共通・診療科に書けるのは医師、自分の分は医療従事者なら誰でも(useDefinitionOwners)。
export function FavoriteConditionPage() {
  const { owners: allOwners, ready, departmentId, practitionerId } = useDefinitionOwners("自分の頻用病名");
  const owners = useMemo(() => allOwners.filter((o) => o.scope !== "team"), [allOwners]);
  const list = useFavoriteConditions(departmentId, practitionerId, ready);
  const mutations = useFavoriteConditionMutations();

  const [ownerKey, setOwnerKey] = useState<string>(definitionOwnerKey({ scope: "facility", ownerId: null }));
  const activeOwner: DefinitionOwnerOption = owners.find((o) => definitionOwnerKey(o) === ownerKey) ?? owners[0];
  const [editing, setEditing] = useState<Editing>(null);

  const items = useMemo(
    () =>
      (list.data?.items ?? []).filter(
        (item) =>
          item.scope === activeOwner.scope && (activeOwner.scope === "facility" || item.owner_id === activeOwner.ownerId),
      ),
    [list.data, activeOwner],
  );

  function handleDelete(item: FavoriteCondition) {
    if (!window.confirm(`頻用病名「${item.name}」を削除しますか？`)) return;
    mutations.remove.mutate(item.id);
  }

  return (
    <div className="page favorite-condition-page">
      <div className="page__header">
        <h1>頻用病名</h1>
      </div>

      <ErrorBanner error={list.error ?? mutations.remove.error} />

      <div className="order-set-picker__tabs" role="tablist" aria-label="頻用病名の持ち主">
        {owners.map((owner) => (
          <button
            key={definitionOwnerKey(owner)}
            type="button"
            role="tab"
            aria-selected={definitionOwnerKey(owner) === definitionOwnerKey(activeOwner)}
            className={`order-set-picker__tab${
              definitionOwnerKey(owner) === definitionOwnerKey(activeOwner) ? " order-set-picker__tab--active" : ""
            }`}
            onClick={() => setOwnerKey(definitionOwnerKey(owner))}
          >
            {owner.label}
          </button>
        ))}
      </div>

      <div className="favorite-condition-page__actions">
        <button
          type="button"
          disabled={!ready || !activeOwner.canEdit || mutations.remove.isPending}
          onClick={() => setEditing({ mode: "new" })}
        >
          追加
        </button>
      </div>

      <table className="master-search__table">
        <thead>
          <tr>
            <th>病名</th>
            <th>ICD10</th>
            <th>更新日時</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{item.name}</td>
              <td>{item.definition.disease.icd10_2013}</td>
              <td>{formatDateTime(item.updated_at)}</td>
              <td className="master-search__actions">
                {activeOwner.canEdit && (
                  <>
                    <button
                      type="button"
                      className="rp-card__compact-button"
                      onClick={() => setEditing({ mode: "edit", item })}
                    >
                      編集
                    </button>
                    <button
                      type="button"
                      className="rp-card__icon-button"
                      title={`${item.name}を削除`}
                      aria-label={`${item.name}を削除`}
                      disabled={mutations.remove.isPending}
                      onClick={() => handleDelete(item)}
                    >
                      <TrashIcon />
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
          {list.data && items.length === 0 && (
            <tr>
              <td colSpan={4} className="master-search__empty">
                頻用病名がありません
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing?.mode === "new" && (
        <FavoriteConditionEditorModal
          initialOwner={{ scope: activeOwner.scope, ownerId: activeOwner.ownerId }}
          onClose={() => setEditing(null)}
        />
      )}
      {editing?.mode === "edit" && <FavoriteConditionEditorModal existing={editing.item} onClose={() => setEditing(null)} />}
    </div>
  );
}
