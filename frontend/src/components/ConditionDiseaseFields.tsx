import { useState, type ReactNode } from "react";
import type { Disease, Modifier } from "../api/masterClient";
import { conditionDisplayName, isSuspected, withSuspected } from "../fhir/conditionHelpers";
import { ModifierSearchModal } from "./ModifierSearchModal";

/** マスタの病名に付ける修飾語の部分(病名フォームと頻用病名の編集で共用)。 */
export interface DiseaseFieldValues {
  disease: Disease | null;
  prefixModifiers: Modifier[];
  postfixModifiers: Modifier[];
}

interface ConditionDiseaseFieldsProps {
  values: DiseaseFieldValues;
  onChange: (patch: Partial<DiseaseFieldValues>) => void;
  /** プレビュー行の右に置くもの(「頻用登録」など)。 */
  previewAction?: ReactNode;
}

type ModifierKind = "prefix" | "postfix";

// 疑い病名のチェック・接頭語・接尾語・連結した病名のプレビュー。病名を選ぶ行は呼び出し側が持つ
// (病名フォームはマスタ検索か頻用病名、頻用病名の編集はマスタ検索だけ)。
export function ConditionDiseaseFields({ values, onChange, previewAction }: ConditionDiseaseFieldsProps) {
  const [modal, setModal] = useState<ModifierKind | null>(null);

  function handleModifierSelect(modifier: Modifier) {
    if (modal === "prefix") onChange({ prefixModifiers: [...values.prefixModifiers, modifier] });
    else if (modal === "postfix") onChange({ postfixModifiers: [...values.postfixModifiers, modifier] });
    setModal(null);
  }

  function removeModifier(kind: "prefixModifiers" | "postfixModifiers", index: number) {
    onChange({ [kind]: values[kind].filter((_, i) => i !== index) });
  }

  const fullName = conditionDisplayName({ diseaseMode: "master", freeText: "", ...values });
  const singleUseWarning =
    values.disease?.single_use_prohibited_category === "01" &&
    values.prefixModifiers.length === 0 &&
    values.postfixModifiers.length === 0;

  function renderModifierList(kind: "prefixModifiers" | "postfixModifiers") {
    const modifiers = values[kind];
    if (modifiers.length === 0) {
      return <span className="rp-card__usage-value rp-card__usage-value--empty">なし</span>;
    }
    return (
      <span className="condition-form__modifiers">
        {modifiers.map((modifier, index) => (
          <span className="condition-form__modifier-chip" key={`${modifier.management_number}-${index}`}>
            {modifier.name}
            <button
              type="button"
              aria-label={`${modifier.name} を削除`}
              onClick={() => removeModifier(kind, index)}
            >
              ×
            </button>
          </span>
        ))}
      </span>
    );
  }

  return (
    <>
      {/* 疑い病名は毎回修飾語から選ぶのが手間なので、チェックで接尾語「の疑い」を付け外しする。
          接尾語の一覧にも出るので、モーダルから外しても連動する。 */}
      <div className="condition-form__row">
        <label className="qe-item__checkbox">
          <input
            type="checkbox"
            checked={isSuspected(values.postfixModifiers)}
            onChange={(e) => onChange({ postfixModifiers: withSuspected(values.postfixModifiers, e.target.checked) })}
          />
          疑い病名
        </label>
      </div>

      <div className="condition-form__row">
        <label>
          接頭語
          {renderModifierList("prefixModifiers")}
        </label>
        <button type="button" onClick={() => setModal("prefix")}>
          + 接頭語追加
        </button>
      </div>

      <div className="condition-form__row">
        <label>
          接尾語
          {renderModifierList("postfixModifiers")}
        </label>
        <button type="button" onClick={() => setModal("postfix")}>
          + 接尾語追加
        </button>
      </div>

      {fullName && (
        <p className="condition-form__preview">
          登録される病名: <strong>{fullName}</strong>
          {values.disease?.icd10_2013 ? ` (ICD10: ${values.disease.icd10_2013})` : ""}
          {previewAction}
        </p>
      )}
      {singleUseWarning && (
        <p className="condition-form__hint">
          この病名は単独での使用が適当でないとされています(修飾語との組合せが望ましい)。
        </p>
      )}

      {modal && (
        <ModifierSearchModal
          title={modal === "prefix" ? "接頭語を選択" : "接尾語を選択"}
          onSelect={handleModifierSelect}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}
