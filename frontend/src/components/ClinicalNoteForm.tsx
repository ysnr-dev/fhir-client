import { useState, type FormEvent } from "react";
import {
  newSectionDraft,
  SECTION_OPTIONS,
  type ClinicalNoteFormValues,
  type SectionCode,
} from "../fhir/clinicalNoteHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { RichTextEditor } from "./RichTextEditor";

// 診療記録の入力フォーム(Create/Edit 共用)。
// セクションは可変(追加・削除・並べ替え)。同じ種別の重複追加も許す
// (例: 自由記載を複数に分ける使い方)。

interface ClinicalNoteFormProps {
  initialValues: ClinicalNoteFormValues;
  // 確定(final)・修正済み(amended)の編集ではステータス選択を出さない(保存で amended 固定)。
  statusLocked?: boolean;
  onSubmit: (values: ClinicalNoteFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  validationError?: string | null;
  submitLabel?: string;
}

export function ClinicalNoteForm({
  initialValues,
  statusLocked = false,
  onSubmit,
  submitting,
  submitError,
  validationError,
  submitLabel = "登録",
}: ClinicalNoteFormProps) {
  const [values, setValues] = useState<ClinicalNoteFormValues>(initialValues);
  // セクション追加セレクトの選択値(追加ボタンを押すまで反映しない)
  const [addCode, setAddCode] = useState<SectionCode>(SECTION_OPTIONS[0].code);

  function update<K extends keyof ClinicalNoteFormValues>(key: K, value: ClinicalNoteFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function updateSection(uid: string, patch: Partial<{ code: SectionCode; html: string }>) {
    setValues((v) => ({
      ...v,
      sections: v.sections.map((s) => (s.uid === uid ? { ...s, ...patch } : s)),
    }));
  }

  function removeSection(uid: string) {
    setValues((v) => ({ ...v, sections: v.sections.filter((s) => s.uid !== uid) }));
  }

  function moveSection(uid: string, delta: -1 | 1) {
    setValues((v) => {
      const index = v.sections.findIndex((s) => s.uid === uid);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= v.sections.length) return v;
      const sections = [...v.sections];
      [sections[index], sections[target]] = [sections[target], sections[index]];
      return { ...v, sections };
    });
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit(values);
  }

  return (
    <form className="patient-form clinical-note-form" onSubmit={handleSubmit}>
      <ErrorBanner error={submitError} />
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}

      <fieldset>
        <legend>記録情報</legend>
        <label>
          タイトル
          <input
            type="text"
            value={values.title}
            onChange={(e) => update("title", e.target.value)}
            placeholder="例: 定期外来"
          />
        </label>
        <label>
          記録日時
          <input
            type="datetime-local"
            value={values.date}
            onChange={(e) => update("date", e.target.value)}
          />
        </label>
        {!statusLocked && (
          <label>
            ステータス
            <select
              value={values.status}
              onChange={(e) => update("status", e.target.value as "preliminary" | "final")}
            >
              <option value="preliminary">下書き</option>
              <option value="final">確定</option>
            </select>
          </label>
        )}
      </fieldset>

      <fieldset className="clinical-note-form__sections">
        <legend>セクション</legend>
        {values.sections.length === 0 && (
          <p className="patient-table__empty">セクションがありません。下の「追加」から追加してください。</p>
        )}
        {values.sections.map((section, index) => (
          // key は uid。並べ替えでもエディタのインスタンスが section に追随する。
          <div key={section.uid} className="clinical-note-section">
            {/* セクション種別・並べ替え・削除はエディタの操作バーに同居させる
                (枠を入れ子にしないため)。 */}
            <RichTextEditor
              initialHtml={section.html}
              onChange={(html) => updateSection(section.uid, { html })}
              leading={
                <select
                  value={section.code}
                  onChange={(e) => updateSection(section.uid, { code: e.target.value as SectionCode })}
                  aria-label="セクション種別"
                >
                  {SECTION_OPTIONS.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.title}
                    </option>
                  ))}
                </select>
              }
              trailing={
                <div className="clinical-note-section__actions">
                  <button
                    type="button"
                    onClick={() => moveSection(section.uid, -1)}
                    disabled={index === 0}
                    title="上へ移動"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveSection(section.uid, 1)}
                    disabled={index === values.sections.length - 1}
                    title="下へ移動"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => removeSection(section.uid)}
                    title="セクションを削除"
                  >
                    削除
                  </button>
                </div>
              }
            />
          </div>
        ))}

        <div className="clinical-note-form__add">
          <select value={addCode} onChange={(e) => setAddCode(e.target.value as SectionCode)}>
            {SECTION_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.title}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => update("sections", [...values.sections, newSectionDraft(addCode)])}
          >
            + セクション追加
          </button>
        </div>
      </fieldset>

      <div className="prescription-form__submit">
        <button type="submit" disabled={submitting}>
          {submitting ? "送信中..." : submitLabel}
        </button>
      </div>
    </form>
  );
}
