import type { InsulinScaleSet } from "../api/masterClient";
import {
  INSULIN_SCALE_KIND_OPTIONS,
  INSULIN_UNIT,
  emptyInsulinScaleRow,
  insulinScaleFromSet,
  insulinScaleKindUnit,
  type InsulinScaleKind,
  type InsulinScaleRow,
  type InsulinScaleValues,
} from "../fhir/insulinScaleHelpers";
import { TrashIcon } from "./icons/TrashIcon";

/**
 * インスリンのスケール(行ごとの単位)の入力。注射の薬剤行の下と、スケールセットのマスタで使う。
 * セットを選ぶと行が写り、写した後に種別や行を直すとセットの印は外れる(オーダーに残すのは
 * 「セットのまま」かどうか)。
 */
export function InsulinScaleEditor({
  scale,
  onChange,
  onRemove,
  sets,
}: {
  scale: InsulinScaleValues;
  onChange: (scale: InsulinScaleValues) => void;
  /** 渡したときだけ削除ボタンを出す。 */
  onRemove?: () => void;
  /** 渡したときだけセットの選択を出す。 */
  sets?: InsulinScaleSet[];
}) {
  const free = scale.kind === "free";
  const kindLabel = INSULIN_SCALE_KIND_OPTIONS.find((o) => o.code === scale.kind)?.display ?? "";
  const unit = insulinScaleKindUnit(scale.kind);

  function edit(patch: Partial<InsulinScaleValues>) {
    onChange({ ...scale, ...patch, set: null });
  }

  function updateRow(index: number, patch: Partial<InsulinScaleRow>) {
    edit({ rows: scale.rows.map((row, i) => (i === index ? { ...row, ...patch } : row)) });
  }

  function chooseSet(id: string) {
    const set = sets?.find((s) => String(s.id) === id);
    if (set) onChange(insulinScaleFromSet(set));
  }

  return (
    <div className="insulin-scale">
      <div className="insulin-scale__header">
        <label className="insulin-scale__kind">
          スケール
          <select value={scale.kind} onChange={(e) => edit({ kind: e.target.value as InsulinScaleKind })}>
            {INSULIN_SCALE_KIND_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.display}
              </option>
            ))}
          </select>
        </label>
        {sets && sets.length > 0 && (
          <label className="insulin-scale__kind">
            セット
            <select value={scale.set ? String(scale.set.id) : ""} onChange={(e) => chooseSet(e.target.value)}>
              <option value="">選択してください</option>
              {sets.map((set) => (
                <option key={set.id} value={set.id}>
                  {set.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {onRemove && (
          <button
            type="button"
            className="rp-card__icon-button insulin-scale__remove"
            title="スケールを削除"
            aria-label="スケールを削除"
            onClick={onRemove}
          >
            <TrashIcon />
          </button>
        )}
      </div>
      <table className="insulin-scale__table">
        <thead>
          <tr>
            <th>{free ? "条件" : `${kindLabel}(${unit})`}</th>
            <th>{INSULIN_UNIT}</th>
            <th>コメント</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {scale.rows.map((row, index) => (
            <tr key={index}>
              <td className={free ? "insulin-scale__condition" : undefined}>
                {free ? (
                  <input
                    type="text"
                    aria-label={`${index + 1} 行目の条件`}
                    value={row.condition}
                    onChange={(e) => updateRow(index, { condition: e.target.value })}
                  />
                ) : (
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
                )}
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
                    onClick={() => edit({ rows: scale.rows.filter((_, i) => i !== index) })}
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
          onClick={() => edit({ rows: [...scale.rows, emptyInsulinScaleRow()] })}
        >
          + 行追加
        </button>
      </div>
    </div>
  );
}
