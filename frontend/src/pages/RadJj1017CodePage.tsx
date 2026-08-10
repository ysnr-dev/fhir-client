import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { RadJj1017Code, RadJj1017Element } from "../api/masterClient";
import {
  useRadJj1017CodeMutations,
  useRadJj1017CodeSearch,
  useRadJj1017Elements,
} from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";

// JJ1017 の部品コード表。配布ファイル由来の標準コードは取込で洗い替えるので
// この画面では読むだけ。書けるのは施設独自の拡張コードだけ。
export function RadJj1017CodePage() {
  const elements = useRadJj1017Elements();
  const [element, setElement] = useState<string>("");
  const [source, setSource] = useState<string>("");
  const [nameInput, setNameInput] = useState("");
  const [name, setName] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<RadJj1017Code | "new" | null>(null);

  // 要素が読めたら先頭(種別)を開いておく。
  useEffect(() => {
    if (!element && elements.data && elements.data.elements.length > 0) {
      setElement(elements.data.elements[0].element);
    }
  }, [element, elements.data]);

  const list = useRadJj1017CodeSearch({ element, source, name }, page, element !== "");
  const selected = elements.data?.elements.find((e) => e.element === element) ?? null;
  const hasNext = list.data ? page * list.data.per < list.data.total : false;
  const isBodyPart = element === "body_part";

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setName(nameInput);
    setPage(1);
  }

  function handleElementChange(next: string) {
    setElement(next);
    setPage(1);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>JJ1017コード</h1>
        <div className="page__header-actions">
          <button
            type="button"
            onClick={() => setEditing("new")}
            disabled={!selected?.extension_allowed}
            title={
              selected?.extension_allowed
                ? undefined
                : "この要素は JJ1017 指針で施設拡張が認められていません"
            }
          >
            拡張コードを追加
          </button>
        </div>
      </div>

      <ErrorBanner error={elements.error} />

      <form className="patient-search-form" onSubmit={handleSearch}>
        <label>
          要素
          <select value={element} onChange={(e) => handleElementChange(e.target.value)}>
            {elements.data?.elements.map((option) => (
              <option key={option.element} value={option.element}>
                {option.label}
              </option>
            ))}
          </select>
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
            <option value="local">施設拡張</option>
          </select>
        </label>
        <label>
          名称
          <input type="text" value={nameInput} onChange={(e) => setNameInput(e.target.value)} />
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

      {selected && <ElementSummary element={selected} />}

      <ErrorBanner error={list.error} />

      <table className="master-search__table">
        <thead>
          <tr>
            <th className="rad-code__compact">コード</th>
            <th>名称</th>
            <th>英語名</th>
            {isBodyPart && <th className="rad-code__compact">大部位</th>}
            {isBodyPart && <th>使用モダリティ</th>}
            <th className="rad-code__compact">Ver</th>
            <th className="rad-code__compact">区分</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((code) => (
            <tr
              key={code.id}
              className={code.source === "local" ? "master-search__row" : undefined}
              onClick={() => code.source === "local" && setEditing(code)}
            >
              <td className="rad-code__compact">{code.code}</td>
              <td>
                {code.name}
                {code.common_name && <span className="rad-code__common">{code.common_name}</span>}
              </td>
              <td>{code.name_english}</td>
              {isBodyPart && <td className="rad-code__compact">{code.major_part_code}</td>}
              {isBodyPart && (
                <td>
                  {[
                    code.use_general ? "一般" : "",
                    code.use_ct ? "CT" : "",
                    code.use_mr ? "MR" : "",
                    code.use_us ? "US" : "",
                  ]
                    .filter(Boolean)
                    .join(" / ")}
                </td>
              )}
              <td className="rad-code__compact">{code.jj_version}</td>
              <td className="rad-code__compact">
                {code.source === "local" ? (
                  <span className="rad-code__badge">施設拡張</span>
                ) : (
                  "標準"
                )}
              </td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr>
              <td colSpan={isBodyPart ? 7 : 5} className="master-search__empty">
                コードがありません。マスタ取込で JJ1017 の別表を取り込んでください。
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

      {editing !== null && selected && (
        <CodeEditModal
          element={selected}
          code={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// 選んだ要素が32桁コードのどこに入るか、施設拡張がどこまで許されているかを出す。
// 指針を都度引かなくても拡張コードを作れるようにするための案内。
function ElementSummary({ element }: { element: RadJj1017Element }) {
  const from = element.offset + 1;
  const to = element.offset + element.length;
  const position = from === to ? `${from}桁目` : `${from}〜${to}桁目`;

  return (
    <p className="rad-code__summary">
      {element.table} / 32桁コードの{position}（{element.length}桁）
      {" ・ "}
      {element.extension_allowed
        ? `施設拡張は ${element.extension_label} が使えます`
        : "施設拡張は認められていません"}
      {" ・ "}
      標準 {element.official_count} 件 / 施設拡張 {element.local_count} 件
    </p>
  );
}

interface CodeEditModalProps {
  element: RadJj1017Element;
  // null は新規作成。
  code: RadJj1017Code | null;
  onClose: () => void;
}

function CodeEditModal({ element, code, onClose }: CodeEditModalProps) {
  const mutations = useRadJj1017CodeMutations();
  const [draft, setDraft] = useState({
    code: code?.code ?? "",
    name: code?.name ?? "",
    name_english: code?.name_english ?? "",
    common_name: code?.common_name ?? "",
    note: code?.note ?? "",
  });

  const payload = useMemo(
    () => ({
      element: element.element,
      code: draft.code,
      name: draft.name,
      name_english: draft.name_english || null,
      common_name: draft.common_name || null,
      note: draft.note || null,
    }),
    [draft, element.element],
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.code || !draft.name) return;

    if (code === null) {
      await mutations.create.mutateAsync(payload);
    } else {
      await mutations.update.mutateAsync({ id: code.id, payload });
    }
    onClose();
  }

  async function handleDelete() {
    if (code === null) return;
    if (!window.confirm(`${code.code} ${code.name} を削除しますか？`)) return;

    await mutations.remove.mutateAsync(code.id);
    onClose();
  }

  const saving = mutations.create.isPending || mutations.update.isPending;

  return (
    <Modal
      title={code === null ? `${element.label}の拡張コードを追加` : `${element.label}の拡張コードを編集`}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit}>
        <p className="rad-code__summary">
          {element.length}桁 ／ 使える範囲: {element.extension_label}
          （数字と、I と O を除く英大文字）
        </p>
        <div className="lab-order-item__fields">
          <label>
            コード
            <input
              type="text"
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
              maxLength={element.length}
              // コードを変えると別のコードになるので、作り直してもらう。
              disabled={code !== null}
              required
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
            英語名
            <input
              type="text"
              value={draft.name_english}
              onChange={(e) => setDraft({ ...draft, name_english: e.target.value })}
            />
          </label>
          <label>
            通称名称
            <input
              type="text"
              value={draft.common_name}
              onChange={(e) => setDraft({ ...draft, common_name: e.target.value })}
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

        <ErrorBanner
          error={mutations.create.error ?? mutations.update.error ?? mutations.remove.error}
        />

        <div className="lab-order-item__actions">
          <button type="submit" disabled={saving}>
            保存
          </button>
          {code !== null && (
            <button type="button" onClick={handleDelete} disabled={mutations.remove.isPending}>
              削除
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
