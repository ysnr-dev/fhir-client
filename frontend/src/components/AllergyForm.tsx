import { makeFieldUpdater } from "../lib/form";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import type { JfagyAllergen, JfagyDrug, Medicine } from "../api/masterClient";
import {
  allergenDomainLabel,
  allergenFromJfagyDrug,
  allergenFromMedicine,
  CLINICAL_STATUS_OPTIONS,
  CRITICALITY_OPTIONS,
  emptyAllergyForm,
  TYPE_OPTIONS,
  VERIFICATION_STATUS_OPTIONS,
  type AllergyClinicalStatus,
  type AllergyCriticality,
  type AllergyFormValues,
  type AllergyType,
  type AllergyVerificationStatus,
} from "../fhir/allergyHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { AllergenSearchModal } from "./AllergenSearchModal";
import { JfagyDrugSearchModal } from "./JfagyDrugSearchModal";
import { MedicineSearchModal } from "./MedicineSearchModal";

// アレルゲンの選び方。allergen は J-FAGY コード表(食品・非食品と医薬品ダミー)、
// medicine は医薬品マスタ(銘柄名)または剤形・規格・銘柄不明コードマスタから選ぶ。
type AllergenSource = "allergen" | "medicine";
// 医薬品の指定方法。brand: 銘柄名(YCM+YJコード)、unknown: 剤形・規格・銘柄不明(GCM)。
type MedicineCodeMode = "brand" | "unknown";

function sourceOf(allergen: JfagyAllergen | null): AllergenSource {
  const code = allergen?.jfagy_code ?? "";
  return code.startsWith("YCM") || code.startsWith("GCM") ? "medicine" : "allergen";
}

interface AllergyFormProps {
  initialValues?: AllergyFormValues;
  onSubmit: (values: AllergyFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel?: string;
}

export function AllergyForm({
  initialValues,
  onSubmit,
  submitting,
  submitError,
  submitLabel = "登録",
}: AllergyFormProps) {
  const [values, setValues] = useState<AllergyFormValues>(initialValues ?? emptyAllergyForm);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [source, setSource] = useState<AllergenSource>(() =>
    sourceOf(initialValues?.allergen ?? null),
  );
  const [medicineMode, setMedicineMode] = useState<MedicineCodeMode>(() =>
    initialValues?.allergen?.jfagy_code.startsWith("GCM") ? "unknown" : "brand",
  );
  const [openModal, setOpenModal] = useState<null | "allergen" | "brand" | "unknown">(null);

  const update = makeFieldUpdater(setValues);

  function handleSourceChange(next: AllergenSource) {
    setSource(next);
    // 区分と合わない選択済みアレルゲンを残すと、登録内容が画面の区分表示と食い違うため捨てる。
    if (values.allergen && sourceOf(values.allergen) !== next) update("allergen", null);
  }

  function handleAllergenSelect(allergen: JfagyAllergen) {
    update("allergen", allergen);
    setValidationError(null);
    setOpenModal(null);
  }

  function handleMedicineSelect(medicine: Medicine) {
    const allergen = allergenFromMedicine(medicine);
    setOpenModal(null);
    if (!allergen) {
      setValidationError(
        "選択した医薬品にはYJコードが登録されていないため、アレルゲンとして記録できません。剤形・規格・銘柄不明から成分で選択してください。",
      );
      return;
    }
    update("allergen", allergen);
    setValidationError(null);
  }

  function handleJfagyDrugSelect(drug: JfagyDrug) {
    handleAllergenSelect(allergenFromJfagyDrug(drug));
  }

  function validate(): string | null {
    if (!values.allergen) {
      return source === "medicine" ? "医薬品を選択してください。" : "アレルゲンを選択してください。";
    }
    if (!values.recordedDate) return "記録日は必須です。";
    if (values.onsetDate && values.onsetDate > values.recordedDate) {
      return "発症日は記録日以前の日付を入力してください。";
    }
    return null;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const error = validate();
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    onSubmit(values);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    // input 上での Enter による暗黙の form submit を抑止する。
    if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
      e.preventDefault();
    }
  }

  const domainLabel = allergenDomainLabel(values.allergen?.jfagy_code);

  return (
    <form className="prescription-form" onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={submitError} />

      <fieldset>
        <legend>アレルゲン</legend>

        <div className="clinical-note-form__mode">
          <span className="clinical-note-form__mode-legend">区分</span>
          <div className="clinical-note-form__mode-options">
            {(
              [
                ["allergen", "アレルゲン(食品・環境など)"],
                ["medicine", "医薬品"],
              ] as const
            ).map(([value, label]) => (
              <label className="clinical-note-form__mode-option" key={value}>
                <input
                  type="radio"
                  name="allergy-source"
                  checked={source === value}
                  onChange={() => handleSourceChange(value)}
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        {source === "medicine" && (
          <div className="clinical-note-form__mode allergy-form__medicine-mode">
            <span className="clinical-note-form__mode-legend">指定方法</span>
            <div className="clinical-note-form__mode-options">
              {(
                [
                  ["brand", "銘柄名"],
                  ["unknown", "剤形・規格・銘柄不明"],
                ] as const
              ).map(([value, label]) => (
                <label className="clinical-note-form__mode-option" key={value}>
                  <input
                    type="radio"
                    name="allergy-medicine-mode"
                    checked={medicineMode === value}
                    onChange={() => setMedicineMode(value)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="condition-form__row">
          <label>
            {source === "medicine" ? "医薬品" : "アレルゲン"}
            {values.allergen ? (
              <span className="rp-card__usage-value">{values.allergen.name}</span>
            ) : (
              <span className="rp-card__usage-value rp-card__usage-value--empty">未選択</span>
            )}
          </label>
          <button
            type="button"
            onClick={() =>
              setOpenModal(source === "allergen" ? "allergen" : medicineMode)
            }
          >
            {source === "medicine"
              ? values.allergen
                ? "医薬品を変更"
                : "医薬品を選択"
              : values.allergen
                ? "アレルゲンを変更"
                : "アレルゲンを選択"}
          </button>
        </div>

        {values.allergen && (
          <p className="condition-form__preview">
            登録されるアレルゲン: <strong>{values.allergen.name}</strong>
            {domainLabel && ` (分類: ${domainLabel})`}
          </p>
        )}
      </fieldset>

      <fieldset>
        <legend>詳細</legend>
        <label>
          タイプ
          <select value={values.type} onChange={(e) => update("type", e.target.value as AllergyType)}>
            {TYPE_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
        <label>
          重篤化リスク
          <select
            value={values.criticality}
            onChange={(e) => update("criticality", e.target.value as AllergyCriticality)}
          >
            {CRITICALITY_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
        <label>
          臨床状態
          <select
            value={values.clinicalStatus}
            onChange={(e) => update("clinicalStatus", e.target.value as AllergyClinicalStatus)}
          >
            {CLINICAL_STATUS_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
        <label>
          確からしさ
          <select
            value={values.verificationStatus}
            onChange={(e) => update("verificationStatus", e.target.value as AllergyVerificationStatus)}
          >
            {VERIFICATION_STATUS_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <fieldset>
        <legend>経過・メモ</legend>
        <label>
          発症日
          <input
            type="date"
            value={values.onsetDate}
            onChange={(e) => update("onsetDate", e.target.value)}
          />
        </label>
        <label>
          記録日
          <input
            type="date"
            value={values.recordedDate}
            onChange={(e) => update("recordedDate", e.target.value)}
          />
        </label>
        <label className="prescription-form__comment-field">
          症状(蕁麻疹、呼吸困難など)
          <input
            type="text"
            value={values.reaction}
            onChange={(e) => update("reaction", e.target.value)}
          />
        </label>
        <label className="prescription-form__comment-field">
          メモ
          <input type="text" value={values.note} onChange={(e) => update("note", e.target.value)} />
        </label>
      </fieldset>

      <div className="prescription-form__submit">
        <button type="submit" disabled={submitting}>
          {submitting ? "送信中..." : submitLabel}
        </button>
      </div>

      {openModal === "allergen" && (
        <AllergenSearchModal onSelect={handleAllergenSelect} onClose={() => setOpenModal(null)} />
      )}
      {openModal === "brand" && (
        <MedicineSearchModal
          title="医薬品を選択(銘柄名)"
          onSelect={handleMedicineSelect}
          onClose={() => setOpenModal(null)}
        />
      )}
      {openModal === "unknown" && (
        <JfagyDrugSearchModal onSelect={handleJfagyDrugSelect} onClose={() => setOpenModal(null)} />
      )}
    </form>
  );
}
