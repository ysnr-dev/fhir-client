import {
  INSULIN_SCALE_KIND_OPTIONS,
  INSULIN_UNIT,
  emptyInsulinScaleRow,
  insulinScaleKindUnit,
  type InsulinScaleKind,
  type InsulinScaleRow,
  type InsulinScaleValues,
} from "../fhir/insulinScaleHelpers";
import { TrashIcon } from "./icons/TrashIcon";

/** 注射の薬剤行の下に出すインスリンのスケール(幅ごとの単位)の入力。 */
export function InsulinScaleEditor({
  scale,
  onChange,
  onRemove,
}: {
  scale: InsulinScaleValues;
  onChange: (scale: InsulinScaleValues) => void;
  onRemove: () => void;
}) {
  const unit = insulinScaleKindUnit(scale.kind);

  function updateRow(index: number, patch: Partial<InsulinScaleRow>) {
    onChange({ ...scale, rows: scale.rows.map((row, i) => (i === index ? { ...row, ...patch } : row)) });
  }

  return (
    <div className="insulin-scale">
      <div className="insulin-scale__header">
        <label className="insulin-scale__kind">
          スケール
          <select
            value={scale.kind}
            onChange={(e) => onChange({ ...scale, kind: e.target.value as InsulinScaleKind })}
          >
            {INSULIN_SCALE_KIND_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="rp-card__icon-button"
          title="スケールを削除"
          aria-label="スケールを削除"
          onClick={onRemove}
        >
          <TrashIcon />
        </button>
      </div>
      <table className="insulin-scale__table">
        <thead>
          <tr>
            <th>{`${INSULIN_SCALE_KIND_OPTIONS.find((o) => o.code === scale.kind)?.display ?? ""}(${unit})`}</th>
            <th>{INSULIN_UNIT}</th>
            <th>コメント</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {scale.rows.map((row, index) => (
            <tr key={index}>
              <td>
                <span className="insulin-scale__range">
                  <input
                    type="number"
                    step="1"
                    min="0"
                    aria-label={`${index + 1} 行目の下限`}
                    value={row.low}
                    onChange={(e) => updateRow(index, { low: e.target.value })}
                  />
                  〜
                  <input
                    type="number"
                    step="1"
                    min="0"
                    aria-label={`${index + 1} 行目の上限`}
                    value={row.high}
                    onChange={(e) => updateRow(index, { high: e.target.value })}
                  />
                </span>
              </td>
              <td>
                <input
                  type="number"
                  step="any"
                  min="0"
                  className="insulin-scale__dose"
                  aria-label={`${index + 1} 行目の単位`}
                  value={row.dose}
                  onChange={(e) => updateRow(index, { dose: e.target.value })}
                />
              </td>
              <td>
                <input
                  type="text"
                  aria-label={`${index + 1} 行目のコメント`}
                  value={row.note}
                  onChange={(e) => updateRow(index, { note: e.target.value })}
                />
              </td>
              <td>
                {scale.rows.length > 1 && (
                  <button
                    type="button"
                    className="rp-card__icon-button"
                    title="この行を削除"
                    aria-label="この行を削除"
                    onClick={() => onChange({ ...scale, rows: scale.rows.filter((_, i) => i !== index) })}
                  >
                    <TrashIcon />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="rp-card__actions">
        <button
          type="button"
          className="rp-card__compact-button"
          onClick={() => onChange({ ...scale, rows: [...scale.rows, emptyInsulinScaleRow()] })}
        >
          + 行追加
        </button>
      </div>
    </div>
  );
}
