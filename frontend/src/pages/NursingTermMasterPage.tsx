import { useMemo, useState, type FormEvent } from "react";
import type {
  NursingDiagnosisType,
  NursingTaxonomy,
  NursingTerm,
  NursingTermItem,
  NursingTermItemType,
  NursingTermLevel,
} from "../api/masterClient";
import { useNursingTermMutations, useNursingTermTree } from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";
import {
  NURSING_DIAGNOSIS_TYPE_LABELS,
  NURSING_ITEM_TYPE_LABELS,
  buildNursingTermTree,
} from "../fhir/nursingCarePlanHelpers";
import { TrashIcon } from "../components/icons/TrashIcon";

const TAXONOMY_TITLES: Record<NursingTaxonomy, string> = {
  diagnosis: "看護診断",
  outcome: "看護成果",
  intervention: "看護介入",
};

const ITEM_TYPES: Record<NursingTaxonomy, NursingTermItemType[]> = {
  diagnosis: ["defining_characteristic", "related_factor", "risk_factor"],
  outcome: ["indicator"],
  intervention: ["activity"],
};

const LEVEL_LABELS: Record<NursingTermLevel, string> = { domain: "領域", class: "類", term: "用語" };

// 看護計画の用語マスタ(看護診断・看護成果・看護介入)。領域 → 類 → 用語の木で並べる。
// NANDA-I・NOC・NIC はライセンス物なので同梱しない(docs/nursing-care-plan-design.md)。
export function NursingTermMasterPage({ taxonomy }: { taxonomy: NursingTaxonomy }) {
  const [editing, setEditing] = useState<NursingTerm | "new" | null>(null);
  const [query, setQuery] = useState("");
  const list = useNursingTermTree(taxonomy);
  const terms = useMemo(() => list.data?.items ?? [], [list.data]);
  const tree = useMemo(
    () => buildNursingTermTree(terms, query.trim(), { includeInactive: true, keepEmpty: true }),
    [terms, query],
  );
  const rows = tree.flatMap((domain) => [
    domain.term,
    ...domain.children.flatMap((klass) => [klass.term, ...klass.children.map((leaf) => leaf.term)]),
  ]);

  return (
    <div className="page">
      <div className="page__header">
        <h1>{TAXONOMY_TITLES[taxonomy]}</h1>
        <div className="page__header-actions">
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="検索" />
          <button type="button" onClick={() => setEditing("new")}>
            追加
          </button>
        </div>
      </div>

      <ErrorBanner error={list.error} />

      <table className="master-search__table">
        <thead>
          <tr>
            <th className="rad-code__compact">コード</th>
            <th>名称</th>
            <th className="rad-code__compact">階層</th>
            <th className="rad-code__compact">有効</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((term) => (
            <tr key={term.id} className="master-search__row" onClick={() => setEditing(term)}>
              <td className="rad-code__compact">{term.code}</td>
              <td className={`nursing-term-master__name--${term.level}`}>{term.name}</td>
              <td className="rad-code__compact">{LEVEL_LABELS[term.level]}</td>
              <td className="rad-code__compact">{term.active ? "" : "無効"}</td>
            </tr>
          ))}
          {list.data && rows.length === 0 && (
            <tr>
              <td colSpan={4} className="master-search__empty">
                登録がありません。
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing !== null && (
        <TermEditModal
          taxonomy={taxonomy}
          terms={terms}
          item={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function TermEditModal({
  taxonomy,
  terms,
  item,
  onClose,
}: {
  taxonomy: NursingTaxonomy;
  terms: NursingTerm[];
  item: NursingTerm | null;
  onClose: () => void;
}) {
  const mutations = useNursingTermMutations();
  const [level, setLevel] = useState<NursingTermLevel>(item?.level ?? "term");
  const [code, setCode] = useState(item?.code ?? "");
  const [parentCode, setParentCode] = useState(item?.parent_code ?? "");
  const [name, setName] = useState(item?.name ?? "");
  const [nameKana, setNameKana] = useState(item?.name_kana ?? "");
  const [diagnosisType, setDiagnosisType] = useState<NursingDiagnosisType | "">(item?.diagnosis_type ?? "");
  const [definition, setDefinition] = useState(item?.definition ?? "");
  const [guidance, setGuidance] = useState(item?.guidance ?? "");
  const [active, setActive] = useState(item?.active ?? true);
  const [displayOrder, setDisplayOrder] = useState(item?.display_order != null ? String(item.display_order) : "");
  const [items, setItems] = useState<NursingTermItem[]>(item?.items ?? []);

  const parentLevel = level === "class" ? "domain" : level === "term" ? "class" : null;
  const parents = parentLevel ? terms.filter((t) => t.level === parentLevel) : [];

  function setRow(index: number, patch: Partial<NursingTermItem>) {
    setItems((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const payload = {
      taxonomy,
      level,
      code: code.trim(),
      parent_code: parentLevel ? parentCode : null,
      name: name.trim(),
      name_kana: nameKana.trim() || null,
      diagnosis_type: taxonomy === "diagnosis" && level === "term" && diagnosisType ? diagnosisType : null,
      definition: definition.trim() || null,
      guidance: guidance.trim() || null,
      active,
      display_order: displayOrder ? Number(displayOrder) : null,
      items: level === "term" ? items.filter((row) => row.name.trim()) : [],
    };
    if (item === null) await mutations.create.mutateAsync(payload);
    else await mutations.update.mutateAsync({ id: item.id, payload });
    onClose();
  }

  async function handleDelete() {
    if (item === null) return;
    if (!window.confirm(`${item.name} を削除しますか？`)) return;
    await mutations.remove.mutateAsync(item.id);
    onClose();
  }

  return (
    <Modal title={TAXONOMY_TITLES[taxonomy]} onClose={onClose} className="modal--wide">
      <form className="prescription-form" onSubmit={handleSubmit}>
        <div className="lab-order-item__fields">
          <label>
            階層
            <select
              value={level}
              onChange={(e) => setLevel(e.target.value as NursingTermLevel)}
              disabled={item !== null}
            >
              {(Object.keys(LEVEL_LABELS) as NursingTermLevel[]).map((l) => (
                <option key={l} value={l}>
                  {LEVEL_LABELS[l]}
                </option>
              ))}
            </select>
          </label>
          {parentLevel && (
            <label>
              {LEVEL_LABELS[parentLevel]}
              <select value={parentCode} onChange={(e) => setParentCode(e.target.value)} required>
                <option value="">-</option>
                {parents.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.code} {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            コード
            <input type="text" value={code} onChange={(e) => setCode(e.target.value)} required disabled={item !== null} />
          </label>
          <label>
            名称
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            カナ
            <input type="text" value={nameKana} onChange={(e) => setNameKana(e.target.value)} />
          </label>
          {taxonomy === "diagnosis" && level === "term" && (
            <label>
              種類
              <select
                value={diagnosisType}
                onChange={(e) => setDiagnosisType(e.target.value as NursingDiagnosisType | "")}
              >
                <option value="">-</option>
                {(Object.keys(NURSING_DIAGNOSIS_TYPE_LABELS) as NursingDiagnosisType[]).map((t) => (
                  <option key={t} value={t}>
                    {NURSING_DIAGNOSIS_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            表示順
            <input type="number" value={displayOrder} onChange={(e) => setDisplayOrder(e.target.value)} />
          </label>
          <label className="nursing-problem-form__check">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            有効
          </label>
        </div>
        <label>
          定義
          <textarea rows={2} value={definition} onChange={(e) => setDefinition(e.target.value)} />
        </label>
        {taxonomy === "diagnosis" && level === "term" && (
          <label>
            ガイダンス
            <textarea rows={3} value={guidance} onChange={(e) => setGuidance(e.target.value)} />
          </label>
        )}

        {level === "term" && (
          <fieldset>
            <legend>{ITEM_TYPES[taxonomy].map((t) => NURSING_ITEM_TYPE_LABELS[t]).join("・")}</legend>
            <div className="nursing-problem-form__block">
              {items.map((row, index) => (
                <div key={index} className="nursing-problem-form__row">
                  {ITEM_TYPES[taxonomy].length > 1 && (
                    <select
                      value={row.item_type}
                      onChange={(e) => setRow(index, { item_type: e.target.value as NursingTermItemType })}
                      aria-label="種類"
                    >
                      {ITEM_TYPES[taxonomy].map((t) => (
                        <option key={t} value={t}>
                          {NURSING_ITEM_TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  )}
                  <input
                    type="text"
                    className="nursing-term-master__item-code"
                    value={row.code}
                    onChange={(e) => setRow(index, { code: e.target.value })}
                    aria-label="コード"
                  />
                  <input
                    type="text"
                    value={row.name}
                    onChange={(e) => setRow(index, { name: e.target.value })}
                    aria-label="名称"
                  />
                  <button
                    type="button"
                    className="rp-card__icon-button"
                    onClick={() => setItems((rows) => rows.filter((_, i) => i !== index))}
                    title="行を削除"
                    aria-label="行を削除"
                  >
                    <TrashIcon />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="rp-card__compact-button"
                onClick={() => setItems((rows) => [...rows, { item_type: ITEM_TYPES[taxonomy][0], code: "", name: "" }])}
              >
                追加
              </button>
            </div>
          </fieldset>
        )}

        <ErrorBanner error={mutations.create.error ?? mutations.update.error ?? mutations.remove.error} />

        <div className="lab-order-item__actions">
          <button type="submit" disabled={mutations.create.isPending || mutations.update.isPending}>
            保存
          </button>
          {item !== null && (
            <button type="button" onClick={handleDelete} disabled={mutations.remove.isPending}>
              削除
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
