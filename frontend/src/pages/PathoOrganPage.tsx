import { useState, type FormEvent } from "react";
import type { PathoOrgan } from "../api/masterClient";
import { usePathoOrganMutations, usePathoOrganSearch } from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";

// 病理検査の臓器・検査材料(JAHIS 病理・臨床細胞データ交換規約 付録-3 テーブル
// LPATHO003)。規約付録の標準コードは seed で投入するのでこの画面では読むだけ。
// 書けるのは施設追加分と、オーダー画面に直接並べる頻用臓器の印。
export function PathoOrganPage() {
  const [nameInput, setNameInput] = useState("");
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [frequentOnly, setFrequentOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<PathoOrgan | "new" | null>(null);

  const list = usePathoOrganSearch({ name, source, frequent: frequentOnly }, page);
  const mutations = usePathoOrganMutations();
  const hasNext = list.data ? page * list.data.per < list.data.total : false;

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setName(nameInput);
    setPage(1);
  }

  function toggleFrequent(organ: PathoOrgan) {
    mutations.update.mutate({ id: organ.id, payload: { frequent: !organ.frequent } });
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>病理臓器・検査材料</h1>
        <div className="page__header-actions">
          <button type="button" onClick={() => setEditing("new")}>
            施設追加コードを追加
          </button>
        </div>
      </div>

      <p className="dose-conversion__lead">
        病理検査オーダーの臓器・検査材料の選択肢です(JAHIS テーブル LPATHO003)。
        頻用の印を付けた臓器は、オーダー画面で検索せずに押して選べます。
      </p>

      <form className="patient-search-form" onSubmit={handleSearch}>
        <label>
          臓器名・ICD-10
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
        <label className="patient-search-form__checkbox">
          <input
            type="checkbox"
            checked={frequentOnly}
            onChange={(e) => {
              setFrequentOnly(e.target.checked);
              setPage(1);
            }}
          />
          頻用のみ
        </label>
        <div className="patient-search-form__actions">
          <button type="submit">検索</button>
          <button
            type="button"
            onClick={() => {
              setNameInput("");
              setName("");
              setSource("");
              setFrequentOnly(false);
              setPage(1);
            }}
          >
            クリア
          </button>
        </div>
      </form>

      <ErrorBanner error={list.error} />
      <ErrorBanner error={mutations.update.error} />

      <table className="master-search__table">
        <thead>
          <tr>
            <th className="rad-code__compact">コード</th>
            <th>臓器・検査材料</th>
            <th className="rad-code__compact">ICD-10</th>
            <th className="rad-code__compact">頻用</th>
            <th className="rad-code__compact">区分</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((organ) => (
            <tr
              key={organ.id}
              className={organ.source === "local" ? "master-search__row" : undefined}
              onClick={() => organ.source === "local" && setEditing(organ)}
            >
              <td className="rad-code__compact">{organ.code}</td>
              <td>{organ.name}</td>
              <td className="rad-code__compact">{organ.icd10 ?? ""}</td>
              <td className="rad-code__compact">
                {/* 標準コードでも切り替えられる唯一の項目。行クリックの編集とは
                    別操作なので、伝播を止めてチェックボックス単体で効かせる。 */}
                <input
                  type="checkbox"
                  checked={organ.frequent}
                  aria-label={`${organ.name}を頻用にする`}
                  disabled={mutations.update.isPending}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggleFrequent(organ)}
                />
              </td>
              <td className="rad-code__compact">
                {organ.source === "local" ? (
                  <span className="rad-code__badge">施設追加</span>
                ) : (
                  "標準"
                )}
              </td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr>
              <td colSpan={5} className="master-search__empty">
                臓器がありません。db:seed で規約付録のコード表を投入できます。
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
        <OrganEditModal
          organ={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

interface OrganEditModalProps {
  // null は新規作成。
  organ: PathoOrgan | null;
  onClose: () => void;
}

function OrganEditModal({ organ, onClose }: OrganEditModalProps) {
  const mutations = usePathoOrganMutations();
  const [draft, setDraft] = useState({
    code: organ?.code ?? "",
    name: organ?.name ?? "",
    icd10: organ?.icd10 ?? "",
  });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.code || !draft.name) return;

    const payload = { name: draft.name, icd10: draft.icd10 || null };
    if (organ === null) {
      await mutations.create.mutateAsync({ ...payload, code: draft.code });
    } else {
      await mutations.update.mutateAsync({ id: organ.id, payload });
    }
    onClose();
  }

  async function handleDelete() {
    if (organ === null) return;
    if (!window.confirm(`${organ.name} を削除しますか？`)) return;

    await mutations.remove.mutateAsync(organ.id);
    onClose();
  }

  return (
    <Modal title={organ === null ? "施設追加コードを追加" : "施設追加コードを編集"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="lab-order-item__fields">
          <label>
            コード
            <input
              type="text"
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              // コードを変えると別のコードになるので、作り直してもらう。
              disabled={organ !== null}
              required
            />
          </label>
          <label>
            臓器・検査材料名
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              required
            />
          </label>
          <label>
            ICD-10
            <input
              type="text"
              value={draft.icd10}
              onChange={(e) => setDraft({ ...draft, icd10: e.target.value })}
              placeholder="C16.3"
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
          {organ !== null && (
            <button type="button" onClick={handleDelete} disabled={mutations.remove.isPending}>
              削除
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
