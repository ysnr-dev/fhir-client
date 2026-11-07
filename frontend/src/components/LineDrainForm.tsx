import type { LineDrainType } from "../api/masterClient";
import type { LineDrainFormValues } from "../fhir/lineDrainHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";

// 留置物の挿入の入力欄(docs/line-drain-design.md §4.1)。種別は施設マスタから選び、
// 部位・サイズ・製品名・ロットは自由記載。

interface LineDrainFormProps {
  values: LineDrainFormValues;
  onChange: (values: LineDrainFormValues) => void;
  types: LineDrainType[];
  practitioners: fhir4.Practitioner[];
  onSubmit: () => void;
  submitLabel: string;
  submitting: boolean;
}

export function LineDrainForm({
  values,
  onChange,
  types,
  practitioners,
  onSubmit,
  submitLabel,
  submitting,
}: LineDrainFormProps) {
  function update<K extends keyof LineDrainFormValues>(key: K, value: LineDrainFormValues[K]) {
    onChange({ ...values, [key]: value });
  }

  function handlePerformerChange(id: string) {
    const selected = practitioners.find((p) => p.id === id);
    onChange({ ...values, performerId: id, performerName: selected ? practitionerDisplayName(selected) : "" });
  }

  return (
    <form
      className="vital-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="qp-field">
        <label>
          <span className="qp-field__label">種別</span>
          <select value={values.typeCode} onChange={(e) => update("typeCode", e.target.value)}>
            <option value=""></option>
            {types.map((t) => (
              <option key={t.code} value={t.code}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="qp-field">
        <label>
          <span className="qp-field__label">部位</span>
          <input type="text" value={values.bodySite} onChange={(e) => update("bodySite", e.target.value)} />
        </label>
      </div>
      <div className="qp-field">
        <label>
          <span className="qp-field__label">サイズ</span>
          <input type="text" value={values.size} onChange={(e) => update("size", e.target.value)} />
        </label>
      </div>
      <div className="qp-field">
        <label>
          <span className="qp-field__label">製品名</span>
          <input type="text" value={values.productName} onChange={(e) => update("productName", e.target.value)} />
        </label>
      </div>
      <div className="qp-field">
        <label>
          <span className="qp-field__label">ロット</span>
          <input type="text" value={values.lotNumber} onChange={(e) => update("lotNumber", e.target.value)} />
        </label>
      </div>
      <div className="qp-field">
        <label>
          <span className="qp-field__label">挿入日時</span>
          <input
            type="datetime-local"
            value={values.insertedAt}
            onChange={(e) => update("insertedAt", e.target.value)}
          />
        </label>
      </div>
      <div className="qp-field">
        <label>
          <span className="qp-field__label">挿入者</span>
          <select value={values.performerId} onChange={(e) => handlePerformerChange(e.target.value)}>
            <option value=""></option>
            {practitioners.map((p) => (
              <option key={p.id} value={p.id}>
                {practitionerDisplayName(p)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="qp-field">
        <label>
          <span className="qp-field__label">目的</span>
          <input type="text" value={values.purpose} onChange={(e) => update("purpose", e.target.value)} />
        </label>
      </div>
      <div className="qp-field">
        <label>
          <span className="qp-field__label">コメント</span>
          <textarea rows={2} value={values.note} onChange={(e) => update("note", e.target.value)} />
        </label>
      </div>
      <div className="prescription-form__submit">
        <button type="submit" disabled={submitting}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
