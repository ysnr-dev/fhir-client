import { ageWithMonthsLabel, displayKana, genderLabel } from "../fhir/patientHelpers";

// 患者を 1 行にする一覧(外来患者一覧・入院患者一覧・部門業務の各ワークリスト)で
// 共通に使う、患者そのものを表すセル。どの一覧でも同じ並び・同じ見た目で出す。
//
// 氏名は一覧ごとに出し方が違う(カルテへのリンクにする、患者が取れていない行は
// Encounter や Appointment に控えた名前で代わりに出す)ので、ここに含めるのは
// 氏名に添えるカナだけにする。

/** 氏名の後ろに小さめの括弧書きで添えるカナ。カナが無ければ何も出さない。 */
export function PatientKana({ patient }: { patient?: fhir4.Patient }) {
  const kana = patient ? displayKana(patient) : "";
  if (!kana) return null;
  return <span className="patient-cells__kana">（{kana}）</span>;
}

/** 生年月日・性別の列見出し。患者氏名の次に置く。 */
export function PatientProfileHeadCells() {
  return (
    <>
      <th>生年月日</th>
      <th>性別</th>
    </>
  );
}

/** 生年月日(年齢)・性別のセル。患者が取れていない行は "-" で埋める。 */
export function PatientProfileCells({ patient }: { patient?: fhir4.Patient }) {
  return (
    <>
      <td>
        {patient?.birthDate ?? "-"}
        {patient?.birthDate && ageWithMonthsLabel(patient.birthDate) && (
          <span className="patient-cells__age">（{ageWithMonthsLabel(patient.birthDate)}）</span>
        )}
      </td>
      <td>{patient ? genderLabel(patient.gender) : "-"}</td>
    </>
  );
}
