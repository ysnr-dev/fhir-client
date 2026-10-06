import { useState, type FormEvent } from "react";
import { refreshProblemDisplay } from "../fhir/conditionHelpers";
import { SETTING_OPTIONS, type PrescriptionSetting } from "../fhir/prescriptionHelpers";
import {
  GUIDANCE_CONDITION_OPTIONS,
  GUIDANCE_KIND_OPTIONS,
  emptyMedicationGuidanceOrderForm,
  validateMedicationGuidanceOrderForm,
  type MedicationGuidanceCondition,
  type MedicationGuidanceKind,
  type MedicationGuidanceOrderFormValues,
} from "../fhir/medicationGuidanceOrderHelpers";
import { makeFieldUpdater } from "../lib/form";
import { useProblemOptions } from "../hooks/useProblemOptions";
import { useValidationError } from "../hooks/useValidationError";
import { ErrorBanner } from "./ErrorBanner";
import { ProblemSelect } from "./ProblemSelect";

// 服薬指導オーダーの入力フォーム(docs/medication-guidance-order-design.md)。栄養指導と同じく
// 明細も伝票レイアウトも無いので 1 枚で完結する。指導区分・指導条件は診療報酬の区分に沿った
// 固定の分類なので、DB マスタを持たずフロントの定数から選択肢を出す。

interface MedicationGuidanceOrderFormProps {
  patientId: string;
  initialValues?: MedicationGuidanceOrderFormValues;
  onSubmit: (values: MedicationGuidanceOrderFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel?: string;
}

export function MedicationGuidanceOrderForm({
  patientId,
  initialValues,
  onSubmit,
  submitting,
  submitError,
  submitLabel = "登録",
}: MedicationGuidanceOrderFormProps) {
  const [values, setValues] = useState<MedicationGuidanceOrderFormValues>(
    initialValues ?? emptyMedicationGuidanceOrderForm(""),
  );
  const [validationError, setValidationError, validationErrorRef] = useValidationError();
  const [commentOpen, setCommentOpen] = useState(Boolean(initialValues?.comment));
  const problemOptions = useProblemOptions(patientId);
  const update = makeFieldUpdater(setValues);

  function toggleCondition(code: MedicationGuidanceCondition, checked: boolean) {
    setValues((v) => ({
      ...v,
      conditions: checked
        ? GUIDANCE_CONDITION_OPTIONS.map((o) => o.code).filter((c) => c === code || v.conditions.includes(c))
        : v.conditions.filter((c) => c !== code),
    }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validateMedicationGuidanceOrderForm(values);
    setValidationError(error);
    if (error) return;
    onSubmit({ ...values, problem: refreshProblemDisplay(values.problem, problemOptions) });
  }

  return (
    <form className="prescription-form medication-guidance-form" onSubmit={handleSubmit}>
      {validationError && (
        <div className="error-banner" role="alert" ref={validationErrorRef}>
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={submitError} />

      <fieldset>
        <legend>指導内容</legend>
        <label>
          指導区分 *
          <select
            value={values.kind}
            onChange={(e) => update("kind", e.target.value as MedicationGuidanceKind)}
            required
          >
            <option value="">選択してください</option>
            {GUIDANCE_KIND_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
        <div className="medication-guidance-form__wide">
          <span className="medication-guidance-form__label">指導条件</span>
          <div className="rehab-order__therapy-types">
            {GUIDANCE_CONDITION_OPTIONS.map((o) => (
              <label key={o.code} className="rehab-order__therapy-type">
                <input
                  type="checkbox"
                  checked={values.conditions.includes(o.code)}
                  onChange={(e) => toggleCondition(o.code, e.target.checked)}
                />
                {o.display}
              </label>
            ))}
          </div>
        </div>
        <label className="medication-guidance-form__wide">
          対象薬剤
          <input type="text" value={values.targetDrugs} onChange={(e) => update("targetDrugs", e.target.value)} />
        </label>
        <label className="medication-guidance-form__wide">
          指導してほしいこと
          <textarea rows={3} value={values.purpose} onChange={(e) => update("purpose", e.target.value)} />
        </label>
      </fieldset>

      {/* 期間。終了日を入れなければ継続で、部門一覧の「終了」か退院で終わる。 */}
      <fieldset>
        <legend>期間</legend>
        <label>
          開始日 *
          <input type="date" value={values.startDate} onChange={(e) => update("startDate", e.target.value)} required />
        </label>
        <label>
          終了日
          <input type="date" value={values.endDate} onChange={(e) => update("endDate", e.target.value)} />
        </label>
      </fieldset>

      <fieldset>
        <legend>依頼共通</legend>
        <label>
          対象プロブレム
          <ProblemSelect
            value={values.problem}
            options={problemOptions}
            onChange={(problem) => update("problem", problem)}
          />
        </label>
        <label>
          入外区分
          <select value={values.setting} onChange={(e) => update("setting", e.target.value as PrescriptionSetting)}>
            <option value="">選択してください</option>
            {SETTING_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
        {commentOpen ? (
          <div className="prescription-form__comment-field">
            <label>
              薬剤部への連絡事項
              <input type="text" value={values.comment} onChange={(e) => update("comment", e.target.value)} />
            </label>
            <button
              type="button"
              className="rp-card__icon-button"
              title="薬剤部への連絡事項を削除"
              aria-label="薬剤部への連絡事項を削除"
              onClick={() => {
                setCommentOpen(false);
                update("comment", "");
              }}
            >
              ×
            </button>
          </div>
        ) : (
          <div className="prescription-form__comment-toggle">
            <button type="button" className="comment-add-button" onClick={() => setCommentOpen(true)}>
              ＋薬剤部への連絡事項
            </button>
          </div>
        )}
      </fieldset>

      <div className="prescription-form__actions">
        <button type="submit" disabled={submitting}>
          {submitting ? "保存中..." : submitLabel}
        </button>
      </div>
    </form>
  );
}
