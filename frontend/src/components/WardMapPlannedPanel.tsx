import {
  encounterDepartmentName,
  encounterPatientId,
  plannedBedName,
  plannedRoomName,
} from "../fhir/encounterHelpers";
import { calculateAge, displayName, genderShortLabel, patientNumberOf } from "../fhir/patientHelpers";

// 病棟マップの当日入院予定。カードを掴んで空床へ落とすと入院実施(床を選んだ状態)になる。
// 掴まずに「入院実施」を押しても同じモーダルが開く(予定の床のまま)。

export function WardMapPlannedPanel({
  encounters,
  patientsById,
  onPointerDown,
  onExecute,
}: {
  encounters: fhir4.Encounter[];
  patientsById: Map<string, fhir4.Patient> | undefined;
  onPointerDown: (encounter: fhir4.Encounter, event: React.PointerEvent) => void;
  onExecute: (encounter: fhir4.Encounter) => void;
}) {
  return (
    <div className="ward-map__panel ward-map__planned">
      <h3>本日の入院予定 {encounters.length > 0 && <span>{encounters.length}</span>}</h3>
      {encounters.length === 0 ? (
        <p className="ward-map__workspace-empty">この病棟への入院予定はありません</p>
      ) : (
        <ul className="ward-map__workspace-list">
          {encounters.map((encounter) => {
            const patient = patientsById?.get(encounterPatientId(encounter) ?? "");
            const age = patient?.birthDate ? calculateAge(patient.birthDate) : undefined;
            // plannedRoomName / plannedBedName は未指定を "-" で返す(一覧のセル用)。
            const roomName = plannedRoomName(encounter);
            const bedName = plannedBedName(encounter);
            const place = [roomName !== "-" && roomName, bedName !== "-" && bedName && `ベッド${bedName}`]
              .filter(Boolean)
              .join(" ");
            return (
              <li
                key={encounter.id}
                className="ward-map__workspace-card ward-map__planned-card"
                onPointerDown={(event) => onPointerDown(encounter, event)}
              >
                <span className="ward-map__workspace-name">
                  {patient ? displayName(patient) : "(患者不明)"}
                  {patient && (
                    <span className="ward-map__bed-age">
                      {" "}
                      {genderShortLabel(patient.gender)}
                      {age != null ? ` ${age}` : ""}
                    </span>
                  )}
                </span>
                <span className="ward-map__workspace-from">
                  {[patient && patientNumberOf(patient), place || "床未定", encounterDepartmentName(encounter)]
                    .filter(Boolean)
                    .join(" / ")}
                </span>
                <button
                  type="button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => onExecute(encounter)}
                >
                  入院実施
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
