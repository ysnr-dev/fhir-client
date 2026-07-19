import { useState, type FormEvent } from "react";
import type { PatientSearchParams } from "../api/queries";

interface PatientSearchFormProps {
  onSearch: (params: PatientSearchParams) => void;
}

const emptySearch: PatientSearchParams = {
  name: "",
  gender: "",
  birthDateFrom: "",
  birthDateTo: "",
  identifier: "",
};

export function PatientSearchForm({ onSearch }: PatientSearchFormProps) {
  const [values, setValues] = useState<PatientSearchParams>(emptySearch);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSearch(values);
  }

  function handleReset() {
    setValues(emptySearch);
    onSearch(emptySearch);
  }

  return (
    <form className="patient-search-form" onSubmit={handleSubmit}>
      <label>
        氏名(漢字・カナ部分一致)
        <input
          type="text"
          value={values.name}
          onChange={(e) => setValues({ ...values, name: e.target.value })}
        />
      </label>
      <label>
        性別
        <select value={values.gender} onChange={(e) => setValues({ ...values, gender: e.target.value })}>
          <option value="">指定なし</option>
          <option value="male">男性</option>
          <option value="female">女性</option>
          <option value="other">その他</option>
          <option value="unknown">不明</option>
        </select>
      </label>
      <label>
        生年月日(from)
        <input
          type="date"
          value={values.birthDateFrom}
          onChange={(e) => setValues({ ...values, birthDateFrom: e.target.value })}
        />
      </label>
      <label>
        生年月日(to)
        <input
          type="date"
          value={values.birthDateTo}
          onChange={(e) => setValues({ ...values, birthDateTo: e.target.value })}
        />
      </label>
      <label>
        患者番号
        <input
          type="text"
          value={values.identifier}
          onChange={(e) => setValues({ ...values, identifier: e.target.value })}
        />
      </label>
      <div className="patient-search-form__actions">
        <button type="submit">検索</button>
        <button type="button" onClick={handleReset}>
          クリア
        </button>
      </div>
    </form>
  );
}
