import { useState, type FormEvent } from "react";
import { useQuestionnaireOptions } from "../api/queries";
import type { ClinicalNoteTitle, ClinicalNoteTitleMode } from "../api/masterClient";
import { useClinicalNoteTitleMutations, useClinicalNoteTitles } from "../api/masterQueries";
import { ErrorBanner } from "../components/ErrorBanner";
import { Modal } from "../components/Modal";
import { TemplateSelect } from "../components/TemplateSelect";
import { CLINICAL_NOTE_MODE_OPTIONS, clinicalNoteModeLabel } from "../fhir/clinicalNoteHelpers";
import { PRACTITIONER_ROLE_OPTIONS, practitionerRoleLabel } from "../fhir/practitionerRoleHelpers";
import { questionnaireCanonical } from "../fhir/questionnaireResponseHelpers";

// 診療記録のタイトルのマスタ。タイトルごとに記載形式(テンプレートなら既定の
// テンプレート)を決めておき、診療記録のフォームで選んだときに当てる。職種が
// ログイン中の医療従事者と一致するタイトルは、新規記録の初期値になる。
export function ClinicalNoteTitlePage() {
  const [editing, setEditing] = useState<ClinicalNoteTitle | "new" | null>(null);
  const list = useClinicalNoteTitles();
  const templates = useQuestionnaireOptions({ status: "active" });

  // 一覧はテンプレート名で見せる(canonical のままでは何か分からないため)。
  function templateName(canonical: string | null): string {
    if (!canonical) return "";
    const questionnaire = templates.questionnaires.find(
      (q) => questionnaireCanonical(q) === canonical,
    );
    return questionnaire?.title ?? questionnaire?.name ?? canonical;
  }

  return (
    <div className="page">
      <div className="page__header">
        <h1>診療記録タイトル</h1>
        <div className="page__header-actions">
          <button type="button" onClick={() => setEditing("new")}>
            追加
          </button>
        </div>
      </div>

      <ErrorBanner error={list.error} />
      <ErrorBanner error={templates.error} />

      <table className="master-search__table">
        <thead>
          <tr>
            <th>タイトル</th>
            <th className="rad-code__compact">記載形式</th>
            <th>テンプレート</th>
            <th className="rad-code__compact">職種</th>
            <th className="rad-code__compact">表示順</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((item) => (
            <tr key={item.id} className="master-search__row" onClick={() => setEditing(item)}>
              <td>{item.title}</td>
              <td className="rad-code__compact">{clinicalNoteModeLabel(item.mode)}</td>
              <td>{templateName(item.template_canonical)}</td>
              <td className="rad-code__compact">{practitionerRoleLabel(item.role_code ?? undefined)}</td>
              <td className="rad-code__compact">{item.display_order ?? ""}</td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr>
              <td colSpan={5} className="master-search__empty">
                タイトルがありません。
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing !== null && (
        <TitleEditModal
          item={editing === "new" ? null : editing}
          questionnaires={templates.questionnaires}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

interface TitleEditModalProps {
  // null は新規作成。
  item: ClinicalNoteTitle | null;
  questionnaires: fhir4.Questionnaire[];
  onClose: () => void;
}

function TitleEditModal({ item, questionnaires, onClose }: TitleEditModalProps) {
  const mutations = useClinicalNoteTitleMutations();
  const [draft, setDraft] = useState({
    title: item?.title ?? "",
    mode: item?.mode ?? ("soap" as ClinicalNoteTitleMode),
    templateCanonical: item?.template_canonical ?? "",
    roleCode: item?.role_code ?? "",
    displayOrder: item?.display_order != null ? String(item.display_order) : "",
  });
  const [validationError, setValidationError] = useState<string | null>(null);

  // マスタは canonical で持ち、TemplateSelect は Questionnaire.id で扱うので変換する。
  const templateId =
    questionnaires.find((q) => questionnaireCanonical(q) === draft.templateCanonical)?.id ?? "";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.title.trim()) return;
    if (draft.mode === "template" && !draft.templateCanonical) {
      setValidationError("テンプレートを選択してください。");
      return;
    }
    setValidationError(null);

    const payload = {
      title: draft.title.trim(),
      mode: draft.mode,
      template_canonical: draft.mode === "template" ? draft.templateCanonical : null,
      role_code: draft.roleCode || null,
      display_order: draft.displayOrder ? Number(draft.displayOrder) : null,
    };
    if (item === null) {
      await mutations.create.mutateAsync(payload);
    } else {
      await mutations.update.mutateAsync({ id: item.id, payload });
    }
    onClose();
  }

  async function handleDelete() {
    if (item === null) return;
    if (!window.confirm(`${item.title} を削除しますか？`)) return;

    await mutations.remove.mutateAsync(item.id);
    onClose();
  }

  return (
    <Modal title={item === null ? "タイトルを追加" : "タイトルを編集"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {validationError && (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">{validationError}</p>
          </div>
        )}
        <div className="lab-order-item__fields">
          <label>
            タイトル
            <input
              type="text"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              required
            />
          </label>
          <label>
            記載形式
            <select
              value={draft.mode}
              onChange={(e) => setDraft({ ...draft, mode: e.target.value as ClinicalNoteTitleMode })}
            >
              {CLINICAL_NOTE_MODE_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {draft.mode === "template" && (
            <div className="clinical-note-title__template">
              <TemplateSelect
                label="テンプレート初期値"
                questionnaires={questionnaires}
                value={templateId}
                onChange={(id) => {
                  const questionnaire = questionnaires.find((q) => q.id === id);
                  setDraft({
                    ...draft,
                    templateCanonical: questionnaire ? questionnaireCanonical(questionnaire) : "",
                  });
                }}
              />
            </div>
          )}
          <label>
            職種
            <select
              value={draft.roleCode}
              onChange={(e) => setDraft({ ...draft, roleCode: e.target.value })}
            >
              <option value="">(職種を問わない)</option>
              {PRACTITIONER_ROLE_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
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
          {item !== null && (
            <button type="button" onClick={handleDelete} disabled={mutations.remove.isPending}>
              削除
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
