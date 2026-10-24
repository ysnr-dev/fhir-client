import { useState } from "react";
import { useSaveKartePaneFavorite } from "../api/masterQueries";
import { moveItem } from "../lib/arrays";
import { ErrorBanner } from "./ErrorBanner";
import { TrashIcon } from "./icons/TrashIcon";
import { KARTE_MENU_ITEMS, karteMenuFullLabel, karteMenuItemsOf } from "./karteMenu";
import { Modal } from "./Modal";

// カルテ右ペインの頻用メニューの設定。左でメニューを選び、右で並べ替える。ログイン中の医療従事者ごとに保存する。

export function KartePaneFavoriteModal({
  practitionerId,
  menuKeys,
  onClose,
}: {
  practitionerId: string;
  menuKeys: string[];
  onClose: () => void;
}) {
  const [keys, setKeys] = useState(menuKeys);
  const save = useSaveKartePaneFavorite(practitionerId);
  const selected = new Set(keys);
  const items = karteMenuItemsOf(keys);

  function toggle(key: string, on: boolean) {
    setKeys((prev) => (on ? [...prev, key] : prev.filter((k) => k !== key)));
  }

  async function handleSave() {
    await save.mutateAsync(keys);
    onClose();
  }

  return (
    <Modal title="頻用設定" onClose={onClose} className="modal--karte-favorite">
      <div className="karte-favorite">
        <section className="karte-favorite__column">
          <h3>メニュー</h3>
          <ul className="karte-favorite__choices">
            {KARTE_MENU_ITEMS.map((item) => (
              <li key={item.key}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.has(item.key)}
                    onChange={(e) => toggle(item.key, e.target.checked)}
                  />
                  {karteMenuFullLabel(item)}
                </label>
              </li>
            ))}
          </ul>
        </section>
        <section className="karte-favorite__column">
          <h3>並び順</h3>
          <ol className="karte-favorite__order">
            {items.map((item, index) => {
              const label = karteMenuFullLabel(item);
              return (
                <li key={item.key}>
                  <span className="karte-favorite__name">{label}</span>
                  <button
                    type="button"
                    className="rp-card__icon-button"
                    onClick={() => setKeys(moveItem(keys, index, -1))}
                    disabled={index === 0}
                    title="上へ"
                    aria-label="上へ"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="rp-card__icon-button"
                    onClick={() => setKeys(moveItem(keys, index, 1))}
                    disabled={index === items.length - 1}
                    title="下へ"
                    aria-label="下へ"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="rp-card__icon-button"
                    onClick={() => toggle(item.key, false)}
                    title={`${label}を削除`}
                    aria-label={`${label}を削除`}
                  >
                    <TrashIcon />
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      </div>

      <ErrorBanner error={save.error} />

      <div className="chart-editor__actions">
        <button type="button" onClick={handleSave} disabled={save.isPending}>
          保存
        </button>
        <button type="button" onClick={onClose}>
          取消
        </button>
      </div>
    </Modal>
  );
}
