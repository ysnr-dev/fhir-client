import { useMemo, useState, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import type { PatientCaution } from "../api/masterClient";
import { usePatientCautions } from "../api/masterQueries";
import {
  useAllergiesForPatients,
  useDeletePatient,
  useFlagsForPatients,
  useInfectionsForPatients,
} from "../api/queries";
import {
  addressLabelOf,
  ageWithMonthsLabel,
  displayName,
  genderShortLabel,
  homePhoneOf,
  mobilePhoneOf,
} from "../fhir/patientHelpers";
import { PatientDeceasedMark, PatientKana } from "./PatientRowCells";
import { RowPictograms } from "./PatientListRowParts";
import { ErrorBanner } from "./ErrorBanner";
import { RowMenu } from "./RowMenu";
import { PatientProfileDrawer } from "./PatientProfileDrawer";
import { useReturnLinkState } from "../returnTo";

export function PatientTable({ patients }: { patients: fhir4.Patient[] }) {
  const deletePatient = useDeletePatient();
  // カルテの「戻る」でこの一覧(検索条件つき)に戻れるように遷移元を渡す。
  const returnLinkState = useReturnLinkState();

  const patientIds = useMemo(
    () => patients.map((p) => p.id).filter((id): id is string => Boolean(id)),
    [patients],
  );
  const cautions = usePatientCautions();
  const cautionsByCode = useMemo(
    () => new Map<string, PatientCaution>((cautions.data?.items ?? []).map((c) => [c.code, c])),
    [cautions.data],
  );
  const flags = useFlagsForPatients(patientIds);
  const allergies = useAllergiesForPatients(patientIds);
  const infections = useInfectionsForPatients(patientIds);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 検索し直して一覧から消えた患者は、開いたままにせず閉じる。
  const selected = patients.find((p): p is fhir4.Patient & { id: string } => p.id === selectedId);

  // 行の中のボタン・リンク(カルテ、ピクトグラム、ケバブ)は各自の操作を優先する。
  // ピクトグラムの吹き出しは body 直下へ出すが、React のイベントは行まで伝わって
  // くるので、行の DOM の外からのクリックも除く。
  function handleRowClick(event: MouseEvent<HTMLTableRowElement>, patientId: string | undefined) {
    const target = event.target as HTMLElement;
    if (!event.currentTarget.contains(target)) return;
    if (target.closest("a, button, input, [role='menu']")) return;
    if (!patientId) return;
    setSelectedId((current) => (current === patientId ? null : patientId));
  }

  function handleDelete(patient: fhir4.Patient) {
    if (!patient.id) return;
    const label = displayName(patient) || patient.id;
    if (!window.confirm(`${label} を削除します。よろしいですか?`)) return;
    deletePatient.mutate(patient.id);
  }

  if (patients.length === 0) {
    return <p className="patient-table__empty">該当する患者が見つかりませんでした。</p>;
  }

  return (
    <>
      <ErrorBanner error={deletePatient.error} />
      <table className="patient-table patient-list">
        <thead>
          <tr>
            <th>患者番号</th>
            <th>氏名</th>
            <th>性別</th>
            <th>生年月日</th>
            <th>住所</th>
            <th>固定電話</th>
            <th>携帯電話</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {patients.map((patient) => (
            <tr
              key={patient.id}
              className={
                patient.id === selectedId
                  ? "patient-table__row--clickable patient-table__row--selected"
                  : "patient-table__row--clickable"
              }
              onClick={(e) => handleRowClick(e, patient.id)}
            >
              <td>{patient.identifier?.[0]?.value ?? "-"}</td>
              <td>
                {/* 外来患者一覧と同じく、カナは氏名の後ろに括弧書きで添え、ピクトグラムを続ける。 */}
                <span className="outpatient__name-cell">
                  <span className="outpatient__name">
                    {displayName(patient) || "-"}
                    <PatientKana patient={patient} />
                  </span>
                  <PatientDeceasedMark patient={patient} />
                  <RowPictograms
                    patientId={patient.id ?? ""}
                    flags={flags.byPatient}
                    allergies={allergies.byPatient}
                    infections={infections.byPatient}
                    cautionsByCode={cautionsByCode}
                  />
                </span>
              </td>
              <td>{genderShortLabel(patient.gender)}</td>
              <td>
                {patient.birthDate ?? "-"}
                {patient.birthDate && ageWithMonthsLabel(patient.birthDate) && (
                  <span className="patient-cells__age">（{ageWithMonthsLabel(patient.birthDate)}）</span>
                )}
              </td>
              <td>{addressLabelOf(patient) || "-"}</td>
              <td>{homePhoneOf(patient) || "-"}</td>
              <td>{mobilePhoneOf(patient) || "-"}</td>
              <td className="patient-table__actions">
                <Link className="button" to={`/patients/${patient.id}/karte`} state={returnLinkState}>
                  カルテ
                </Link>
                <RowMenu label={`${displayName(patient) || patient.id} の操作`}>
                  <Link className="row-menu__item" to={`/patients/${patient.id}/edit`}>
                    患者編集
                  </Link>
                  <button
                    type="button"
                    className="row-menu__item row-menu__item--danger"
                    onClick={() => handleDelete(patient)}
                    disabled={deletePatient.isPending}
                  >
                    患者削除
                  </button>
                </RowMenu>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {selected && (
        <PatientProfileDrawer patient={selected} onClose={() => setSelectedId(null)} />
      )}
    </>
  );
}
