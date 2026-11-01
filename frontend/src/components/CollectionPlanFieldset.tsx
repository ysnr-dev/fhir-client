import { useState } from "react";
import {
  DEFAULT_COLLECTION_INTERVAL_DAYS,
  DEFAULT_COLLECTION_VOLUME,
  collectionPlanStatusLabel,
  plannedVolumeTotal,
  proposeCollections,
  type CollectionPlanLine,
} from "../fhir/autologousPlanHelpers";
import { localDay } from "../lib/dates";
import { TrashIcon } from "./icons/TrashIcon";

// 輸血オーダーの「採血予定」。自己血(貯血式)の製剤を選んだときだけ出す。
// 手術日(投与予定日)・回数・1 回量・間隔から予定を逆算して並べ、医師が日時・量を直す。
// 採血済みの予定は動かせない(表示だけ)。

interface Props {
  lines: CollectionPlanLine[];
  onChange: (lines: CollectionPlanLine[]) => void;
  /** 手術日(投与予定日時)。空なら提案できない。 */
  scheduledDateTime: string;
  /** 自己血として依頼した量(mL)。回数の既定に使う。 */
  orderedVolume: number;
  /** 1 回量の既定(製剤マスタの既定単位数)。 */
  defaultVolume: number | null | undefined;
}

export function CollectionPlanFieldset({ lines, onChange, scheduledDateTime, orderedVolume, defaultVolume }: Props) {
  const [volume, setVolume] = useState(String(defaultVolume || DEFAULT_COLLECTION_VOLUME));
  // 回数は手で変えるまで依頼量 ÷ 1 回量から出す(単位数を直したら追う)。
  const [countInput, setCountInput] = useState("");
  const [intervalDays, setIntervalDays] = useState(String(DEFAULT_COLLECTION_INTERVAL_DAYS));
  const surgeryDate = localDay(scheduledDateTime);
  const perCollection = Number(volume) || DEFAULT_COLLECTION_VOLUME;
  const count =
    countInput || String(orderedVolume > 0 ? Math.max(1, Math.ceil(orderedVolume / perCollection)) : 1);

  function propose() {
    const proposed = proposeCollections({
      surgeryDate,
      count: Number(count) || 0,
      volume: Number(volume) || 0,
      intervalDays: Number(intervalDays) || DEFAULT_COLLECTION_INTERVAL_DAYS,
    });
    // 採血済みの予定は残し、未採血の予定を提案で置き換える。
    onChange([...lines.filter((line) => line.status === "fulfilled"), ...proposed]);
  }

  function updateLine(index: number, patch: Partial<CollectionPlanLine>) {
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function addLine() {
    onChange([...lines, { id: "", plannedAt: "", volume, status: "booked" }]);
  }

  function removeLine(index: number) {
    onChange(lines.filter((_, i) => i !== index));
  }

  const total = plannedVolumeTotal(lines);

  return (
    <fieldset className="collection-plan">
      <legend>採血予定</legend>
      <div className="collection-plan__proposal">
        <label>
          回数
          <input type="number" min={1} step={1} value={count} onChange={(e) => setCountInput(e.target.value)} />
        </label>
        <label>
          1回量(mL)
          <input type="number" min={0} step={50} value={volume} onChange={(e) => setVolume(e.target.value)} />
        </label>
        <label>
          間隔(日)
          <input
            type="number"
            min={1}
            step={1}
            value={intervalDays}
            onChange={(e) => setIntervalDays(e.target.value)}
          />
        </label>
        <button type="button" className="rp-card__compact-button" onClick={propose} disabled={!surgeryDate}>
          提案
        </button>
      </div>

      {lines.length > 0 && (
        <table className="rp-card__medicines collection-plan__table">
          <thead>
            <tr>
              <th>回</th>
              <th>予定日時</th>
              <th>予定量(mL)</th>
              <th>状態</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => {
              const fixed = line.status !== "booked";
              return (
                // 予定は追加・削除しかしないので index を鍵にしてよい。
                <tr key={index}>
                  <td>{index + 1}</td>
                  <td>
                    <input
                      type="datetime-local"
                      value={line.plannedAt}
                      disabled={fixed}
                      onChange={(e) => updateLine(index, { plannedAt: e.target.value })}
                      aria-label={`${index + 1} 回目の予定日時`}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      step={50}
                      value={line.volume}
                      disabled={fixed}
                      onChange={(e) => updateLine(index, { volume: e.target.value })}
                      aria-label={`${index + 1} 回目の予定量`}
                    />
                  </td>
                  <td>{collectionPlanStatusLabel(line.status)}</td>
                  <td>
                    {!fixed && (
                      <button
                        type="button"
                        className="rp-card__icon-button"
                        title={`${index + 1} 回目の予定を削除`}
                        aria-label={`${index + 1} 回目の予定を削除`}
                        onClick={() => removeLine(index)}
                      >
                        <TrashIcon />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="collection-plan__foot">
        <button type="button" className="rp-card__compact-button" onClick={addLine}>
          ＋予定追加
        </button>
        <span className="order-select__muted">
          合計 {total} mL{orderedVolume > 0 && ` / 依頼 ${orderedVolume} mL`}
        </span>
      </div>
    </fieldset>
  );
}
