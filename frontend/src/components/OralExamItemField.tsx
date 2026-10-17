import { itemOptions, type OralExamCodeBook } from "../fhir/oralExamHelpers";

interface OralExamItemFieldProps {
  book: OralExamCodeBook | undefined;
  item: string;
  label: string;
  value: string;
  onChange: (code: string) => void;
}

/** コード表の 1 項目。選択肢が 1 つだけ(あり/なし)ならチェックボックス、それ以外はセレクト。 */
export function OralExamItemField({ book, item, label, value, onChange }: OralExamItemFieldProps) {
  const options = itemOptions(book, item, value);
  if (options.length === 1) {
    const only = options[0];
    return (
      <label className="oral-exam__check">
        <input
          type="checkbox"
          checked={value === only.code}
          onChange={(e) => onChange(e.target.checked ? only.code : "")}
        />
        {label}
      </label>
    );
  }
  return (
    <label className="oral-exam__field">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="" />
        {options.map((option) => (
          <option key={option.code} value={option.code}>
            {option.display}
          </option>
        ))}
      </select>
    </label>
  );
}
