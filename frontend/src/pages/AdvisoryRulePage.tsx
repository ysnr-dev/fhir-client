import { useMemo, useState, type FormEvent } from "react";
import type { AdvisoryRule, LabResultItem } from "../api/masterClient";
import { advisoryRuleHooks } from "../api/masterQueries";
import { useLabResultItem } from "../api/masterQueries";
import { usePatientsByNumber } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { LabResultItemSearchModal } from "../components/LabResultItemSearchModal";
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
import {
  type AdvisoryRuleMaintenance,
  MAINTENANCE_KIND_LABELS,
  MAINTENANCE_KINDS,
  MAINTENANCE_STATE_LABELS,
  type MaintenanceKind,
  maintenanceStatusOf,
} from "../fhir/healthMaintenanceHelpers";
import { displayName } from "../fhir/patientHelpers";
import { useAdvisoryRuleEvaluation } from "../hooks/useAdvisoryRuleAdvisories";

// 施設の規則のマスタ(docs/advisory-design.md §2.9・§3.6)。条件式(FHIRPath と % 変数)が真になると、
// 選んだ場所(登録フォーム・カルテを開いたとき)で警告を出す。定期項目を持たせると定期検査・検診の規則(§2.10)になり、
// 式が対象の患者を選び、項目の最終実施日と間隔から期限を出す。
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
            <th>定期項目</th>
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
              <td>{maintenanceLabel(rule.maintenance)}</td>
              <td className="rad-code__compact">{rule.enabled ? "有効" : "無効"}</td>
              <td className="rad-code__compact">{rule.display_order ?? ""}</td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr>
              <td colSpan={7} className="master-search__empty">
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

function maintenanceLabel(maintenance: AdvisoryRuleMaintenance | null): string {
  if (!maintenance) return "";
  return `${MAINTENANCE_KIND_LABELS[maintenance.kind]} ${maintenance.name ?? maintenance.code} / ${maintenance.interval_days} 日`;
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
  /** 空は定期項目なし。 */
  maintenanceKind: MaintenanceKind | "";
  maintenanceCode: string;
  maintenanceName: string;
  maintenanceInterval: string;
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
    maintenanceKind: rule?.maintenance?.kind ?? "",
    maintenanceCode: rule?.maintenance?.code ?? "",
    maintenanceName: rule?.maintenance?.name ?? "",
    maintenanceInterval: rule?.maintenance ? String(rule.maintenance.interval_days) : "",
  };
}

/** 入力中の定期項目。種類が無ければ null、種類があってコードか間隔が欠けていれば undefined(保存できない)。 */
function maintenanceOf(draft: Draft): AdvisoryRuleMaintenance | null | undefined {
  if (!draft.maintenanceKind) return null;
  const interval = Number(draft.maintenanceInterval);
  if (!draft.maintenanceCode.trim() || !Number.isInteger(interval) || interval <= 0) return undefined;
  return {
    kind: draft.maintenanceKind,
    code: draft.maintenanceCode.trim(),
    name: draft.maintenanceName.trim() || null,
    interval_days: interval,
  };
}

function RuleEditModal({ rule, onClose }: { rule: AdvisoryRule | null; onClose: () => void }) {
  const mutations = advisoryRuleHooks.useMutations();
  const [draft, setDraft] = useState(() => draftOf(rule));
  const [variablesOpen, setVariablesOpen] = useState(false);
  const [labSearchOpen, setLabSearchOpen] = useState(false);
  const maintenance = maintenanceOf(draft);

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

  function selectLabItem(item: LabResultItem) {
    setDraft((prev) => ({ ...prev, maintenanceCode: item.result_item_code, maintenanceName: item.name }));
    setLabSearchOpen(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (maintenance === undefined) return;
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
      maintenance,
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

        <fieldset className="advisory-rule__maintenance">
          <legend>定期項目</legend>
          <div className="lab-order-item__fields">
            <label>
              種類
              <select
                value={draft.maintenanceKind}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    maintenanceKind: e.target.value as MaintenanceKind | "",
                    maintenanceCode: "",
                    maintenanceName: "",
                  })
                }
              >
                <option value="">なし</option>
                {MAINTENANCE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {MAINTENANCE_KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
            </label>
            {draft.maintenanceKind === "lab" ? (
              <div className="advisory-rule__lab-item">
                <span>項目</span>
                <span className="advisory-rule__label-row">
                  <span>{draft.maintenanceCode ? `${draft.maintenanceName || "?"}(${draft.maintenanceCode})` : "未選択"}</span>
                  <button type="button" className="rp-card__compact-button" onClick={() => setLabSearchOpen(true)}>
                    項目を選択
                  </button>
                </span>
              </div>
            ) : draft.maintenanceKind ? (
              <>
                <label>
                  コード
                  <input
                    type="text"
                    value={draft.maintenanceCode}
                    onChange={(e) => setDraft({ ...draft, maintenanceCode: e.target.value })}
                  />
                </label>
                <label>
                  項目名
                  <input
                    type="text"
                    value={draft.maintenanceName}
                    onChange={(e) => setDraft({ ...draft, maintenanceName: e.target.value })}
                  />
                </label>
              </>
            ) : null}
            {draft.maintenanceKind && (
              <label>
                間隔(日)
                <input
                  type="number"
                  min={1}
                  value={draft.maintenanceInterval}
                  onChange={(e) => setDraft({ ...draft, maintenanceInterval: e.target.value })}
                />
              </label>
            )}
          </div>
        </fieldset>

        <RuleTrial expression={draft.expression} maintenance={maintenance ?? null} />

        <ErrorBanner error={mutations.create.error ?? mutations.update.error ?? mutations.remove.error} />

        <div className="lab-order-item__actions">
          <button
            type="submit"
            disabled={
              draft.contexts.length === 0 ||
              maintenance === undefined ||
              mutations.create.isPending ||
              mutations.update.isPending
            }
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

      {/* 変数モーダル・検査項目の検索は <form> を持つので、この <form> の外に置く。 */}
      {variablesOpen && (
        <PopulateExpressionModal
          condition
          title="条件式の変数"
          extraOptions={ADVISORY_RULE_EXTRA_OPTIONS}
          onSelect={appendExpression}
          onClose={() => setVariablesOpen(false)}
        />
      )}
      {labSearchOpen && (
        <LabResultItemSearchModal title="定期項目の検査項目" onSelect={selectLabItem} onClose={() => setLabSearchOpen(false)} />
      )}
    </Modal>
  );
}

/** 患者番号を入れて、その患者で条件式(と定期項目の期限)を評価する(入力中の薬剤は空)。 */
function RuleTrial({ expression, maintenance }: { expression: string; maintenance: AdvisoryRuleMaintenance | null }) {
  const [input, setInput] = useState("");
  const [number, setNumber] = useState("");
  const patients = usePatientsByNumber(number);
  const patient = patients.data?.length === 1 ? patients.data[0] : undefined;
  const maintenanceKey = JSON.stringify(maintenance);
  const rules = useMemo(
    () =>
      patient && expression.trim()
        ? [{ code: "trial", expression, maintenance: JSON.parse(maintenanceKey) as AdvisoryRuleMaintenance | null }]
        : [],
    [patient, expression, maintenanceKey],
  );
  const { env, records, error } = useAdvisoryRuleEvaluation(patient?.id ?? "", rules);
  const currentLabItem = useLabResultItem(maintenance?.kind === "lab" ? maintenance.code : null);

  let result = "";
  if (number && patients.data && patients.data.length !== 1) {
    result = patients.data.length === 0 ? "該当する患者がいません" : "同じ番号の患者が複数います";
  } else if (patient && env && rules.length > 0) {
    const outcome = evaluateAdvisoryRule(expression, env.patient, env.env);
    if (outcome.error) result = `式の誤り: ${outcome.error}`;
    else if (!outcome.matched) result = "該当なし";
    else {
      const record = rules[0].maintenance ? records.get("trial") : undefined;
      if (rules[0].maintenance && record) {
        const status = maintenanceStatusOf(rules[0].maintenance, record);
        result = `該当(${MAINTENANCE_STATE_LABELS[status.state]}${status.lastDate ? `、最終 ${status.lastDate}` : ""})`;
      } else {
        result = "該当";
      }
    }
  } else if (patient && rules.length > 0) {
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
      <ErrorBanner error={patients.error ?? error ?? currentLabItem.error} />
    </div>
  );
}
