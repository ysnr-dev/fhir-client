import { useState } from "react";
import { newDraftKey, phaseLabelOf } from "../fhir/pathwayHelpers";
import type { PathwayPhaseBranchDraft, PathwayPhaseDraft } from "../fhir/pathwayHelpers";
import { Modal } from "./Modal";
import { moveItem, TrashIcon } from "./PathwayEventCard";

// フェーズの終わりで選べる次の候補の編集。先頭が標準の経路。Modal は非ポータルで外側の form の
// 中に出るので、ここには form を書かない。

interface Props {
  phase: PathwayPhaseDraft;
  phases: PathwayPhaseDraft[];
  readOnly: boolean;
  onCommit: (branches: PathwayPhaseBranchDraft[]) => void;
  onClose: () => void;
}

export function PathwayPhaseBranchModal({ phase, phases, readOnly, onCommit, onClose }: Props) {
  const [branches, setBranches] = useState<PathwayPhaseBranchDraft[]>(phase.branches);
  const targets = phases.filter((p) => p.phaseKey !== phase.phaseKey);

  function patch(key: number, value: Partial<PathwayPhaseBranchDraft>) {
    setBranches((prev) => prev.map((b) => (b.key === key ? { ...b, ...value } : b)));
  }

  return (
    <Modal title={`分岐: ${phaseLabelOf(phases, phase.phaseKey)}`} onClose={onClose} className="pathway-branch-modal">
      <fieldset className="pathway-branch-modal__rows" disabled={readOnly}>
        {branches.map((branch, index) => (
          <div key={branch.key} className="pathway-branch-modal__row">
            <label>
              次のフェーズ
              <select value={branch.toPhaseKey} onChange={(e) => patch(branch.key, { toPhaseKey: e.target.value })}>
                <option value="">パスを終了</option>
                {targets.map((p) => (
                  <option key={p.phaseKey} value={p.phaseKey}>
                    {phaseLabelOf(phases, p.phaseKey)}
                  </option>
                ))}
              </select>
            </label>
            <label className="pathway-branch-modal__criteria">
              目安
              <input type="text" value={branch.criteria} onChange={(e) => patch(branch.key, { criteria: e.target.value })} />
            </label>
            <div className="pathway-branch-modal__tools">
              <button
                type="button"
                disabled={index === 0}
                onClick={() => setBranches((prev) => moveItem(prev, index, -1))}
                aria-label="上へ"
              >
                ↑
              </button>
              <button
                type="button"
                disabled={index === branches.length - 1}
                onClick={() => setBranches((prev) => moveItem(prev, index, 1))}
                aria-label="下へ"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => setBranches((prev) => prev.filter((b) => b.key !== branch.key))}
                aria-label="削除"
              >
                <TrashIcon />
              </button>
            </div>
          </div>
        ))}
        <div className="lab-order-item__actions">
          <button
            type="button"
            onClick={() => setBranches((prev) => [...prev, { key: newDraftKey(), toPhaseKey: "", criteria: "" }])}
          >
            ＋ 候補
          </button>
        </div>
      </fieldset>
      <div className="lab-order-item__actions">
        {!readOnly && (
          <button type="button" className="primary" onClick={() => onCommit(branches)}>
            決定
          </button>
        )}
        <button type="button" onClick={onClose}>
          {readOnly ? "閉じる" : "キャンセル"}
        </button>
      </div>
    </Modal>
  );
}
