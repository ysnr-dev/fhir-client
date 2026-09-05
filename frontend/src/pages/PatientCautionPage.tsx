import { useState, type FormEvent } from "react";
import type { PatientCaution } from "../api/masterClient";
import { usePatientCautionMutations, usePatientCautions } from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";
import {
  CAUTION_PICTOGRAM_KEYS,
  CAUTION_PICTOGRAM_LABELS,
  CautionPictogram,
} from "../components/icons/cautionPictograms";
import { FLAG_CATEGORY_OPTIONS, flagCategoryLabel } from "../fhir/flagHelpers";

// 患者の診療上の注意の区分マスタ。実体の注意は上流の FHIR Flag が患者ごとに
// 持ち、この画面は「何を注意として選べるか」と「患者帯にどう出すか」を決める。
export function PatientCautionPage() {
  const [editing, setEditing] = useState<PatientCaution | "new" | null>(null);
  const list = usePatientCautions();

  return (
    <div className="page">
      <div className="page__header">
        <h1>注意区分</h1>
        <div className="page__header-actions">
          <button type="button" onClick={() => setEditing("new")}>
            追加
          </button>
        </div>
      </div>

      <p className="dose-conversion__lead">
        カルテのプロファイルタブで選べる「診療上の注意」の選択肢です。ピクトグラムを設定した区分だけが患者帯にアイコンで出ます。行をクリックすると編集できます。
      </p>

      <ErrorBanner error={list.error} />

      <table className="master-search__table">
        <thead>
          <tr>
            <th className="rad-code__compact">コード</th>
            <th>表示名</th>
            <th className="rad-code__compact">区分</th>
            <th className="rad-code__compact">ピクトグラム</th>
            <th className="rad-code__compact">表示順</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((caution) => (
            <tr key={caution.id} className="master-search__row" onClick={() => setEditing(caution)}>
              <td className="rad-code__compact">{caution.code}</td>
              <td>{caution.name}</td>
              <td className="rad-code__compact">{flagCategoryLabel(caution.category)}</td>
              <td className="rad-code__compact">
                {caution.pictogram && (
                  <span className="patient-caution__pictogram">
                    <CautionPictogram pictogram={caution.pictogram} />
                    {caution.pictogram}
                  </span>
                )}
              </td>
              <td className="rad-code__compact">{caution.display_order ?? ""}</td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr>
              <td colSpan={5} className="master-search__empty">
                注意区分がありません。db:seed で初期値を投入できます。
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing !== null && (
        <CautionEditModal
          caution={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

interface CautionEditModalProps {
  // null は新規作成。
  caution: PatientCaution | null;
  onClose: () => void;
}

function CautionEditModal({ caution, onClose }: CautionEditModalProps) {
  const mutations = usePatientCautionMutations();
  const [draft, setDraft] = useState({
    code: caution?.code ?? "",
    name: caution?.name ?? "",
    category: caution?.category ?? FLAG_CATEGORY_OPTIONS[0].code,
    pictogram: caution?.pictogram ?? "",
    displayOrder: caution?.display_order != null ? String(caution.display_order) : "",
  });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.code || !draft.name) return;

    const payload = {
      name: draft.name,
      category: draft.category,
      pictogram: draft.pictogram || null,
      display_order: draft.displayOrder ? Number(draft.displayOrder) : null,
    };
    if (caution === null) {
      await mutations.create.mutateAsync({ ...payload, code: draft.code });
    } else {
      await mutations.update.mutateAsync({ id: caution.id, payload });
    }
    onClose();
  }

  async function handleDelete() {
    if (caution === null) return;
    if (!window.confirm(`${caution.name} を削除しますか？`)) return;

    await mutations.remove.mutateAsync(caution.id);
    onClose();
  }

  return (
    <Modal title={caution === null ? "注意区分を追加" : "注意区分を編集"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="lab-order-item__fields">
          <label>
            コード
            <input
              type="text"
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              // コードを変えると別の区分になるので、作り直してもらう。
              disabled={caution !== null}
              required
            />
          </label>
          <label>
            表示名
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              required
            />
          </label>
          <label>
            区分
            <select
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            >
              {FLAG_CATEGORY_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.display}
                </option>
              ))}
            </select>
          </label>
          <label>
            ピクトグラム
            <span className="patient-caution__pictogram-field">
              <select
                value={draft.pictogram}
                onChange={(e) => setDraft({ ...draft, pictogram: e.target.value })}
              >
                <option value="">(帯に出さない)</option>
                {CAUTION_PICTOGRAM_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {key}（{CAUTION_PICTOGRAM_LABELS[key]}）
                  </option>
                ))}
              </select>
              {draft.pictogram && (
                <span className="patient-caution__pictogram-preview">
                  <CautionPictogram pictogram={draft.pictogram} size={20} />
                </span>
              )}
            </span>
          </label>
          <label>
            表示順
            <input
              type="number"
              value={draft.displayOrder}
              onChange={(e) => setDraft({ ...draft, displayOrder: e.target.value })}
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
          {caution !== null && (
            <button type="button" onClick={handleDelete} disabled={mutations.remove.isPending}>
              削除
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
