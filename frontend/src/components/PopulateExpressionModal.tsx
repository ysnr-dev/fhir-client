import { useState } from "react";
import { POPULATE_EXPRESSION_OPTIONS } from "../fhir/populateContext";
import { Modal } from "./Modal";

// カルテから転記できる変数の一覧。左で選ぶと、右に説明と入る値のサンプルを出す。
// テンプレート項目の初期値式を選ぶとき(onSelect)と、文書テンプレートに書く
// プレースホルダーを調べるとき(placeholder)に使う。

interface PopulateExpressionModalProps {
  /** 項目に設定済みの式。一覧にあればそれを選んだ状態で開く。 */
  currentExpression?: string;
  /** 初期値式として選ぶ。 */
  onSelect?: (expression: string) => void;
  /** 文書テンプレートのプレースホルダー({{名前}})を出し、コピーできるようにする。 */
  placeholder?: boolean;
  onClose: () => void;
}

export function PopulateExpressionModal({
  currentExpression,
  onSelect,
  placeholder = false,
  onClose,
}: PopulateExpressionModalProps) {
  const [selectedIndex, setSelectedIndex] = useState(() =>
    Math.max(
      0,
      POPULATE_EXPRESSION_OPTIONS.findIndex((option) => option.expression === currentExpression),
    ),
  );
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const selected = POPULATE_EXPRESSION_OPTIONS[selectedIndex];
  const selectedPlaceholder = `{{${selected.label}}}`;

  async function handleCopy() {
    await navigator.clipboard.writeText(selectedPlaceholder);
    setCopiedIndex(selectedIndex);
  }

  return (
    <Modal
      title={placeholder ? "プレースホルダーの変数" : "初期値式の変数"}
      onClose={onClose}
      className="modal--populate-expression"
    >
      <div className="populate-expression">
        <ul className="populate-expression__list">
          {POPULATE_EXPRESSION_OPTIONS.map((option, index) => (
            <li key={option.expression}>
              {option.group !== POPULATE_EXPRESSION_OPTIONS[index - 1]?.group && (
                <div className="populate-expression__group">{option.group}</div>
              )}
              <button
                type="button"
                className={
                  index === selectedIndex
                    ? "populate-expression__option populate-expression__option--active"
                    : "populate-expression__option"
                }
                onClick={() => setSelectedIndex(index)}
              >
                <span>{option.label}</span>
                <code>%{option.variable}</code>
              </button>
            </li>
          ))}
        </ul>
        <div className="populate-expression__detail">
          <h3>{selected.label}</h3>
          <dl>
            {placeholder && (
              <>
                <dt>書式</dt>
                <dd>
                  <code className="populate-expression__code">{selectedPlaceholder}</code>
                </dd>
              </>
            )}
            <dt>式</dt>
            <dd>
              <code className="populate-expression__code">{selected.expression}</code>
            </dd>
            <dt>説明</dt>
            <dd>{selected.description}</dd>
            <dt>サンプル</dt>
            <dd>
              <pre className="populate-expression__sample">{selected.sample}</pre>
            </dd>
          </dl>
          <div className="populate-expression__actions">
            {placeholder && (
              <button type="button" onClick={() => void handleCopy()}>
                {copiedIndex === selectedIndex ? "コピーしました" : "コピー"}
              </button>
            )}
            {onSelect && (
              <button type="button" onClick={() => onSelect(selected.expression)}>
                この式を使う
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
