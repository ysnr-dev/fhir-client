import { makeFieldUpdater } from "../lib/form";
import { useState, type FormEvent } from "react";
import {
  defaultSectionsForMode,
  isEmptyNoteHtml,
  SECTION_OPTIONS,
  type ClinicalNoteFormValues,
  type ClinicalNoteMode,
} from "../fhir/clinicalNoteHelpers";
import { refreshProblemDisplay } from "../fhir/conditionHelpers";
import { useProblemOptions } from "../hooks/useProblemOptions";
import { ErrorBanner } from "./ErrorBanner";
import { useNoteSectionsEditor } from "./NoteSectionsEditor";
import { ProblemSelect } from "./ProblemSelect";

// 診療記録の入力フォーム(Create/Edit 共用)。
// 記載形式は SOAP(複数セクション可変。追加・削除・並べ替え、同じ種別の重複も許す)と
// 自由記載(1 セクションのみ)をラジオで切り替える。セクションの編集部品は
// 退院時サマリーと共用(NoteSectionsEditor)。

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
  const editor = useNoteSectionsEditor({
    patientId,
    sections: values.sections,
    onChange: (sections) => update("sections", sections),
    sectionOptions: SECTION_OPTIONS,
    arrangeable: isSoap,
  });

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

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // プロブレムの表示名は保存時点の最新にそろえる(病名を変えたあとに記録を編集保存
    // したとき、拡張の display だけ古い名前で残らないように)。
    onSubmit({ ...values, problem: refreshProblemDisplay(values.problem, problemOptions) });
  }

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
        {editor.sections}
      </fieldset>

      <div className="prescription-form__submit">
        <button type="submit" disabled={submitting}>
          {submitting ? "送信中..." : submitLabel}
        </button>
      </div>
    </form>

    {/* モーダルは form の外に置く(NoteSectionsEditor 参照)。 */}
    {editor.modals}
    </>
  );
}
