import type { RefObject } from "react";
import { displayName } from "../fhir/patientHelpers";

// 病棟マップの一時退避ワークスペース。行き先を決めていない患者を置く場所。
// ここから床へ掴んで運べる。入れ替えの途中で使い、退避のままでは確定できない。

export function WardMapWorkspace({
  encounters,
  patientsById,
  fromLabel,
  containerRef,
  active,
  onPointerDown,
  onReturn,
}: {
  encounters: fhir4.Encounter[];
  patientsById: Map<string, fhir4.Patient> | undefined;
  /** 退避前に居た床の表示名。 */
  fromLabel: (encounter: fhir4.Encounter) => string;
  containerRef: RefObject<HTMLDivElement | null>;
  /** 掴んでいるものを落とせる状態(強調する)。 */
  active: boolean;
  onPointerDown: (encounter: fhir4.Encounter, event: React.PointerEvent) => void;
  /** 元の床へ戻す(移動を取り消す)。 */
  onReturn: (encounter: fhir4.Encounter) => void;
}) {
  return (
    <div
      ref={containerRef}
      className={`ward-map__panel ward-map__workspace${active ? " ward-map__workspace--drop-target" : ""}`}
    >
      <h3>一時退避 {encounters.length > 0 && <span>{encounters.length}</span>}</h3>
      {encounters.length === 0 ? (
        <p className="ward-map__workspace-empty">患者をここへ運ぶと床を空けられます</p>
      ) : (
        <ul className="ward-map__workspace-list">
          {encounters.map((encounter) => {
            const patient = patientsById?.get(encounter.subject?.reference?.replace("Patient/", "") ?? "");
            return (
              <li
                key={encounter.id}
                className="ward-map__workspace-card"
                onPointerDown={(event) => onPointerDown(encounter, event)}
              >
                <span className="ward-map__workspace-name">{patient ? displayName(patient) : "(患者不明)"}</span>
                <span className="ward-map__workspace-from">← {fromLabel(encounter)}</span>
                <button
                  type="button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => onReturn(encounter)}
                >
                  戻す
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
