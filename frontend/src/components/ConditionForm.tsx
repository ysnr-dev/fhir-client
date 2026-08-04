import { useState, type FormEvent, type KeyboardEvent } from "react";
import type { Disease, Modifier } from "../api/masterClient";
import {
  CATEGORY_LABELS,
  conditionDisplayName,
  emptyConditionForm,
  OUTCOME_OPTIONS,
  type ConditionCategory,
  type ConditionFormValues,
  type OutcomeCode,
} from "../fhir/conditionHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { DiseaseSearchModal } from "./DiseaseSearchModal";
import { ModifierSearchModal } from "./ModifierSearchModal";

interface ConditionFormProps {
  initialValues?: ConditionFormValues;
  onSubmit: (values: ConditionFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel?: string;
}

type ModalState = { kind: "disease" } | { kind: "prefix" } | { kind: "postfix" } | null;

export function ConditionForm({
  initialValues,
  onSubmit,
  submitting,
  submitError,
  submitLabel = "登録",
}: ConditionFormProps) {
  const [values, setValues] = useState<ConditionFormValues>(initialValues ?? emptyConditionForm);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);

  function update<K extends keyof ConditionFormValues>(key: K, value: ConditionFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function handleDiseaseSelect(disease: Disease) {
    update("disease", disease);
    setModal(null);
  }

  function handleModifierSelect(modifier: Modifier) {
    if (modal?.kind === "prefix") {
      setValues((v) => ({ ...v, prefixModifiers: [...v.prefixModifiers, modifier] }));
    } else if (modal?.kind === "postfix") {
      setValues((v) => ({ ...v, postfixModifiers: [...v.postfixModifiers, modifier] }));
    }
    setModal(null);
  }

  function removeModifier(kind: "prefixModifiers" | "postfixModifiers", index: number) {
    setValues((v) => ({ ...v, [kind]: v[kind].filter((_, i) => i !== index) }));
  }

  function validate(): string | null {
    if (!values.disease) return "病名を選択してください。";
    if (!values.startDate) return "開始日は必須です。";
    if (values.endDate && values.endDate < values.startDate) {
      return "終了日は開始日以降の日付を入力してください。";
    }
    if (values.endDate && values.outcome === "active") {
      return "終了日を入力した場合は、転帰区分を軽快・治癒・中止のいずれかにしてください。";
    }
    return null;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validate();
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    onSubmit(values);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    // input 上での Enter による暗黙の form submit を抑止する。
    if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
      e.preventDefault();
    }
  }

  const fullName = conditionDisplayName(values);
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
    <form className="prescription-form" onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={submitError} />

      <fieldset>
        <legend>病名</legend>

        {/* 区分。プロブレム(POMR のプロブレムリストに載る)と保険病名(レセプト用)を
            同じ Condition で区分管理する。ラジオの横並びは診療記録フォームと同じ形。 */}
        <div className="clinical-note-form__mode">
          <span className="clinical-note-form__mode-legend">区分</span>
          <div className="clinical-note-form__mode-options">
            {(["billing", "problem"] as const).map((category) => (
              <label className="clinical-note-form__mode-option" key={category}>
                <input
                  type="radio"
                  name="condition-category"
                  checked={values.category === category}
                  onChange={() => update("category", category as ConditionCategory)}
                />
                {CATEGORY_LABELS[category]}
              </label>
            ))}
          </div>
        </div>

        <div className="condition-form__row">
          <label>
            病名
            {values.disease ? (
              <span className="rp-card__usage-value">{values.disease.name}</span>
            ) : (
              <span className="rp-card__usage-value rp-card__usage-value--empty">未選択</span>
            )}
          </label>
          <button type="button" onClick={() => setModal({ kind: "disease" })}>
            {values.disease ? "病名を変更" : "病名を選択"}
          </button>
        </div>

        <div className="condition-form__row">
          <label>
            接頭語
            {renderModifierList("prefixModifiers")}
          </label>
          <button type="button" onClick={() => setModal({ kind: "prefix" })}>
            + 接頭語追加
          </button>
        </div>

        <div className="condition-form__row">
          <label>
            接尾語
            {renderModifierList("postfixModifiers")}
          </label>
          <button type="button" onClick={() => setModal({ kind: "postfix" })}>
            + 接尾語追加
          </button>
        </div>

        {values.disease && (
          <p className="condition-form__preview">
            登録される病名: <strong>{fullName}</strong>
            {values.disease.icd10_2013 && ` (ICD10: ${values.disease.icd10_2013})`}
          </p>
        )}
        {singleUseWarning && (
          <p className="condition-form__hint">
            この病名は単独での使用が適当でないとされています(修飾語との組合せが望ましい)。
          </p>
        )}
      </fieldset>

      <fieldset>
        <legend>経過</legend>
        <label>
          開始日
          <input
            type="date"
            value={values.startDate}
            onChange={(e) => update("startDate", e.target.value)}
          />
        </label>
        <label>
          終了日
          <input type="date" value={values.endDate} onChange={(e) => update("endDate", e.target.value)} />
        </label>
        <label>
          転帰区分
          <select value={values.outcome} onChange={(e) => update("outcome", e.target.value as OutcomeCode)}>
            {OUTCOME_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <div className="prescription-form__submit">
        <button type="submit" disabled={submitting}>
          {submitting ? "送信中..." : submitLabel}
        </button>
      </div>

      {modal?.kind === "disease" && (
        <DiseaseSearchModal onSelect={handleDiseaseSelect} onClose={() => setModal(null)} />
      )}
      {(modal?.kind === "prefix" || modal?.kind === "postfix") && (
        <ModifierSearchModal
          title={modal.kind === "prefix" ? "接頭語を選択" : "接尾語を選択"}
          onSelect={handleModifierSelect}
          onClose={() => setModal(null)}
        />
      )}
    </form>
  );
}
