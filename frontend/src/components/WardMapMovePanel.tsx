import { WORKSPACE, type MovePlan } from "../fhir/bedMovePlanHelpers";

// 病棟マップの保留中の移動一覧。行ごとに取り消せ、まとめて確定する。

export function WardMapMovePanel({
  plan,
  patientName,
  bedLabel,
  onCancel,
  onClear,
  onConfirm,
}: {
  plan: MovePlan;
  patientName: (encounter: fhir4.Encounter) => string;
  bedLabel: (bedId: string) => string;
  onCancel: (encounterId: string) => void;
  onClear: () => void;
  onConfirm: () => void;
}) {
  const moves = [...plan.values()];
  return (
    <div className="ward-map__panel ward-map__moves">
      <h3>保留中の移動 {moves.length > 0 && <span>{moves.length}</span>}</h3>
      {moves.length === 0 ? (
        <p className="ward-map__workspace-empty">患者を掴んで空床か別の患者の床へ運びます</p>
      ) : (
        <ul className="ward-map__move-list">
          {moves.map((move) => (
            <li key={move.encounter.id} className="ward-map__move-row">
              <span className="ward-map__move-name">{patientName(move.encounter)}</span>
              <span className="ward-map__move-path">
                {bedLabel(move.fromBedId)} → {move.toBedId === WORKSPACE ? "退避" : bedLabel(move.toBedId)}
              </span>
              <button type="button" onClick={() => onCancel(move.encounter.id ?? "")} aria-label="この移動を取り消す">
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="ward-map__move-actions">
        <button type="button" onClick={onConfirm} disabled={moves.length === 0}>
          転床を確定
        </button>
        <button type="button" onClick={onClear} disabled={moves.length === 0}>
          すべて破棄
        </button>
      </div>
    </div>
  );
}
