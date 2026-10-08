import { Modal } from "./Modal";

/** 入院患者一覧で表示を切り替えられる列。 */
export interface InpatientOptionalColumns {
  pathway: boolean;
  dpc: boolean;
}

const COLUMN_LABELS: Record<keyof InpatientOptionalColumns, string> = {
  pathway: "パス",
  dpc: "DPC",
};

/** 入院患者一覧の表示項目変更。チェックを切り替えるとその場で表に反映する。 */
export function InpatientColumnsModal({
  columns,
  onChange,
  onClose,
}: {
  columns: InpatientOptionalColumns;
  onChange: (key: keyof InpatientOptionalColumns, shown: boolean) => void;
  onClose: () => void;
}) {
  return (
    <Modal title="表示項目変更" onClose={onClose} className="inpatient-columns-modal">
      <div className="inpatient-columns-modal__list">
        {(Object.keys(COLUMN_LABELS) as (keyof InpatientOptionalColumns)[]).map((key) => (
          <label key={key} className="master-search__checkbox">
            <input
              type="checkbox"
              checked={columns[key]}
              onChange={(e) => onChange(key, e.target.checked)}
            />
            {COLUMN_LABELS[key]}
          </label>
        ))}
      </div>
    </Modal>
  );
}
