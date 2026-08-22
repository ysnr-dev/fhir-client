import { useState, type KeyboardEvent } from "react";
import {
  useAdmitPatient,
  usePatientSearch,
  usePractitionerOptions,
  useSelfDepartments,
  type PatientSearchParams,
} from "../api/queries";
import { departmentDisplayName } from "../fhir/departmentHelpers";
import {
  buildAdmissionEncounter,
  validateAdmissionForm,
  type AdmissionFormValues,
} from "../fhir/encounterHelpers";
import { displayKana, displayName } from "../fhir/patientHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { bedDisplayName } from "../fhir/wardHelpers";
import { today } from "../lib/dates";
import { makeFieldUpdater } from "../lib/form";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { Pagination } from "./Pagination";

// 空きベッドへの入院登録。患者を選ぶまでは検索、選んだら診療科・主治医・担当看護師・
// 入院日・特記事項を添えて登録する二段構え(当日受付モーダルと同じ形)。

interface AdmissionModalProps {
  bed: fhir4.Location;
  roomName: string;
  /** 入院日の既定値。一覧で見ている日を渡す。 */
  defaultAdmissionDate?: string;
  /** 患者 id -> 既に入院しているベッドの表示名。二重入院の警告に使う。 */
  admittedBedLabelByPatientId: Map<string, string>;
  onClose: () => void;
}

export function AdmissionModal({
  bed,
  roomName,
  defaultAdmissionDate,
  admittedBedLabelByPatientId,
  onClose,
}: AdmissionModalProps) {
  const [patient, setPatient] = useState<fhir4.Patient | null>(null);
  const [values, setValues] = useState<AdmissionFormValues>({
    departmentId: "",
    practitionerId: "",
    nurseIds: [],
    admissionDate: defaultAdmissionDate || today(),
    note: "",
  });
  const [validationError, setValidationError] = useState<string | null>(null);
  // 担当看護師セレクトの選択中の値。追加したら空に戻すので values とは別に持つ。
  const [nursePick, setNursePick] = useState("");

  const departments = useSelfDepartments();
  const practitioners = usePractitionerOptions();
  const admit = useAdmitPatient();

  const update = makeFieldUpdater(setValues);
  const bedLabel = bedDisplayName(bed, roomName);

  function addNurse(id: string) {
    if (!id) return;
    setValues((current) =>
      current.nurseIds.includes(id)
        ? current
        : { ...current, nurseIds: [...current.nurseIds, id] },
    );
    // 追加したらセレクトは「選択してください」に戻す。続けて次の人を選べる。
    setNursePick("");
  }

  function removeNurse(id: string) {
    setValues((current) => ({
      ...current,
      nurseIds: current.nurseIds.filter((n) => n !== id),
    }));
  }

  function practitionerName(id: string): string {
    const found = practitioners.practitioners.find((p) => p.id === id);
    return found ? practitionerDisplayName(found) : id;
  }

  function handleSubmit() {
    if (!patient?.id || !bed.id) return;

    const error = validateAdmissionForm(values);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);

    // 転床やデータ修正の途中ということもあるので、止めずに確認だけする。
    const admittedBed = admittedBedLabelByPatientId.get(patient.id);
    if (admittedBed) {
      const label = displayName(patient);
      if (!window.confirm(`${label} は既に入院しています(${admittedBed})。このまま入院登録しますか?`)) {
        return;
      }
    }

    const department = departments.departments.find((d) => d.id === values.departmentId);
    const practitioner = practitioners.practitioners.find((p) => p.id === values.practitionerId);
    const nurses = values.nurseIds
      .map((id) => practitioners.practitioners.find((p) => p.id === id))
      .filter((p): p is fhir4.Practitioner => Boolean(p?.id))
      .map((p) => ({ id: p.id as string, name: practitionerDisplayName(p) }));

    const encounter = buildAdmissionEncounter(
      patient,
      {
        bedId: bed.id,
        bedLabel,
        departmentName: department ? departmentDisplayName(department) : "",
        practitionerName: practitioner ? practitionerDisplayName(practitioner) : "",
        nurses,
      },
      values,
    );
    admit.mutate(encounter, { onSuccess: onClose });
  }

  return (
    <Modal title={`入院登録 - ${bedLabel}`} onClose={onClose} className="modal--wide">
      <ErrorBanner error={departments.error ?? practitioners.error} />
      <ErrorBanner error={admit.error} />
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}

      {patient ? (
        <div className="walk-in">
          <div className="walk-in__patient">
            <span>{patient.identifier?.[0]?.value ?? "-"}</span>
            <span>{displayName(patient)}</span>
            <button type="button" onClick={() => setPatient(null)} disabled={admit.isPending}>
              選び直す
            </button>
          </div>

          <div className="walk-in__fields">
            <label>
              入院先
              <input type="text" value={bedLabel} readOnly />
            </label>
            <label>
              診療科(必須)
              <select
                value={values.departmentId}
                onChange={(e) => update("departmentId", e.target.value)}
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
              主治医
              <select
                value={values.practitionerId}
                onChange={(e) => update("practitionerId", e.target.value)}
              >
                <option value="">未指定</option>
                {practitioners.practitioners.map((practitioner) => (
                  <option key={practitioner.id} value={practitioner.id}>
                    {practitionerDisplayName(practitioner)}
                  </option>
                ))}
              </select>
            </label>
            <div className="admission__nurses">
              {/* 複数選べるので、セレクトで 1 人ずつ足して下に並べる。
                  select multiple は Ctrl 押しながらのクリックが要って選び方が
                  見て分からないため使わない。 */}
              <label>
                担当看護師
                <div className="admission__nurse-pick">
                  <select value={nursePick} onChange={(e) => setNursePick(e.target.value)}>
                    <option value="">看護師を選択</option>
                    {practitioners.practitioners
                      // 選んだ人はセレクトから消して、二重に足せないようにする。
                      .filter((p) => !values.nurseIds.includes(p.id as string))
                      .map((practitioner) => (
                        <option key={practitioner.id} value={practitioner.id}>
                          {practitionerDisplayName(practitioner)}
                        </option>
                      ))}
                  </select>
                  <button type="button" onClick={() => addNurse(nursePick)} disabled={!nursePick}>
                    追加
                  </button>
                </div>
              </label>

              {values.nurseIds.length > 0 && (
                <ul className="admission__nurse-chips">
                  {values.nurseIds.map((id) => (
                    <li key={id}>
                      {practitionerName(id)}
                      <button
                        type="button"
                        className="order-select__remove"
                        onClick={() => removeNurse(id)}
                        aria-label={`${practitionerName(id)} を担当から外す`}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <label>
              入院日(必須)
              <input
                type="date"
                value={values.admissionDate}
                onChange={(e) => update("admissionDate", e.target.value)}
              />
            </label>
            <label className="admission__note">
              特記事項
              <textarea
                rows={2}
                value={values.note}
                onChange={(e) => update("note", e.target.value)}
              />
            </label>
          </div>

          <div className="walk-in__actions">
            <button type="button" onClick={handleSubmit} disabled={admit.isPending}>
              {admit.isPending ? "登録中..." : "入院登録"}
            </button>
            <button type="button" onClick={onClose} disabled={admit.isPending}>
              キャンセル
            </button>
          </div>
        </div>
      ) : (
        <AdmissionPatientSearch onSelect={setPatient} />
      )}
    </Modal>
  );
}

function AdmissionPatientSearch({ onSelect }: { onSelect: (patient: fhir4.Patient) => void }) {
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
