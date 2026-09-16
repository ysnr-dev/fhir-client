import { useState, type FormEvent, type KeyboardEvent } from "react";
import {
  questionnaireResponsePlainText,
  type TemplateBinding,
} from "../fhir/questionnaireResponseHelpers";
import {
  RAD_REPORT_STATUS_OPTIONS,
  willBecomeAmended,
  type RadReportFormValues,
} from "../fhir/radReportHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { RadReportImagesEditor } from "./RadReportImagesEditor";
import { TemplateEntryModal } from "./TemplateEntryModal";
import { TemplateTextField } from "./TemplateTextField";

// 読影レポートの入力(docs/rad-report-design.md §4.1)。放射線検査一覧とカルテの双方から
// RadReportEntryModal 経由で使う。
//
// 画像欄はファイルのドロップ・貼り付けを受けるので <form> の外に置き、登録ボタンは
// form 属性で本文のフォームに結び付ける(描き込み・テンプレート記入のモーダルも
// フォームの子孫にしない。Modal は非ポータルで、form の入れ子は送信が外へ漏れる)。

const FORM_ID = "rad-report-form";

type TemplateField = "findings" | "conclusion";

export function RadReportForm({
  patientId,
  initialValues,
  defaultFindingsCanonical,
  onSubmit,
  submitting,
  submitError,
  submitLabel = "登録",
}: {
  patientId: string;
  initialValues: RadReportFormValues;
  /** 所見の既定テンプレート(撮影項目マスタ)。 */
  defaultFindingsCanonical?: string;
  onSubmit: (values: RadReportFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel?: string;
}) {
  const [values, setValues] = useState<RadReportFormValues>(initialValues);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [templateField, setTemplateField] = useState<TemplateField | null>(null);

  function patch(next: Partial<RadReportFormValues>) {
    setValues((current) => ({ ...current, ...next }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!values.findings.trim() && !values.conclusion.trim() && values.images.length === 0) {
      setValidationError("所見・診断・画像のいずれかを入力してください。");
      return;
    }
    if (values.reportStatus === "final" && !values.conclusion.trim()) {
      setValidationError("最終報告には診断が必要です。");
      return;
    }
    if (values.criticalFinding && !values.criticalFindingText.trim()) {
      setValidationError("重要所見の要点を入力してください。");
      return;
    }
    setValidationError(null);
    onSubmit(values);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    // input 上での Enter による暗黙の送信を止める(他のフォームと同じ)。
    if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault();
  }

  const templateBinding: TemplateBinding | null =
    templateField === "findings"
      ? values.findingsTemplate
      : templateField === "conclusion"
        ? values.conclusionTemplate
        : null;
  const amended = willBecomeAmended(values);

  return (
    <>
      <div className="prescription-form rad-report-form">
        {validationError && (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">{validationError}</p>
          </div>
        )}
        {imageError && (
          <div className="error-banner" role="alert">
            <p className="error-banner__line error-banner__line--error">{imageError}</p>
          </div>
        )}
        <ErrorBanner error={submitError} />

        <form
          id={FORM_ID}
          className="prescription-form"
          onSubmit={handleSubmit}
          onKeyDown={handleKeyDown}
        >
          <fieldset>
            <legend>読影</legend>
            <label>
              報告区分
              <select
                value={values.reportStatus}
                onChange={(e) =>
                  patch({ reportStatus: e.target.value as RadReportFormValues["reportStatus"] })
                }
              >
                {RAD_REPORT_STATUS_OPTIONS.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.display}
                  </option>
                ))}
              </select>
            </label>
            <TemplateTextField
              label="所見"
              className="patho-long-text"
              rows={10}
              value={values.findings}
              template={values.findingsTemplate}
              onChange={(findings) => patch({ findings })}
              onOpenTemplate={() => setTemplateField("findings")}
              onClearTemplate={() => patch({ findingsTemplate: null })}
            />
            <TemplateTextField
              label="診断"
              className="patho-long-text"
              rows={4}
              value={values.conclusion}
              template={values.conclusionTemplate}
              onChange={(conclusion) => patch({ conclusion })}
              onOpenTemplate={() => setTemplateField("conclusion")}
              onClearTemplate={() => patch({ conclusionTemplate: null })}
            />
          </fieldset>

          <fieldset>
            <legend>重要所見</legend>
            <label className="rad-report-form__critical">
              <input
                type="checkbox"
                checked={values.criticalFinding}
                onChange={(e) => patch({ criticalFinding: e.target.checked })}
              />
              重要所見あり
            </label>
            {values.criticalFinding && (
              <label className="rad-report-form__critical-text">
                要点
                <input
                  type="text"
                  value={values.criticalFindingText}
                  onChange={(e) => patch({ criticalFindingText: e.target.value })}
                />
              </label>
            )}
          </fieldset>
        </form>

        <fieldset>
          <legend>画像</legend>
          <RadReportImagesEditor
            images={values.images}
            onChange={(images) => patch({ images })}
            onError={setImageError}
          />
        </fieldset>

        <div className="prescription-form__submit">
          <button type="submit" form={FORM_ID} disabled={submitting}>
            {submitting ? "送信中..." : amended ? "訂正報告として更新" : submitLabel}
          </button>
        </div>
      </div>

      {templateField && (
        <TemplateEntryModal
          patientId={patientId}
          draft={templateBinding?.draft ?? null}
          responseId={templateBinding?.responseId ?? null}
          defaultCanonical={templateField === "findings" ? defaultFindingsCanonical : undefined}
          onSubmit={(draft) => {
            const text = questionnaireResponsePlainText(draft.questionnaire, draft.response);
            // 保存済みの回答を再編集した場合は同じ id へ書き戻す(id は保存時に使う)。
            const binding: TemplateBinding = { responseId: templateBinding?.responseId ?? null, draft };
            patch(
              templateField === "findings"
                ? { findings: text, findingsTemplate: binding }
                : { conclusion: text, conclusionTemplate: binding },
            );
            setTemplateField(null);
          }}
          onClose={() => setTemplateField(null)}
        />
      )}
    </>
  );
}
