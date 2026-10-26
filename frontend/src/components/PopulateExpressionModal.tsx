import { useState } from "react";
import type { LabResultItem } from "../api/masterClient";
import { useLabResultItem } from "../api/masterQueries";
import { POPULATE_EXPRESSION_OPTIONS } from "../fhir/populateContext";
import {
  CONDITION_OPERATOR_LABELS,
  CONDITION_OPERATORS,
  conditionExpression,
  parseConditionExpression,
  type ConditionOperator,
} from "../fhir/populateCondition";
import {
  LAB_ATTRS,
  LAB_ATTR_LABELS,
  labExpression,
  parseLabExpression,
  type LabAttr,
} from "../fhir/populateLab";
import { LabResultItemSearchModal } from "./LabResultItemSearchModal";
import { Modal } from "./Modal";

// カルテから転記できる変数の一覧。左で選ぶと、右に説明と入る値のサンプルを出す。
// テンプレート項目の初期値式を選ぶとき(onSelect)と、文書テンプレートに書く
// プレースホルダーを調べるとき(placeholder)に使う。
// 「検査項目の最新値」だけは結果項目と取り出す値を選んで式を組み立てる。
// 様式のチェック項目の条件(condition)では、選んだ変数に比較を足した条件式にする(populateCondition.ts)。

interface PopulateExpressionModalProps {
  /** 項目に設定済みの式。一覧にあればそれを選んだ状態で開く。 */
  currentExpression?: string;
  /** 初期値式として選ぶ。 */
  onSelect?: (expression: string) => void;
  /** 文書テンプレートのプレースホルダー({{名前}})を出し、コピーできるようにする。 */
  placeholder?: boolean;
  /** 変数と比較から条件式を組み立てる(様式のチェック項目)。 */
  condition?: boolean;
  onClose: () => void;
}

const LAB_OPTION_INDEX = POPULATE_EXPRESSION_OPTIONS.findIndex((option) => option.parameterized === "lab");

// 分類ごとの変数(一覧の並び順のまま)。
const OPTION_GROUPS = POPULATE_EXPRESSION_OPTIONS.reduce<{ group: string; indexes: number[] }[]>((groups, option, index) => {
  const last = groups[groups.length - 1];
  if (last?.group === option.group) last.indexes.push(index);
  else groups.push({ group: option.group, indexes: [index] });
  return groups;
}, []);

// 選んだ結果項目のデータ型と単位に合わせたサンプル値。
function labSample(item: Pick<LabResultItem, "data_type" | "display_unit"> | undefined, attr: LabAttr): string {
  const numeric = !item || item.data_type === "PQ";
  const unit = item?.display_unit ?? "%";
  const value = numeric ? "7.2" : "陰性";
  switch (attr) {
    case "value":
      return value;
    case "unit":
      return numeric ? unit : "";
    case "date":
      return "2026-09-05";
    case "text":
      return numeric ? `${value} ${unit}` : value;
    case "interpretation":
      return "H";
  }
}

export function PopulateExpressionModal({
  currentExpression,
  onSelect,
  placeholder = false,
  condition = false,
  onClose,
}: PopulateExpressionModalProps) {
  const currentCondition = condition ? parseConditionExpression(currentExpression) : null;
  const currentBase = condition ? currentCondition?.base : currentExpression;
  const currentLab = parseLabExpression(currentBase);
  const currentIndex = currentLab
    ? LAB_OPTION_INDEX
    : POPULATE_EXPRESSION_OPTIONS.findIndex((option) => option.expression === currentBase);
  const [selectedIndex, setSelectedIndex] = useState(() => Math.max(0, currentIndex));
  // 分類は閉じて開く。設定済みの式があればその分類だけ開いておく。
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(
    () => new Set(currentIndex >= 0 ? [POPULATE_EXPRESSION_OPTIONS[currentIndex].group] : []),
  );
  const [operator, setOperator] = useState<ConditionOperator>(currentCondition?.operator ?? "exists");
  const [operand, setOperand] = useState(currentCondition?.operand ?? "");
  const [labCode, setLabCode] = useState(currentLab?.code ?? "");
  const [labAttr, setLabAttr] = useState<LabAttr>(currentLab?.attr ?? "value");
  const [labItem, setLabItem] = useState<LabResultItem | null>(null);
  const [labSearchOpen, setLabSearchOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // 設定済みの式から開いたときは、コードから結果項目の名前を引く。
  const currentLabItem = useLabResultItem(labItem || !labCode ? null : labCode);
  const selectedLabItem = labItem ?? currentLabItem.data ?? undefined;

  const selected = POPULATE_EXPRESSION_OPTIONS[selectedIndex];
  const isLab = selected.parameterized === "lab";
  const baseExpression = isLab ? (labCode ? labExpression(labCode, labAttr) : "") : selected.expression;
  const expression = condition ? conditionExpression({ base: baseExpression, operator, operand }) : baseExpression;
  const sample = isLab ? labSample(selectedLabItem, labAttr) : selected.sample;
  const selectedPlaceholder = isLab ? `{{${expression}}}` : `{{${selected.label}}}`;

  async function handleCopy() {
    await navigator.clipboard.writeText(selectedPlaceholder);
    setCopied(true);
  }

  function toggleGroup(group: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }

  function select(index: number) {
    setSelectedIndex(index);
    setCopied(false);
  }

  return (
    <Modal
      title={placeholder ? "プレースホルダーの変数" : condition ? "初期値の条件" : "初期値式の変数"}
      onClose={onClose}
      className="modal--populate-expression"
    >
      <div className="populate-expression">
        <ul className="populate-expression__list">
          {OPTION_GROUPS.map(({ group, indexes }) => {
            const open = openGroups.has(group);
            return (
              <li key={group}>
                <button
                  type="button"
                  className="populate-expression__group"
                  aria-expanded={open}
                  onClick={() => toggleGroup(group)}
                >
                  <span aria-hidden="true">{open ? "▾" : "▸"}</span>
                  {group}
                </button>
                {open && (
                  <ul className="populate-expression__options">
                    {indexes.map((index) => {
                      const option = POPULATE_EXPRESSION_OPTIONS[index];
                      return (
                        <li key={index}>
                          <button
                            type="button"
                            className={
                              index === selectedIndex
                                ? "populate-expression__option populate-expression__option--active"
                                : "populate-expression__option"
                            }
                            onClick={() => select(index)}
                          >
                            <span>{option.label}</span>
                            <code>%{option.variable}</code>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
        <div className="populate-expression__detail">
          <h3>{selected.label}</h3>
          <dl>
            {isLab && (
              <>
                <dt>検査項目</dt>
                <dd className="populate-expression__lab">
                  <span>
                    {selectedLabItem
                      ? `${selectedLabItem.name}(${selectedLabItem.result_item_code})`
                      : labCode || "未選択"}
                  </span>
                  <button type="button" className="rp-card__compact-button" onClick={() => setLabSearchOpen(true)}>
                    項目を選択
                  </button>
                </dd>
                <dt>取り出す値</dt>
                <dd className="populate-expression__lab-attrs">
                  {LAB_ATTRS.map((attr) => (
                    <label key={attr}>
                      <input
                        type="radio"
                        name="populate-lab-attr"
                        checked={labAttr === attr}
                        onChange={() => {
                          setLabAttr(attr);
                          setCopied(false);
                        }}
                      />
                      {LAB_ATTR_LABELS[attr]}
                    </label>
                  ))}
                </dd>
              </>
            )}
            {condition && (
              <>
                <dt>条件</dt>
                <dd className="populate-expression__condition">
                  <select value={operator} onChange={(e) => setOperator(e.target.value as ConditionOperator)}>
                    {CONDITION_OPERATORS.map((op) => (
                      <option key={op} value={op}>
                        {CONDITION_OPERATOR_LABELS[op]}
                      </option>
                    ))}
                  </select>
                  {operator !== "exists" && (
                    <input
                      type="text"
                      aria-label="比較する値"
                      value={operand}
                      onChange={(e) => setOperand(e.target.value)}
                    />
                  )}
                </dd>
              </>
            )}
            {placeholder && (
              <>
                <dt>書式</dt>
                <dd>
                  <code className="populate-expression__code">{expression ? selectedPlaceholder : "—"}</code>
                </dd>
              </>
            )}
            <dt>式</dt>
            <dd>
              <code className="populate-expression__code">{expression || "—"}</code>
            </dd>
            <dt>説明</dt>
            <dd>{selected.description}</dd>
            <dt>サンプル</dt>
            <dd>
              <pre className="populate-expression__sample">{sample}</pre>
            </dd>
          </dl>
          <div className="populate-expression__actions">
            {placeholder && (
              <button type="button" disabled={!expression} onClick={() => void handleCopy()}>
                {copied ? "コピーしました" : "コピー"}
              </button>
            )}
            {onSelect && (
              <button type="button" disabled={!expression} onClick={() => onSelect(expression)}>
                適用
              </button>
            )}
          </div>
        </div>
      </div>
      {labSearchOpen && (
        <LabResultItemSearchModal
          title="検査項目を選択"
          onSelect={(item) => {
            setLabItem(item);
            setLabCode(item.result_item_code);
            setCopied(false);
            setLabSearchOpen(false);
          }}
          onClose={() => setLabSearchOpen(false)}
        />
      )}
    </Modal>
  );
}
