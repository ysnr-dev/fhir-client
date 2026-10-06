import { useState } from "react";
import { useMedicineAttributeMutations, useMedicineAttributes } from "../api/masterQueries";
import type { Medicine, MedicineAttribute, MedicineAttributeDefinition } from "../api/masterClient";
import { ErrorBanner } from "../components/ErrorBanner";
import { MedicineSearchModal } from "../components/MedicineSearchModal";
import { TrashIcon } from "../components/icons/TrashIcon";

// 薬剤付加情報(docs/lot-number-design.md)。施設独自の薬剤の設定を 1 薬 1 行で持つ。
// 列は backend の項目の定義(definitions)から組み立てるので、項目が増えても画面は直さない。
// 行が無くても既定で項目が真になる薬(生物学的製剤の印がある薬のロット管理)は「既定」として並べ、
// 値を変えた時点で行を作る。行を削除すると既定に戻る。

export function MedicineAttributePage() {
  const [includeDefaults, setIncludeDefaults] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [adding, setAdding] = useState(false);
  // 編集中の備考(医薬品コードごと)。未編集の行は保存済みの値を出す。
  const [notes, setNotes] = useState<Record<string, string>>({});

  const list = useMedicineAttributes(includeDefaults);
  const { create, update, remove } = useMedicineAttributeMutations();
  const busy = create.isPending || update.isPending || remove.isPending;

  const definitions = list.data?.definitions ?? [];
  const items = (list.data?.items ?? []).filter((item) => matchesKeyword(item, keyword));
  const registeredCodes = new Set(list.data?.items.filter((i) => i.registered).map((i) => i.medicine_code));

  function save(item: MedicineAttribute, settings: MedicineAttribute["settings"], note: string | null) {
    if (item.id == null) {
      create.mutate({ medicine_code: item.medicine_code, settings, note });
    } else {
      update.mutate({ id: item.id, payload: { settings, note } });
    }
  }

  function handleToggle(item: MedicineAttribute, definition: MedicineAttributeDefinition, checked: boolean) {
    save(item, { ...item.settings, [definition.key]: checked }, item.note);
  }

  async function handleNoteSave(item: MedicineAttribute) {
    const note = notes[item.medicine_code] ?? "";
    if (item.id == null) {
      await create.mutateAsync({ medicine_code: item.medicine_code, settings: item.settings, note: note || null });
    } else {
      await update.mutateAsync({ id: item.id, payload: { note: note || null } });
    }
    setNotes((prev) => {
      const next = { ...prev };
      delete next[item.medicine_code];
      return next;
    });
  }

  function handleDelete(item: MedicineAttribute) {
    if (item.id == null) return;
    if (!window.confirm(`${item.medicine_name ?? item.medicine_code} の薬剤付加情報を削除しますか？`)) return;
    remove.mutate(item.id);
  }

  function handleAdd(medicine: Medicine) {
    setAdding(false);
    if (registeredCodes.has(medicine.medicine_code)) return;
    create.mutate({ medicine_code: medicine.medicine_code, settings: {} });
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>薬剤付加情報</h1>
        <button type="button" onClick={() => setAdding(true)} disabled={busy}>
          ＋薬剤
        </button>
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
      <ErrorBanner error={create.error ?? update.error ?? remove.error} />

      <table className="master-search__table medicine-attribute__table">
        <thead>
          <tr>
            <th>医薬品名</th>
            <th>コード</th>
            {definitions.map((definition) => (
              <th key={definition.key} className="medicine-attribute__flag">
                {definition.label}
              </th>
            ))}
            <th>備考</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const note = notes[item.medicine_code] ?? item.note ?? "";
            const noteDirty = note !== (item.note ?? "");
            return (
              <tr key={item.medicine_code}>
                <td>
                  {item.medicine_name ?? <span className="medicine-attribute__missing">医薬品マスタに無いコード</span>}
                  {!item.registered && <span className="medicine-attribute__badge">既定</span>}
                </td>
                <td className="medicine-attribute__code">{item.medicine_code}</td>
                {definitions.map((definition) => (
                  <td key={definition.key} className="medicine-attribute__flag">
                    {definition.type === "boolean" && (
                      <label
                        className="medicine-attribute__value"
                        title={item.settings[definition.key] == null ? "既定の値" : undefined}
                      >
                        <input
                          type="checkbox"
                          aria-label={definition.label}
                          checked={Boolean(item.effective[definition.key])}
                          disabled={busy}
                          onChange={(e) => handleToggle(item, definition, e.target.checked)}
                        />
                        {item.registered && item.settings[definition.key] == null && (
                          <span className="medicine-attribute__default">既定</span>
                        )}
                      </label>
                    )}
                  </td>
                ))}
                <td>
                  <input
                    type="text"
                    className="medicine-attribute__note"
                    value={note}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [item.medicine_code]: e.target.value }))}
                  />
                </td>
                <td className="master-search__actions">
                  <button
                    type="button"
                    className="rp-card__compact-button"
                    onClick={() => handleNoteSave(item)}
                    disabled={busy || !noteDirty}
                  >
                    保存
                  </button>
                  {item.registered && (
                    <button
                      type="button"
                      className="rp-card__icon-button"
                      title={`${item.medicine_name ?? item.medicine_code}を削除`}
                      aria-label={`${item.medicine_name ?? item.medicine_code}を削除`}
                      onClick={() => handleDelete(item)}
                      disabled={busy}
                    >
                      <TrashIcon />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
          {list.data && items.length === 0 && (
            <tr>
              <td colSpan={definitions.length + 4} className="master-search__empty">
                該当する薬剤がありません
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {adding && (
        <MedicineSearchModal title="薬剤を選択" onSelect={handleAdd} onClose={() => setAdding(false)} />
      )}
    </div>
  );
}

function matchesKeyword(item: MedicineAttribute, keyword: string): boolean {
  const word = keyword.trim();
  if (!word) return true;
  return (item.medicine_name ?? "").includes(word) || item.medicine_code.includes(word);
}
