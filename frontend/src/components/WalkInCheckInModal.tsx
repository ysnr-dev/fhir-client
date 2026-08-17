import { useState, type KeyboardEvent } from "react";
import {
  useDepartmentList,
  useLocationOptions,
  usePatientSearch,
  usePractitionerOptions,
  useWalkInCheckIn,
  type PatientSearchParams,
} from "../api/queries";
import { buildWalkInAppointment } from "../fhir/appointmentHelpers";
import { departmentCode, departmentDisplayName } from "../fhir/departmentHelpers";
import { displayKana, displayName } from "../fhir/patientHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { Pagination } from "./Pagination";

// 当日受付。予約なしで来院した患者を探して、その場で受付済の予約を作る。
//
// 患者を選ぶまでは検索、選んだら診療科・担当医・診察室を添えて受付する二段構え。
// 検索は上流 FHIR サーバーへのリクエストになるため検索ボタンで確定する
// (医療機関検索モーダルと同じ inputs / search の二段構え)。

interface WalkInCheckInModalProps {
  onClose: () => void;
}

interface WalkInSelects {
  departmentId: string;
  practitionerId: string;
  locationId: string;
}

const emptySelects: WalkInSelects = { departmentId: "", practitionerId: "", locationId: "" };

export function WalkInCheckInModal({ onClose }: WalkInCheckInModalProps) {
  const [patient, setPatient] = useState<fhir4.Patient | null>(null);
  const [selects, setSelects] = useState<WalkInSelects>(emptySelects);

  const departments = useDepartmentList({});
  const practitioners = usePractitionerOptions();
  const locations = useLocationOptions();
  const checkIn = useWalkInCheckIn();

  function handleSubmit() {
    if (!patient) return;
    const department = departments.departments.find((d) => d.id === selects.departmentId);
    const practitioner = practitioners.practitioners.find((p) => p.id === selects.practitionerId);
    const location = locations.locations.find((l) => l.id === selects.locationId);

    const appointment = buildWalkInAppointment(
      patient,
      {
        departmentCode: department ? departmentCode(department) : "",
        departmentName: department ? departmentDisplayName(department) : "",
        practitionerId: selects.practitionerId,
        practitionerName: practitioner ? practitionerDisplayName(practitioner) : "",
        locationId: selects.locationId,
        locationName: location?.name ?? "",
      },
      new Date(),
    );
    checkIn.mutate(appointment, { onSuccess: onClose });
  }

  return (
    <Modal title="当日受付" onClose={onClose} className="modal--wide">
      <ErrorBanner error={departments.error ?? practitioners.error ?? locations.error} />
      <ErrorBanner error={checkIn.error} />

      {patient ? (
        <div className="walk-in">
          <div className="walk-in__patient">
            <span>{patient.identifier?.[0]?.value ?? "-"}</span>
            <span>{displayName(patient)}</span>
            <button type="button" onClick={() => setPatient(null)} disabled={checkIn.isPending}>
              選び直す
            </button>
          </div>

          <div className="walk-in__fields">
            <label>
              診療科
              <select
                value={selects.departmentId}
                onChange={(e) => setSelects({ ...selects, departmentId: e.target.value })}
              >
                <option value="">未指定</option>
                {departments.departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {departmentDisplayName(department)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              担当医
              <select
                value={selects.practitionerId}
                onChange={(e) => setSelects({ ...selects, practitionerId: e.target.value })}
              >
                <option value="">未指定</option>
                {practitioners.practitioners.map((practitioner) => (
                  <option key={practitioner.id} value={practitioner.id}>
                    {practitionerDisplayName(practitioner)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              診察室
              <select
                value={selects.locationId}
                onChange={(e) => setSelects({ ...selects, locationId: e.target.value })}
              >
                <option value="">未指定</option>
                {locations.locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="walk-in__actions">
            <button type="button" onClick={handleSubmit} disabled={checkIn.isPending}>
              {checkIn.isPending ? "受付中..." : "受付"}
            </button>
            <button type="button" onClick={onClose} disabled={checkIn.isPending}>
              キャンセル
            </button>
          </div>
        </div>
      ) : (
        <WalkInPatientSearch onSelect={setPatient} />
      )}
    </Modal>
  );
}

function WalkInPatientSearch({ onSelect }: { onSelect: (patient: fhir4.Patient) => void }) {
  const [inputs, setInputs] = useState<PatientSearchParams>({ name: "", identifier: "" });
  const [search, setSearch] = useState<PatientSearchParams>({});
  const [offset, setOffset] = useState(0);

  const { bundle, total, count, hasPrevious, hasNext, isFetching, error } = usePatientSearch(
    search,
    offset,
  );
  const patients =
    bundle?.entry?.map((e) => e.resource).filter((r): r is fhir4.Patient => Boolean(r)) ?? [];

  function runSearch() {
    setSearch(inputs);
    setOffset(0);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      runSearch();
    }
  }

  return (
    <>
      <div className="master-search__form">
        <label>
          患者番号
          <input
            type="text"
            value={inputs.identifier}
            onChange={(e) => setInputs({ ...inputs, identifier: e.target.value })}
            onKeyDown={handleKeyDown}
          />
        </label>
        <label>
          氏名(漢字・カナ部分一致)
          <input
            type="text"
            value={inputs.name}
            onChange={(e) => setInputs({ ...inputs, name: e.target.value })}
            onKeyDown={handleKeyDown}
          />
        </label>
        <button type="button" onClick={runSearch} disabled={isFetching}>
          検索
        </button>
      </div>
      <ErrorBanner error={error} />
      <div className="master-search__table-wrap">
        <table className="master-search__table">
          <thead>
            <tr>
              <th>患者番号</th>
              <th>氏名</th>
              <th>カナ</th>
              <th>生年月日</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {patients.map((patient) => (
              <tr key={patient.id}>
                <td>{patient.identifier?.[0]?.value ?? "-"}</td>
                <td>{displayName(patient)}</td>
                <td>{displayKana(patient)}</td>
                <td>{patient.birthDate ?? "-"}</td>
                <td className="master-search__actions">
                  <button type="button" onClick={() => onSelect(patient)}>
                    選択
                  </button>
                </td>
              </tr>
            ))}
            {!isFetching && patients.length === 0 && (
              <tr>
                <td colSpan={5} className="master-search__empty">
                  該当する患者がいません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination
        offset={offset}
        count={count}
        total={total}
        hasPrevious={hasPrevious}
        hasNext={hasNext}
        onPrevious={() => setOffset((o) => Math.max(0, o - count))}
        onNext={() => setOffset((o) => o + count)}
      />
    </>
  );
}
