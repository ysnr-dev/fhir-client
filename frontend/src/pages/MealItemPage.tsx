import { useEffect, useState, type FormEvent } from "react";
import type { MealItem, MealItemPayload } from "../api/masterClient";
import {
  useMealItem,
  useMealItemMutations,
  useMealItemSearch,
  type MealItemFilters,
} from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";
import { MEAL_ITEM_KIND_LABELS } from "../components/mealItemOptions";

// 食事オーダー項目マスタ。処置の TreatmentItemPage から、セット構成・実施入力
// データセット・レセ電算コード・予約枠を全て落とした最小の作り。
// 食種(diet)と主食(staple)を kind で切り替えて 1 画面で管理する。

// 編集フォームの値。input で扱うため全て文字列で持ち、保存時に payload へ変換する。
interface Draft {
  item_code: string;
  name: string;
  name_kana: string;
  kind: string;
  // 食止め(禁食)の食種か。食種のときだけ選べる。
  is_fasting: boolean;
  valid_from: string;
  valid_to: string;
  display_order: string;
  note: string;
}

const emptyDraft: Draft = {
  item_code: "",
  name: "",
  name_kana: "",
  kind: "diet",
  is_fasting: false,
  valid_from: "",
  valid_to: "",
  display_order: "",
  note: "",
};

function toPayload(draft: Draft): MealItemPayload {
  return {
    item_code: draft.item_code,
    name: draft.name,
    name_kana: draft.name_kana || null,
    kind: draft.kind,
    // 主食は食止めにできない(backend 側でも同じ規則で落とす)。
    is_fasting: draft.kind === "diet" && draft.is_fasting,
    valid_from: draft.valid_from || null,
    valid_to: draft.valid_to || null,
    display_order: draft.display_order ? Number(draft.display_order) : null,
    note: draft.note || null,
  };
}

export function MealItemPage() {
  const [inputs, setInputs] = useState<MealItemFilters>({});
  const [filters, setFilters] = useState<MealItemFilters>({});
  const [page, setPage] = useState(1);
  // 編集対象の id。"new" は新規作成モーダル。
  const [editing, setEditing] = useState<number | "new" | null>(null);

  const list = useMealItemSearch(filters, page);

  const hasNext = list.data ? page * list.data.per < list.data.total : false;

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setFilters(inputs);
    setPage(1);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>食事オーダー項目マスタ</h1>
        <div className="page__header-actions">
          <button type="button" onClick={() => setEditing("new")}>
            項目を追加
          </button>
        </div>
      </div>

      <form className="patient-search-form" onSubmit={handleSearch}>
        <label>
          名称・カナ
          <input
            type="text"
            value={inputs.name ?? ""}
            onChange={(e) => setInputs({ ...inputs, name: e.target.value })}
          />
        </label>
        <label>
          区分
          <select
            value={inputs.kind ?? ""}
            onChange={(e) => setInputs({ ...inputs, kind: e.target.value })}
          >
            <option value="">すべて</option>
            <option value="diet">食種</option>
            <option value="staple">主食</option>
          </select>
        </label>
        <label className="dose-conversion__checkbox">
          <input
            type="checkbox"
            checked={inputs.active ?? false}
            onChange={(e) => setInputs({ ...inputs, active: e.target.checked })}
          />
          有効期間内のみ
        </label>
        <div className="patient-search-form__actions">
          <button type="submit">検索</button>
          <button
            type="button"
            onClick={() => {
              setInputs({});
              setFilters({});
              setPage(1);
            }}
          >
            クリア
          </button>
        </div>
      </form>

      <ErrorBanner error={list.error} />

      <table className="master-search__table">
        <thead>
          <tr>
            <th>コード</th>
            <th>名称</th>
            <th>カナ</th>
            <th className="rad-item__compact">区分</th>
            <th className="rad-item__compact">有効期間</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((item) => (
            <tr key={item.id} onClick={() => setEditing(item.id)} className="master-search__row">
              <td>{item.item_code}</td>
              <td>{item.name}</td>
              <td>{item.name_kana}</td>
              <td className="rad-item__compact">
                {MEAL_ITEM_KIND_LABELS[item.kind] ?? item.kind}
                {/* 食止めは「その日は食事を出さない」特別な食種なので印を出す。 */}
                {item.is_fasting && <span className="dose-conversion__badge">食止め</span>}
              </td>
              <td className="rad-item__compact">
                {(item.valid_from || item.valid_to) &&
                  `${item.valid_from ?? ""}〜${item.valid_to ?? ""}`}
              </td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr>
              <td colSpan={5} className="master-search__empty">
                食事オーダー項目がありません
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="master-search__pager">
        <button
          type="button"
          onClick={() => setPage((p) => p - 1)}
          disabled={page <= 1 || list.isFetching}
        >
          前へ
        </button>
        <span>
          {page} ページ目 (全 {list.data?.total ?? 0} 件)
        </span>
        <button
          type="button"
          onClick={() => setPage((p) => p + 1)}
          disabled={!hasNext || list.isFetching}
        >
          次へ
        </button>
      </div>

      {editing !== null && (
        <ItemEditModal
          itemId={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

interface ItemEditModalProps {
  // null は新規作成。
  itemId: number | null;
  onClose: () => void;
}

function ItemEditModal({ itemId, onClose }: ItemEditModalProps) {
  const detail = useMealItem(itemId);
  const mutations = useMealItemMutations();
  const [draft, setDraft] = useState<Draft>(emptyDraft);

  useEffect(() => {
    if (!detail.data) return;
    const d: MealItem = detail.data;
    setDraft({
      item_code: d.item_code,
      name: d.name,
      name_kana: d.name_kana ?? "",
      kind: d.kind,
      is_fasting: d.is_fasting,
      valid_from: d.valid_from ?? "",
      valid_to: d.valid_to ?? "",
      display_order: d.display_order === null ? "" : String(d.display_order),
      note: d.note ?? "",
    });
  }, [detail.data]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.name) return;

    const payload = toPayload(draft);
    if (itemId === null) {
      await mutations.create.mutateAsync(payload);
      onClose();
    } else {
      await mutations.update.mutateAsync({ id: itemId, payload });
    }
  }

  async function handleDelete() {
    if (itemId === null || !detail.data) return;
    if (!window.confirm(`${detail.data.name} を削除しますか？`)) return;

    await mutations.remove.mutateAsync(itemId);
    onClose();
  }

  const saving = mutations.create.isPending || mutations.update.isPending;
  const isDiet = draft.kind === "diet";

  return (
    <Modal
      title={itemId === null ? "食事オーダー項目を追加" : "食事オーダー項目を編集"}
      onClose={onClose}
      className="modal--lab-order-item"
    >
      <form onSubmit={handleSubmit}>
        <div className="lab-order-item__fields">
          <label>
            項目コード
            <input
              type="text"
              value={draft.item_code}
              onChange={(e) => setDraft({ ...draft, item_code: e.target.value })}
              placeholder={itemId === null ? "空欄なら自動採番" : undefined}
              disabled={itemId !== null}
            />
          </label>
          <label>
            名称
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              required
            />
          </label>
          <label>
            カナ(検索用)
            <input
              type="text"
              value={draft.name_kana}
              onChange={(e) => setDraft({ ...draft, name_kana: e.target.value })}
            />
          </label>
          <label>
            区分
            <select
              value={draft.kind}
              onChange={(e) => {
                const kind = e.target.value;
                // 主食に変えたら食止めは外す(backend でも検証される)。
                setDraft({ ...draft, kind, is_fasting: kind === "diet" && draft.is_fasting });
              }}
            >
              <option value="diet">食種</option>
              <option value="staple">主食</option>
            </select>
          </label>
          <label>
            有効開始日
            <input
              type="date"
              value={draft.valid_from}
              onChange={(e) => setDraft({ ...draft, valid_from: e.target.value })}
            />
          </label>
          <label>
            有効終了日
            <input
              type="date"
              value={draft.valid_to}
              onChange={(e) => setDraft({ ...draft, valid_to: e.target.value })}
            />
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
            備考
            <input
              type="text"
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />
          </label>
        </div>

        {/* 食止めは主食を伴わないので、オーダー画面ではこの印の付いた食種を
            選んだときに主食欄を無効にする。 */}
        <label className="dose-conversion__checkbox">
          <input
            type="checkbox"
            checked={draft.is_fasting}
            disabled={!isDiet}
            onChange={(e) => setDraft({ ...draft, is_fasting: e.target.checked })}
          />
          食止め(禁食)の食種
        </label>

        <ErrorBanner error={detail.error} />
        <ErrorBanner
          error={mutations.create.error ?? mutations.update.error ?? mutations.remove.error}
        />

        <div className="lab-order-item__actions">
          <button type="submit" disabled={saving}>
            保存
          </button>
          {itemId !== null && (
            <button type="button" onClick={handleDelete} disabled={mutations.remove.isPending}>
              削除
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
