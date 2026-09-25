import { useState } from "react";
import type { ChartLaneData, ChartRange, ChartTrackRef } from "../fhir/chartDefinitionHelpers";
import {
  anchorStateTrack,
  findStateTrack,
  stratifySeries,
  type ChartStateTrack,
} from "../fhir/chartStateHelpers";
import { formatValue } from "./chartScale";
import { Modal } from "./Modal";

// 層別の要約。帯の行(選択肢の項目・追う薬剤・入院・クール・有害事象)か基準日の前後を「層」にし、
// 各定量項目の値を層ごとに n・中央値・範囲・基準外の割合で並べる。目で読んでいた相関を数で確かめる
// ための表で、統計はここまでに留める(p 値は出さない)。画面側の計算だけで、URL にも定義にも残さない。

const ANCHOR_KEY = "anchor";

interface Props {
  lanes: ChartLaneData[];
  stateTracks: ChartStateTrack[];
  range: ChartRange;
  /** 最初に選ぶ層(定義の網掛け)。 */
  initialRef: ChartTrackRef | null;
  anchor?: string;
  onClose: () => void;
}

export function ChartStratifyModal({ lanes, stateTracks, range, initialRef, anchor, onClose }: Props) {
  const choices = [
    ...stateTracks.map((track, index) => ({ key: String(index), label: track.name, track })),
    ...(anchor ? [{ key: ANCHOR_KEY, label: "基準日の前後", track: anchorStateTrack(anchor, range) }] : []),
  ];
  const initialIndex = stateTracks.indexOf(findStateTrack(stateTracks, initialRef) ?? stateTracks[0]);
  const [selectedKey, setSelectedKey] = useState(initialIndex >= 0 ? String(initialIndex) : choices[0]?.key ?? "");
  const selected = choices.find((choice) => choice.key === selectedKey) ?? choices[0];

  // 行 = 定量の系列(血圧は収縮期・拡張期の 2 行)。
  const rows = lanes.flatMap((lane) =>
    lane.series.map((series) => ({
      key: series.key,
      name: lane.series.length > 1 ? `${lane.name} ${series.name}` : lane.name,
      unit: lane.unit,
      // 判定を持つのは検査(結果の interpretation)とバイタル(施設のしきい値)。
      summaries: selected ? stratifySeries(series.points, selected.track, lane.source !== "template") : [],
    })),
  );
  // どの行にも値が無い層の列は出さない。
  const columns = selected
    ? [...selected.track.strata.map((stratum) => stratum.label), ...(selected.track.rest ? [selected.track.rest] : [])]
        .filter((label) => rows.some((row) => row.summaries.find((summary) => summary.label === label)?.n))
    : [];

  return (
    <Modal title="層別の要約" onClose={onClose} className="modal--wide">
      <div className="patient-chart__analysis">
        <div className="patient-chart__analysis-controls">
          <label>
            層
            <select value={selected?.key ?? ""} onChange={(e) => setSelectedKey(e.target.value)} disabled={choices.length === 0}>
              {choices.map((choice) => (
                <option key={choice.key} value={choice.key}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {choices.length === 0 ? (
          <p className="patient-chart__stats">層にできる行(選択肢の項目・追う薬剤・入退院・化学療法・有害事象)がこのチャートにありません。</p>
        ) : columns.length === 0 ? (
          <p className="patient-chart__stats">この期間に値がありません。</p>
        ) : (
          <table className="patient-chart__strata">
            <thead>
              <tr>
                <th rowSpan={2} scope="col">
                  項目
                </th>
                {columns.map((label) => (
                  <th key={label} colSpan={4} scope="colgroup" className="patient-chart__strata-group">
                    {label}
                  </th>
                ))}
              </tr>
              <tr>
                {columns.map((label) => (
                  <StratumHeader key={label} />
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <th scope="row">
                    {row.name}
                    {row.unit ? `(${row.unit})` : ""}
                  </th>
                  {columns.map((label) => {
                    const summary = row.summaries.find((entry) => entry.label === label);
                    const n = summary?.n ?? 0;
                    return (
                      <StratumCells
                        key={label}
                        n={n}
                        median={summary?.median}
                        min={summary?.min}
                        max={summary?.max}
                        outOfRange={summary?.outOfRange}
                      />
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}

      </div>
    </Modal>
  );
}

function StratumHeader() {
  return (
    <>
      <th scope="col" className="patient-chart__strata-first">
        n
      </th>
      <th scope="col">中央値</th>
      <th scope="col">範囲</th>
      <th scope="col">基準外</th>
    </>
  );
}

function StratumCells({
  n,
  median,
  min,
  max,
  outOfRange,
}: {
  n: number;
  median?: number;
  min?: number;
  max?: number;
  outOfRange?: number;
}) {
  if (n === 0) {
    return (
      <>
        <td className="patient-chart__strata-first patient-chart__strata-empty">0</td>
        <td className="patient-chart__strata-empty">—</td>
        <td className="patient-chart__strata-empty">—</td>
        <td className="patient-chart__strata-empty">—</td>
      </>
    );
  }
  return (
    <>
      <td className="patient-chart__strata-first">{n}</td>
      <td>{median === undefined ? "—" : formatValue(median)}</td>
      <td>
        {min === undefined || max === undefined
          ? "—"
          : min === max
            ? formatValue(min)
            : `${formatValue(min)}〜${formatValue(max)}`}
      </td>
      <td>{outOfRange === undefined ? "—" : `${Math.round(outOfRange * 100)}%`}</td>
    </>
  );
}
