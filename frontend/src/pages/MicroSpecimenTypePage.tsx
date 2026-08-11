import { useState, type FormEvent } from "react";
import type { MicroSpecimenType } from "../api/masterClient";
import { useMicroSpecimenTypeMutations, useMicroSpecimenTypeSearch } from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";

// JANIS 材料(検査材料)コード表。標準コードは取込で洗い替えるのでこの画面では
// 読むだけ。書けるのは施設追加分だけ。
export function MicroSpecimenTypePage() {
  const [nameInput, setNameInput] = useState("");
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<MicroSpecimenType | "new" | null>(null);

  const list = useMicroSpecimenTypeSearch({ name, source }, page);
  const hasNext = list.data ? page * list.data.per < list.data.total : false;

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setName(nameInput);
    setPage(1);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>JANIS材料コード</h1>
        <div className="page__header-actions">
          <button type="button" onClick={() => setEditing("new")}>
            施設追加コードを追加
          </button>
        </div>
      </div>

      <p className="dose-conversion__lead">
        細菌検査オーダーの検体種別の選択肢です。施設追加分は取込で消えません。
      </p>

      <form className="patient-search-form" onSubmit={handleSearch}>
        <label>
          材料名
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
            <th>検査材料名</th>
            <th>系統</th>
            <th className="rad-code__compact">区分</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((type) => (
            <tr
              key={type.id}
              className={type.source === "local" ? "master-search__row" : undefined}
              onClick={() => type.source === "local" && setEditing(type)}
            >
              <td className="rad-code__compact">{type.code}</td>
              <td>{type.name}</td>
              <td>{type.category}</td>
              <td className="rad-code__compact">
                {type.source === "local" ? (
                  <span className="rad-code__badge">施設追加</span>
                ) : (
                  "標準"
                )}
              </td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr>
              <td colSpan={4} className="master-search__empty">
                材料がありません。マスタ取込で JANIS 材料コード表を取り込んでください。
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
        <SpecimenTypeEditModal
          specimenType={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

interface SpecimenTypeEditModalProps {
  // null は新規作成。
  specimenType: MicroSpecimenType | null;
  onClose: () => void;
}

function SpecimenTypeEditModal({ specimenType, onClose }: SpecimenTypeEditModalProps) {
  const mutations = useMicroSpecimenTypeMutations();
  const [draft, setDraft] = useState({
    code: specimenType?.code ?? "",
    name: specimenType?.name ?? "",
    category: specimenType?.category ?? "",
  });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.code || !draft.name) return;

    const payload = { name: draft.name, category: draft.category || null };
    if (specimenType === null) {
      await mutations.create.mutateAsync({ ...payload, code: draft.code });
    } else {
      await mutations.update.mutateAsync({ id: specimenType.id, payload });
    }
    onClose();
  }

  async function handleDelete() {
    if (specimenType === null) return;
    if (!window.confirm(`${specimenType.name} を削除しますか？`)) return;

    await mutations.remove.mutateAsync(specimenType.id);
    onClose();
  }

  return (
    <Modal
      title={specimenType === null ? "施設追加コードを追加" : "施設追加コードを編集"}
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
              disabled={specimenType !== null}
              required
            />
          </label>
          <label>
            検査材料名
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              required
            />
          </label>
          <label>
            系統
            <input
              type="text"
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              placeholder="その他"
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
          {specimenType !== null && (
            <button type="button" onClick={handleDelete} disabled={mutations.remove.isPending}>
              削除
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
