import { useId, useMemo, useState } from "react";
import {
  collectLinkIds,
  parseMappingRules,
  serializeMappingRules,
  type MappingRule,
} from "../fhir/reportLayoutMapping";
import { questionnairePlaceholders, RESERVED_PLACEHOLDERS } from "../fhir/reportPlaceholders";
import type { TlfItemIds } from "../fhir/tlfPlaceholders";

type RuleKind = MappingRule["kind"];

const KIND_OPTIONS: { kind: RuleKind; label: string }[] = [
  { kind: "value", label: "回答値を出力" },
  { kind: "showCode", label: "code 一致で表示" },
  { kind: "showAnswered", label: "回答ありで表示" },
  { kind: "meta", label: "メタ値を別 ID に出力" },
];

interface Props {
  /** マッピング本文(JSON テキスト)。単一情報源は親の文字列 state。 */
  value: string;
  onChange: (text: string) => void;
  /** 選択中のテンプレート(linkId・code の候補表示に使う。無ければ自由入力) */
  questionnaire?: fhir4.Questionnaire;
  /** .tlf から抽出したアイテム ID(tlfId・show の候補表示に使う) */
  tlfItems?: TlfItemIds | null;
  disabled?: boolean;
}

// ルール種別を変えるとき、共通するフィールドは引き継ぐ。
function convertRule(rule: MappingRule, kind: RuleKind): MappingRule {
  if (rule.kind === kind) return rule;
  const linkId = "linkId" in rule ? rule.linkId : "";
  const tlfId = "tlfId" in rule ? rule.tlfId : "";
  const show = "show" in rule ? rule.show : [""];
  switch (kind) {
    case "value":
      return { kind, linkId, tlfId };
    case "showCode":
      return { kind, linkId, code: "", show };
    case "showAnswered":
      return { kind, linkId, show };
    case "meta":
      return { kind, meta: "", tlfId };
  }
}

// マッピング定義の行エディタ。ルールを 1 行 1 フォームで編集し、常に
// serializeMappingRules で文字列化して親へ返す(保存ペイロードは従来どおり
// mapping テキスト)。生 JSON 編集にも切り替えられ、エディタで扱えない内容
// (手書きの不正 JSON 等)は自動で JSON 編集へフォールバックする。
export function ReportLayoutMappingEditor({
  value,
  onChange,
  questionnaire,
  tlfItems,
  disabled,
}: Props) {
  const [jsonMode, setJsonMode] = useState(false);
  const listId = useId();

  const parsed = useMemo(() => parseMappingRules(value), [value]);
  const formAvailable = "rules" in parsed;
  const showForm = formAvailable && !jsonMode;
  const rules = formAvailable ? parsed.rules : [];

  // linkId の候補(テンプレート項目由来の行を linkId で重複排除)。
  const linkIdOptions = useMemo(() => {
    if (!questionnaire) return null;
    const seen = new Set<string>();
    const options: { linkId: string; label: string }[] = [];
    for (const row of questionnairePlaceholders(questionnaire)) {
      if (!row.linkId || seen.has(row.linkId)) continue;
      seen.add(row.linkId);
      options.push({ linkId: row.linkId, label: row.label });
    }
    return options;
  }, [questionnaire]);

  // code の候補(linkId -> answerOption の coding)。
  const codeOptions = useMemo(() => {
    if (!questionnaire) return null;
    const map = new Map<string, { code: string; display?: string }[]>();
    collectLinkIds(questionnaire).forEach((item, linkId) => {
      const codes = (item.answerOption ?? [])
        .map((option) => option.valueCoding)
        .filter((coding): coding is fhir4.Coding => Boolean(coding?.code))
        .map((coding) => ({ code: coding.code as string, display: coding.display }));
      if (codes.length) map.set(linkId, codes);
    });
    return map;
  }, [questionnaire]);

  function updateRules(next: MappingRule[]) {
    onChange(serializeMappingRules(next));
  }

  function updateRule(index: number, rule: MappingRule) {
    updateRules(rules.map((r, i) => (i === index ? rule : r)));
  }

  function renderLinkIdField(rule: Exclude<MappingRule, { kind: "meta" }>, index: number) {
    const known = linkIdOptions?.some((option) => option.linkId === rule.linkId);
    return (
      <label>
        項目(linkId)
        {linkIdOptions ? (
          <select
            value={rule.linkId}
            onChange={(e) => updateRule(index, { ...rule, linkId: e.target.value })}
          >
            <option value="">選択してください</option>
            {rule.linkId && !known && (
              <option value={rule.linkId}>{rule.linkId}(テンプレートにない項目)</option>
            )}
            {linkIdOptions.map((option) => (
              <option key={option.linkId} value={option.linkId}>
                {option.linkId}({option.label})
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={rule.linkId}
            onChange={(e) => updateRule(index, { ...rule, linkId: e.target.value })}
          />
        )}
      </label>
    );
  }

  function renderTlfIdField(rule: Extract<MappingRule, { tlfId: string }>, index: number) {
    return (
      <label>
        出力先アイテム ID(tlfId)
        <input
          type="text"
          list={tlfItems ? `${listId}-${rule.kind === "meta" ? "text" : "value"}` : undefined}
          value={rule.tlfId}
          onChange={(e) => updateRule(index, { ...rule, tlfId: e.target.value })}
        />
      </label>
    );
  }

  function renderShowField(rule: Extract<MappingRule, { show: string[] }>, index: number) {
    const update = (show: string[]) => updateRule(index, { ...rule, show });
    return (
      <div className="mapping-editor__show">
        <span>表示するアイテム ID(show)</span>
        {rule.show.map((id, i) => (
          // 並べ替えは無く末尾追加・個別削除のみなので index キーで足りる。
          <div key={i} className="mapping-editor__show-row">
            <input
              type="text"
              list={tlfItems ? `${listId}-all` : undefined}
              value={id}
              onChange={(e) => update(rule.show.map((s, j) => (j === i ? e.target.value : s)))}
            />
            {rule.show.length > 1 && (
              <button type="button" onClick={() => update(rule.show.filter((_, j) => j !== i))}>
                削除
              </button>
            )}
          </div>
        ))}
        <button type="button" onClick={() => update([...rule.show, ""])}>
          ID を追加
        </button>
      </div>
    );
  }

  function renderRule(rule: MappingRule, index: number) {
    return (
      // ルールに固有 ID は無く、並べ替えも無いので index キーで足りる。
      <li key={index} className="mapping-editor__rule">
        <div className="mapping-editor__rule-header">
          <span className="mapping-editor__rule-number">ルール{index + 1}</span>
          <select
            value={rule.kind}
            onChange={(e) => updateRule(index, convertRule(rule, e.target.value as RuleKind))}
          >
            {KIND_OPTIONS.map((option) => (
              <option key={option.kind} value={option.kind}>
                {option.label}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => updateRules(rules.filter((_, i) => i !== index))}>
            削除
          </button>
        </div>
        <div className="mapping-editor__fields">
          {rule.kind === "meta" ? (
            <label>
              メタ値(meta)
              <select
                value={rule.meta}
                onChange={(e) => updateRule(index, { ...rule, meta: e.target.value })}
              >
                <option value="">選択してください</option>
                {RESERVED_PLACEHOLDERS.map((p) => (
                  <option key={p.tlfId} value={p.tlfId}>
                    {p.tlfId}({p.label})
                  </option>
                ))}
              </select>
            </label>
          ) : (
            renderLinkIdField(rule, index)
          )}
          {rule.kind === "showCode" && (
            <label>
              一致する選択肢コード(code)
              <input
                type="text"
                list={codeOptions?.has(rule.linkId) ? `${listId}-code-${index}` : undefined}
                value={rule.code}
                onChange={(e) => updateRule(index, { ...rule, code: e.target.value })}
              />
              {codeOptions?.has(rule.linkId) && (
                <datalist id={`${listId}-code-${index}`}>
                  {codeOptions.get(rule.linkId)!.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.display}
                    </option>
                  ))}
                </datalist>
              )}
            </label>
          )}
          {rule.kind === "value" || rule.kind === "meta"
            ? renderTlfIdField(rule, index)
            : renderShowField(rule, index)}
        </div>
      </li>
    );
  }

  return (
    <div className="mapping-editor">
      <fieldset className="mapping-editor__fieldset" disabled={disabled}>
        <div className="mapping-editor__header">
          <span className="mapping-editor__title">マッピング定義(任意)</span>
          {showForm ? (
            <button type="button" onClick={() => setJsonMode(true)}>
              JSON で編集
            </button>
          ) : (
            <button type="button" onClick={() => setJsonMode(false)} disabled={!formAvailable}>
              フォームで編集
            </button>
          )}
        </div>

        {showForm ? (
          <>
            {rules.length === 0 && (
              <p className="report-layout-form__file">
                ルールはありません(linkId 由来の ID 規約のみで対応します)。
              </p>
            )}
            <ul className="mapping-editor__rules">{rules.map(renderRule)}</ul>
            <button
              type="button"
              className="mapping-editor__add"
              onClick={() => updateRules([...rules, { kind: "value", linkId: "", tlfId: "" }])}
            >
              ルールを追加
            </button>
          </>
        ) : (
          <>
            <textarea
              value={value}
              onChange={(e) => onChange(e.target.value)}
              rows={8}
              placeholder={'[\n  { "linkId": "item-1", "tlfId": "answer_1" },\n  { "linkId": "item-2", "code": "01", "show": ["check_1"] }\n]'}
            />
            {!formAvailable && (
              <p className="report-layout-form__file">
                フォームで編集できない内容のため JSON 編集に切り替えました({parsed.error})。
              </p>
            )}
          </>
        )}

        {tlfItems && (
          <>
            <datalist id={`${listId}-value`}>
              {[...tlfItems.textIds, ...tlfItems.imageIds].map((id) => (
                <option key={id} value={id} />
              ))}
            </datalist>
            <datalist id={`${listId}-text`}>
              {[...tlfItems.textIds].map((id) => (
                <option key={id} value={id} />
              ))}
            </datalist>
            <datalist id={`${listId}-all`}>
              {[...tlfItems.allIds].map((id) => (
                <option key={id} value={id} />
              ))}
            </datalist>
          </>
        )}
      </fieldset>
    </div>
  );
}
