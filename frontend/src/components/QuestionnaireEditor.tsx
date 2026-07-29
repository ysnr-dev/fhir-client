import { useState, type FormEvent, type KeyboardEvent } from "react";
import {
  appendChild,
  emptyQuestionnaireForm,
  moveItemById,
  newEditorItem,
  newVariable,
  removeItemById,
  STATUS_OPTIONS,
  updateItemById,
  validateQuestionnaireForm,
  type EditorItem,
  type QuestionnaireFormValues,
  type QuestionnaireStatus,
} from "../fhir/questionnaireHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { QuestionnaireItemEditor } from "./QuestionnaireItemEditor";

interface QuestionnaireEditorProps {
  initialValues?: QuestionnaireFormValues;
  onSubmit: (values: QuestionnaireFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel?: string;
}

export function QuestionnaireEditor({
  initialValues,
  onSubmit,
  submitting,
  submitError,
  submitLabel = "登録",
}: QuestionnaireEditorProps) {
  const [values, setValues] = useState<QuestionnaireFormValues>(
    initialValues ?? emptyQuestionnaireForm,
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  function update<K extends keyof QuestionnaireFormValues>(
    key: K,
    value: QuestionnaireFormValues[K],
  ) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function handleItemUpdate(id: string, updater: (item: EditorItem) => EditorItem) {
    setValues((v) => ({ ...v, items: updateItemById(v.items, id, updater) }));
  }

  function handleItemRemove(id: string) {
    setValues((v) => ({ ...v, items: removeItemById(v.items, id) }));
  }

  function handleItemMove(id: string, direction: "up" | "down") {
    setValues((v) => ({ ...v, items: moveItemById(v.items, id, direction) }));
  }

  function handleAppendChild(parentId: string | null) {
    setValues((v) => ({ ...v, items: appendChild(v.items, parentId, newEditorItem()) }));
  }

  function updateVariable(id: string, key: "name" | "expression", value: string) {
    setValues((v) => ({
      ...v,
      variables: v.variables.map((variable) =>
        variable.id === id ? { ...variable, [key]: value } : variable,
      ),
    }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validateQuestionnaireForm(values);
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

  return (
    <form className="prescription-form" onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={submitError} />

      <fieldset>
        <legend>テンプレート情報</legend>
        <div className="qe-meta">
          <label>
            タイトル
            <input
              type="text"
              value={values.title}
              onChange={(e) => update("title", e.target.value)}
              placeholder="テンプレートの表示名"
            />
          </label>
          <label>
            名前(テンプレートコード)
            <input
              type="text"
              value={values.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="半角英数字15バイト以下"
            />
          </label>
          <label>
            URL(一意識別子)
            <input
              type="text"
              value={values.url}
              onChange={(e) => update("url", e.target.value)}
              placeholder="https://example.org/Questionnaire/..."
            />
          </label>
          <label>
            バージョン
            <input
              type="text"
              value={values.version}
              onChange={(e) => update("version", e.target.value)}
            />
          </label>
          <label>
            ステータス
            <select
              value={values.status}
              onChange={(e) => update("status", e.target.value as QuestionnaireStatus)}
            >
              {STATUS_OPTIONS.map((status) => (
                <option key={status.code} value={status.code}>
                  {status.label}
                </option>
              ))}
            </select>
          </label>
          <label className="qe-meta__description">
            説明
            <textarea
              value={values.description}
              onChange={(e) => update("description", e.target.value)}
              rows={2}
            />
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>変数(FHIRPath)</legend>
        {values.variables.length === 0 && (
          <p className="qe-hint">計算式から %変数名 で参照できる変数を定義できます。</p>
        )}
        {values.variables.map((variable) => (
          <div className="qe-variable__row" key={variable.id}>
            <input
              type="text"
              aria-label="変数名"
              value={variable.name}
              onChange={(e) => updateVariable(variable.id, "name", e.target.value)}
              placeholder="変数名"
            />
            <input
              type="text"
              aria-label="変数の式"
              className="qe-variable__expression"
              value={variable.expression}
              onChange={(e) => updateVariable(variable.id, "expression", e.target.value)}
              placeholder="FHIRPath 式 (例: %resource.item.where(linkId='weight').answer.value)"
            />
            <button
              type="button"
              onClick={() =>
                update(
                  "variables",
                  values.variables.filter((v) => v.id !== variable.id),
                )
              }
            >
              ×
            </button>
          </div>
        ))}
        <button type="button" onClick={() => update("variables", [...values.variables, newVariable()])}>
          + 変数を追加
        </button>
      </fieldset>

      <fieldset>
        <legend>項目</legend>
        {values.items.map((item, index) => (
          <QuestionnaireItemEditor
            key={item.id}
            item={item}
            index={index}
            siblingCount={values.items.length}
            rootItems={values.items}
            onUpdate={handleItemUpdate}
            onRemove={handleItemRemove}
            onMove={handleItemMove}
            onAppendChild={handleAppendChild}
          />
        ))}
        <button type="button" className="qe-add-item" onClick={() => handleAppendChild(null)}>
          + 項目を追加
        </button>
      </fieldset>

      <div className="prescription-form__submit">
        <button type="submit" disabled={submitting}>
          {submitting ? "送信中..." : submitLabel}
        </button>
      </div>
    </form>
  );
}
