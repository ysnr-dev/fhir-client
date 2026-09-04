import { makeFieldUpdater } from "../lib/form";
import { useState, type FormEvent } from "react";
import { emptyPatientForm, type PatientFormValues } from "../fhir/patientHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { NameKanjiInput } from "./NameKanjiInput";
import { PostalCodeInput } from "./PostalCodeInput";

interface PatientFormProps {
  initialValues?: PatientFormValues;
  onSubmit: (values: PatientFormValues) => void;
  submitting: boolean;
  submitError?: unknown;
  submitLabel: string;
  /** 患者番号を空欄のまま登録できるようにする(登録時に自動採番される)。 */
  autoNumber?: boolean;
}

export function PatientForm({
  initialValues,
  onSubmit,
  submitting,
  submitError,
  submitLabel,
  autoNumber = false,
}: PatientFormProps) {
  const [values, setValues] = useState<PatientFormValues>(initialValues ?? emptyPatientForm);
  const [validationError, setValidationError] = useState<string | null>(null);

  const update = makeFieldUpdater(setValues);

  // 郵便番号から引けた住所。番地方書は町域に続けて手入力するので、
  // 既に何か書かれていれば触らない。
  function applyPostalAddress(address: { prefecture: string; city: string; town: string }) {
    setValues((current) => ({
      ...current,
      prefecture: address.prefecture,
      city: address.city,
      addressLine: current.addressLine || address.town,
    }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!autoNumber && !values.identifierValue.trim()) {
      setValidationError("患者番号は必須です。");
      return;
    }
    setValidationError(null);
    onSubmit(values);
  }

  return (
    <form className="patient-form" onSubmit={handleSubmit}>
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={submitError} />

      <fieldset>
        <legend>{autoNumber ? "患者番号" : "患者番号(必須)"}</legend>
        <label>
          番号
          <input
            type="text"
            value={values.identifierValue}
            onChange={(e) => update("identifierValue", e.target.value)}
            placeholder={autoNumber ? "空欄なら自動採番" : undefined}
            required={!autoNumber}
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>氏名(漢字)</legend>
        <label>
          {"姓"}
          <NameKanjiInput
            value={values.familyKanji}
            onChange={(v) => update("familyKanji", v)}
            kana={values.familyKana}
            onKanaChange={(v) => update("familyKana", v)}
          />
        </label>
        <label>
          {"名"}
          <NameKanjiInput
            value={values.givenKanji}
            onChange={(v) => update("givenKanji", v)}
            kana={values.givenKana}
            onKanaChange={(v) => update("givenKana", v)}
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>氏名(カナ)</legend>
        <label>
          セイ
          <input type="text" value={values.familyKana} onChange={(e) => update("familyKana", e.target.value)} />
        </label>
        <label>
          メイ
          <input type="text" value={values.givenKana} onChange={(e) => update("givenKana", e.target.value)} />
        </label>
      </fieldset>

      <label>
        性別
        <select value={values.gender} onChange={(e) => update("gender", e.target.value as PatientFormValues["gender"])}>
          <option value="">未指定</option>
          <option value="male">男性</option>
          <option value="female">女性</option>
          <option value="other">その他</option>
          <option value="unknown">不明</option>
        </select>
      </label>

      <label>
        生年月日
        <input type="date" value={values.birthDate} onChange={(e) => update("birthDate", e.target.value)} />
      </label>

      <label className="patient-form__checkbox">
        <input type="checkbox" checked={values.active} onChange={(e) => update("active", e.target.checked)} />
        有効(active)
      </label>

      <fieldset className="patient-form__address">
        <legend>住所</legend>
        <div className="patient-form__row">
          <label>
            郵便番号
            <PostalCodeInput
              value={values.postalCode}
              onChange={(v) => update("postalCode", v)}
              onResolved={applyPostalAddress}
            />
          </label>
          <label>
            都道府県
            <input
              type="text"
              value={values.prefecture}
              onChange={(e) => update("prefecture", e.target.value)}
            />
          </label>
          <label>
            市区町村
            <input
              type="text"
              value={values.city}
              onChange={(e) => update("city", e.target.value)}
            />
          </label>
        </div>
        <label>
          番地方書
          <input
            type="text"
            value={values.addressLine}
            onChange={(e) => update("addressLine", e.target.value)}
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>電話番号</legend>
        <label>
          固定電話
          <input
            type="text"
            value={values.homePhone}
            onChange={(e) => update("homePhone", e.target.value)}
          />
        </label>
        <label>
          携帯電話
          <input
            type="text"
            value={values.mobilePhone}
            onChange={(e) => update("mobilePhone", e.target.value)}
          />
        </label>
      </fieldset>

      <label>
        EMail
        <input type="email" value={values.email} onChange={(e) => update("email", e.target.value)} />
      </label>

      <div className="patient-form__actions">
        <button type="submit" disabled={submitting}>
          {submitting ? "送信中..." : submitLabel}
        </button>
      </div>
    </form>
  );
}
