import { makeFieldUpdater } from "../lib/form";
import { useState, type FormEvent } from "react";
import {
  CONTACT_RELATIONSHIP_OPTIONS,
  emptyPatientContact,
  emptyPatientForm,
  LANGUAGE_OPTIONS,
  type PatientContactValues,
  type PatientFormValues,
} from "../fhir/patientHelpers";
import { organizationDisplayName } from "../fhir/organizationHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { NameKanjiInput } from "./NameKanjiInput";
import { OrganizationSearchModal } from "./OrganizationSearchModal";
import { PostalCodeInput } from "./PostalCodeInput";
import { PractitionerSearchModal } from "./PractitionerSearchModal";

// 患者の登録・編集フォーム。入力欄の並びは新患登録モーダル
// (NewPatientCheckInModal)と共通のレイアウト(.patient-fields)にしてある。
// 窓口が同じ患者属性を同じ並びで書けるようにするため。

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
  const [openModal, setOpenModal] = useState<null | "organization" | "practitioner">(null);

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

  function updateContact(index: number, next: PatientContactValues) {
    setValues((current) => ({
      ...current,
      contacts: current.contacts.map((c, i) => (i === index ? next : c)),
    }));
  }

  function addContact() {
    setValues((current) => ({ ...current, contacts: [...current.contacts, emptyPatientContact] }));
  }

  function removeContact(index: number) {
    setValues((current) => ({
      ...current,
      contacts: current.contacts.filter((_, i) => i !== index),
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
    <form className="patient-fields" onSubmit={handleSubmit}>
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <ErrorBanner error={submitError} />

      <div className="patient-fields__row">
        <label className="patient-fields__field--number">
          <span>
            患者番号
            {!autoNumber && <span className="patient-fields__required">必須</span>}
          </span>
          <input
            type="text"
            value={values.identifierValue}
            onChange={(e) => update("identifierValue", e.target.value)}
            placeholder={autoNumber ? "空欄なら自動採番" : undefined}
            required={!autoNumber}
          />
        </label>
      </div>

      <div className="patient-fields__row">
        <span className="patient-fields__group">患者氏名</span>
        <label>
          姓
          <NameKanjiInput
            value={values.familyKanji}
            onChange={(v) => update("familyKanji", v)}
            kana={values.familyKana}
            onKanaChange={(v) => update("familyKana", v)}
          />
        </label>
        <label>
          名
          <NameKanjiInput
            value={values.givenKanji}
            onChange={(v) => update("givenKanji", v)}
            kana={values.givenKana}
            onKanaChange={(v) => update("givenKana", v)}
          />
        </label>
      </div>

      <div className="patient-fields__row">
        <span className="patient-fields__group">カナ氏名</span>
        <label>
          セイ
          <input
            type="text"
            value={values.familyKana}
            onChange={(e) => update("familyKana", e.target.value)}
          />
        </label>
        <label>
          メイ
          <input
            type="text"
            value={values.givenKana}
            onChange={(e) => update("givenKana", e.target.value)}
          />
        </label>
      </div>

      <div className="patient-fields__row">
        <span className="patient-fields__group">旧姓・通称名</span>
        <label>
          旧姓
          <input
            type="text"
            value={values.maidenFamily}
            onChange={(e) => update("maidenFamily", e.target.value)}
          />
        </label>
        <label>
          通称名
          <input
            type="text"
            value={values.nickname}
            onChange={(e) => update("nickname", e.target.value)}
          />
        </label>
      </div>

      <div className="patient-fields__row">
        <label className="patient-fields__field--gender">
          性別
          <select
            value={values.gender}
            onChange={(e) => update("gender", e.target.value as PatientFormValues["gender"])}
          >
            <option value="">未指定</option>
            <option value="male">男性</option>
            <option value="female">女性</option>
            <option value="other">その他</option>
            <option value="unknown">不明</option>
          </select>
        </label>
        <label>
          生年月日
          <input
            type="date"
            value={values.birthDate}
            onChange={(e) => update("birthDate", e.target.value)}
          />
        </label>
        <label>
          死亡日
          <input
            type="date"
            value={values.deceasedDate}
            onChange={(e) => update("deceasedDate", e.target.value)}
          />
        </label>
      </div>

      <div className="patient-fields__row">
        <label className="patient-fields__field--gender">
          使用言語
          <select
            value={values.language}
            onChange={(e) => update("language", e.target.value as PatientFormValues["language"])}
          >
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.display}
              </option>
            ))}
          </select>
        </label>
        <label className="patient-fields__checkbox">
          <input
            type="checkbox"
            checked={values.interpreterNeeded}
            onChange={(e) => update("interpreterNeeded", e.target.checked)}
          />
          通訳が必要
        </label>
        <label className="patient-fields__checkbox">
          <input
            type="checkbox"
            checked={values.active}
            onChange={(e) => update("active", e.target.checked)}
          />
          有効(active)
        </label>
      </div>

      <span className="patient-fields__group">住所</span>
      <div className="patient-fields__row patient-fields__row--indent">
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
      <div className="patient-fields__row patient-fields__row--indent">
        <label className="patient-fields__field--wide">
          番地方書
          <input
            type="text"
            value={values.addressLine}
            onChange={(e) => update("addressLine", e.target.value)}
          />
        </label>
      </div>

      <span className="patient-fields__group">電話番号</span>
      <div className="patient-fields__row patient-fields__row--indent">
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
      </div>

      <div className="patient-fields__row">
        <label className="patient-fields__field--email">
          EMail
          <input type="email" value={values.email} onChange={(e) => update("email", e.target.value)} />
        </label>
      </div>

      <span className="patient-fields__group">連絡先(緊急連絡先・キーパーソン)</span>
      {values.contacts.map((contact, index) => (
        <ContactFields
          key={index}
          contact={contact}
          onChange={(next) => updateContact(index, next)}
          onRemove={() => removeContact(index)}
        />
      ))}
      <div className="patient-fields__row patient-fields__row--indent">
        <button type="button" onClick={addContact}>
          連絡先を追加
        </button>
      </div>

      <span className="patient-fields__group">かかりつけ医・紹介元</span>
      <div className="patient-fields__row patient-fields__row--indent">
        <label className="patient-fields__field--email">
          選択中
          <input type="text" value={values.generalPractitionerName} readOnly />
        </label>
        <button type="button" onClick={() => setOpenModal("organization")}>
          医療機関から選ぶ
        </button>
        <button type="button" onClick={() => setOpenModal("practitioner")}>
          医師から選ぶ
        </button>
        {values.generalPractitionerRef && (
          <button
            type="button"
            onClick={() => {
              update("generalPractitionerRef", "");
              update("generalPractitionerName", "");
            }}
          >
            解除
          </button>
        )}
      </div>

      {openModal === "organization" && (
        <OrganizationSearchModal
          title="かかりつけ医療機関を選択"
          excludeSelf
          onSelect={(organization) => {
            update("generalPractitionerRef", `Organization/${organization.id}`);
            update("generalPractitionerName", organizationDisplayName(organization));
            setOpenModal(null);
          }}
          onClose={() => setOpenModal(null)}
        />
      )}

      {openModal === "practitioner" && (
        <PractitionerSearchModal
          onSelect={(practitioner) => {
            update("generalPractitionerRef", `Practitioner/${practitioner.id}`);
            update("generalPractitionerName", practitionerDisplayName(practitioner));
            setOpenModal(null);
          }}
          onClose={() => setOpenModal(null)}
        />
      )}

      <div className="patient-fields__actions">
        <button type="submit" disabled={submitting}>
          {submitting ? "送信中..." : submitLabel}
        </button>
      </div>
    </form>
  );
}

interface ContactFieldsProps {
  contact: PatientContactValues;
  onChange: (next: PatientContactValues) => void;
  onRemove: () => void;
}

// 連絡先 1 件分。続柄は複数選べる(近親者かつ緊急連絡先など)ので、
// 単一選択の select ではなくチェックボックスの並びにする。
function ContactFields({ contact, onChange, onRemove }: ContactFieldsProps) {
  function toggleRelationship(code: string, checked: boolean) {
    onChange({
      ...contact,
      relationships: checked
        ? [...contact.relationships, code]
        : contact.relationships.filter((c) => c !== code),
    });
  }

  return (
    <div className="patient-fields__contact">
      <div className="patient-fields__row">
        {CONTACT_RELATIONSHIP_OPTIONS.map((option) => (
          <label key={option.code} className="patient-fields__checkbox">
            <input
              type="checkbox"
              checked={contact.relationships.includes(option.code)}
              onChange={(e) => toggleRelationship(option.code, e.target.checked)}
            />
            {option.display}
          </label>
        ))}
      </div>
      <div className="patient-fields__row">
        <label>
          姓
          <input
            type="text"
            value={contact.family}
            onChange={(e) => onChange({ ...contact, family: e.target.value })}
          />
        </label>
        <label>
          名
          <input
            type="text"
            value={contact.given}
            onChange={(e) => onChange({ ...contact, given: e.target.value })}
          />
        </label>
        <label>
          続柄の補足
          <input
            type="text"
            value={contact.relationshipNote}
            onChange={(e) => onChange({ ...contact, relationshipNote: e.target.value })}
          />
        </label>
      </div>
      <div className="patient-fields__row">
        <label>
          固定電話
          <input
            type="text"
            value={contact.homePhone}
            onChange={(e) => onChange({ ...contact, homePhone: e.target.value })}
          />
        </label>
        <label>
          携帯電話
          <input
            type="text"
            value={contact.mobilePhone}
            onChange={(e) => onChange({ ...contact, mobilePhone: e.target.value })}
          />
        </label>
        <label className="patient-fields__field--wide">
          住所
          <input
            type="text"
            value={contact.address}
            onChange={(e) => onChange({ ...contact, address: e.target.value })}
          />
        </label>
        <button type="button" onClick={onRemove}>
          削除
        </button>
      </div>
    </div>
  );
}
