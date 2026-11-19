import { useState, type FormEvent } from "react";
import type { Medicine, PromisedPrescription, PromisedPrescriptionPayload } from "../api/masterClient";
import {
  usePromisedPrescription,
  usePromisedPrescriptionMutations,
  usePromisedPrescriptionSearch,
} from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { MasterBackLink } from "../components/MasterBackLink";
import { MedicineSearchModal } from "../components/MedicineSearchModal";
import { Modal } from "../components/Modal";
import { TrashIcon } from "../components/icons/TrashIcon";
import { promisedItemsSummary } from "../fhir/promisedPrescriptionHelpers";

// 約束処方のマスタ画面。名称・基準量と、基準量あたりの構成薬を登録する。
// 処方オーダーの医薬品検索の候補「約束処方」に並び、選ぶと構成薬が量を比例させて Rp に入る。

interface DraftItem {
  medicine_code: string;
  name: string;
  amount: string;
  unit_name: string;
}

interface Draft {
  code: string;
  name: string;
  name_kana: string;
  base_amount: string;
  unit_name: string;
  mix: boolean;
  valid_from: string;
  valid_to: string;
  display_order: string;
  note: string;
  items: DraftItem[];
}

const emptyDraft: Draft = {
  code: "",
  name: "",
  name_kana: "",
  base_amount: "",
  unit_name: "",
  mix: false,
  valid_from: "",
  valid_to: "",
  display_order: "",
  note: "",
  items: [],
};

function draftOf(p: PromisedPrescription): Draft {
  return {
    code: p.code,
    name: p.name,
    name_kana: p.name_kana ?? "",
    base_amount: String(Number(p.base_amount)),
    unit_name: p.unit_name,
    mix: p.mix,
    valid_from: p.valid_from ?? "",
    valid_to: p.valid_to ?? "",
    display_order: p.display_order === null ? "" : String(p.display_order),
    note: p.note ?? "",
    items: p.items.map((item) => ({
      medicine_code: item.medicine_code,
      name: item.medicine_name ?? `(マスタに無いコード ${item.medicine_code})`,
      amount: String(Number(item.amount)),
      unit_name: item.unit_name ?? "",
    })),
  };
}

function toPayload(draft: Draft): PromisedPrescriptionPayload {
  return {
    code: draft.code,
    name: draft.name,
    name_kana: draft.name_kana || null,
    base_amount: draft.base_amount,
    unit_name: draft.unit_name,
    mix: draft.mix,
    valid_from: draft.valid_from || null,
    valid_to: draft.valid_to || null,
    display_order: draft.display_order ? Number(draft.display_order) : null,
    note: draft.note || null,
    items: draft.items.map((item) => ({
      medicine_code: item.medicine_code,
      amount: item.amount,
      unit_name: item.unit_name || null,
    })),
  };
}

export function PromisedPrescriptionPage() {
  const [input, setInput] = useState("");
  const [filters, setFilters] = useState<{ name?: string; active?: boolean }>({});
  const [activeOnly, setActiveOnly] = useState(false);
  const [page, setPage] = useState(1);
  // 編集対象の id。"new" は新規作成モーダル。
  const [editing, setEditing] = useState<number | "new" | null>(null);

  const list = usePromisedPrescriptionSearch(filters, page);
  const hasNext = list.data ? page * list.data.per < list.data.total : false;

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setFilters({ name: input, active: activeOnly });
    setPage(1);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>約束処方</h1>
        <div>
          <button type="button" onClick={() => setEditing("new")}>
            約束処方追加
          </button>
          <MasterBackLink />
        </div>
      </div>

      <form className="patient-search-form" onSubmit={handleSearch}>
        <label>
          名称・カナ
          <input type="text" value={input} onChange={(e) => setInput(e.target.value)} />
        </label>
        <label className="dose-conversion__checkbox">
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
          運用期間内のみ
        </label>
        <div className="patient-search-form__actions">
          <button type="submit">検索</button>
          <button
            type="button"
            onClick={() => {
              setInput("");
              setActiveOnly(false);
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
            <th className="rad-item__compact">基準量</th>
            <th>構成薬</th>
            <th className="rad-item__compact">運用期間</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((p) => (
            <tr key={p.id} onClick={() => setEditing(p.id)} className="master-search__row">
              <td>{p.code}</td>
              <td>{p.name}</td>
              <td className="rad-item__compact">
                {Number(p.base_amount)}
                {p.unit_name}
              </td>
              <td>{promisedItemsSummary(p)}</td>
              <td className="rad-item__compact">
                {(p.valid_from || p.valid_to) && `${p.valid_from ?? ""}〜${p.valid_to ?? ""}`}
              </td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr>
              <td colSpan={5} className="master-search__empty">
                約束処方がありません
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="master-search__pager">
        <button type="button" onClick={() => setPage((p) => p - 1)} disabled={page <= 1 || list.isFetching}>
          前へ
        </button>
        <span>
          {page} ページ目 (全 {list.data?.total ?? 0} 件)
        </span>
        <button type="button" onClick={() => setPage((p) => p + 1)} disabled={!hasNext || list.isFetching}>
          次へ
        </button>
      </div>

      {editing !== null && (
        <EditModal id={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

// 編集は読み込みを待ってからフォームを出す(フォームの初期値を読み込んだ値にする)。
function EditModal({ id, onClose }: { id: number | null; onClose: () => void }) {
  const detail = usePromisedPrescription(id);
  if (id !== null && !detail.data) {
    return (
      <Modal title="約束処方を編集" onClose={onClose} className="modal--lab-order-item">
        <ErrorBanner error={detail.error} />
      </Modal>
    );
  }
  return <EditForm id={id} initial={detail.data ? draftOf(detail.data) : emptyDraft} onClose={onClose} />;
}

function EditForm({ id, initial, onClose }: { id: number | null; initial: Draft; onClose: () => void }) {
  const mutations = usePromisedPrescriptionMutations();
  const [draft, setDraft] = useState<Draft>(initial);
  const [adding, setAdding] = useState(false);

  function updateItem(index: number, patch: Partial<DraftItem>) {
    setDraft((prev) => ({
      ...prev,
      items: prev.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));
  }

  function addMedicine(medicine: Medicine) {
    setAdding(false);
    setDraft((prev) =>
      prev.items.some((item) => item.medicine_code === medicine.medicine_code)
        ? prev
        : {
            ...prev,
            items: [
              ...prev.items,
              {
                medicine_code: medicine.medicine_code,
                name: medicine.name ?? "",
                amount: "",
                unit_name: medicine.unit_name ?? "",
              },
            ],
          },
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const payload = toPayload(draft);
    if (id === null) await mutations.create.mutateAsync(payload);
    else await mutations.update.mutateAsync({ id, payload });
    onClose();
  }

  async function handleDelete() {
    if (id === null) return;
    if (!window.confirm(`${initial.name} を削除しますか？`)) return;

    await mutations.remove.mutateAsync(id);
    onClose();
  }

  const saving = mutations.create.isPending || mutations.update.isPending;

  return (
    <Modal
      title={id === null ? "約束処方を追加" : "約束処方を編集"}
      onClose={onClose}
      className="modal--lab-order-item"
    >
      <form onSubmit={handleSubmit}>
        <div className="lab-order-item__fields">
          <label>
            コード
            <input
              type="text"
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              placeholder={id === null ? "空欄なら自動採番" : undefined}
              disabled={id !== null}
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
        </div>

        <div className="lab-order-item__fields">
          <label>
            基準量
            <input
              type="number"
              step="0.001"
              min="0"
              value={draft.base_amount}
              onChange={(e) => setDraft({ ...draft, base_amount: e.target.value })}
              required
            />
          </label>
          <label>
            単位
            <input
              type="text"
              value={draft.unit_name}
              onChange={(e) => setDraft({ ...draft, unit_name: e.target.value })}
              required
            />
          </label>
          <label className="dose-conversion__checkbox">
            <input
              type="checkbox"
              checked={draft.mix}
              onChange={(e) => setDraft({ ...draft, mix: e.target.checked })}
            />
            混合
          </label>
        </div>

        <div className="lab-order-item__fields">
          <label>
            運用開始日
            <input
              type="date"
              value={draft.valid_from}
              onChange={(e) => setDraft({ ...draft, valid_from: e.target.value })}
            />
          </label>
          <label>
            運用終了日
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
            <input type="text" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
          </label>
        </div>

        <section className="lab-order-item__section">
          <div className="lab-order-item__section-head">
            <h3>構成薬</h3>
            <button type="button" onClick={() => setAdding(true)}>
              医薬品追加
            </button>
          </div>
          <div className="lab-order-item__table-wrap">
            <table className="master-search__table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>コード</th>
                  <th className="rad-item__compact">量</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {draft.items.map((item, index) => (
                  <tr key={item.medicine_code}>
                    <td>{item.name}</td>
                    <td>{item.medicine_code}</td>
                    <td className="rad-item__compact">
                      <input
                        type="number"
                        className="rad-quantity-input"
                        step="0.001"
                        min="0"
                        value={item.amount}
                        aria-label={`${item.name}の量`}
                        onChange={(e) => updateItem(index, { amount: e.target.value })}
                        required
                      />
                      {item.unit_name}
                    </td>
                    <td className="master-search__actions">
                      <button
                        type="button"
                        className="rp-card__icon-button"
                        title="構成薬を削除"
                        aria-label="構成薬を削除"
                        onClick={() =>
                          setDraft((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== index) }))
                        }
                      >
                        <TrashIcon />
                      </button>
                    </td>
                  </tr>
                ))}
                {draft.items.length === 0 && (
                  <tr>
                    <td colSpan={4} className="master-search__empty">
                      登録がありません
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <ErrorBanner error={mutations.create.error ?? mutations.update.error ?? mutations.remove.error} />

        <div className="lab-order-item__actions">
          <button type="submit" disabled={saving || draft.items.length === 0}>
            保存
          </button>
          {id !== null && (
            <button type="button" onClick={handleDelete} disabled={mutations.remove.isPending}>
              削除
            </button>
          )}
        </div>
      </form>

      {/* Modal はポータルではないので、検索欄の Enter が外側の form を submit しないよう form の外に置く。 */}
      {adding && <MedicineSearchModal onSelect={addMedicine} onClose={() => setAdding(false)} />}
    </Modal>
  );
}
