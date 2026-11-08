import { phaseLabelOf, type PathwayPhaseDraft } from "../fhir/pathwayHelpers";

/** 経路上で分岐するフェーズごとの「次のフェーズ」の選択。既定は分岐の先頭(標準の経路)。 */
export function PathwayRouteSelects({
  phases,
  route,
  choices,
  onChoose,
}: {
  phases: PathwayPhaseDraft[];
  route: PathwayPhaseDraft[];
  choices: Map<string, string>;
  onChoose: (phaseKey: string, toPhaseKey: string) => void;
}) {
  if (phases.length <= 1) return null;
  return (
    <>
      {route
        .filter((phase) => phase.branches.length > 1)
        .map((phase) => (
          <label key={phase.phaseKey} className="pathway-preview__field">
            {`${phaseLabelOf(phases, phase.phaseKey)} の次`}
            <select
              value={choices.get(phase.phaseKey) ?? phase.branches[0]?.toPhaseKey ?? ""}
              onChange={(e) => onChoose(phase.phaseKey, e.target.value)}
            >
              {phase.branches.map((branch) => (
                <option key={branch.key} value={branch.toPhaseKey}>
                  {branch.toPhaseKey ? phaseLabelOf(phases, branch.toPhaseKey) : "パスを終了"}
                </option>
              ))}
            </select>
          </label>
        ))}
    </>
  );
}
