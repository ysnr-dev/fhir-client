import { useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useMedicineAttributeMutations, useMedicineAttributes } from "../api/masterQueries";
import type {
  Medicine,
  MedicineAdoptionImportResult,
  MedicineAttribute,
  MedicineAttributeDefinition,
  MedicineAttributeQuantity,
  MedicineAttributeValue,
} from "../api/masterClient";
import { useSelfDepartments } from "../api/queries";
import { ErrorBanner } from "../components/ErrorBanner";
import { MedicineSearchModal } from "../components/MedicineSearchModal";
import { Modal } from "../components/Modal";
import { TrashIcon } from "../components/icons/TrashIcon";
import { MasterBackLink } from "../components/MasterBackLink";
import { departmentCode, departmentDisplayName, sortDepartmentsByCode } from "../fhir/departmentHelpers";

// 薬剤付加情報(docs/lot-number-design.md)。施設独自の薬剤の設定を 1 薬 1 行で持つ。
// 一覧は設定済みの項目を要約で出し、編集はモーダルで行う。項目は backend の定義(definitions)から
// 組み立てるので、項目が増えても画面は直さない。
// 行が無くても既定で項目が真になる薬(生物学的製剤の印がある薬のロット管理)は「既定」として並べ、
// 保存した時点で行を作る。行を削除すると既定に戻る。

export function MedicineAttributePage() {
  const [includeDefaults, setIncludeDefaults] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<MedicineAttribute | null>(null);
  const [imported, setImported] = useState<MedicineAdoptionImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const list = useMedicineAttributes(includeDefaults);
  const { create, remove, importAdoption } = useMedicineAttributeMutations();
  const { departments } = useSelfDepartments();
  const departmentNames = new Map(departments.map((d) => [departmentCode(d), departmentDisplayName(d)]));

  const definitions = list.data?.definitions ?? [];
  const items = (list.data?.items ?? []).filter((item) => matchesKeyword(item, keyword));

  function handleDelete(item: MedicineAttribute) {
    if (item.id == null) return;
    if (!window.confirm(`${item.medicine_name ?? item.medicine_code} の薬剤付加情報を削除しますか？`)) return;
    remove.mutate(item.id);
  }

  // 登録済みの薬はその行を、未登録の薬は空の行を作ってから開く(設定できる項目と既定値は backend が決める)。
  async function handleAdd(medicine: Medicine) {
    setAdding(false);
    const existing = list.data?.items.find((i) => i.medicine_code === medicine.medicine_code && i.registered);
    setEditing(existing ?? (await create.mutateAsync({ medicine_code: medicine.medicine_code, settings: {} })));
  }

  async function handleImport(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImported(null);
    setImported(await importAdoption.mutateAsync(file));
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>薬剤付加情報</h1>
        <div>
          <button type="button" onClick={() => setAdding(true)} disabled={create.isPending}>
            ＋薬剤
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={importAdoption.isPending}
            title="医薬品コード, 採用区分 の 2 列の CSV"
          >
            採用区分取込
          </button>
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" hidden onChange={handleImport} />
          <MasterBackLink />
        </div>
      </div>

      <div className="patient-search-form">
        <label>
          医薬品名
          <input type="text" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
        </label>
        <label className="dose-conversion__checkbox">
          <input
            type="checkbox"
            checked={includeDefaults}
            onChange={(e) => setIncludeDefaults(e.target.checked)}
          />
          既定で対象の薬も表示
        </label>
      </div>

      <ErrorBanner error={list.error} />
      <ErrorBanner error={create.error ?? remove.error ?? importAdoption.error} />
      {imported && (
        <p className="master-search__count">
          採用区分を {imported.imported} 件取り込みました
          {imported.skipped > 0 && `(医薬品マスタに無いコード ${imported.skipped} 件)`}
        </p>
      )}

      <table className="master-search__table medicine-attribute__table">
        <thead>
          <tr>
            <th>医薬品名</th>
            <th>コード</th>
            <th>設定</th>
            <th>備考</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.medicine_code}>
              <td>
                {item.medicine_name ?? <span className="medicine-attribute__missing">医薬品マスタに無いコード</span>}
                {!item.registered && <span className="medicine-attribute__badge">既定</span>}
              </td>
              <td className="medicine-attribute__code">{item.medicine_code}</td>
              <td>
                {attributeSummary(definitions, item, departmentNames).map((text) => (
                  <span key={text} className="medicine-attribute__chip">
                    {text}
                  </span>
                ))}
              </td>
              <td>{item.note}</td>
              <td className="master-search__actions">
                <span className="medicine-attribute__actions">
                  <button type="button" className="rp-card__compact-button" onClick={() => setEditing(item)}>
                    編集
                  </button>
                  {item.registered && (
                    <button
                      type="button"
                      className="rp-card__icon-button"
                      title={`${item.medicine_name ?? item.medicine_code}を削除`}
                      aria-label={`${item.medicine_name ?? item.medicine_code}を削除`}
                      onClick={() => handleDelete(item)}
                      disabled={remove.isPending}
                    >
                      <TrashIcon />
                    </button>
                  )}
                </span>
              </td>
            </tr>
          ))}
          {list.data && items.length === 0 && (
            <tr>
              <td colSpan={5} className="master-search__empty">
                該当する薬剤がありません
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {adding && (
        <MedicineSearchModal title="薬剤を選択" onSelect={handleAdd} onClose={() => setAdding(false)} />
      )}
      {editing && (
        <AttributeEditModal
          item={editing}
          definitions={definitions}
          departments={sortDepartmentsByCode(departments)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function matchesKeyword(item: MedicineAttribute, keyword: string): boolean {
  const word = keyword.trim();
  if (!word) return true;
  return (item.medicine_name ?? "").includes(word) || item.medicine_code.includes(word);
}

/** 一覧に出す、既定と違う値の項目(「ロット管理」「採用」「DDD 2g」「内科・外科」)。 */
function attributeSummary(
  definitions: MedicineAttributeDefinition[],
  item: MedicineAttribute,
  departmentNames: ReadonlyMap<string, string>,
): string[] {
  return definitions.flatMap((definition) => {
    if (item.applicable?.[definition.key] === false) return [];
    const value = item.effective[definition.key];
    if (definition.type === "boolean") return value === true ? [definition.label] : [];
    if (definition.type === "enum") {
      // 先頭の選択肢は「該当しない・未設定」。
      if (typeof value !== "string" || value === definition.options?.[0]?.value) return [];
      return [definition.options?.find((o) => o.value === value)?.label ?? value];
    }
    if (definition.type === "departments") {
      if (!Array.isArray(value) || value.length === 0) return [];
      return [value.map((code) => departmentNames.get(code) ?? code).join("・")];
    }
    return isQuantity(value) ? [`${definition.label} ${value.value}${value.unit}`] : [];
  });
}

function isQuantity(value: MedicineAttributeValue | undefined): value is MedicineAttributeQuantity {
  return typeof value === "object" && value !== null && "value" in value;
}

/** 1 薬の編集。保存するのは触った項目だけで、触っていない項目は既定のまま(行の settings に入れない)。 */
function AttributeEditModal({
  item,
  definitions,
  departments,
  onClose,
}: {
  item: MedicineAttribute;
  definitions: MedicineAttributeDefinition[];
  departments: fhir4.Organization[];
  onClose: () => void;
}) {
  const { create, update } = useMedicineAttributeMutations();
  const [settings, setSettings] = useState<MedicineAttribute["settings"]>(item.settings);
  const [note, setNote] = useState(item.note ?? "");
  const [quantityError, setQuantityError] = useState(false);
  const noteId = useId();
  const saving = create.isPending || update.isPending;

  const valueOf = (key: string): MedicineAttributeValue =>
    key in settings ? settings[key] : (item.effective[key] ?? null);
  const change = (key: string, value: MedicineAttributeValue) => setSettings((prev) => ({ ...prev, [key]: value }));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (quantityError) return;
    const payload = { settings, note: note.trim() || null };
    if (item.id == null) {
      await create.mutateAsync({ medicine_code: item.medicine_code, ...payload });
    } else {
      await update.mutateAsync({ id: item.id, payload });
    }
    onClose();
  }

  const fields = definitions.filter((definition) => item.applicable?.[definition.key] !== false);

  return (
    <Modal title={item.medicine_name ?? item.medicine_code} onClose={onClose} className="modal--medicine-attribute">
      <form onSubmit={handleSubmit}>
        <ErrorBanner error={create.error ?? update.error} />
        <p className="medicine-attribute__code-line">{item.medicine_code}</p>
        <div className="medicine-attribute__fields">
          {fields.map((definition) => (
            <AttributeField
              key={definition.key}
              definition={definition}
              value={valueOf(definition.key)}
              departments={departments}
              onChange={(value) => change(definition.key, value)}
              onQuantityError={setQuantityError}
            />
          ))}
          <label className="medicine-attribute__label" htmlFor={noteId}>
            備考
          </label>
          <input id={noteId} type="text" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="brought-med__actions">
          <button type="button" onClick={onClose}>
            キャンセル
          </button>
          <button type="submit" disabled={saving || quantityError}>
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * 項目 1 つの行(左に項目名、右に入力)。boolean はチェック、enum はセレクト、quantity は数値と単位、
 * departments は選んだ科のチップと追加のセレクト。
 */
function AttributeField({
  definition,
  value,
  departments,
  onChange,
  onQuantityError,
}: {
  definition: MedicineAttributeDefinition;
  value: MedicineAttributeValue;
  departments: fhir4.Organization[];
  onChange: (value: MedicineAttributeValue) => void;
  onQuantityError: (invalid: boolean) => void;
}) {
  const id = useId();
  const label = (
    <label className="medicine-attribute__label" htmlFor={id}>
      {definition.label}
    </label>
  );

  if (definition.type === "boolean") {
    return (
      <>
        {label}
        <span className="medicine-attribute__control">
          <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
        </span>
      </>
    );
  }

  if (definition.type === "enum") {
    return (
      <>
        {label}
        <span className="medicine-attribute__control">
          <select id={id} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)}>
            {(definition.options ?? []).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </span>
      </>
    );
  }

  if (definition.type === "departments") {
    return (
      <>
        {label}
        <DepartmentPicker
          id={id}
          label={definition.label}
          selected={Array.isArray(value) ? value : []}
          departments={departments}
          onChange={onChange}
        />
      </>
    );
  }

  return (
    <>
      {label}
      <QuantityField
        id={id}
        label={definition.label}
        units={definition.units ?? []}
        value={isQuantity(value) ? value : null}
        onChange={onChange}
        onError={onQuantityError}
      />
    </>
  );
}

/** 選んだ診療科をチップで並べ(× で外す)、残りの科をセレクトで足す。何も選ばなければすべての科。 */
function DepartmentPicker({
  id,
  label,
  selected,
  departments,
  onChange,
}: {
  id: string;
  label: string;
  selected: string[];
  departments: fhir4.Organization[];
  onChange: (value: string[]) => void;
}) {
  const options = departments.flatMap((department) => {
    const code = departmentCode(department);
    return code ? [{ code, name: departmentDisplayName(department) }] : [];
  });
  const nameOf = (code: string) => options.find((o) => o.code === code)?.name ?? code;

  return (
    <span className="medicine-attribute__control medicine-attribute__departments">
      {selected.map((code) => (
        <span key={code} className="medicine-attribute__department">
          {nameOf(code)}
          <button
            type="button"
            className="medicine-attribute__department-remove"
            title={`${nameOf(code)}を外す`}
            aria-label={`${nameOf(code)}を外す`}
            onClick={() => onChange(selected.filter((c) => c !== code))}
          >
            ×
          </button>
        </span>
      ))}
      <select
        id={id}
        aria-label={`${label}を追加`}
        value=""
        onChange={(e) => e.target.value && onChange([...selected, e.target.value])}
      >
        <option value="">{selected.length === 0 ? "すべての科" : "追加"}</option>
        {options
          .filter((o) => !selected.includes(o.code))
          .map((o) => (
            <option key={o.code} value={o.code}>
              {o.name}
            </option>
          ))}
      </select>
    </span>
  );
}

/** 数値と単位。数値を空にすると未設定に戻す。 */
function QuantityField({
  id,
  label,
  units,
  value,
  onChange,
  onError,
}: {
  id: string;
  label: string;
  units: string[];
  value: MedicineAttributeQuantity | null;
  onChange: (value: MedicineAttributeQuantity | null) => void;
  onError: (invalid: boolean) => void;
}) {
  const [amount, setAmount] = useState(value ? String(value.value) : "");
  const [unit, setUnit] = useState(value?.unit ?? units[0] ?? "");

  function commit(nextAmount: string, nextUnit: string) {
    const trimmed = nextAmount.trim();
    const number = Number(trimmed);
    const invalid = trimmed !== "" && !(Number.isFinite(number) && number > 0);
    onError(invalid);
    if (invalid) return;
    onChange(trimmed ? { value: number, unit: nextUnit } : null);
  }

  return (
    <span className="medicine-attribute__control medicine-attribute__quantity">
      <input
        id={id}
        type="number"
        min={0}
        step="any"
        aria-label={label}
        value={amount}
        onChange={(e) => {
          setAmount(e.target.value);
          commit(e.target.value, unit);
        }}
      />
      <select
        aria-label={`${label}の単位`}
        value={unit}
        onChange={(e) => {
          setUnit(e.target.value);
          commit(amount, e.target.value);
        }}
      >
        {units.map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </select>
    </span>
  );
}
