import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  encounterAdmissionDate,
  encounterAttendingName,
  encounterDepartmentName,
} from "../fhir/encounterHelpers";
import { calculateAge, displayName, genderShortLabel, patientNumberOf } from "../fhir/patientHelpers";
import { bedShortLabel } from "../fhir/wardHelpers";
import { diffDays } from "../lib/dates";
import { useReturnLinkState } from "../returnTo";

// 病棟マップのベッド 1 床。空床なら番号だけ、入院中なら患者の要点を載せる。
//
// 押すとカルテへ。カード全体を Link にすると掴む操作(pointerdown)と競合するので、
// 本体は onOpen で遷移し、氏名だけを Link にして中クリック・右クリックの
// 「新しいタブで開く」を残す。

export type BedCardState = "moved-away" | "moved-in" | "drop-target" | "dragging" | "workspace";

export function WardMapBedCard({
  bed,
  roomName,
  encounter,
  patient,
  date,
  state,
  movable = false,
  onPointerDown,
  onOpen,
  menu,
  pictograms,
  tags,
  note,
}: {
  /** ベッドの Location。消えていれば undefined(欠番)。 */
  bed: fhir4.Location | undefined;
  roomName: string;
  encounter?: fhir4.Encounter;
  patient?: fhir4.Patient;
  /** 基準日。入院日数の計算に使う。 */
  date: string;
  state?: BedCardState;
  /** 掴んで動かせる(今日の表示で、患者が居るとき)。 */
  movable?: boolean;
  onPointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
  /** 本体を押したとき(カルテを開く)。ドラッグ直後の click は呼び出し側で飲む。 */
  onOpen?: () => void;
  /** ケバブメニュー。 */
  menu?: ReactNode;
  pictograms?: ReactNode;
  /** 退院予定・外出泊中などの札。 */
  tags?: ReactNode;
  /** 移動元・移動先の補足(「→ 302号室 2」など)。 */
  note?: ReactNode;
}) {
  const returnLinkState = useReturnLinkState();
  const patientId = patient?.id;
  const occupied = Boolean(encounter);
  const admission = encounter ? encounterAdmissionDate(encounter) : undefined;
  const days = admission && date >= admission ? diffDays(admission, date) + 1 : undefined;
  const age = patient?.birthDate ? calculateAge(patient.birthDate) : undefined;

  const classes = [
    "ward-map__bed",
    occupied ? "ward-map__bed--occupied" : "ward-map__bed--empty",
    bed ? "" : "ward-map__bed--stale",
    state ? `ward-map__bed--${state}` : "",
    movable ? "ward-map__bed--movable" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      onPointerDown={onPointerDown}
      onClick={onOpen}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onKeyDown={(event) => {
        if (onOpen && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="ward-map__bed-head">
        <span className="ward-map__bed-no">{bed ? bedShortLabel(bed) : "?"}</span>
        {patient && <span className="ward-map__bed-patient-no">{patientNumberOf(patient) ?? ""}</span>}
        {menu && (
          <span className="ward-map__bed-menu" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
            {menu}
          </span>
        )}
      </div>

      {occupied ? (
        <>
          <div className="ward-map__bed-name">
            {patientId ? (
              <Link
                to={`/patients/${patientId}/karte`}
                state={returnLinkState}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                {patient ? displayName(patient) : "(患者不明)"}
              </Link>
            ) : (
              <span>{patient ? displayName(patient) : "(患者不明)"}</span>
            )}
            {patient && (
              <span className="ward-map__bed-age">
                {genderShortLabel(patient.gender)}
                {age != null ? ` ${age}` : ""}
              </span>
            )}
          </div>
          <div className="ward-map__bed-meta">
            {[encounter && encounterDepartmentName(encounter), encounter && encounterAttendingName(encounter)]
              .filter(Boolean)
              .join(" / ") || " "}
          </div>
          <div className="ward-map__bed-meta ward-map__bed-meta--bottom">
            {days != null && <span className="ward-map__bed-days">入院 {days} 日目</span>}
          </div>
          {pictograms && (
            // 吹き出しを開く操作がカード本体の遷移や掴む操作に化けないようにする。
            <div
              className="ward-map__bed-pictograms"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {pictograms}
            </div>
          )}
          {tags && <div className="ward-map__bed-tags">{tags}</div>}
        </>
      ) : (
        <div className="ward-map__bed-empty">{bed ? "空床" : "削除されたベッド"}</div>
      )}
      {note && <div className="ward-map__bed-note">{note}</div>}
      <span className="ward-map__bed-room" aria-hidden="true">
        {roomName}
      </span>
    </div>
  );
}
