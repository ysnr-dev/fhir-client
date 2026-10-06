import { PATIENT_COLUMNS, type PatientColumn } from "../../fhir/extractQueryHelpers";

/**
 * 一覧・CSV に出す患者の列(患者番号・氏名はいつも出す)。選んでいないあいだは既定の列にチェックを
 * 付けて見せ、1 つでも変えたら選んだ列だけを出す。
 */
export function PatientColumnsField({
  value,
  selected,
  onChange,
}: {
  value: PatientColumn[];
  selected: boolean;
  onChange: (columns: PatientColumn[]) => void;
}) {
  return (
    <div className="data-extract__output" role="group" aria-label="出力する患者の項目">
      <span className="extract-checks__label">出力項目</span>
      {PATIENT_COLUMNS.map((column) => (
        <label key={column.value} className="extract-checks__item">
          <input
            type="checkbox"
            checked={value.includes(column.value)}
            onChange={(e) =>
              onChange(
                e.target.checked ? [...value, column.value] : value.filter((v) => v !== column.value),
              )
            }
          />
          {column.label}
        </label>
      ))}
      {selected && (
        <button type="button" className="rp-card__compact-button" onClick={() => onChange([])}>
          既定
        </button>
      )}
    </div>
  );
}
