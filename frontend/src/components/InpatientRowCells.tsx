import { Link } from "react-router-dom";
import {
  encounterAttendingName,
  encounterDepartmentName,
  encounterNurseNames,
} from "../fhir/encounterHelpers";
import {
  ageWithMonthsLabel,
  displayKana,
  displayName,
  genderLabel,
} from "../fhir/patientHelpers";
import { useKarteLinkState } from "../karteReturn";

// 入院患者一覧のどのタブでも同じ並び・同じ見た目で出す部分。
// 日付まわりと操作はタブごとに違うので、ここには含めない。
// 病室・ベッドはここに含める(左の固定列なので、クラスの付け忘れで固定が崩れる
// のを防ぎたい)。中身が「今どこに居るか」か「どこへ移るか」かはタブ側で決める。

/** 病室〜担当看護師の列見出し。 */
export function InpatientHeadCells() {
  return (
    <>
      <th className="inpatient__col-room">病室</th>
      <th className="inpatient__col-bed">ベッド</th>
      <th className="inpatient__col-name">患者氏名</th>
      <th>生年月日</th>
      <th>性別</th>
      <th>診療科</th>
      <th>主治医</th>
      <th>担当看護師</th>
    </>
  );
}

export function InpatientBodyCells({
  roomName,
  bedName,
  encounter,
  patient,
  departmentName,
}: {
  roomName: string;
  bedName: string;
  encounter: fhir4.Encounter;
  /** _include で取れていれば渡す。無ければ Encounter に控えた氏名で出す。 */
  patient?: fhir4.Patient;
  /** 診療科の表示の差し替え。転科・転棟タブは移動先の科を出す。 */
  departmentName?: string;
}) {
  return (
    <>
      <td className="inpatient__room inpatient__col-room">{roomName}</td>
      <td className="inpatient__col-bed">{bedName}</td>
      <td className="inpatient__name inpatient__col-name">
        {patient ? (
          <>
            {/* カナは列を分けず、氏名の後ろに小さめの括弧書きで添える。 */}
            {displayName(patient)}
            {displayKana(patient) && (
              <span className="inpatient__kana">（{displayKana(patient)}）</span>
            )}
          </>
        ) : (
          (encounter.subject?.display ?? "-")
        )}
      </td>
      <td>
        {patient?.birthDate ?? "-"}
        {patient?.birthDate && ageWithMonthsLabel(patient.birthDate) && (
          <span className="inpatient__age">（{ageWithMonthsLabel(patient.birthDate)}）</span>
        )}
      </td>
      <td>{patient ? genderLabel(patient.gender) : "-"}</td>
      <td>{departmentName || encounterDepartmentName(encounter)}</td>
      <td>{encounterAttendingName(encounter)}</td>
      <td>{encounterNurseNames(encounter).join("、") || "-"}</td>
    </>
  );
}

/** 操作列の先頭に置くカルテへのリンク。患者が取れていないときは出さない。 */
export function KarteLink({ patient }: { patient?: fhir4.Patient }) {
  const karteLinkState = useKarteLinkState();
  if (!patient?.id) return null;
  return (
    <Link className="button" to={`/patients/${patient.id}/karte`} state={karteLinkState}>
      カルテ
    </Link>
  );
}
