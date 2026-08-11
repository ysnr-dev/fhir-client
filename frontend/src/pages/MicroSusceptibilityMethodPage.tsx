import { useState, type FormEvent } from "react";
import type { MicroSusceptibilityMethod } from "../api/masterClient";
import {
  useMicroSusceptibilityMethodMutations,
  useMicroSusceptibilityMethodSearch,
} from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";

// JANIS 薬剤感受性検査測定法コード表。標準コードは取込で洗い替えるので読むだけ。
// 書けるのは施設追加コードだけ。
export function MicroSusceptibilityMethodPage() {
  const [nameInput, setNameInput] = useState("");
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<MicroSusceptibilityMethod | "new" | null>(null);

  const list = useMicroSusceptibilityMethodSearch({ name, source }, page);
  const hasNext = list.data ? page * list.data.per < list.data.total : false;

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setName(nameInput);
    setPage(1);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>JANIS感受性測定法コード</h1>
        <div className="page__header-actions">
          <button type="button" onClick={() => setEditing("new")}>
            施設追加コードを追加
          </button>
        </div>
      </div>

      <p className="dose-conversion__lead">
        細菌検査結果の薬剤感受性の検査方法の選択肢です。標準コードは取込で
        洗い替えるため読むだけで、施設追加分だけを編集できます。
      </p>

      <form className="patient-search-form" onSubmit={handleSearch}>
        <label>
          方法
          <input type="text" value={nameInput} onChange={(e) => setNameInput(e.target.value)} />
        </label>
        <label>
          区分
          <select
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setPage(1);
            }}
          >
            <option value="">すべて</option>
            <option value="official">標準コード</option>
            <option value="local">施設追加</option>
          </select>
        </label>
        <div className="patient-search-form__actions">
          <button type="submit">検索</button>
          <button
            type="button"
            onClick={() => {
              setNameInput("");
              setName("");
              setSource("");
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
            <th className="rad-code__compact">コード</th>
            <th>方法</th>
            <th className="rad-code__compact">分類</th>
            <th>製品名</th>
            <th>発売会社</th>
            <th className="rad-code__compact">区分</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((method) => (
            <tr
              key={method.id}
              className={method.source === "local" ? "master-search__row" : undefined}
              onClick={() => method.source === "local" && setEditing(method)}
            >
              <td className="rad-code__compact">{method.code}</td>
              <td>{method.name}</td>
              <td className="rad-code__compact">{method.classification}</td>
              <td>{method.product_name}</td>
              <td>{method.company}</td>
              <td className="rad-code__compact">
                {method.source === "local" ? (
                  <span className="rad-code__badge">施設追加</span>
                ) : (
                  "標準"
                )}
              </td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr>
              <td colSpan={6} className="master-search__empty">
                測定法がありません。マスタ取込で JANIS 測定法コード表を取り込んでください。
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
        <SusceptibilityMethodEditModal
          method={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

interface SusceptibilityMethodEditModalProps {
  // null は新規作成。
  method: MicroSusceptibilityMethod | null;
  onClose: () => void;
}

function SusceptibilityMethodEditModal({ method, onClose }: SusceptibilityMethodEditModalProps) {
  const mutations = useMicroSusceptibilityMethodMutations();
  const [draft, setDraft] = useState({
    code: method?.code ?? "",
    name: method?.name ?? "",
    classification: method?.classification ?? "",
    product_name: method?.product_name ?? "",
  });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.code || !draft.name) return;

    const payload = {
      name: draft.name,
      classification: draft.classification || null,
      product_name: draft.product_name || null,
    };
    if (method === null) {
      await mutations.create.mutateAsync({ ...payload, code: draft.code });
    } else {
      await mutations.update.mutateAsync({ id: method.id, payload });
    }
    onClose();
  }

  async function handleDelete() {
    if (method === null) return;
    if (!window.confirm(`${method.name} を削除しますか？`)) return;

    await mutations.remove.mutateAsync(method.id);
    onClose();
  }

  return (
    <Modal
      title={method === null ? "施設追加コードを追加" : "施設追加コードを編集"}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit}>
        <div className="lab-order-item__fields">
          <label>
            コード
            <input
              type="text"
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              // コードを変えると別のコードになるので、作り直してもらう。
              disabled={method !== null}
              required
            />
          </label>
          <label>
            方法
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              required
            />
          </label>
          <label>
            分類
            <input
              type="text"
              value={draft.classification}
              onChange={(e) => setDraft({ ...draft, classification: e.target.value })}
              placeholder="自動化機器 / 用手法"
            />
          </label>
          <label>
            製品名
            <input
              type="text"
              value={draft.product_name}
              onChange={(e) => setDraft({ ...draft, product_name: e.target.value })}
            />
          </label>
        </div>

        <ErrorBanner
          error={mutations.create.error ?? mutations.update.error ?? mutations.remove.error}
        />

        <div className="lab-order-item__actions">
          <button type="submit" disabled={mutations.create.isPending || mutations.update.isPending}>
            保存
          </button>
          {method !== null && (
            <button type="button" onClick={handleDelete} disabled={mutations.remove.isPending}>
              削除
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
