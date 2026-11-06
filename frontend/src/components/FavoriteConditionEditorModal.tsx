import { useMemo, useState } from "react";
import type { Disease, FavoriteCondition, OrderSetScope } from "../api/masterClient";
import { useFavoriteConditionMutations, useFavoriteConditions } from "../api/masterQueries";
import {
  FAVORITE_CONDITION_SCHEMA_VERSION,
  favoriteConditionName,
  type FavoriteConditionBody,
} from "../fhir/conditionHelpers";
import { definitionOwnerKey, useDefinitionOwners, type DefinitionOwnerOption } from "../hooks/useDefinitionOwners";
import { ConditionDiseaseFields, type DiseaseFieldValues } from "./ConditionDiseaseFields";
import { DiseaseSearchModal } from "./DiseaseSearchModal";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";

interface FavoriteConditionEditorModalProps {
  /** 編集する頻用病名。無ければ新規。 */
  existing?: FavoriteCondition;
  /** 新規の保存先の初期値(頻用病名ページの選択中のタブ)。無ければ自分。 */
  initialOwner?: { scope: OrderSetScope; ownerId: string | null };
  /** 新規の病名・修飾語の初期値(病名フォームの「頻用登録」)。 */
  initialBody?: FavoriteConditionBody;
  onClose: () => void;
}

const EMPTY_FIELDS: DiseaseFieldValues = { disease: null, prefixModifiers: [], postfixModifiers: [] };

/** 頻用病名の登録・編集。病名フォームの中(form 要素の内側)からも開くので form は書かない。 */
export function FavoriteConditionEditorModal({ existing, initialOwner, initialBody, onClose }: FavoriteConditionEditorModalProps) {
  const { owners: allOwners, ready, departmentId, practitionerId } = useDefinitionOwners("自分の頻用病名");
  const owners = useMemo(() => allOwners.filter((o) => o.scope !== "team" && o.canEdit), [allOwners]);
  const list = useFavoriteConditions(departmentId, practitionerId, ready);
  const mutations = useFavoriteConditionMutations();

  const initialKey = existing
    ? definitionOwnerKey({ scope: existing.scope, ownerId: existing.owner_id })
    : initialOwner
      ? definitionOwnerKey(initialOwner)
      : definitionOwnerKey({ scope: "practitioner", ownerId: practitionerId ?? null });
  const [ownerKey, setOwnerKey] = useState(initialKey);
  const owner: DefinitionOwnerOption | undefined =
    owners.find((o) => definitionOwnerKey(o) === ownerKey) ?? owners.find((o) => o.scope === "practitioner") ?? owners[0];

  const [fields, setFields] = useState<DiseaseFieldValues>(() =>
    existing
      ? { disease: existing.definition.disease, prefixModifiers: existing.definition.prefixModifiers, postfixModifiers: existing.definition.postfixModifiers }
      : initialBody
        ? { disease: initialBody.disease, prefixModifiers: initialBody.prefixModifiers, postfixModifiers: initialBody.postfixModifiers }
        : EMPTY_FIELDS,
  );
  const [pickingDisease, setPickingDisease] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const body: FavoriteConditionBody | null = fields.disease
    ? { schema_version: FAVORITE_CONDITION_SCHEMA_VERSION, ...fields, disease: fields.disease }
    : null;
  const name = body ? favoriteConditionName(body) : "";
  const saving = mutations.create.isPending || mutations.update.isPending;

  function handleDiseaseSelect(disease: Disease) {
    setFields((f) => ({ ...f, disease }));
    setPickingDisease(false);
  }

  async function handleSave() {
    if (!body || !owner) {
      setValidationError(owner ? "病名を選択してください。" : "登録できる保存先がありません。");
      return;
    }
    const duplicate = (list.data?.items ?? []).find(
      (item) =>
        item.id !== existing?.id &&
        item.scope === owner.scope &&
        (owner.scope === "facility" || item.owner_id === owner.ownerId) &&
        item.name === name,
    );
    if (duplicate) {
      setValidationError(`「${name}」は${owner.label}に登録済みです。`);
      return;
    }
    setValidationError(null);
    if (existing) {
      await mutations.update.mutateAsync({ id: existing.id, payload: { name, definition: body } });
    } else {
      await mutations.create.mutateAsync({
        scope: owner.scope,
        owner_id: owner.ownerId,
        owner_name: owner.ownerName,
        name,
        definition: body,
      });
    }
    onClose();
  }

  return (
    <Modal title={existing ? "頻用病名を編集" : "頻用病名を登録"} onClose={onClose}>
      <div className="prescription-form">
        {validationError && (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">{validationError}</p>
          </div>
        )}
        <ErrorBanner error={mutations.create.error ?? mutations.update.error} />

        <fieldset>
          <legend>頻用病名</legend>
          <label>
            保存先
            {existing || owners.length <= 1 ? (
              <span className="rp-card__usage-value">{owner?.label ?? "(なし)"}</span>
            ) : (
              <select value={owner ? definitionOwnerKey(owner) : ""} onChange={(e) => setOwnerKey(e.target.value)}>
                {owners.map((o) => (
                  <option key={definitionOwnerKey(o)} value={definitionOwnerKey(o)}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </label>

          <div className="condition-form__row">
            <label>
              病名
              {fields.disease ? (
                <span className="rp-card__usage-value">{fields.disease.name}</span>
              ) : (
                <span className="rp-card__usage-value rp-card__usage-value--empty">未選択</span>
              )}
            </label>
            <button type="button" onClick={() => setPickingDisease(true)}>
              {fields.disease ? "病名変更" : "病名選択"}
            </button>
          </div>

          <ConditionDiseaseFields values={fields} onChange={(patch) => setFields((f) => ({ ...f, ...patch }))} />
        </fieldset>

        <div className="prescription-form__submit">
          <button type="button" onClick={handleSave} disabled={saving || !ready}>
            {saving ? "送信中..." : existing ? "更新" : "登録"}
          </button>
        </div>
      </div>

      {pickingDisease && <DiseaseSearchModal onSelect={handleDiseaseSelect} onClose={() => setPickingDisease(false)} />}
    </Modal>
  );
}
