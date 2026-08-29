import { useEffect, useState, type FormEvent } from "react";
import type { TransfusionProduct, TransfusionProductPayload } from "../api/masterClient";
import {
  useTransfusionProduct,
  useTransfusionProductMutations,
  useTransfusionProductSearch,
  type TransfusionProductFilters,
} from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";
import {
  TRANSFUSION_CATEGORY_OPTIONS,
  transfusionCategoryLabel,
} from "../components/transfusionProductOptions";

// 輸血製剤マスタ。食事オーダー項目(MealItemPage)と同じ最小の作りで、セット構成・
// 実施入力データセット・レセ電算コード・予約枠はいずれも持たない。

// 編集フォームの値。input で扱うため全て文字列で持ち、保存時に payload へ変換する。
interface Draft {
  item_code: string;
  name: string;
  name_kana: string;
  abbreviation: string;
  category: string;
  unit_label: string;
  default_units: string;
  requires_crossmatch: boolean;
  valid_from: string;
  valid_to: string;
  display_order: string;
  note: string;
}

const emptyDraft: Draft = {
  item_code: "",
  name: "",
  name_kana: "",
  abbreviation: "",
  category: "rbc",
  unit_label: "単位",
  default_units: "",
  requires_crossmatch: true,
  valid_from: "",
  valid_to: "",
  display_order: "",
  note: "",
};

function toPayload(draft: Draft): TransfusionProductPayload {
  return {
    item_code: draft.item_code,
    name: draft.name,
    name_kana: draft.name_kana || null,
    abbreviation: draft.abbreviation || null,
    category: draft.category,
    unit_label: draft.unit_label,
    default_units: draft.default_units ? Number(draft.default_units) : null,
    requires_crossmatch: draft.requires_crossmatch,
    valid_from: draft.valid_from || null,
    valid_to: draft.valid_to || null,
    display_order: draft.display_order ? Number(draft.display_order) : null,
    note: draft.note || null,
  };
}

export function TransfusionProductPage() {
  const [inputs, setInputs] = useState<TransfusionProductFilters>({});
  const [filters, setFilters] = useState<TransfusionProductFilters>({});
  const [page, setPage] = useState(1);
  // 編集対象の id。"new" は新規作成モーダル。
  const [editing, setEditing] = useState<number | "new" | null>(null);

  const list = useTransfusionProductSearch(filters, page);

  const hasNext = list.data ? page * list.data.per < list.data.total : false;

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setFilters(inputs);
    setPage(1);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>輸血製剤マスタ</h1>
        <div className="page__header-actions">
          <button type="button" onClick={() => setEditing("new")}>
            製剤を追加
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
          製剤区分
          <select
            value={inputs.category ?? ""}
            onChange={(e) => setInputs({ ...inputs, category: e.target.value })}
          >
            <option value="">すべて</option>
            {TRANSFUSION_CATEGORY_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.display}
              </option>
            ))}
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
            <th className="rad-item__compact">略称</th>
            <th className="rad-item__compact">区分</th>
            <th className="rad-item__compact">既定単位数</th>
            <th className="rad-item__compact">有効期間</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((item) => (
            <tr key={item.id} onClick={() => setEditing(item.id)} className="master-search__row">
              <td>{item.item_code}</td>
              <td>{item.name}</td>
              <td className="rad-item__compact">{item.abbreviation}</td>
              <td className="rad-item__compact">
                {transfusionCategoryLabel(item.category)}
                {/* 交差適合試験の要否はオーダー画面の検査区分の初期選択に効くので、
                    一覧でも「不要」だけ印を出す(既定は必要)。 */}
                {!item.requires_crossmatch && (
                  <span className="dose-conversion__badge">交差不要</span>
                )}
              </td>
              <td className="rad-item__compact">
                {item.default_units !== null && `${item.default_units}${item.unit_label}`}
              </td>
              <td className="rad-item__compact">
                {(item.valid_from || item.valid_to) &&
                  `${item.valid_from ?? ""}〜${item.valid_to ?? ""}`}
              </td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr>
              <td colSpan={6} className="master-search__empty">
                輸血製剤がありません
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
        <ProductEditModal
          productId={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

interface ProductEditModalProps {
  // null は新規作成。
  productId: number | null;
  onClose: () => void;
}

function ProductEditModal({ productId, onClose }: ProductEditModalProps) {
  const detail = useTransfusionProduct(productId);
  const mutations = useTransfusionProductMutations();
  const [draft, setDraft] = useState<Draft>(emptyDraft);

  useEffect(() => {
    if (!detail.data) return;
    const d: TransfusionProduct = detail.data;
    setDraft({
      item_code: d.item_code,
      name: d.name,
      name_kana: d.name_kana ?? "",
      abbreviation: d.abbreviation ?? "",
      category: d.category,
      unit_label: d.unit_label,
      default_units: d.default_units === null ? "" : String(d.default_units),
      requires_crossmatch: d.requires_crossmatch,
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
    if (productId === null) {
      await mutations.create.mutateAsync(payload);
      onClose();
    } else {
      await mutations.update.mutateAsync({ id: productId, payload });
    }
  }

  async function handleDelete() {
    if (productId === null || !detail.data) return;
    if (!window.confirm(`${detail.data.name} を削除しますか？`)) return;

    await mutations.remove.mutateAsync(productId);
    onClose();
  }

  const saving = mutations.create.isPending || mutations.update.isPending;

  return (
    <Modal
      title={productId === null ? "輸血製剤を追加" : "輸血製剤を編集"}
      onClose={onClose}
      className="modal--lab-order-item"
    >
      <form onSubmit={handleSubmit}>
        <div className="lab-order-item__fields">
          <label>
            製剤コード
            <input
              type="text"
              value={draft.item_code}
              onChange={(e) => setDraft({ ...draft, item_code: e.target.value })}
              placeholder={productId === null ? "空欄なら自動採番" : undefined}
              disabled={productId !== null}
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
            略称
            <input
              type="text"
              value={draft.abbreviation}
              onChange={(e) => setDraft({ ...draft, abbreviation: e.target.value })}
              placeholder="RBC-LR"
            />
          </label>
          <label>
            製剤区分
            <select
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            >
              {TRANSFUSION_CATEGORY_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.display}
                </option>
              ))}
            </select>
          </label>
          <label>
            単位の呼び方
            <input
              type="text"
              value={draft.unit_label}
              onChange={(e) => setDraft({ ...draft, unit_label: e.target.value })}
              required
            />
          </label>
          <label>
            既定単位数
            <input
              type="number"
              min={1}
              value={draft.default_units}
              onChange={(e) => setDraft({ ...draft, default_units: e.target.value })}
            />
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

        {/* 交差適合試験の要否。オーダー画面で製剤を選んだときの検査区分の初期選択に
            使う(血漿・血小板は交差適合試験を行わないのが一般的)。 */}
        <label className="dose-conversion__checkbox">
          <input
            type="checkbox"
            checked={draft.requires_crossmatch}
            onChange={(e) => setDraft({ ...draft, requires_crossmatch: e.target.checked })}
          />
          交差適合試験が必要な製剤
        </label>

        <ErrorBanner error={detail.error} />
        <ErrorBanner
          error={mutations.create.error ?? mutations.update.error ?? mutations.remove.error}
        />

        <div className="lab-order-item__actions">
          <button type="submit" disabled={saving}>
            保存
          </button>
          {productId !== null && (
            <button type="button" onClick={handleDelete} disabled={mutations.remove.isPending}>
              削除
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
