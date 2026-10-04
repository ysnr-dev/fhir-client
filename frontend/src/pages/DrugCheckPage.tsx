import { useId, useState, type FormEvent } from "react";
import type {
  DrugCheckSeverity,
  DrugDoseRule,
  DrugDoseRulePayload,
  DrugInteraction,
  DrugInteractionPayload,
  Medicine,
} from "../api/masterClient";
import {
  useDrugCheckMutations,
  useDrugDoseRules,
  useDrugInteractions,
  useMedicineTypeOptions,
} from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { MedicineSearchModal } from "../components/MedicineSearchModal";
import { Modal } from "../components/Modal";
import { ingredientKey } from "../fhir/medicationSafetyHelpers";
import { dosageFormLabel } from "../fhir/medicineHelpers";

// 薬剤チェックの施設マスタ(docs/drug-check-master-design.md)。
// 相互作用(併用禁忌・併用注意)と、用量と患者条件(年齢・腎機能・体重)の規則を
// タブで切り替える。薬は YJ コードの先頭 4〜7 桁(成分 7 桁 / 薬効分類 4 桁)で持つ。

type Tab = "interactions" | "doseRules";

const SEVERITY_OPTIONS: { value: DrugCheckSeverity; label: string }[] = [
  { value: "contraindicated", label: "禁忌" },
  { value: "caution", label: "注意" },
];

const DOSAGE_FORM_OPTIONS = [
  { value: "", label: "すべて" },
  { value: "1", label: "内用薬" },
  { value: "4", label: "注射薬" },
  { value: "6", label: "外用薬" },
];

function severityLabel(severity: DrugCheckSeverity, interaction = false): string {
  if (interaction) return severity === "contraindicated" ? "併用禁忌" : "併用注意";
  return severity === "contraindicated" ? "禁忌" : "注意";
}

function trimNumber(value: string | null): string {
  return value === null ? "" : String(Number(value));
}

export function DrugCheckPage() {
  const [tab, setTab] = useState<Tab>("interactions");
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setSubmitted(query.trim());
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>薬剤チェック</h1>
      </div>

      <div className="order-select__tabs" role="tablist">
        {(
          [
            ["interactions", "相互作用"],
            ["doseRules", "用量・患者条件"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? "order-select__tab is-active" : "order-select__tab"}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <form className="master-search__form master-search__form--row" onSubmit={handleSearch}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="薬剤名・コード"
          aria-label="薬剤名・コード"
        />
        <button type="submit">検索</button>
      </form>

      {tab === "interactions" ? (
        <InteractionTab query={submitted} />
      ) : (
        <DoseRuleTab query={submitted} />
      )}
    </div>
  );
}

// ---- 相互作用 -------------------------------------------------------------

function InteractionTab({ query }: { query: string }) {
  const interactions = useDrugInteractions(query);
  const [editing, setEditing] = useState<DrugInteraction | "new" | null>(null);

  return (
    <>
      <ErrorBanner error={interactions.error} />
      <div className="page__header">
        <p className="master-search__count">{interactions.data?.length ?? 0} 件</p>
        <button type="button" onClick={() => setEditing("new")}>
          相互作用追加
        </button>
      </div>
      <table className="master-search__table">
        <thead>
          <tr>
            <th className="rad-item__compact">区分</th>
            <th>医薬品1</th>
            <th>医薬品2</th>
            <th>機序・症状・対処</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {interactions.data?.map((row) => (
            <tr key={row.id}>
              <td className="rad-item__compact">
                <span className={row.severity === "contraindicated" ? "drug-check__severity--high" : ""}>
                  {severityLabel(row.severity, true)}
                </span>
              </td>
              <td>
                {row.name_a}
                <span className="lab-order-item__code">{row.code_a}</span>
              </td>
              <td>
                {row.name_b}
                <span className="lab-order-item__code">{row.code_b}</span>
              </td>
              <td className="drug-check__note">{row.note}</td>
              <td className="master-search__actions">
                <button type="button" onClick={() => setEditing(row)}>
                  編集
                </button>
              </td>
            </tr>
          ))}
          {interactions.data && interactions.data.length === 0 && (
            <tr>
              <td colSpan={5} className="master-search__empty">
                相互作用が登録されていません
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing !== null && (
        <InteractionEditModal
          interaction={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function InteractionEditModal({
  interaction,
  onClose,
}: {
  interaction: DrugInteraction | null;
  onClose: () => void;
}) {
  const mutations = useDrugCheckMutations();
  const [draft, setDraft] = useState<DrugInteractionPayload>(() =>
    interaction
      ? {
          code_a: interaction.code_a,
          name_a: interaction.name_a,
          code_b: interaction.code_b,
          name_b: interaction.name_b,
          severity: interaction.severity,
          note: interaction.note,
        }
      : { code_a: "", name_a: "", code_b: "", name_b: "", severity: "contraindicated", note: null },
  );
  const [picking, setPicking] = useState<"a" | "b" | null>(null);
  const [pickError, setPickError] = useState<Error | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    await mutations.saveInteraction.mutateAsync({ id: interaction?.id, payload: draft });
    onClose();
  }

  async function handleDelete() {
    if (!interaction) return;
    if (!window.confirm(`${interaction.name_a} × ${interaction.name_b} を削除しますか？`)) return;
    await mutations.removeInteraction.mutateAsync(interaction.id);
    onClose();
  }

  function handlePicked(medicine: Medicine) {
    if (!picking) return;
    const picked = ingredientFromMedicine(medicine);
    setPicking(null);
    setPickError(picked instanceof Error ? picked : null);
    if (picked instanceof Error) return;
    setDraft((prev) =>
      picking === "a"
        ? { ...prev, code_a: picked.code, name_a: picked.name }
        : { ...prev, code_b: picked.code, name_b: picked.name },
    );
  }

  const saving = mutations.saveInteraction.isPending || mutations.removeInteraction.isPending;

  return (
    <>
      <Modal
        title={interaction ? "相互作用を編集" : "相互作用を追加"}
        onClose={onClose}
        className="modal--lab-order-item"
      >
        <form onSubmit={handleSubmit}>
          <ErrorBanner
            error={pickError ?? mutations.saveInteraction.error ?? mutations.removeInteraction.error}
          />
          <div className="lab-order-item__fields">
            <DrugField
              label="医薬品1"
              code={draft.code_a}
              name={draft.name_a}
              onChange={(code, name) => setDraft({ ...draft, code_a: code, name_a: name })}
              onPick={() => setPicking("a")}
            />
            <DrugField
              label="医薬品2"
              code={draft.code_b}
              name={draft.name_b}
              onChange={(code, name) => setDraft({ ...draft, code_b: code, name_b: name })}
              onPick={() => setPicking("b")}
            />
            <label>
              区分
              <select
                value={draft.severity}
                onChange={(e) => setDraft({ ...draft, severity: e.target.value as DrugCheckSeverity })}
              >
                {SEVERITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {severityLabel(o.value, true)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              機序・症状・対処
              <textarea
                className="drug-check__textarea"
                rows={3}
                value={draft.note ?? ""}
                onChange={(e) => setDraft({ ...draft, note: e.target.value || null })}
              />
            </label>
          </div>
          <EditActions saving={saving} onDelete={interaction ? handleDelete : undefined} onClose={onClose} />
        </form>
      </Modal>
      {picking && (
        <MedicineSearchModal
          title="成分を医薬品から選ぶ"
          onSelect={handlePicked}
          onClose={() => setPicking(null)}
        />
      )}
    </>
  );
}

// ---- 用量・患者条件 -------------------------------------------------------

/** 規則の条件を 1 行の文に。 */
function conditionText(rule: DrugDoseRule): string {
  const parts: string[] = [];
  if (rule.age_from !== null && rule.age_to !== null) parts.push(`${rule.age_from} 歳以上 ${rule.age_to} 歳未満`);
  else if (rule.age_from !== null) parts.push(`${rule.age_from} 歳以上`);
  else if (rule.age_to !== null) parts.push(`${rule.age_to} 歳未満`);
  if (rule.renal_index && rule.renal_below !== null) {
    parts.push(`${rule.renal_index === "egfr" ? "eGFR" : "CCr"} ${trimNumber(rule.renal_below)} 未満`);
  }
  return parts.join("・");
}

function limitText(rule: DrugDoseRule): string {
  const unit = `${rule.dose_unit ?? ""}${rule.per_kg ? "/kg" : ""}`;
  const parts: string[] = [];
  if (rule.max_single_dose !== null) parts.push(`1回 ${trimNumber(rule.max_single_dose)}${unit}`);
  if (rule.max_daily_dose !== null) parts.push(`1日 ${trimNumber(rule.max_daily_dose)}${unit}`);
  return parts.join(" / ");
}

function DoseRuleTab({ query }: { query: string }) {
  const rules = useDrugDoseRules(query);
  const [editing, setEditing] = useState<DrugDoseRule | "new" | null>(null);

  return (
    <>
      <ErrorBanner error={rules.error} />
      <div className="page__header">
        <p className="master-search__count">{rules.data?.length ?? 0} 件</p>
        <button type="button" onClick={() => setEditing("new")}>
          規則追加
        </button>
      </div>
      <table className="master-search__table">
        <thead>
          <tr>
            <th>医薬品</th>
            <th className="rad-item__compact">剤形</th>
            <th>条件</th>
            <th>上限</th>
            <th className="rad-item__compact">区分</th>
            <th>文言</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rules.data?.map((rule) => (
            <tr key={rule.id}>
              <td>
                {rule.name}
                <span className="lab-order-item__code">{rule.code}</span>
              </td>
              <td className="rad-item__compact">{rule.dosage_form ? dosageFormLabel(rule.dosage_form) : "すべて"}</td>
              <td>{conditionText(rule)}</td>
              <td>{limitText(rule)}</td>
              <td className="rad-item__compact">
                <span className={rule.severity === "contraindicated" ? "drug-check__severity--high" : ""}>
                  {severityLabel(rule.severity)}
                </span>
              </td>
              <td className="drug-check__note">{rule.message}</td>
              <td className="master-search__actions">
                <button type="button" onClick={() => setEditing(rule)}>
                  編集
                </button>
              </td>
            </tr>
          ))}
          {rules.data && rules.data.length === 0 && (
            <tr>
              <td colSpan={7} className="master-search__empty">
                規則が登録されていません
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing !== null && (
        <DoseRuleEditModal rule={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

interface DoseRuleDraft {
  code: string;
  name: string;
  dosage_form: string;
  age_from: string;
  age_to: string;
  renal_index: "" | "egfr" | "ccr";
  renal_below: string;
  max_single_dose: string;
  max_daily_dose: string;
  dose_unit: string;
  per_kg: boolean;
  severity: DrugCheckSeverity;
  message: string;
}

function toDoseRuleDraft(rule: DrugDoseRule | null): DoseRuleDraft {
  return {
    code: rule?.code ?? "",
    name: rule?.name ?? "",
    dosage_form: rule?.dosage_form ?? "",
    age_from: rule?.age_from?.toString() ?? "",
    age_to: rule?.age_to?.toString() ?? "",
    renal_index: rule?.renal_index ?? "",
    renal_below: trimNumber(rule?.renal_below ?? null),
    max_single_dose: trimNumber(rule?.max_single_dose ?? null),
    max_daily_dose: trimNumber(rule?.max_daily_dose ?? null),
    dose_unit: rule?.dose_unit ?? "mg",
    per_kg: rule?.per_kg ?? false,
    severity: rule?.severity ?? "caution",
    message: rule?.message ?? "",
  };
}

function numberOrNull(value: string): number | null {
  return value.trim() === "" ? null : Number(value);
}

function toDoseRulePayload(draft: DoseRuleDraft): DrugDoseRulePayload {
  const hasLimit = draft.max_single_dose.trim() !== "" || draft.max_daily_dose.trim() !== "";
  return {
    code: draft.code.trim(),
    name: draft.name.trim(),
    dosage_form: draft.dosage_form || null,
    age_from: numberOrNull(draft.age_from),
    age_to: numberOrNull(draft.age_to),
    renal_index: draft.renal_index || null,
    renal_below: draft.renal_index ? numberOrNull(draft.renal_below) : null,
    max_single_dose: numberOrNull(draft.max_single_dose),
    max_daily_dose: numberOrNull(draft.max_daily_dose),
    dose_unit: hasLimit ? draft.dose_unit.trim() || null : null,
    per_kg: hasLimit && draft.per_kg,
    severity: draft.severity,
    message: draft.message.trim() || null,
  };
}

function DoseRuleEditModal({ rule, onClose }: { rule: DrugDoseRule | null; onClose: () => void }) {
  const mutations = useDrugCheckMutations();
  const [draft, setDraft] = useState<DoseRuleDraft>(() => toDoseRuleDraft(rule));
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState<Error | null>(null);
  const update = (patch: Partial<DoseRuleDraft>) => setDraft((prev) => ({ ...prev, ...patch }));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    await mutations.saveDoseRule.mutateAsync({ id: rule?.id, payload: toDoseRulePayload(draft) });
    onClose();
  }

  async function handleDelete() {
    if (!rule) return;
    if (!window.confirm(`${rule.name} の規則を削除しますか？`)) return;
    await mutations.removeDoseRule.mutateAsync(rule.id);
    onClose();
  }

  function handlePicked(medicine: Medicine) {
    if (!picking) return;
    const picked = ingredientFromMedicine(medicine);
    setPicking(false);
    setPickError(picked instanceof Error ? picked : null);
    if (picked instanceof Error) return;
    update({ code: picked.code, name: picked.name, dosage_form: draft.dosage_form || medicine.dosage_form || "" });
  }

  const saving = mutations.saveDoseRule.isPending || mutations.removeDoseRule.isPending;

  return (
    <>
      <Modal title={rule ? "規則を編集" : "規則を追加"} onClose={onClose} className="modal--lab-order-item">
        <form onSubmit={handleSubmit}>
          <ErrorBanner error={pickError ?? mutations.saveDoseRule.error ?? mutations.removeDoseRule.error} />
          <div className="lab-order-item__fields">
            <DrugField
              label="医薬品"
              code={draft.code}
              name={draft.name}
              onChange={(code, name) => update({ code, name })}
              onPick={() => setPicking(true)}
            />
            <label>
              剤形
              <select value={draft.dosage_form} onChange={(e) => update({ dosage_form: e.target.value })}>
                {DOSAGE_FORM_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              区分
              <select
                value={draft.severity}
                onChange={(e) => update({ severity: e.target.value as DrugCheckSeverity })}
              >
                {SEVERITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="drug-check__inline">
              <span>年齢</span>
              <input
                type="number"
                min={0}
                value={draft.age_from}
                onChange={(e) => update({ age_from: e.target.value })}
                aria-label="年齢の下限"
              />
              <span>歳以上</span>
              <input
                type="number"
                min={0}
                value={draft.age_to}
                onChange={(e) => update({ age_to: e.target.value })}
                aria-label="年齢の上限"
              />
              <span>歳未満</span>
            </div>
            <div className="drug-check__inline">
              <span>腎機能</span>
              <select
                value={draft.renal_index}
                onChange={(e) => update({ renal_index: e.target.value as DoseRuleDraft["renal_index"] })}
                aria-label="腎機能の指標"
              >
                <option value="">指定なし</option>
                <option value="egfr">eGFR</option>
                <option value="ccr">CCr</option>
              </select>
              <input
                type="number"
                min={0}
                step="any"
                value={draft.renal_below}
                onChange={(e) => update({ renal_below: e.target.value })}
                disabled={!draft.renal_index}
                aria-label="腎機能のしきい値"
              />
              <span>未満</span>
            </div>
            <div className="drug-check__inline">
              <span>上限</span>
              <span>1回</span>
              <input
                type="number"
                min={0}
                step="any"
                value={draft.max_single_dose}
                onChange={(e) => update({ max_single_dose: e.target.value })}
                aria-label="1回量の上限"
              />
              <span>1日</span>
              <input
                type="number"
                min={0}
                step="any"
                value={draft.max_daily_dose}
                onChange={(e) => update({ max_daily_dose: e.target.value })}
                aria-label="1日量の上限"
              />
              <input
                type="text"
                className="drug-check__unit"
                value={draft.dose_unit}
                onChange={(e) => update({ dose_unit: e.target.value })}
                aria-label="上限の単位"
              />
              <label className="drug-check__check">
                <input
                  type="checkbox"
                  checked={draft.per_kg}
                  onChange={(e) => update({ per_kg: e.target.checked })}
                />
                /kg
              </label>
            </div>
            <label>
              文言
              <textarea
                className="drug-check__textarea"
                rows={2}
                value={draft.message} onChange={(e) => update({ message: e.target.value })} />
            </label>
          </div>
          <EditActions saving={saving} onDelete={rule ? handleDelete : undefined} onClose={onClose} />
        </form>
      </Modal>
      {picking && (
        <MedicineSearchModal
          title="成分を医薬品から選ぶ"
          dosageForm={draft.dosage_form || undefined}
          onSelect={handlePicked}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}

// ---- 共通 ---------------------------------------------------------------

/** 成分(YJ 上 7 桁)で指すか、薬効分類(4 桁)で指すか。 */
type CodeLevel = "ingredient" | "yakko";

/** 選んだ医薬品から成分のコード(YJ 上 7 桁)と一般名を作る。成分が取れない薬は Error。 */
function ingredientFromMedicine(medicine: Medicine): { code: string; name: string } | Error {
  const key = ingredientKey(medicine);
  if (!key) return new Error(`${medicine.name} は YJ コードを持たないため選べません。`);
  const generic = (medicine.generic_name_description ?? "").replace(/^【般】/, "");
  return { code: key, name: generic || medicine.name };
}

/**
 * 医薬品の指定。成分なら医薬品検索から選び(名称は手で直せる)、薬効分類なら
 * 薬効分類の一覧から直接選ぶ。
 */
function DrugField({
  label,
  code,
  name,
  onChange,
  onPick,
}: {
  label: string;
  code: string;
  name: string;
  onChange: (code: string, name: string) => void;
  /** 成分を医薬品検索から選ぶ。 */
  onPick: () => void;
}) {
  const [level, setLevel] = useState<CodeLevel>(code.length === 4 ? "yakko" : "ingredient");

  function changeLevel(next: CodeLevel) {
    setLevel(next);
    onChange("", "");
  }

  return (
    <div className="drug-check__drug">
      <span>{label}</span>
      <select
        value={level}
        onChange={(e) => changeLevel(e.target.value as CodeLevel)}
        aria-label={`${label}の指定方法`}
      >
        <option value="ingredient">成分</option>
        <option value="yakko">薬効分類</option>
      </select>
      {level === "ingredient" ? (
        <>
          <input
            type="text"
            className="drug-check__code"
            value={code}
            onChange={(e) => onChange(e.target.value, name)}
            placeholder="コード"
            aria-label={`${label}のコード`}
            required
          />
          <input
            type="text"
            className="drug-check__name"
            value={name}
            onChange={(e) => onChange(code, e.target.value)}
            placeholder="名称"
            aria-label={`${label}の名称`}
            required
          />
          <button type="button" onClick={onPick}>
            医薬品選択
          </button>
        </>
      ) : (
        <YakkoInput label={label} code={code} name={name} onChange={onChange} />
      )}
    </div>
  );
}

/** 薬効分類の選択。候補("2171 冠血管拡張剤")を選ぶか、4 桁の番号を直接打つと確定する。 */
function YakkoInput({
  label,
  code,
  name,
  onChange,
}: {
  label: string;
  code: string;
  name: string;
  onChange: (code: string, name: string) => void;
}) {
  const options = useMedicineTypeOptions(true);
  const listId = useId();
  const [text, setText] = useState(code ? `${code} ${name}` : "");

  function handleChange(value: string) {
    setText(value);
    const matched =
      options.data?.find((t) => `${t.code} ${t.name ?? ""}` === value) ??
      (/^\d{4}$/.test(value) ? options.data?.find((t) => t.code === value) : undefined);
    if (matched) {
      onChange(matched.code, matched.name ?? matched.code);
      setText(`${matched.code} ${matched.name ?? ""}`);
    } else {
      onChange("", "");
    }
  }

  return (
    <>
      <input
        type="text"
        className="drug-check__name"
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        list={listId}
        placeholder="薬効名・番号"
        aria-label={`${label}の薬効分類`}
        required
      />
      <datalist id={listId}>
        {options.data?.map((type) => (
          <option key={type.id} value={`${type.code} ${type.name ?? ""}`} />
        ))}
      </datalist>
    </>
  );
}

function EditActions({
  saving,
  onDelete,
  onClose,
}: {
  saving: boolean;
  onDelete?: () => void;
  onClose: () => void;
}) {
  return (
    <div className="brought-med__actions">
      {onDelete && (
        <button type="button" onClick={onDelete} disabled={saving}>
          削除
        </button>
      )}
      <button type="button" onClick={onClose}>
        キャンセル
      </button>
      <button type="submit" disabled={saving}>
        {saving ? "保存中..." : "保存"}
      </button>
    </div>
  );
}
