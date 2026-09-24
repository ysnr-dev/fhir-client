import { makeFieldUpdater } from "../lib/form";
import { useState, type FormEvent } from "react";
import {
  useQuestionnaireByCanonical,
  useQuestionnaireOptions,
  useQuestionnaireResponse,
} from "../api/queries";
import {
  defaultSectionsForMode,
  FREE_TEXT_SECTION_CODE,
  isEmptyNoteHtml,
  SECTION_OPTIONS,
  templateHtml,
  type ClinicalNoteFormValues,
  type ClinicalNoteMode,
} from "../fhir/clinicalNoteHelpers";
import { refreshProblemDisplay } from "../fhir/conditionHelpers";
import type { TemplateDraft } from "../fhir/questionnaireResponseHelpers";
import { useProblemOptions } from "../hooks/useProblemOptions";
import { ErrorBanner } from "./ErrorBanner";
import { useNoteSectionsEditor } from "./NoteSectionsEditor";
import { ProblemSelect } from "./ProblemSelect";
import { TemplateEntryForm } from "./TemplateEntryModal";
import { TemplateSelect } from "./TemplateSelect";

// 診療記録の入力フォーム(Create/Edit 共用)。
// 記載形式は SOAP(複数セクション可変。追加・削除・並べ替え、同じ種別の重複も許す)・
// 自由記載(1 セクションのみ)・テンプレート(選んだテンプレートの記入フォームを
// そのまま出し、回答の平文を 1 セクションの本文にする)をラジオで切り替える。
// セクションの編集部品は退院時サマリーと共用(NoteSectionsEditor)。

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

  // 対象プロブレムの候補。POMR の「#1 糖尿病についての S/O/A/P」を記録 1 件で表す
  // (複数のプロブレムを扱うときは記録を分けて登録する)。
  const problemOptions = useProblemOptions(patientId);

  const update = makeFieldUpdater(setValues);

  const isSoap = values.mode === "soap";
  const isTemplate = values.mode === "template";

  // テンプレートモードの唯一のセクションが保存済み QR を指していれば、その再編集
  // (テンプレートは固定)。無ければ新規記入で、テンプレートをここで選ぶ。
  const savedResponseId = isTemplate ? (values.sections[0]?.template?.responseId ?? null) : null;
  const [questionnaireId, setQuestionnaireId] = useState("");
  const templateOptions = useQuestionnaireOptions({ status: "active" });
  const savedResponse = useQuestionnaireResponse(savedResponseId ?? undefined);
  const savedQuestionnaire = useQuestionnaireByCanonical(savedResponse.data?.data.questionnaire);
  const editor = useNoteSectionsEditor({
    patientId,
    sections: values.sections,
    onChange: (sections) => update("sections", sections),
    sectionOptions: SECTION_OPTIONS,
    arrangeable: isSoap,
  });

  // 記載形式の切替。セクション構成が変わるため本文は引き継がず作り直す。
  // 入力済みのときだけ確認する(誤クリックで長文を失わないため)。
  // テンプレートの記入途中は本文(sections)に現れないので、選択の有無で判定する。
  function changeMode(mode: ClinicalNoteMode) {
    if (mode === values.mode) return;
    const hasContent = isTemplate
      ? Boolean(questionnaireId || savedResponseId)
      : values.sections.some((s) => !isEmptyNoteHtml(s.html));
    if (hasContent && !window.confirm("記載形式を切り替えると入力済みの本文は破棄されます。よろしいですか?")) {
      return;
    }
    setQuestionnaireId("");
    setValues((v) => ({ ...v, mode, sections: defaultSectionsForMode(mode) }));
  }

  function submitValues(next: ClinicalNoteFormValues) {
    // プロブレムの表示名は保存時点の最新にそろえる(病名を変えたあとに記録を編集保存
    // したとき、拡張の display だけ古い名前で残らないように)。
    onSubmit({ ...next, problem: refreshProblemDisplay(next.problem, problemOptions) });
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // テンプレートモードの登録は記入フォーム側の送信で行う(記録情報の欄で Enter を
    // 押しても、記入内容を取り込まないまま登録しない)。
    if (isTemplate) return;
    submitValues(values);
  }

  // テンプレートモードの登録。回答の平文を唯一のセクションの本文にし、記録ごと保存する。
  // 見出しはテンプレート名(「自由記載」ではなく何を記入したかが分かるように)。
  function handleTemplateSubmit(draft: TemplateDraft) {
    const current = values.sections[0];
    const next: ClinicalNoteFormValues = {
      ...values,
      sections: [
        {
          uid: current?.uid ?? crypto.randomUUID(),
          code: FREE_TEXT_SECTION_CODE,
          html: templateHtml(draft.questionnaire, draft.response),
          template: { responseId: current?.template?.responseId ?? null, draft },
          title: draft.questionnaire.title ?? draft.questionnaire.name,
        },
      ],
    };
    setValues(next);
    submitValues(next);
  }

  return (
    <>
    <form
      className={`patient-form clinical-note-form${values.mode === "free" ? " clinical-note-form--free" : ""}`}
      onSubmit={handleSubmit}
    >
      <ErrorBanner error={submitError} />
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}

      <fieldset className="clinical-note-form__info">
        <legend>記録情報</legend>
        {/* 行の構成は固定(記載形式[+テンプレート選択] / タイトル・対象プロブレム /
            記録日時・ステータス)。記載形式の行にはテンプレート選択以外を並べない。 */}
        <div className="clinical-note-form__row">
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
                  checked={values.mode === "free"}
                  onChange={() => changeMode("free")}
                />
                自由記載
              </label>
              <label className="clinical-note-form__mode-option">
                <input
                  type="radio"
                  name="clinical-note-mode"
                  checked={isTemplate}
                  onChange={() => changeMode("template")}
                />
                テンプレート
              </label>
            </div>
          </div>
          {isTemplate && (
            <div className="clinical-note-form__template">
              {savedResponseId ? (
                // 保存済みの回答の再編集ではテンプレートを変えられない(別の様式の回答になるため)。
                <span className="clinical-note-form__template-name">
                  {savedQuestionnaire.questionnaire?.title ??
                    savedQuestionnaire.questionnaire?.name ??
                    "読み込み中..."}
                </span>
              ) : templateOptions.isLoading ? (
                <span>読み込み中...</span>
              ) : templateOptions.questionnaires.length === 0 ? (
                <span className="patient-table__empty">有効なテンプレートがありません。</span>
              ) : (
                <TemplateSelect
                  questionnaires={templateOptions.questionnaires}
                  value={questionnaireId}
                  onChange={setQuestionnaireId}
                />
              )}
            </div>
          )}
        </div>
        <div className="clinical-note-form__row">
          <label>
            タイトル
            <input
              type="text"
              value={values.title}
              onChange={(e) => update("title", e.target.value)}
              placeholder="例: 定期外来"
            />
          </label>
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
        </div>
        <div className="clinical-note-form__row">
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
        </div>
      </fieldset>

      {!isTemplate && (
        <>
          <fieldset className="clinical-note-form__sections">
            <legend>{isSoap ? "セクション" : "本文"}</legend>
            {editor.sections}
          </fieldset>

          <div className="prescription-form__submit">
            <button type="submit" disabled={submitting}>
              {submitting ? "送信中..." : submitLabel}
            </button>
          </div>
        </>
      )}
    </form>

    {/* テンプレートの記入フォームは独自の <form> を持つので、記録のフォームの外に置く
        (入れ子にすると送信が外側へ漏れる)。登録ボタンはこちらの送信が兼ねる。 */}
    {isTemplate && (
      <div className="clinical-note-form__template-entry">
        {savedResponseId || questionnaireId ? (
          <TemplateEntryForm
            patientId={patientId}
            draft={null}
            responseId={savedResponseId}
            questionnaireId={questionnaireId}
            extractsObservations
            submitLabel={submitLabel}
            submitting={submitting}
            onSubmit={handleTemplateSubmit}
          />
        ) : (
          <ErrorBanner error={templateOptions.error} />
        )}
      </div>
    )}

    {/* モーダルは form の外に置く(NoteSectionsEditor 参照)。 */}
    {editor.modals}
    </>
  );
}
