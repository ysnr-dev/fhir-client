import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { LabSpecimen, LabSpecimenPayload } from "../api/masterClient";
import {
  useLabContainers,
  useLabSpecimenCategories,
  useLabSpecimenMutations,
  useLabSpecimenSearch,
  type LabSpecimenFilters,
} from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";

// 編集フォームの値。配布ファイル由来の列(コード・名称・分類)は手動追加の検体
// だけで編集し、取込済みの検体では略称・既定採取管・備考をメンテする。
interface Draft {
  specimen_code: string;
  name: string;
  short_name: string;
  category: string;
  default_container_code: string;
  note: string;
}

const emptyDraft: Draft = {
  specimen_code: "",
  name: "",
  short_name: "",
  category: "",
  default_container_code: "",
  note: "",
};

function toPayload(draft: Draft): LabSpecimenPayload {
  return {
    specimen_code: draft.specimen_code,
    name: draft.name,
    short_name: draft.short_name || null,
    category: draft.category || null,
    default_container_code: draft.default_container_code || null,
    note: draft.note || null,
  };
}

export function LabSpecimenPage() {
  const [inputs, setInputs] = useState<LabSpecimenFilters>({});
  const [filters, setFilters] = useState<LabSpecimenFilters>({});
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<LabSpecimen | "new" | null>(null);

  const list = useLabSpecimenSearch(filters, page);
  const categories = useLabSpecimenCategories();
  const containers = useLabContainers();

  const containerNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of containers.data?.items ?? []) map.set(c.container_code, c.name);
    return map;
  }, [containers.data]);

  const hasNext = list.data ? page * list.data.per < list.data.total : false;

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setFilters(inputs);
    setPage(1);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>検体マスタ</h1>
        <div className="page__header-actions">
          <button type="button" onClick={() => setEditing("new")}>
            検体を追加
          </button>
        </div>
      </div>

      <p className="dose-conversion__lead">
        JLAC11 の材料コード一覧から取り込みます（マスタ取込画面）。略称・既定採取管・備考は
        取込で消えない手入力の列です。
      </p>

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
          検体分類
          <select
            value={inputs.category ?? ""}
            onChange={(e) => setInputs({ ...inputs, category: e.target.value })}
          >
            <option value="">すべて</option>
            {categories.data?.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>
        <label className="dose-conversion__checkbox">
          <input
            type="checkbox"
            checked={inputs.recommendedOnly ?? false}
            onChange={(e) => setInputs({ ...inputs, recommendedOnly: e.target.checked })}
          />
          推奨コードのみ
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
            <th>略称</th>
            <th>検体分類</th>
            <th className="lab-order-item__compact">推奨</th>
            <th>既定採取管</th>
            <th>JLAC10材料</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((specimen) => (
            <tr key={specimen.id} onClick={() => setEditing(specimen)} className="master-search__row">
              <td>{specimen.specimen_code}</td>
              {/* 配布ファイルの字下げ階層(親を持つ検体)を字下げで表す。 */}
              <td>{specimen.parent_specimen_code ? `　${specimen.name}` : specimen.name}</td>
              <td>{specimen.short_name}</td>
              <td>{specimen.category}</td>
              <td className="lab-order-item__compact">{specimen.recommended ? "◯" : ""}</td>
              <td>
                {specimen.default_container_code
                  ? (containerNames.get(specimen.default_container_code) ??
                    specimen.default_container_code)
                  : ""}
              </td>
              <td>{specimen.jlac10_specimen_code}</td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr>
              <td colSpan={7} className="master-search__empty">
                検体がありません。マスタ取込画面から JLAC11 材料コード一覧を取り込んでください。
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
        <SpecimenEditModal
          specimen={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

interface SpecimenEditModalProps {
  // null は新規作成(院内独自検体の追加)。
  specimen: LabSpecimen | null;
  onClose: () => void;
}

function SpecimenEditModal({ specimen, onClose }: SpecimenEditModalProps) {
  const mutations = useLabSpecimenMutations();
  const containers = useLabContainers();
  const [draft, setDraft] = useState<Draft>(emptyDraft);

  useEffect(() => {
    if (!specimen) return;
    setDraft({
      specimen_code: specimen.specimen_code,
      name: specimen.name,
      short_name: specimen.short_name ?? "",
      category: specimen.category ?? "",
      default_container_code: specimen.default_container_code ?? "",
      note: specimen.note ?? "",
    });
  }, [specimen]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.specimen_code || !draft.name) return;

    if (specimen === null) {
      await mutations.create.mutateAsync(toPayload(draft));
    } else {
      await mutations.update.mutateAsync({ id: specimen.id, payload: toPayload(draft) });
    }
    onClose();
  }

  async function handleDelete() {
    if (specimen === null) return;
    if (!window.confirm(`${specimen.name} を削除しますか？`)) return;

    await mutations.remove.mutateAsync(specimen.id);
    onClose();
  }

  return (
    <Modal title={specimen === null ? "検体を追加" : "検体を編集"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="lab-order-item__fields">
          <label>
            検体コード(3桁)
            <input
              type="text"
              value={draft.specimen_code}
              onChange={(e) => setDraft({ ...draft, specimen_code: e.target.value })}
              disabled={specimen !== null}
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
            略称
            <input
              type="text"
              value={draft.short_name}
              onChange={(e) => setDraft({ ...draft, short_name: e.target.value })}
            />
          </label>
          <label>
            検体分類
            <input
              type="text"
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            />
          </label>
          <label>
            既定採取管
            <select
              value={draft.default_container_code}
              onChange={(e) => setDraft({ ...draft, default_container_code: e.target.value })}
            >
              <option value="">未設定</option>
              {containers.data?.items.map((container) => (
                <option key={container.container_code} value={container.container_code}>
                  {container.name}
                </option>
              ))}
            </select>
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

        <ErrorBanner error={mutations.create.error ?? mutations.update.error ?? mutations.remove.error} />

        <div className="lab-order-item__actions">
          <button type="submit" disabled={mutations.create.isPending || mutations.update.isPending}>
            保存
          </button>
          {specimen !== null && (
            <button type="button" onClick={handleDelete} disabled={mutations.remove.isPending}>
              削除
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
