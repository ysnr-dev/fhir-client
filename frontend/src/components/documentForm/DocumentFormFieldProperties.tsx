import { useState } from "react";
import {
  ALIGN_LABELS,
  ALIGNS,
  DATE_FORMAT_LABELS,
  DATE_FORMATS,
  FIELD_TYPE_LABELS,
  FIELD_TYPES,
  TRANSFER_KIND_LABELS,
  TRANSFER_KINDS,
  changeFieldType,
  type DocumentFormField,
  type DocumentFormPageMeta,
  type TransferKind,
} from "../../fhir/documentFormLayout";
import { PopulateExpressionModal } from "../PopulateExpressionModal";

// 選択中のフィールドの属性。種類ごとに要る項目だけを出す。

export function DocumentFormFieldProperties({
  field,
  pages,
  onChange,
}: {
  field: DocumentFormField;
  pages: DocumentFormPageMeta[];
  onChange: (next: DocumentFormField) => void;
}) {
  const [variablesOpen, setVariablesOpen] = useState(false);

  function patch(values: Partial<DocumentFormField>) {
    onChange({ ...field, ...values });
  }

  function numberInput(key: "x" | "y" | "w" | "h", min: number) {
    return (
      <label>
        {key.toUpperCase()}
        <input
          type="number"
          min={min}
          value={field[key]}
          onChange={(e) => patch({ [key]: Math.max(min, Math.round(Number(e.target.value) || 0)) })}
        />
      </label>
    );
  }

  function toggleTransferKind(kind: TransferKind, on: boolean) {
    const current = field.transfer_kinds ?? [];
    const next = on ? TRANSFER_KINDS.filter((k) => k === kind || current.includes(k)) : current.filter((k) => k !== kind);
    patch({ transfer_kinds: next });
  }

  return (
    <div className="document-form-props">
      <label>
        種類
        <select
          value={field.type}
          onChange={(e) => onChange(changeFieldType(field, e.target.value as DocumentFormField["type"]))}
        >
          {FIELD_TYPES.map((type) => (
            <option key={type} value={type}>
              {FIELD_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </label>
      <label>
        ラベル
        <input type="text" value={field.label} onChange={(e) => patch({ label: e.target.value })} />
      </label>
      <label>
        ページ
        <select value={field.page} onChange={(e) => patch({ page: Number(e.target.value) })}>
          {pages.map((page) => (
            <option key={page.page_number} value={page.page_number}>
              {page.page_number}
            </option>
          ))}
        </select>
      </label>
      <div className="document-form-props__row">
        {numberInput("x", 0)}
        {numberInput("y", 0)}
        {numberInput("w", 1)}
        {numberInput("h", 1)}
      </div>
      <div className="document-form-props__row">
        <label>
          文字サイズ
          <input
            type="number"
            min={6}
            max={72}
            step={0.5}
            value={field.font_size}
            onChange={(e) => patch({ font_size: Number(e.target.value) || field.font_size })}
          />
        </label>
        <label>
          配置
          <select value={field.align} onChange={(e) => patch({ align: e.target.value as DocumentFormField["align"] })}>
            {ALIGNS.map((align) => (
              <option key={align} value={align}>
                {ALIGN_LABELS[align]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="document-form-props__check">
        <input type="checkbox" checked={field.required} onChange={(e) => patch({ required: e.target.checked })} />
        必須
      </label>
      <label className="document-form-props__check">
        <input type="checkbox" checked={field.mask ?? false} onChange={(e) => patch({ mask: e.target.checked || undefined })} />
        塗りつぶし
      </label>

      {field.type === "select" && (
        <label>
          選択肢
          <textarea
            rows={4}
            value={(field.options ?? []).join("\n")}
            onChange={(e) => patch({ options: e.target.value.split("\n") })}
          />
        </label>
      )}

      {field.type === "date" && (
        <label>
          日付表示
          <select
            value={field.date_format ?? "slash"}
            onChange={(e) => patch({ date_format: e.target.value as DocumentFormField["date_format"] })}
          >
            {DATE_FORMATS.map((format) => (
              <option key={format} value={format}>
                {DATE_FORMAT_LABELS[format]}
              </option>
            ))}
          </select>
        </label>
      )}

      {field.initial_expression !== undefined && (
        <label>
          初期値
          <div className="document-form-props__expression">
            <input
              type="text"
              value={field.initial_expression}
              onChange={(e) => patch({ initial_expression: e.target.value })}
            />
            <button type="button" className="rp-card__compact-button" onClick={() => setVariablesOpen(true)}>
              変数
            </button>
          </div>
        </label>
      )}

      {field.transfer_kinds !== undefined && (
        <div className="document-form-props__kinds">
          <span>転記</span>
          {TRANSFER_KINDS.map((kind) => (
            <label key={kind} className="document-form-props__check">
              <input
                type="checkbox"
                checked={field.transfer_kinds?.includes(kind) ?? false}
                onChange={(e) => toggleTransferKind(kind, e.target.checked)}
              />
              {TRANSFER_KIND_LABELS[kind]}
            </label>
          ))}
        </div>
      )}

      {variablesOpen && (
        <PopulateExpressionModal
          currentExpression={field.initial_expression}
          onSelect={(expression) => {
            patch({ initial_expression: expression });
            setVariablesOpen(false);
          }}
          onClose={() => setVariablesOpen(false)}
        />
      )}
    </div>
  );
}
