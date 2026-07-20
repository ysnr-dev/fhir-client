import { useState, type FormEvent } from "react";
import type { Medicine, MedicineUsage } from "../api/masterClient";
import {
  CATEGORY_OPTIONS,
  emptyMedicineLine,
  emptyPrescriptionForm,
  emptyRp,
  SETTING_OPTIONS,
  type MedicineLineValues,
  type PrescriptionFormValues,
  type PrescriptionSetting,
  type RpValues,
} from "../fhir/prescriptionHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { MedicineSearchModal } from "./MedicineSearchModal";
import { UsageSearchModal } from "./UsageSearchModal";

interface PrescriptionFormProps {
  onSubmit: (values: PrescriptionFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
}

type ModalState =
  | { kind: "usage"; rpIndex: number }
  | { kind: "medicine"; rpIndex: number; medIndex: number }
  | null;

export function PrescriptionForm({ onSubmit, submitting, submitError }: PrescriptionFormProps) {
  const [values, setValues] = useState<PrescriptionFormValues>(emptyPrescriptionForm);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);

  function update<K extends keyof PrescriptionFormValues>(key: K, value: PrescriptionFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function updateRp(rpIndex: number, patch: Partial<RpValues>) {
    setValues((v) => ({
      ...v,
      rps: v.rps.map((rp, i) => (i === rpIndex ? { ...rp, ...patch } : rp)),
    }));
  }

  function updateMedicine(rpIndex: number, medIndex: number, patch: Partial<MedicineLineValues>) {
    setValues((v) => ({
      ...v,
      rps: v.rps.map((rp, i) =>
        i === rpIndex
          ? { ...rp, medicines: rp.medicines.map((m, j) => (j === medIndex ? { ...m, ...patch } : m)) }
          : rp,
      ),
    }));
  }

  function handleSettingChange(setting: PrescriptionSetting) {
    setValues((v) => ({ ...v, setting, category: "" }));
  }

  function addRp() {
    setValues((v) => ({
      ...v,
      rps: [...v.rps, { ...emptyRp, medicines: [{ ...emptyMedicineLine }] }],
    }));
  }

  function removeRp(rpIndex: number) {
    setValues((v) => ({ ...v, rps: v.rps.filter((_, i) => i !== rpIndex) }));
  }

  function addMedicine(rpIndex: number) {
    setValues((v) => ({
      ...v,
      rps: v.rps.map((rp, i) =>
        i === rpIndex ? { ...rp, medicines: [...rp.medicines, { ...emptyMedicineLine }] } : rp,
      ),
    }));
  }

  function removeMedicine(rpIndex: number, medIndex: number) {
    setValues((v) => ({
      ...v,
      rps: v.rps.map((rp, i) =>
        i === rpIndex ? { ...rp, medicines: rp.medicines.filter((_, j) => j !== medIndex) } : rp,
      ),
    }));
  }

  function handleUsageSelect(usage: MedicineUsage) {
    if (modal?.kind !== "usage") return;
    updateRp(modal.rpIndex, { usage, doseDays: "", doseCount: "" });
    setModal(null);
  }

  function handleMedicineSelect(medicine: Medicine) {
    if (modal?.kind !== "medicine") return;
    updateMedicine(modal.rpIndex, modal.medIndex, { medicine });
    setModal(null);
  }

  function validate(): string | null {
    if (!values.authoredDate) return "処方日は必須です。";
    if (!values.setting) return "入外区分は必須です。";
    if (!values.category) return "処方区分は必須です。";
    if (values.rps.length === 0) return "RPを1件以上登録してください。";

    for (let i = 0; i < values.rps.length; i++) {
      const rp = values.rps[i];
      const rpLabel = `RP${i + 1}`;
      if (!rp.usage) return `${rpLabel}: 用法を選択してください。`;
      if (rp.usage.basic_usage_category === "内服") {
        if (!rp.doseDays || Number(rp.doseDays) < 1) return `${rpLabel}: 投与日数を入力してください。`;
      }
      if (rp.usage.basic_usage_category === "頓服") {
        if (!rp.doseCount || Number(rp.doseCount) < 1) return `${rpLabel}: 投与回数を入力してください。`;
      }
      if (rp.medicines.length === 0) return `${rpLabel}: 医薬品を1件以上登録してください。`;
      for (let j = 0; j < rp.medicines.length; j++) {
        const med = rp.medicines[j];
        if (!med.medicine) return `${rpLabel}: 医薬品を選択してください。`;
        if (!med.dose || Number(med.dose) <= 0) return `${rpLabel}: 用量を入力してください。`;
      }
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

  return (
    <form className="prescription-form" onSubmit={handleSubmit}>
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={submitError} />

      <fieldset>
        <legend>処方共通</legend>
        <label>
          入外区分
          <select
            value={values.setting}
            onChange={(e) => handleSettingChange(e.target.value as PrescriptionSetting)}
          >
            <option value="">選択してください</option>
            {SETTING_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
        <label>
          処方区分
          <select value={values.category} onChange={(e) => update("category", e.target.value)}>
            <option value="">選択してください</option>
            {values.setting &&
              CATEGORY_OPTIONS[values.setting].map((o) => (
                <option key={o.code} value={o.code}>
                  {o.display}
                </option>
              ))}
          </select>
        </label>
        <label>
          処方日
          <input
            type="date"
            value={values.authoredDate}
            onChange={(e) => update("authoredDate", e.target.value)}
          />
        </label>
        <label>
          処方箋コメント
          <input type="text" value={values.comment} onChange={(e) => update("comment", e.target.value)} />
        </label>
      </fieldset>

      {values.rps.map((rp, rpIndex) => (
        <fieldset className="rp-card" key={rpIndex}>
          <legend>{`RP${rpIndex + 1}`}</legend>

          <table className="rp-card__medicines">
            <thead>
              <tr>
                <th>医薬品</th>
                <th>用量</th>
                <th>単位</th>
                <th>薬剤コメント</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rp.medicines.map((med, medIndex) => (
                <tr key={medIndex}>
                  <td>
                    {med.medicine ? (
                      <span>{med.medicine.name}</span>
                    ) : (
                      <span className="rp-card__usage-value--empty">未選択</span>
                    )}{" "}
                    <button
                      type="button"
                      onClick={() => setModal({ kind: "medicine", rpIndex, medIndex })}
                    >
                      {med.medicine ? "変更" : "選択"}
                    </button>
                  </td>
                  <td>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={med.dose}
                      onChange={(e) => updateMedicine(rpIndex, medIndex, { dose: e.target.value })}
                    />
                  </td>
                  <td>{med.medicine?.unit_name ?? "-"}</td>
                  <td>
                    <input
                      type="text"
                      value={med.comment}
                      onChange={(e) => updateMedicine(rpIndex, medIndex, { comment: e.target.value })}
                    />
                  </td>
                  <td>
                    {rp.medicines.length > 1 && (
                      <button type="button" onClick={() => removeMedicine(rpIndex, medIndex)}>
                        削除
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="rp-card__actions">
            <button type="button" onClick={() => addMedicine(rpIndex)}>
              + 医薬品追加
            </button>
          </div>

          <div className="rp-card__usage">
            <label>
              用法
              {rp.usage ? (
                <span className="rp-card__usage-value">{rp.usage.usage_name}</span>
              ) : (
                <span className="rp-card__usage-value rp-card__usage-value--empty">未選択</span>
              )}
            </label>
            <button type="button" onClick={() => setModal({ kind: "usage", rpIndex })}>
              {rp.usage ? "用法を変更" : "用法を選択"}
            </button>
          </div>

          {rp.usage?.basic_usage_category === "内服" && (
            <label>
              投与日数
              <input
                type="number"
                min="1"
                value={rp.doseDays}
                onChange={(e) => updateRp(rpIndex, { doseDays: e.target.value })}
              />
            </label>
          )}
          {rp.usage?.basic_usage_category === "頓服" && (
            <label>
              投与回数
              <input
                type="number"
                min="1"
                value={rp.doseCount}
                onChange={(e) => updateRp(rpIndex, { doseCount: e.target.value })}
              />
            </label>
          )}

          <label>
            用法コメント
            <input
              type="text"
              value={rp.usageComment}
              onChange={(e) => updateRp(rpIndex, { usageComment: e.target.value })}
            />
          </label>

          {values.rps.length > 1 && (
            <div className="rp-card__actions">
              <button type="button" onClick={() => removeRp(rpIndex)}>
                RP削除
              </button>
            </div>
          )}
        </fieldset>
      ))}

      <div className="prescription-form__actions">
        <button type="button" onClick={addRp}>
          + RP追加
        </button>
      </div>

      <div className="prescription-form__submit">
        <button type="submit" disabled={submitting}>
          {submitting ? "送信中..." : "登録"}
        </button>
      </div>

      {modal?.kind === "usage" && (
        <UsageSearchModal onSelect={handleUsageSelect} onClose={() => setModal(null)} />
      )}
      {modal?.kind === "medicine" && (
        <MedicineSearchModal onSelect={handleMedicineSelect} onClose={() => setModal(null)} />
      )}
    </form>
  );
}
