import { useState, type FormEvent } from "react";
import {
  defaultSectionsForMode,
  isEmptyNoteHtml,
  newSectionDraft,
  SECTION_OPTIONS,
  templateHtml,
  type ClinicalNoteFormValues,
  type ClinicalNoteMode,
  type SectionCode,
} from "../fhir/clinicalNoteHelpers";
import { refreshProblemDisplay } from "../fhir/conditionHelpers";
import type { TemplateDraft } from "../fhir/questionnaireResponseHelpers";
import { useProblemOptions } from "../hooks/useProblemOptions";
import { TemplateEntryModal } from "./TemplateEntryModal";
import { ErrorBanner } from "./ErrorBanner";
import { ProblemSelect } from "./ProblemSelect";
import { RichTextEditor } from "./RichTextEditor";

// 診療記録の入力フォーム(Create/Edit 共用)。
// 記載形式は SOAP(複数セクション可変。追加・削除・並べ替え、同じ種別の重複も許す)と
// 自由記載(1 セクションのみ)をラジオで切り替える。

interface ClinicalNoteFormProps {
  // テンプレート記入モーダルが患者リソースと初期値式コンテキストを引くのに使う。
  patientId: string;
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
  patientId,
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
  // テンプレート記入モーダルを開いているセクションの uid。
  const [templateTarget, setTemplateTarget] = useState<string | null>(null);

  // 対象プロブレムの候補。POMR の「#1 糖尿病についての S/O/A/P」を記録 1 件で表す
  // (複数のプロブレムを扱うときは記録を分けて登録する)。
  const problemOptions = useProblemOptions(patientId);

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

  // 記載形式の切替。セクション構成が変わるため本文は引き継がず作り直す。
  // 入力済みのときだけ確認する(誤クリックで長文を失わないため)。
  function changeMode(mode: ClinicalNoteMode) {
    if (mode === values.mode) return;
    const hasContent = values.sections.some((s) => !isEmptyNoteHtml(s.html));
    if (hasContent && !window.confirm("記載形式を切り替えると入力済みの本文は破棄されます。よろしいですか?")) {
      return;
    }
    setValues((v) => ({ ...v, mode, sections: defaultSectionsForMode(mode) }));
  }

  // テンプレート記入モーダルの登録。回答の平文をセクション本文に反映し、
  // 以後このセクションは直接編集不可(テンプレートからのみ編集)にする。
  function applyTemplate(uid: string, draft: TemplateDraft) {
    setValues((v) => ({
      ...v,
      sections: v.sections.map((s) =>
        s.uid === uid
          ? {
              ...s,
              html: templateHtml(draft.questionnaire, draft.response),
              template: { responseId: s.template?.responseId ?? null, draft },
            }
          : s,
      ),
    }));
    setTemplateTarget(null);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // プロブレムの表示名は保存時点の最新にそろえる(病名を変えたあとに記録を編集保存
    // したとき、拡張の display だけ古い名前で残らないように)。
    onSubmit({ ...values, problem: refreshProblemDisplay(values.problem, problemOptions) });
  }

  const isSoap = values.mode === "soap";
  const templateSection = values.sections.find((s) => s.uid === templateTarget);

  return (
    <>
    <form
      className={`patient-form clinical-note-form${isSoap ? "" : " clinical-note-form--free"}`}
      onSubmit={handleSubmit}
    >
      <ErrorBanner error={submitError} />
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}

      <fieldset>
        <legend>記録情報</legend>
        {/* 記載形式。label 直下に input を置く .patient-form label の縦積みが
            ラジオには合わないので、専用のグループで横に並べる。 */}
        <div className="clinical-note-form__mode">
          <span className="clinical-note-form__mode-legend">記載形式</span>
          <div className="clinical-note-form__mode-options">
            <label className="clinical-note-form__mode-option">
              <input
                type="radio"
                name="clinical-note-mode"
                checked={isSoap}
                onChange={() => changeMode("soap")}
              />
              SOAP
            </label>
            <label className="clinical-note-form__mode-option">
              <input
                type="radio"
                name="clinical-note-mode"
                checked={!isSoap}
                onChange={() => changeMode("free")}
              />
              自由記載
            </label>
          </div>
        </div>
        {/* 対象プロブレム。POMR ではプロブレムごとに SOAP を書くので、記録 1 件に
            1 つだけ紐付ける(複数を扱うときは記録を分けて登録する)。 */}
        <label>
          対象プロブレム
          <ProblemSelect
            value={values.problem}
            options={problemOptions}
            onChange={(problem) => update("problem", problem)}
          />
        </label>
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
        <legend>{isSoap ? "セクション" : "本文"}</legend>
        {isSoap && values.sections.length === 0 && (
          <p className="patient-table__empty">セクションがありません。下の「追加」から追加してください。</p>
        )}
        {values.sections.map((section, index) => (
          // key は uid。並べ替えでもエディタのインスタンスが section に追随する。
          <div key={section.uid} className="clinical-note-section">
            {/* セクション種別・並べ替え・削除はエディタの操作バーに同居させる
                (枠を入れ子にしないため)。自由記載は 1 セクション固定なので出さない。 */}
            <RichTextEditor
              // エディタは非制御なので、テンプレート反映で本文が外から変わったら
              // key を変えて作り直す(authored は記入のたびに更新される)。
              key={`${section.uid}:${section.template?.draft?.response.authored ?? (section.template ? "saved" : "plain")}`}
              initialHtml={section.html}
              onChange={(html) => updateSection(section.uid, { html })}
              // テンプレート由来の本文は直接編集させない(回答との差異を防ぐ)。
              editable={!section.template}
              actions={
                <button
                  type="button"
                  className="rich-text-editor__tool"
                  title={
                    section.template
                      ? "テンプレートから再編集"
                      : "テンプレートで記載(以後この本文はテンプレートからのみ編集)"
                  }
                  onClick={() => setTemplateTarget(section.uid)}
                >
                  {section.template ? "テンプレート編集" : "テンプレート"}
                </button>
              }
              leading={
                isSoap ? (
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
                ) : undefined
              }
              trailing={
                isSoap ? (
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
                ) : undefined
              }
            />
          </div>
        ))}

        {isSoap && (
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
        )}
      </fieldset>

      <div className="prescription-form__submit">
        <button type="submit" disabled={submitting}>
          {submitting ? "送信中..." : submitLabel}
        </button>
      </div>
    </form>

    {/* モーダル内の QuestionnaireResponseForm は独自の <form> を持つため、
        外側フォームの子孫に置かない(form の入れ子は不正で、送信が外へ漏れる)。 */}
    {templateSection && (
      <TemplateEntryModal
        patientId={patientId}
        draft={templateSection.template?.draft ?? null}
        responseId={templateSection.template?.responseId ?? null}
        onSubmit={(draft) => applyTemplate(templateSection.uid, draft)}
        onClose={() => setTemplateTarget(null)}
      />
    )}
    </>
  );
}
