import { useState } from "react";
import type { PathwayDetail, PathwayPhaseBranch } from "../api/masterClient";
import { Modal } from "./Modal";

// フェーズの終わりで次を選ぶ。候補はパス定義の分岐(先頭が標準の経路)。フェーズを選べば右ペインで
// そのフェーズを適用し、「パスを終了」なら終了・中止の入力へ進む。

const CLOSE = "close";

interface Props {
  pathway: PathwayDetail;
  currentName: string;
  candidates: PathwayPhaseBranch[];
  onSelectPhase: (phaseKey: string) => void;
  onSelectClose: () => void;
  onClose: () => void;
}

export function PathwayNextPhaseModal({ pathway, currentName, candidates, onSelectPhase, onSelectClose, onClose }: Props) {
  const [selected, setSelected] = useState(candidates[0]?.to_phase_key ?? CLOSE);
  const nameOf = (phaseKey: string | null) =>
    phaseKey ? (pathway.phases.find((p) => p.phase_key === phaseKey)?.name ?? "") : "パスを終了";

  return (
    <Modal title={`次のフェーズ${currentName ? `（${currentName} の次）` : ""}`} onClose={onClose}>
      <ul className="pathway-next-phase">
        {candidates.map((branch) => {
          const value = branch.to_phase_key ?? CLOSE;
          return (
            <li key={branch.id}>
              <label className="pathway-next-phase__option">
                <input type="radio" name="next-phase" checked={selected === value} onChange={() => setSelected(value)} />
                <span className="pathway-next-phase__name">{nameOf(branch.to_phase_key)}</span>
                {branch.criteria && <span className="pathway-next-phase__criteria">{branch.criteria}</span>}
              </label>
            </li>
          );
        })}
      </ul>
      <div className="lab-order-item__actions">
        <button
          type="button"
          className="primary"
          onClick={() => (selected === CLOSE ? onSelectClose() : onSelectPhase(selected))}
        >
          進む
        </button>
        <button type="button" onClick={onClose}>
          キャンセル
        </button>
      </div>
    </Modal>
  );
}
