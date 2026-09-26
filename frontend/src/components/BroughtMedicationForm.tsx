import { useState, type FormEvent } from "react";
import type { Medicine, MedicineUsage } from "../api/masterClient";
import {
  emptyBroughtMedicationForm,
  emptyBroughtMedicationLine,
  SOURCE_OPTIONS,
  validateBroughtMedicationForm,
  type BroughtMedicationFormValues,
  type BroughtMedicationLineValues,
} from "../fhir/broughtMedicationHelpers";
import { presetUsageFilters } from "../fhir/usageMapping";
import { useValidationError } from "../hooks/useValidationError";
import { makeFieldUpdater } from "../lib/form";
import { ErrorBanner } from "./ErrorBanner";
import { MedicineCautionMarks } from "./MedicineWarnings";
import { MedicineSearchModal } from "./MedicineSearchModal";
import { UsageSearchModal } from "./UsageSearchModal";

// 持参薬の登録・編集フォーム。聞き取りの内容だけを入れる(医薬品の特定・残日数・院内での扱いは
// 薬剤部の鑑別で入れる)。薬剤・用法はマスタで選べなければ名前だけで登録できる。

type ModalState = { kind: "medicine"; index: number } | { kind: "usage"; index: number } | null;

interface BroughtMedicationFormProps {
  initialValues?: BroughtMedicationFormValues;
  onSubmit: (values: BroughtMedicationFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel?: string;
  /** 編集は 1 剤ずつ(行の追加・削除を出さない)。 */
  single?: boolean;
}

export function BroughtMedicationForm({
  initialValues,
  onSubmit,
  submitting,
  submitError,
  submitLabel = "登録",
  single = false,
}: BroughtMedicationFormProps) {
  const [values, setValues] = useState<BroughtMedicationFormValues>(
    () => initialValues ?? emptyBroughtMedicationForm(),
  );
  const [validationError, setValidationError, validationErrorRef] = useValidationError();
  const [modal, setModal] = useState<ModalState>(null);
  const update = makeFieldUpdater(setValues);

  function updateLine(index: number, patch: Partial<BroughtMedicationLineValues>) {
    setValues((v) => ({
      ...v,
      lines: v.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    }));
  }

  function handleMedicineSelect(medicine: Medicine) {
    if (modal?.kind !== "medicine") return;
    updateLine(modal.index, { medicine, name: "" });
    setModal(null);
  }

  function handleUsageSelect(usage: MedicineUsage) {
    if (modal?.kind !== "usage") return;
    updateLine(modal.index, { usage, usageText: "" });
    setModal(null);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validateBroughtMedicationForm(values);
    setValidationError(error);
    if (error) return;
    onSubmit(values);
  }

  return (
    <form className="prescription-form" onSubmit={handleSubmit}>
      {validationError && (
        <div className="error-banner" role="alert" ref={validationErrorRef}>
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={submitError} />

      <fieldset>
        <legend>聞き取り</legend>
        <label>
          情報源
          <select value={values.source} onChange={(e) => update("source", e.target.value)}>
            <option value="">選択してください</option>
            {SOURCE_OPTIONS.map((source) => (
              <option key={source} value={source}>
                {source}
              </option>
            ))}
          </select>
        </label>
        <label>
          処方元
          <input
            type="text"
            value={values.prescriber}
            onChange={(e) => update("prescriber", e.target.value)}
          />
        </label>
        <label>
          最終服用日時
          <input
            type="datetime-local"
            value={values.lastTakenAt}
            onChange={(e) => update("lastTakenAt", e.target.value)}
          />
        </label>
      </fieldset>

      {values.lines.map((line, index) => (
        <fieldset className="rp-card" key={index}>
          <legend>{single ? "持参薬" : `持参薬 ${index + 1}`}</legend>
          <div className="rp-card__usage">
            <span className="rp-card__usage-label">薬剤</span>
            <div className="rp-card__usage-row">
              <button
                type="button"
                className="rp-card__compact-button"
                onClick={() => setModal({ kind: "medicine", index })}
              >
                {line.medicine ? "変更" : "マスタから選択"}
              </button>
              {line.medicine ? (
                <>
                  <span className="rp-card__medicine-name">
                    {line.medicine.name}
                    <MedicineCautionMarks medicine={line.medicine} />
                  </span>
                  <button
                    type="button"
                    className="rp-card__compact-button"
                    onClick={() => updateLine(index, { medicine: null })}
                  >
                    名前で入力
                  </button>
                </>
              ) : (
                <input
                  type="text"
                  aria-label="薬剤名"
                  value={line.name}
                  onChange={(e) => updateLine(index, { name: e.target.value })}
                />
              )}
            </div>
          </div>
          <div className="rp-card__usage">
            <span className="rp-card__usage-label">用法</span>
            <div className="rp-card__usage-row">
              <button
                type="button"
                className="rp-card__compact-button"
                onClick={() => setModal({ kind: "usage", index })}
              >
                {line.usage ? "変更" : "マスタから選択"}
              </button>
              {line.usage ? (
                <>
                  <span className="rp-card__usage-value">{line.usage.usage_name}</span>
                  <button
                    type="button"
                    className="rp-card__compact-button"
                    onClick={() => updateLine(index, { usage: null })}
                  >
                    文字で入力
                  </button>
                </>
              ) : (
                <input
                  type="text"
                  aria-label="用法"
                  value={line.usageText}
                  onChange={(e) => updateLine(index, { usageText: e.target.value })}
                />
              )}
            </div>
          </div>
          <div className="rp-card__usage-row">
            <label>
              1 回量
              <input
                type="number"
                min="0"
                step="any"
                className="rp-card__dose-input"
                value={line.dose}
                onChange={(e) => updateLine(index, { dose: e.target.value })}
              />
            </label>
            <label>
              持参数
              <input
                type="number"
                min="0"
                step="any"
                className="rp-card__dose-input"
                value={line.quantity}
                onChange={(e) => updateLine(index, { quantity: e.target.value })}
              />
            </label>
            <span className="rp-card__medicine-unit">{line.medicine?.unit_name ?? ""}</span>
          </div>
          <label>
            コメント
            <input
              type="text"
              value={line.comment}
              onChange={(e) => updateLine(index, { comment: e.target.value })}
            />
          </label>
          {!single && values.lines.length > 1 && (
            <div className="rp-card__actions rp-card__actions--end">
              <button
                type="button"
                className="rp-card__compact-button"
                onClick={() =>
                  setValues((v) => ({ ...v, lines: v.lines.filter((_, i) => i !== index) }))
                }
              >
                この持参薬を削除
              </button>
            </div>
          )}
        </fieldset>
      ))}

      {!single && (
        <div className="prescription-form__actions">
          <button
            type="button"
            onClick={() =>
              setValues((v) => ({ ...v, lines: [...v.lines, { ...emptyBroughtMedicationLine }] }))
            }
          >
            + 持参薬追加
          </button>
        </div>
      )}

      <div className="prescription-form__submit">
        <button type="submit" disabled={submitting}>
          {submitting ? "送信中..." : submitLabel}
        </button>
      </div>

      {modal?.kind === "medicine" && (
        <MedicineSearchModal onSelect={handleMedicineSelect} onClose={() => setModal(null)} />
      )}
      {modal?.kind === "usage" && (
        <UsageSearchModal
          onSelect={handleUsageSelect}
          onClose={() => setModal(null)}
          initialFilters={presetUsageFilters(values.lines[modal.index]?.medicine ?? undefined)}
        />
      )}
    </form>
  );
}
