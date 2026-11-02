import { useMemo, useState, type FormEvent } from "react";
import type { AdvisoryRule } from "../api/masterClient";
import { advisoryRuleHooks } from "../api/masterQueries";
import { usePatientsByNumber } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { MasterBackLink } from "../components/MasterBackLink";
import { Modal } from "../components/Modal";
import { PopulateExpressionModal } from "../components/PopulateExpressionModal";
import {
  ADVISORY_CONTEXT_LABELS,
  ADVISORY_CONTEXTS,
  ADVISORY_SEVERITY_LABELS,
  type AdvisoryContext,
} from "../fhir/advisoryHelpers";
import {
  ADVISORY_RULE_EXTRA_OPTIONS,
  ADVISORY_RULE_SEVERITIES,
  type AdvisoryRuleSeverity,
  evaluateAdvisoryRule,
} from "../fhir/advisoryRuleHelpers";
import { displayName } from "../fhir/patientHelpers";
import { useAdvisoryRuleEnv } from "../hooks/useAdvisoryRuleAdvisories";

// 施設の規則のマスタ(docs/advisory-design.md §2.9・§3.6)。条件式(FHIRPath と % 変数)が真になると、
// 選んだ場所(登録フォーム・カルテを開いたとき)で警告を出す。
export function AdvisoryRulePage() {
  const [editing, setEditing] = useState<AdvisoryRule | "new" | null>(null);
  const list = advisoryRuleHooks.useList();

  return (
    <div className="page">
      <div className="page__header">
        <h1>警告の規則</h1>
        <div className="page__header-actions">
          <button type="button" onClick={() => setEditing("new")}>
            追加
          </button>
          <MasterBackLink />
        </div>
      </div>

      <ErrorBanner error={list.error} />

      <table className="master-search__table">
        <thead>
          <tr>
            <th className="rad-code__compact">コード</th>
            <th>名称</th>
            <th className="rad-code__compact">重さ</th>
            <th>出す場所</th>
            <th className="rad-code__compact">有効</th>
            <th className="rad-code__compact">表示順</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((rule) => (
            <tr key={rule.id} className="master-search__row" onClick={() => setEditing(rule)}>
              <td className="rad-code__compact">{rule.code}</td>
              <td>{rule.name}</td>
              <td className="rad-code__compact">{ADVISORY_SEVERITY_LABELS[rule.severity]}</td>
              <td>{rule.contexts.map((context) => ADVISORY_CONTEXT_LABELS[context] ?? context).join("、")}</td>
              <td className="rad-code__compact">{rule.enabled ? "有効" : "無効"}</td>
              <td className="rad-code__compact">{rule.display_order ?? ""}</td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr>
              <td colSpan={6} className="master-search__empty">
                規則がありません。
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing !== null && (
        <RuleEditModal rule={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

interface Draft {
  code: string;
  name: string;
  severity: AdvisoryRuleSeverity;
  contexts: AdvisoryContext[];
  expression: string;
  message: string;
  detail: string;
  basis: string;
  enabled: boolean;
  displayOrder: string;
}

function draftOf(rule: AdvisoryRule | null): Draft {
  return {
    code: rule?.code ?? "",
    name: rule?.name ?? "",
    severity: rule?.severity ?? "info",
    contexts: rule?.contexts ?? [],
    expression: rule?.expression ?? "",
    message: rule?.message ?? "",
    detail: rule?.detail ?? "",
    basis: rule?.basis ?? "",
    enabled: rule?.enabled ?? true,
    displayOrder: rule?.display_order != null ? String(rule.display_order) : "",
  };
}

function RuleEditModal({ rule, onClose }: { rule: AdvisoryRule | null; onClose: () => void }) {
  const mutations = advisoryRuleHooks.useMutations();
  const [draft, setDraft] = useState(() => draftOf(rule));
  const [variablesOpen, setVariablesOpen] = useState(false);

  function toggleContext(context: AdvisoryContext) {
    setDraft((prev) => ({
      ...prev,
      contexts: prev.contexts.includes(context)
        ? prev.contexts.filter((value) => value !== context)
        : ADVISORY_CONTEXTS.filter((value) => value === context || prev.contexts.includes(value)),
    }));
  }

  function appendExpression(expression: string) {
    setDraft((prev) => ({
      ...prev,
      expression: prev.expression.trim() ? `${prev.expression.trim()} and ${expression}` : expression,
    }));
    setVariablesOpen(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const payload = {
      name: draft.name,
      severity: draft.severity,
      contexts: draft.contexts,
      expression: draft.expression,
      message: draft.message,
      detail: draft.detail || null,
      basis: draft.basis || null,
      enabled: draft.enabled,
      display_order: draft.displayOrder ? Number(draft.displayOrder) : null,
    };
    if (rule === null) {
      await mutations.create.mutateAsync({ ...payload, code: draft.code });
    } else {
      await mutations.update.mutateAsync({ id: rule.id, payload });
    }
    onClose();
  }

  async function handleDelete() {
    if (rule === null) return;
    if (!window.confirm(`${rule.name} を削除しますか？`)) return;

    await mutations.remove.mutateAsync(rule.id);
    onClose();
  }

  return (
    <Modal title={rule === null ? "警告の規則を追加" : "警告の規則を編集"} onClose={onClose} className="modal--advisory-rule">
      <form onSubmit={handleSubmit}>
        <div className="lab-order-item__fields">
          <label>
            コード
            <input
              type="text"
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              // コードは警告の key と集計に使うので、変えるときは作り直してもらう。
              disabled={rule !== null}
              pattern="[a-z0-9][a-z0-9\-]*"
              required
            />
          </label>
          <label>
            名称
            <input type="text" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
          </label>
          <label>
            重さ
            <select
              value={draft.severity}
              onChange={(e) => setDraft({ ...draft, severity: e.target.value as AdvisoryRuleSeverity })}
            >
              {ADVISORY_RULE_SEVERITIES.map((severity) => (
                <option key={severity} value={severity}>
                  {ADVISORY_SEVERITY_LABELS[severity]}
                </option>
              ))}
            </select>
          </label>
          <label>
            表示順
            <input
              type="number"
              value={draft.displayOrder}
              onChange={(e) => setDraft({ ...draft, displayOrder: e.target.value })}
            />
          </label>
          <label className="advisory-rule__checkbox">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
            />
            有効
          </label>
        </div>

        <fieldset className="advisory-rule__contexts">
          <legend>出す場所</legend>
          {ADVISORY_CONTEXTS.map((context) => (
            <label key={context} className="advisory-rule__checkbox">
              <input
                type="checkbox"
                checked={draft.contexts.includes(context)}
                onChange={() => toggleContext(context)}
              />
              {ADVISORY_CONTEXT_LABELS[context]}
            </label>
          ))}
        </fieldset>

        <label className="advisory-rule__wide">
          <span className="advisory-rule__label-row">
            条件式
            <button type="button" className="rp-card__compact-button" onClick={() => setVariablesOpen(true)}>
              変数
            </button>
          </span>
          <textarea
            className="advisory-rule__expression"
            rows={3}
            value={draft.expression}
            onChange={(e) => setDraft({ ...draft, expression: e.target.value })}
            spellCheck={false}
            required
          />
        </label>
        <label className="advisory-rule__wide">
          文言
          <input
            type="text"
            value={draft.message}
            onChange={(e) => setDraft({ ...draft, message: e.target.value })}
            required
          />
        </label>
        <label className="advisory-rule__wide">
          補足
          <textarea rows={2} value={draft.detail} onChange={(e) => setDraft({ ...draft, detail: e.target.value })} />
        </label>
        <label className="advisory-rule__wide">
          根拠
          <input type="text" value={draft.basis} onChange={(e) => setDraft({ ...draft, basis: e.target.value })} />
        </label>

        <RuleTrial expression={draft.expression} />

        <ErrorBanner error={mutations.create.error ?? mutations.update.error ?? mutations.remove.error} />

        <div className="lab-order-item__actions">
          <button
            type="submit"
            disabled={draft.contexts.length === 0 || mutations.create.isPending || mutations.update.isPending}
          >
            保存
          </button>
          {rule !== null && (
            <button type="button" onClick={handleDelete} disabled={mutations.remove.isPending}>
              削除
            </button>
          )}
        </div>
      </form>

      {/* 変数モーダルの中の結果項目の検索は <form> を持つので、この <form> の外に置く。 */}
      {variablesOpen && (
        <PopulateExpressionModal
          condition
          title="条件式の変数"
          extraOptions={ADVISORY_RULE_EXTRA_OPTIONS}
          onSelect={appendExpression}
          onClose={() => setVariablesOpen(false)}
        />
      )}
    </Modal>
  );
}


/** 患者番号を入れて、その患者で条件式を評価する(入力中の薬剤は空)。 */
function RuleTrial({ expression }: { expression: string }) {
  const [input, setInput] = useState("");
  const [number, setNumber] = useState("");
  const patients = usePatientsByNumber(number);
  const patient = patients.data?.length === 1 ? patients.data[0] : undefined;
  const expressions = useMemo(() => (patient && expression.trim() ? [expression] : []), [patient, expression]);
  const { env, error } = useAdvisoryRuleEnv(patient?.id ?? "", expressions);

  let result = "";
  if (number && patients.data && patients.data.length !== 1) {
    result = patients.data.length === 0 ? "該当する患者がいません" : "同じ番号の患者が複数います";
  } else if (patient && env && expression.trim()) {
    const outcome = evaluateAdvisoryRule(expression, env.patient, env.env);
    result = outcome.error ? `式の誤り: ${outcome.error}` : outcome.matched ? "該当" : "該当なし";
  } else if (patient && expression.trim()) {
    result = "読込中…";
  }

  return (
    <div className="advisory-rule__trial">
      <label>
        患者番号
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // Enter で規則の保存に進まないよう、ここでは試すだけにする。
            if (e.key !== "Enter") return;
            e.preventDefault();
            setNumber(input.trim());
          }}
        />
      </label>
      <button
        type="button"
        className="rp-card__compact-button"
        disabled={!input.trim()}
        onClick={() => setNumber(input.trim())}
      >
        試す
      </button>
      {patient && <span>{displayName(patient)}</span>}
      {result && <span className="advisory-rule__trial-result">{result}</span>}
      <ErrorBanner error={patients.error ?? error} />
    </div>
  );
}
