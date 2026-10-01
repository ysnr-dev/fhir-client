import { useState } from "react";
import { POPULATE_EXPRESSION_OPTIONS } from "../fhir/populateContext";
import { Modal } from "./Modal";

// テンプレート項目の初期値式を、使える変数の一覧から選ぶモーダル。
// 左で式を選ぶと、右に説明と入る値のサンプルを出す。

interface PopulateExpressionModalProps {
  /** 項目に設定済みの式。一覧にあればそれを選んだ状態で開く。 */
  currentExpression: string;
  onSelect: (expression: string) => void;
  onClose: () => void;
}

export function PopulateExpressionModal({
  currentExpression,
  onSelect,
  onClose,
}: PopulateExpressionModalProps) {
  const [selectedIndex, setSelectedIndex] = useState(() =>
    Math.max(
      0,
      POPULATE_EXPRESSION_OPTIONS.findIndex((option) => option.expression === currentExpression),
    ),
  );
  const selected = POPULATE_EXPRESSION_OPTIONS[selectedIndex];

  return (
    <Modal title="初期値式の変数" onClose={onClose} className="modal--populate-expression">
      <div className="populate-expression">
        <ul className="populate-expression__list">
          {POPULATE_EXPRESSION_OPTIONS.map((option, index) => (
            <li key={option.expression}>
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
            <button type="button" onClick={() => onSelect(selected.expression)}>
              この式を使う
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
