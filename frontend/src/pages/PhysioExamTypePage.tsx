import { useEffect, useState, type FormEvent } from "react";
import type { PhysioExamType, PhysioExamTypePayload } from "../api/masterClient";
import { usePhysioExamTypeMutations, usePhysioExamTypeSearch } from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";

// 生理検査の検査種別マスタ。放射線検査でいう JJ1017 の「種別(モダリティ)」に
// 当たる分類軸だが、生理検査は JJ1017 に収載されておらず標準コード体系が無いので、
// 施設がここで自由に定義する。

interface Draft {
  exam_type_code: string;
  name: string;
  short_name: string;
  name_kana: string;
  valid_from: string;
  valid_to: string;
  display_order: string;
  note: string;
}

const emptyDraft: Draft = {
  exam_type_code: "",
  name: "",
  short_name: "",
  name_kana: "",
  valid_from: "",
  valid_to: "",
  display_order: "",
  note: "",
};

function toPayload(draft: Draft): PhysioExamTypePayload {
  return {
    // 空なら省略してサーバーに自動採番させる。
    exam_type_code: draft.exam_type_code || undefined,
    name: draft.name,
    short_name: draft.short_name || null,
    name_kana: draft.name_kana || null,
    valid_from: draft.valid_from || null,
    valid_to: draft.valid_to || null,
    display_order: draft.display_order ? Number(draft.display_order) : null,
    note: draft.note || null,
  };
}

export function PhysioExamTypePage() {
  const [name, setName] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<PhysioExamType | "new" | null>(null);

  const list = usePhysioExamTypeSearch({ name, active: activeOnly }, page);
  const hasNext = list.data ? page * list.data.per < list.data.total : false;

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setPage(1);
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>生理検査 検査種別</h1>
        <div className="page__header-actions">
          <button type="button" onClick={() => setEditing("new")}>
            検査種別を追加
          </button>
        </div>
      </div>

      <p className="dose-conversion__lead">
        心電図・超音波検査などの検査分野です。生理検査には JJ1017
        のような標準コード体系が無いため、施設ごとにここで定義します。
        生理検査オーダー項目の分類・オーダーの絞り込み・生理検査一覧の絞り込みに使われます。
      </p>

      <form className="patient-search-form" onSubmit={handleSearch}>
        <label>
          名称・略称・カナ
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="心電図、US など"
          />
        </label>
        <label className="dose-conversion__checkbox">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => {
              setActiveOnly(e.target.checked);
              setPage(1);
            }}
          />
          有効な種別のみ
        </label>
        <div className="patient-search-form__actions">
          <button type="submit">検索</button>
        </div>
      </form>

      <ErrorBanner error={list.error} />

      <table className="master-search__table">
        <thead>
          <tr>
            <th className="lab-order-item__compact">コード</th>
            <th>名称</th>
            <th>略称</th>
            <th>カナ</th>
            <th className="lab-order-item__compact">有効期間</th>
            <th className="lab-order-item__compact">表示順</th>
            <th>備考</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((examType) => (
            <tr
              key={examType.id}
              onClick={() => setEditing(examType)}
              className="master-search__row"
            >
              <td className="lab-order-item__compact">{examType.exam_type_code}</td>
              <td>{examType.name}</td>
              <td>{examType.short_name}</td>
              <td>{examType.name_kana}</td>
              <td className="lab-order-item__compact">
                {[examType.valid_from, examType.valid_to].some(Boolean)
                  ? `${examType.valid_from ?? ""} 〜 ${examType.valid_to ?? ""}`
                  : ""}
              </td>
              <td className="lab-order-item__compact">{examType.display_order}</td>
              <td>{examType.note}</td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr>
              <td colSpan={7} className="master-search__empty">
                検査種別がありません
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
        <ExamTypeEditModal
          examType={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

interface ExamTypeEditModalProps {
  // null は新規作成。
  examType: PhysioExamType | null;
  onClose: () => void;
}

function ExamTypeEditModal({ examType, onClose }: ExamTypeEditModalProps) {
  const mutations = usePhysioExamTypeMutations();
  const [draft, setDraft] = useState<Draft>(emptyDraft);

  useEffect(() => {
    if (!examType) return;
    setDraft({
      exam_type_code: examType.exam_type_code,
      name: examType.name,
      short_name: examType.short_name ?? "",
      name_kana: examType.name_kana ?? "",
      valid_from: examType.valid_from ?? "",
      valid_to: examType.valid_to ?? "",
      display_order: examType.display_order === null ? "" : String(examType.display_order),
      note: examType.note ?? "",
    });
  }, [examType]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.name) return;

    if (examType === null) {
      await mutations.create.mutateAsync(toPayload(draft));
    } else {
      await mutations.update.mutateAsync({ id: examType.id, payload: toPayload(draft) });
    }
    onClose();
  }

  async function handleDelete() {
    if (examType === null) return;
    // 検査項目は消さず未分類に戻すだけなので、その旨も伝えて確認する。
    if (!window.confirm(`${examType.name} を削除しますか？\nこの種別の検査項目は未分類になります。`)) {
      return;
    }

    await mutations.remove.mutateAsync(examType.id);
    onClose();
  }

  return (
    <Modal title={examType === null ? "検査種別を追加" : "検査種別を編集"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="lab-order-item__fields">
          <label>
            種別コード
            <input
              type="text"
              value={draft.exam_type_code}
              onChange={(e) => setDraft({ ...draft, exam_type_code: e.target.value })}
              disabled={examType !== null}
              placeholder="空欄で自動採番"
            />
          </label>
          <label>
            名称
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="心電図、超音波検査 など"
              required
            />
          </label>
          <label>
            略称
            <input
              type="text"
              value={draft.short_name}
              onChange={(e) => setDraft({ ...draft, short_name: e.target.value })}
              placeholder="ECG、US など"
            />
          </label>
          <label>
            カナ名称
            <input
              type="text"
              value={draft.name_kana}
              onChange={(e) => setDraft({ ...draft, name_kana: e.target.value })}
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

        <ErrorBanner
          error={mutations.create.error ?? mutations.update.error ?? mutations.remove.error}
        />

        <div className="lab-order-item__actions">
          <button type="submit" disabled={mutations.create.isPending || mutations.update.isPending}>
            保存
          </button>
          {examType !== null && (
            <button type="button" onClick={handleDelete} disabled={mutations.remove.isPending}>
              削除
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
