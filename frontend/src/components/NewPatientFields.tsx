import type { Dispatch, SetStateAction } from "react";
import type { PatientFormValues } from "../fhir/patientHelpers";
import { makeFieldUpdater } from "../lib/form";
import { NameKanjiInput } from "./NameKanjiInput";
import { PostalCodeInput } from "./PostalCodeInput";

// 受付の最中に患者を登録するときの入力欄(属性・住所・本人の連絡先)。外来の新患登録と
// 救急受付の新患で共用する。並びと区分けは患者登録・編集フォーム(PatientForm)に合わせる。

export function NewPatientFields({
  values,
  setValues,
}: {
  values: PatientFormValues;
  setValues: Dispatch<SetStateAction<PatientFormValues>>;
}) {
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

  return (
    <>
      <fieldset className="patient-fields__group-box">
        <legend>属性</legend>

        <div className="patient-fields__row">
          <label className="patient-fields__field--number">
            患者番号
            <input
              type="text"
              value={values.identifierValue}
              onChange={(e) => update("identifierValue", e.target.value)}
              placeholder="空欄なら自動採番"
            />
          </label>
        </div>

        <div className="patient-fields__row">
          <span className="patient-fields__group">患者氏名</span>
          <label>
            <span>
              姓
              <span className="patient-fields__required">必須</span>
            </span>
            <NameKanjiInput
              value={values.familyKanji}
              onChange={(v) => update("familyKanji", v)}
              kana={values.familyKana}
              onKanaChange={(v) => update("familyKana", v)}
            />
          </label>
          <label>
            <span>
              名
              <span className="patient-fields__required">必須</span>
            </span>
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
            <span>
              セイ
              <span className="patient-fields__required">必須</span>
            </span>
            <input
              type="text"
              value={values.familyKana}
              onChange={(e) => update("familyKana", e.target.value)}
            />
          </label>
          <label>
            <span>
              メイ
              <span className="patient-fields__required">必須</span>
            </span>
            <input
              type="text"
              value={values.givenKana}
              onChange={(e) => update("givenKana", e.target.value)}
            />
          </label>
        </div>

        <div className="patient-fields__row">
          <label className="patient-fields__field--gender">
            <span>
              性別
              <span className="patient-fields__required">必須</span>
            </span>
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
            <span>
              生年月日
              <span className="patient-fields__required">必須</span>
            </span>
            <input
              type="date"
              value={values.birthDate}
              onChange={(e) => update("birthDate", e.target.value)}
            />
          </label>
        </div>
      </fieldset>

      <fieldset className="patient-fields__group-box">
        <legend>住所</legend>

        <div className="patient-fields__row">
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
        <div className="patient-fields__row">
          <label className="patient-fields__field--wide">
            番地方書
            <input
              type="text"
              value={values.addressLine}
              onChange={(e) => update("addressLine", e.target.value)}
            />
          </label>
        </div>
      </fieldset>

      <fieldset className="patient-fields__group-box">
        <legend>本人の連絡先</legend>

        <div className="patient-fields__row">
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
            <input
              type="email"
              value={values.email}
              onChange={(e) => update("email", e.target.value)}
            />
          </label>
        </div>
      </fieldset>
    </>
  );
}
