import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import type { FormularyEntry, FormularyGroup, FormularyGroupPayload, Medicine } from "../api/masterClient";
import { useFormularyGroups, useFormularyMutations, useMedicineTypeOptions } from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { MedicineSearchModal } from "../components/MedicineSearchModal";
import { TrashIcon } from "../components/PathwayEventCard";
import { Modal } from "../components/Modal";
import { dosageFormLabel } from "../fhir/medicineHelpers";

// 院内フォーミュラリのマスタ(docs/formulary-design.md)。
// 左に薬効群、右に選んだ群の薬剤を推奨順位の順で並べ、↑↓で順位を入れ替える。
// 群の「薬効分類」は群の範囲を示す表示用。

const DOSAGE_FORM_OPTIONS = [
  { value: "", label: "指定なし" },
  { value: "1", label: "内用薬" },
  { value: "4", label: "注射薬" },
  { value: "6", label: "外用薬" },
  { value: "8", label: "歯科用薬剤" },
];

interface GroupDraft {
  code: string;
  name: string;
  yakko_codes: string[];
  dosage_form: string;
  display_order: string;
  note: string;
}

const emptyGroupDraft: GroupDraft = {
  code: "",
  name: "",
  yakko_codes: [],
  dosage_form: "",
  display_order: "",
  note: "",
};

function toGroupPayload(draft: GroupDraft): FormularyGroupPayload {
  return {
    code: draft.code.trim(),
    name: draft.name.trim(),
    yakko_codes: draft.yakko_codes,
    dosage_form: draft.dosage_form || null,
    display_order: draft.display_order ? Number(draft.display_order) : null,
    note: draft.note || null,
  };
}

export function FormularyPage() {
  const groups = useFormularyGroups();
  const mutations = useFormularyMutations();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // 群の編集モーダル。"new" は新規作成。
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [adding, setAdding] = useState(false);
  // 推奨理由の編集中の値(行 id ごと)。未編集の行はサーバーの値をそのまま出す。
  const [notes, setNotes] = useState<Record<number, string>>({});

  const selected = groups.data?.find((g) => g.id === selectedId) ?? null;

  // 群と薬剤を左右に並べるので、本文の幅制限を外して全画面にする。
  useEffect(() => {
    document.body.classList.add("page-wide");
    return () => document.body.classList.remove("page-wide");
  }, []);

  // 群が消えたら選択を外し、まだ何も選んでいなければ先頭を選ぶ。
  useEffect(() => {
    if (!groups.data) return;
    if (selectedId !== null && !groups.data.some((g) => g.id === selectedId)) setSelectedId(null);
    if (selectedId === null && groups.data.length > 0) setSelectedId(groups.data[0].id);
  }, [groups.data, selectedId]);

  const busy =
    mutations.createEntry.isPending || mutations.removeEntry.isPending || mutations.reorder.isPending ||
    mutations.updateEntry.isPending;

  async function handleAddMedicine(medicine: Medicine) {
    if (!selected) return;
    setAdding(false);
    await mutations.createEntry.mutateAsync({
      formulary_group_id: selected.id,
      medicine_code: medicine.medicine_code,
    });
  }

  function handleMove(entry: FormularyEntry, delta: number) {
    if (!selected) return;
    const ids = selected.entries.map((e) => e.id);
    const from = ids.indexOf(entry.id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    ids.splice(from, 1);
    ids.splice(to, 0, entry.id);
    mutations.reorder.mutate(ids);
  }

  function handleRemoveEntry(entry: FormularyEntry) {
    if (!window.confirm(`${entry.medicine_name ?? entry.medicine_code} を群から外しますか？`)) return;
    mutations.removeEntry.mutate(entry.id);
  }

  async function handleSaveNote(entry: FormularyEntry) {
    const note = notes[entry.id];
    if (note === undefined) return;
    await mutations.updateEntry.mutateAsync({ id: entry.id, payload: { note: note || null } });
    setNotes((prev) => {
      const next = { ...prev };
      delete next[entry.id];
      return next;
    });
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>フォーミュラリ</h1>
        <button type="button" onClick={() => setEditing("new")}>
          薬効群を追加
        </button>
      </div>

      <ErrorBanner error={groups.error} />
      <ErrorBanner error={mutations.createEntry.error ?? mutations.reorder.error} />
      <ErrorBanner error={mutations.removeEntry.error ?? mutations.updateEntry.error} />

      <div className="formulary-page">
        <div className="formulary-page__groups">
          <table className="master-search__table">
            <thead>
              <tr>
                <th>コード</th>
                <th>薬効群</th>
                <th className="rad-item__compact">剤形</th>
                <th className="rad-item__compact">薬効分類</th>
                <th className="rad-item__compact">薬剤数</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {groups.data?.map((group) => (
                <tr
                  key={group.id}
                  className={`master-search__row${group.id === selectedId ? " master-search__row--selected" : ""}`}
                  onClick={() => setSelectedId(group.id)}
                >
                  <td>{group.code}</td>
                  <td>{group.name}</td>
                  <td className="rad-item__compact">
                    {group.dosage_form ? dosageFormLabel(group.dosage_form) : ""}
                  </td>
                  <td className="rad-item__compact">{group.yakko_codes.join(", ")}</td>
                  <td className="rad-item__compact">{group.entries.length}</td>
                  <td className="master-search__actions">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(group.id);
                      }}
                    >
                      編集
                    </button>
                  </td>
                </tr>
              ))}
              {groups.data && groups.data.length === 0 && (
                <tr>
                  <td colSpan={6} className="master-search__empty">
                    薬効群がありません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="formulary-page__entries">
          {selected && (
            <>
              <div className="page__header">
                <h2>
                  {selected.name}
                  <span className="lab-order-item__code">{selected.code}</span>
                </h2>
                <button type="button" onClick={() => setAdding(true)} disabled={busy}>
                  薬剤を追加
                </button>
              </div>
              <table className="master-search__table">
                <thead>
                  <tr>
                    <th className="rad-item__compact">順位</th>
                    <th>医薬品</th>
                    <th className="rad-item__compact">単位</th>
                    <th className="rad-item__compact">剤形</th>
                    <th>推奨理由・使い分け</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {selected.entries.map((entry, i) => {
                    const note = notes[entry.id] ?? entry.note ?? "";
                    const dirty = notes[entry.id] !== undefined && notes[entry.id] !== (entry.note ?? "");
                    return (
                      <tr key={entry.id}>
                        <td className="rad-item__compact formulary-page__order">
                          <span className="formulary-page__rank">第{entry.rank}選択</span>
                          <button
                            type="button"
                            onClick={() => handleMove(entry, -1)}
                            disabled={busy || i === 0}
                            title="上へ"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMove(entry, 1)}
                            disabled={busy || i === selected.entries.length - 1}
                            title="下へ"
                          >
                            ↓
                          </button>
                        </td>
                        <td>
                          {entry.medicine_name ?? `(マスタに無いコード ${entry.medicine_code})`}
                          <span className="lab-order-item__code">{entry.medicine_code}</span>
                          {entry.generic_name && (
                            <div className="lab-order-item__code">{entry.generic_name}</div>
                          )}
                        </td>
                        <td className="rad-item__compact">{entry.medicine_unit_name}</td>
                        <td className="rad-item__compact">
                          {dosageFormLabel(entry.medicine_dosage_form)}
                        </td>
                        <td>
                          <input
                            type="text"
                            className="formulary-page__note-input"
                            value={note}
                            onChange={(e) => setNotes((prev) => ({ ...prev, [entry.id]: e.target.value }))}
                            onBlur={() => dirty && handleSaveNote(entry)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleSaveNote(entry);
                              }
                            }}
                          />
                        </td>
                        <td className="master-search__actions">
                          <button
                            type="button"
                            className="rp-card__icon-button"
                            onClick={() => handleRemoveEntry(entry)}
                            disabled={busy}
                            title="群から外す"
                            aria-label="群から外す"
                          >
                            <TrashIcon />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {selected.entries.length === 0 && (
                    <tr>
                      <td colSpan={6} className="master-search__empty">
                        薬剤が登録されていません
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>

      {editing !== null && (
        <GroupEditModal
          group={editing === "new" ? null : (groups.data?.find((g) => g.id === editing) ?? null)}
          onClose={() => setEditing(null)}
        />
      )}
      {adding && selected && (
        <MedicineSearchModal
          title={`${selected.name} に薬剤を追加`}
          dosageForm={selected.dosage_form ?? undefined}
          onSelect={handleAddMedicine}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}

function GroupEditModal({ group, onClose }: { group: FormularyGroup | null; onClose: () => void }) {
  const mutations = useFormularyMutations();
  const yakkoOptions = useMedicineTypeOptions(true);
  const yakkoListId = useId();
  const [draft, setDraft] = useState<GroupDraft>(() =>
    group
      ? {
          code: group.code,
          name: group.name,
          yakko_codes: group.yakko_codes,
          dosage_form: group.dosage_form ?? "",
          display_order: group.display_order === null ? "" : String(group.display_order),
          note: group.note ?? "",
        }
      : emptyGroupDraft,
  );
  const [yakkoInput, setYakkoInput] = useState("");

  // datalist の表示ラベル("code name") → 薬効分類番号。医薬品検索モーダルと同じ形。
  const labelToCode = useMemo(() => {
    const map = new Map<string, string>();
    for (const type of yakkoOptions.data ?? []) {
      map.set(`${type.code} ${type.name ?? ""}`, type.code);
    }
    return map;
  }, [yakkoOptions.data]);
  const yakkoName = (code: string) => yakkoOptions.data?.find((t) => t.code === code)?.name ?? "";

  function handleYakkoInputChange(value: string) {
    setYakkoInput(value);
    // 候補を選択(またはラベル完全一致入力)した時だけ追加する。4 桁の番号直打ちも受ける。
    const code = labelToCode.get(value) ?? (/^\d{4}$/.test(value) ? value : undefined);
    if (!code) return;
    if (!draft.yakko_codes.includes(code)) {
      setDraft((prev) => ({ ...prev, yakko_codes: [...prev.yakko_codes, code] }));
    }
    setYakkoInput("");
  }

  function removeYakko(code: string) {
    setDraft((prev) => ({ ...prev, yakko_codes: prev.yakko_codes.filter((c) => c !== code) }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.code.trim() || !draft.name.trim()) return;
    const payload = toGroupPayload(draft);
    if (group) {
      await mutations.updateGroup.mutateAsync({ id: group.id, payload });
    } else {
      await mutations.createGroup.mutateAsync(payload);
    }
    onClose();
  }

  async function handleDelete() {
    if (!group) return;
    if (!window.confirm(`${group.name} を薬剤ごと削除しますか？`)) return;
    await mutations.removeGroup.mutateAsync(group.id);
    onClose();
  }

  const saving = mutations.createGroup.isPending || mutations.updateGroup.isPending;

  return (
    <Modal title={group ? "薬効群を編集" : "薬効群を追加"} onClose={onClose} className="modal--lab-order-item">
      <form onSubmit={handleSubmit}>
        <ErrorBanner error={mutations.createGroup.error ?? mutations.updateGroup.error ?? mutations.removeGroup.error} />
        <div className="lab-order-item__fields">
          <label>
            コード
            <input
              type="text"
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              required
            />
          </label>
          <label>
            薬効群
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              required
            />
          </label>
          <label>
            剤形
            <select
              value={draft.dosage_form}
              onChange={(e) => setDraft({ ...draft, dosage_form: e.target.value })}
            >
              {DOSAGE_FORM_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            表示順
            <input
              type="number"
              value={draft.display_order}
              onChange={(e) => setDraft({ ...draft, display_order: e.target.value })}
            />
          </label>
          <label>
            薬効分類
            <input
              type="text"
              value={yakkoInput}
              onChange={(e) => handleYakkoInputChange(e.target.value)}
              list={yakkoListId}
              placeholder="薬効名・番号で絞り込んで選択"
            />
            <datalist id={yakkoListId}>
              {yakkoOptions.data?.map((type) => (
                <option key={type.id} value={`${type.code} ${type.name ?? ""}`} />
              ))}
            </datalist>
            <div className="formulary-page__yakko">
              {draft.yakko_codes.map((code) => (
                <span key={code} className="formulary-page__yakko-chip">
                  {code} {yakkoName(code)}
                  <button type="button" onClick={() => removeYakko(code)} aria-label="外す">
                    ×
                  </button>
                </span>
              ))}
            </div>
          </label>
          <label>
            備考
            <input
              type="text"
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
          </label>
        </div>
        <div className="brought-med__actions">
          {group && (
            <button type="button" onClick={handleDelete} disabled={saving}>
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
      </form>
    </Modal>
  );
}
