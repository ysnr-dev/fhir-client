import { useState, type FormEvent } from "react";
import type { MicroOrganism } from "../api/masterClient";
import { useMicroOrganismMutations, useMicroOrganismSearch } from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";

// JANIS 感染症病原体コード表。標準コードは取込で洗い替えるので、この画面で
// 書けるのは「頻用菌の印(オーダー画面に直接並べる菌)」と施設追加コードだけ。
export function MicroOrganismPage() {
  const [nameInput, setNameInput] = useState("");
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [frequentOnly, setFrequentOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<MicroOrganism | "new" | null>(null);
  const mutations = useMicroOrganismMutations();

  const list = useMicroOrganismSearch({ name, source, frequent: frequentOnly }, page);
  const hasNext = list.data ? page * list.data.per < list.data.total : false;

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setName(nameInput);
    setPage(1);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>JANIS病原体コード</h1>
        <div className="page__header-actions">
          <button type="button" onClick={() => setEditing("new")}>
            施設追加コードを追加
          </button>
        </div>
      </div>

      <p className="dose-conversion__lead">
        細菌検査オーダーの目的菌の選択肢です。「頻用」を付けた菌はオーダー画面に
        直接並び、それ以外は検索で選びます。頻用の指定と施設追加分は取込で消えません。
      </p>

      <form className="patient-search-form" onSubmit={handleSearch}>
        <label>
          菌名
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
        <label className="dose-conversion__checkbox">
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

      <ErrorBanner error={list.error ?? mutations.update.error} />

      <table className="master-search__table">
        <thead>
          <tr>
            <th className="rad-code__compact">コード</th>
            <th>菌名</th>
            <th className="rad-code__compact">頻用</th>
            <th className="rad-code__compact">区分</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((organism) => (
            <tr
              key={organism.id}
              className={organism.source === "local" ? "master-search__row" : undefined}
              onClick={() => organism.source === "local" && setEditing(organism)}
            >
              <td className="rad-code__compact">{organism.code}</td>
              <td>{organism.name}</td>
              <td className="rad-code__compact" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={organism.frequent}
                  disabled={mutations.update.isPending}
                  onChange={(e) =>
                    mutations.update.mutate({
                      id: organism.id,
                      payload: { frequent: e.target.checked },
                    })
                  }
                />
              </td>
              <td className="rad-code__compact">
                {organism.source === "local" ? (
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
                菌がありません。マスタ取込で JANIS 病原体コード表を取り込んでください。
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
        <OrganismEditModal
          organism={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

interface OrganismEditModalProps {
  // null は新規作成。
  organism: MicroOrganism | null;
  onClose: () => void;
}

function OrganismEditModal({ organism, onClose }: OrganismEditModalProps) {
  const mutations = useMicroOrganismMutations();
  const [draft, setDraft] = useState({
    code: organism?.code ?? "",
    name: organism?.name ?? "",
    frequent: organism?.frequent ?? false,
  });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.code || !draft.name) return;

    if (organism === null) {
      await mutations.create.mutateAsync(draft);
    } else {
      await mutations.update.mutateAsync({
        id: organism.id,
        payload: { name: draft.name, frequent: draft.frequent },
      });
    }
    onClose();
  }

  async function handleDelete() {
    if (organism === null) return;
    if (!window.confirm(`${organism.name} を削除しますか？`)) return;

    await mutations.remove.mutateAsync(organism.id);
    onClose();
  }

  return (
    <Modal
      title={organism === null ? "施設追加コードを追加" : "施設追加コードを編集"}
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
              disabled={organism !== null}
              required
            />
          </label>
          <label>
            菌名
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              required
            />
          </label>
          <label className="dose-conversion__checkbox">
            <input
              type="checkbox"
              checked={draft.frequent}
              onChange={(e) => setDraft({ ...draft, frequent: e.target.checked })}
            />
            頻用(オーダー画面に直接表示)
          </label>
        </div>

        <ErrorBanner
          error={mutations.create.error ?? mutations.update.error ?? mutations.remove.error}
        />

        <div className="lab-order-item__actions">
          <button type="submit" disabled={mutations.create.isPending || mutations.update.isPending}>
            保存
          </button>
          {organism !== null && (
            <button type="button" onClick={handleDelete} disabled={mutations.remove.isPending}>
              削除
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
