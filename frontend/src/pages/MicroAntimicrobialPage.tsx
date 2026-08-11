import { useState, type FormEvent } from "react";
import type { MicroAntimicrobial } from "../api/masterClient";
import { useMicroAntimicrobialMutations, useMicroAntimicrobialSearch } from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";

// JANIS 抗菌薬コード表。標準コードは取込で洗い替えるので、この画面で
// 書けるのは「頻用薬の印(結果画面の感受性欄に直接並べる薬)」と施設追加コードだけ。
export function MicroAntimicrobialPage() {
  const [nameInput, setNameInput] = useState("");
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [frequentOnly, setFrequentOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<MicroAntimicrobial | "new" | null>(null);
  const mutations = useMicroAntimicrobialMutations();

  const list = useMicroAntimicrobialSearch({ name, source, frequent: frequentOnly }, page);
  const hasNext = list.data ? page * list.data.per < list.data.total : false;

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setName(nameInput);
    setPage(1);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>JANIS抗菌薬コード</h1>
        <div className="page__header-actions">
          <button type="button" onClick={() => setEditing("new")}>
            施設追加コードを追加
          </button>
        </div>
      </div>

      <p className="dose-conversion__lead">
        細菌検査結果の薬剤感受性の選択肢です。「頻用」を付けた薬は結果画面に
        直接並び、それ以外は検索で選びます。頻用の指定と施設追加分は取込で消えません。
      </p>

      <form className="patient-search-form" onSubmit={handleSearch}>
        <label>
          薬剤名・略号
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
            <th>薬剤名</th>
            <th className="rad-code__compact">略号</th>
            <th>系統</th>
            <th className="rad-code__compact">頻用</th>
            <th className="rad-code__compact">区分</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((drug) => (
            <tr
              key={drug.id}
              className={drug.source === "local" ? "master-search__row" : undefined}
              onClick={() => drug.source === "local" && setEditing(drug)}
            >
              <td className="rad-code__compact">{drug.code}</td>
              <td>{drug.name}</td>
              <td className="rad-code__compact">{drug.abbreviation}</td>
              <td>{drug.category}</td>
              <td className="rad-code__compact" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={drug.frequent}
                  disabled={mutations.update.isPending}
                  onChange={(e) =>
                    mutations.update.mutate({
                      id: drug.id,
                      payload: { frequent: e.target.checked },
                    })
                  }
                />
              </td>
              <td className="rad-code__compact">
                {drug.source === "local" ? (
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
                抗菌薬がありません。マスタ取込で JANIS 抗菌薬コード表を取り込んでください。
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
        <AntimicrobialEditModal
          drug={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

interface AntimicrobialEditModalProps {
  // null は新規作成。
  drug: MicroAntimicrobial | null;
  onClose: () => void;
}

function AntimicrobialEditModal({ drug, onClose }: AntimicrobialEditModalProps) {
  const mutations = useMicroAntimicrobialMutations();
  const [draft, setDraft] = useState({
    code: drug?.code ?? "",
    name: drug?.name ?? "",
    abbreviation: drug?.abbreviation ?? "",
    category: drug?.category ?? "",
    frequent: drug?.frequent ?? false,
  });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.code || !draft.name) return;

    const payload = {
      name: draft.name,
      abbreviation: draft.abbreviation || null,
      category: draft.category || null,
      frequent: draft.frequent,
    };
    if (drug === null) {
      await mutations.create.mutateAsync({ ...payload, code: draft.code });
    } else {
      await mutations.update.mutateAsync({ id: drug.id, payload });
    }
    onClose();
  }

  async function handleDelete() {
    if (drug === null) return;
    if (!window.confirm(`${drug.name} を削除しますか？`)) return;

    await mutations.remove.mutateAsync(drug.id);
    onClose();
  }

  return (
    <Modal
      title={drug === null ? "施設追加コードを追加" : "施設追加コードを編集"}
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
              disabled={drug !== null}
              required
            />
          </label>
          <label>
            薬剤名
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              required
            />
          </label>
          <label>
            略号
            <input
              type="text"
              value={draft.abbreviation}
              onChange={(e) => setDraft({ ...draft, abbreviation: e.target.value })}
            />
          </label>
          <label>
            系統
            <input
              type="text"
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            />
          </label>
          <label className="dose-conversion__checkbox">
            <input
              type="checkbox"
              checked={draft.frequent}
              onChange={(e) => setDraft({ ...draft, frequent: e.target.checked })}
            />
            頻用(結果画面に直接表示)
          </label>
        </div>

        <ErrorBanner
          error={mutations.create.error ?? mutations.update.error ?? mutations.remove.error}
        />

        <div className="lab-order-item__actions">
          <button type="submit" disabled={mutations.create.isPending || mutations.update.isPending}>
            保存
          </button>
          {drug !== null && (
            <button type="button" onClick={handleDelete} disabled={mutations.remove.isPending}>
              削除
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
