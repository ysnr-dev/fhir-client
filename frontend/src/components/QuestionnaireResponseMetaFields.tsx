import {
  QR_STATUS_OPTIONS,
  type QuestionnaireResponseMetaValues,
  type QuestionnaireResponseStatus,
} from "../fhir/questionnaireResponseHelpers";

interface QuestionnaireResponseMetaFieldsProps {
  values: QuestionnaireResponseMetaValues;
  onChange: (values: QuestionnaireResponseMetaValues) => void;
}

// テンプレート回答の登録情報(ステータス・記入者・保険医療機関番号)。
// QuestionnaireResponseForm の children としてフォーム先頭に描画する。
export function QuestionnaireResponseMetaFields({
  values,
  onChange,
}: QuestionnaireResponseMetaFieldsProps) {
  function update<K extends keyof QuestionnaireResponseMetaValues>(
    key: K,
    value: QuestionnaireResponseMetaValues[K],
  ) {
    onChange({ ...values, [key]: value });
  }

  return (
    <fieldset className="qp-group">
      <legend>登録情報</legend>
      <div className="qp-field">
        <label>
          <span className="qp-field__label">
            ステータス
            <span className="qp-field__required">必須</span>
          </span>
          <select
            value={values.status}
            onChange={(e) => update("status", e.target.value as QuestionnaireResponseStatus)}
          >
            {QR_STATUS_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="qp-field">
        <label>
          <span className="qp-field__label">
            記入者名
            <span className="qp-field__required">必須</span>
          </span>
          <input
            type="text"
            value={values.authorName}
            required
            onChange={(e) => update("authorName", e.target.value)}
          />
        </label>
      </div>
      <div className="qp-field">
        <label>
          <span className="qp-field__label">
            保険医療機関番号
            <span className="qp-field__required">必須</span>
          </span>
          <input
            type="text"
            value={values.institutionNumber}
            required
            maxLength={10}
            onChange={(e) => update("institutionNumber", e.target.value)}
          />
        </label>
        <p className="qp-field__note">
          10桁の数字(都道府県2桁 + 点数表1桁 + 医療機関コード7桁)。
        </p>
      </div>
    </fieldset>
  );
}
