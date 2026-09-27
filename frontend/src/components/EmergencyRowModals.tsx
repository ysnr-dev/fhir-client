import { useState } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import {
  useEmergencyTriageHistory,
  useIdentifyProvisionalPatient,
  usePractitionerOptions,
  useUpdateEmergencyEncounter,
  type EmergencyRow,
} from "../api/queries";
import {
  buildEmergencyDisposition,
  buildTriageObservation,
  DISPOSITION_OPTIONS,
  emergencyArrivalMode,
  emergencyAttendingId,
  emergencyBedId,
  emergencyComplaint,
  emergencyTriageLevel,
  jtasLabel,
  withEmergencyDetails,
  withEmergencyOrigin,
  withoutProvisionalTag,
  withTriageLevel,
  type ArrivalMode,
  type Disposition,
} from "../fhir/emergencyEncounterHelpers";
import {
  buildPatient,
  displayName,
  parsePatient,
  validateNewPatientForm,
  type PatientFormValues,
} from "../fhir/patientHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import {
  dateTimeLabel,
  nowDateTimeInput,
  nowFhirDateTime,
  toDateTimeInputValue,
  toFhirDateTime,
} from "../lib/dates";
import { makeFieldUpdater } from "../lib/form";
import {
  ArrivalFields,
  GenderSelect,
  JtasPicker,
  useEmergencyBeds,
  type ArrivalFieldValues,
} from "./EmergencyCheckInModal";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { NameKanjiInput } from "./NameKanjiInput";
import { PlannedAdmissionForm } from "./PlannedAdmissionForm";

// 救急患者一覧の行から開くモーダル(トリアージ・来院情報の編集・転帰・身元判明)。

function patientLabel(row: EmergencyRow): string {
  return row.patient ? displayName(row.patient) : (row.encounter.subject?.display ?? "");
}

function PatientLine({ row }: { row: EmergencyRow }) {
  return (
    <div className="walk-in__patient">
      <span>{row.patient?.identifier?.[0]?.value ?? "-"}</span>
      <span>{patientLabel(row)}</span>
    </div>
  );
}

export function EmergencyTriageModal({ row, onClose }: { row: EmergencyRow; onClose: () => void }) {
  const { encounter } = row;
  const [level, setLevel] = useState<number | undefined>(emergencyTriageLevel(encounter));
  const history = useEmergencyTriageHistory(encounter.id);
  const practitioners = usePractitionerOptions();
  const { practitionerId } = useCurrentPractitioner();
  const update = useUpdateEmergencyEncounter();

  function handleSubmit() {
    if (!level || !encounter.id) return;
    const at = nowFhirDateTime();
    const performer = practitioners.practitioners.find((p) => p.id === practitionerId);
    const patientId = encounter.subject?.reference?.split("/").pop() ?? "";
    update.mutate(
      {
        encounter: withTriageLevel(encounter, level, at),
        observation: buildTriageObservation(
          patientId,
          `Encounter/${encounter.id}`,
          level,
          at,
          performer?.id ? { id: performer.id, name: practitionerDisplayName(performer) } : undefined,
        ),
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal title="トリアージ" onClose={onClose}>
      <ErrorBanner error={update.error ?? history.error} />
      <PatientLine row={row} />
      <JtasPicker value={level} onChange={setLevel} />
      <div className="walk-in__actions emergency__modal-actions">
        <button type="button" onClick={handleSubmit} disabled={!level || update.isPending}>
          {update.isPending ? "登録中..." : "登録"}
        </button>
        <button type="button" onClick={onClose} disabled={update.isPending}>
          キャンセル
        </button>
      </div>
      {(history.data?.length ?? 0) > 0 && (
        <table className="master-search__table emergency__triage-history">
          <thead>
            <tr>
              <th>判定日時</th>
              <th>JTAS</th>
              <th>判定者</th>
            </tr>
          </thead>
          <tbody>
            {history.data?.map((record, index) => (
              <tr key={`${record.at}-${index}`}>
                <td>{dateTimeLabel(record.at)}</td>
                <td>
                  <span className={`jtas-badge jtas--${record.level}`}>{record.level}</span>{" "}
                  {jtasLabel(record.level)}
                </td>
                <td>{record.performerName || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

export function EmergencyEditModal({
  row,
  occupiedBedIds,
  onClose,
}: {
  row: EmergencyRow;
  occupiedBedIds: Set<string>;
  onClose: () => void;
}) {
  const { encounter } = row;
  const [arrivedAt, setArrivedAt] = useState(toDateTimeInputValue(encounter.period?.start));
  const [fields, setFields] = useState<ArrivalFieldValues>({
    arrivalMode: (emergencyArrivalMode(encounter) ?? "") as ArrivalMode | "",
    complaint: emergencyComplaint(encounter),
    bedId: emergencyBedId(encounter) ?? "",
    practitionerId: emergencyAttendingId(encounter) ?? "",
  });
  const beds = useEmergencyBeds();
  const practitioners = usePractitionerOptions();
  const update = useUpdateEmergencyEncounter();

  function handleSubmit() {
    if (!arrivedAt) return;
    const practitioner = practitioners.practitioners.find((p) => p.id === fields.practitionerId);
    const next = withEmergencyDetails(encounter, {
      ...fields,
      bedName: beds.beds.find((b) => b.id === fields.bedId)?.name ?? "",
      practitionerName: practitioner ? practitionerDisplayName(practitioner) : "",
    });
    update.mutate(
      { encounter: { ...next, period: { ...next.period, start: toFhirDateTime(arrivedAt) } } },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal title="来院情報の編集" onClose={onClose} className="modal--wide">
      <ErrorBanner error={beds.error ?? practitioners.error ?? update.error} />
      <PatientLine row={row} />
      <div className="walk-in__fields">
        <label>
          来院日時
          <input
            type="datetime-local"
            value={arrivedAt}
            onChange={(e) => setArrivedAt(e.target.value)}
          />
        </label>
        <ArrivalFields
          values={fields}
          onChange={setFields}
          beds={beds.beds}
          occupiedBedIds={occupiedBedIds}
          practitioners={practitioners.practitioners}
        />
      </div>
      <div className="walk-in__actions">
        <button type="button" onClick={handleSubmit} disabled={!arrivedAt || update.isPending}>
          {update.isPending ? "保存中..." : "保存"}
        </button>
        <button type="button" onClick={onClose} disabled={update.isPending}>
          キャンセル
        </button>
      </div>
    </Modal>
  );
}

/**
 * 転帰の入力。「入院」を選んだら、確定したあとそのまま入院予定の入力に進む
 * (病棟・ベッドはここでは決めず、入院予定から入院実施の流れに乗せる)。
 */
export function EmergencyDispositionModal({
  row,
  onClose,
}: {
  row: EmergencyRow;
  onClose: () => void;
}) {
  const { encounter, patient } = row;
  const [disposition, setDisposition] = useState<Disposition | "">("");
  const [endedAt, setEndedAt] = useState(nowDateTimeInput());
  const [admitting, setAdmitting] = useState(false);
  const update = useUpdateEmergencyEncounter();

  function handleSubmit() {
    if (!disposition || !endedAt) return;
    update.mutate(
      { encounter: buildEmergencyDisposition(encounter, disposition, toFhirDateTime(endedAt)) },
      {
        onSuccess: () => {
          if (disposition === "admitted" && patient) setAdmitting(true);
          else onClose();
        },
      },
    );
  }

  if (admitting && patient) {
    return (
      <Modal title="入院予定の登録" onClose={onClose} className="modal--wide">
        <PlannedAdmissionForm
          patient={patient}
          header={() => <PatientLine row={row} />}
          prepare={(planned) => withEmergencyOrigin(planned, encounter.id as string)}
          onSaved={onClose}
          onCancel={onClose}
        />
      </Modal>
    );
  }

  return (
    <Modal title="転帰" onClose={onClose}>
      <ErrorBanner error={update.error} />
      <PatientLine row={row} />
      <div className="walk-in__fields">
        <label>
          転帰
          <select
            value={disposition}
            onChange={(e) => setDisposition(e.target.value as Disposition | "")}
          >
            <option value="">選択してください</option>
            {DISPOSITION_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          退室日時
          <input
            type="datetime-local"
            value={endedAt}
            onChange={(e) => setEndedAt(e.target.value)}
          />
        </label>
      </div>
      <div className="walk-in__actions">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!disposition || !endedAt || update.isPending}
        >
          {update.isPending ? "登録中..." : "確定"}
        </button>
        <button type="button" onClick={onClose} disabled={update.isPending}>
          キャンセル
        </button>
      </div>
    </Modal>
  );
}

/** 身元判明。仮登録した患者の氏名・生年月日などを書き換え、仮の印を外す。 */
export function EmergencyIdentifyModal({
  patient,
  onClose,
}: {
  patient: fhir4.Patient;
  onClose: () => void;
}) {
  const [values, setValues] = useState<PatientFormValues>(() => ({
    ...parsePatient(patient),
    familyKanji: "",
    givenKanji: "",
    familyKana: "",
    givenKana: "",
  }));
  const [validationError, setValidationError] = useState<string | null>(null);
  const identify = useIdentifyProvisionalPatient();
  const update = makeFieldUpdater(setValues);

  function handleSubmit() {
    const error = validateNewPatientForm(values);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    const rebuilt = buildPatient(values, patient.id);
    identify.mutate(withoutProvisionalTag({ ...rebuilt, meta: patient.meta }), {
      onSuccess: onClose,
    });
  }

  return (
    <Modal title="身元判明" onClose={onClose} className="modal--wide">
      <ErrorBanner error={identify.error} />
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}
      <div className="walk-in__patient">
        <span>{patient.identifier?.[0]?.value ?? "-"}</span>
        <span>{displayName(patient)}</span>
      </div>
      <div className="walk-in__fields">
        <label>
          姓
          <NameKanjiInput
            value={values.familyKanji}
            onChange={(v) => update("familyKanji", v)}
            kana={values.familyKana}
            onKanaChange={(v) => update("familyKana", v)}
          />
        </label>
        <label>
          名
          <NameKanjiInput
            value={values.givenKanji}
            onChange={(v) => update("givenKanji", v)}
            kana={values.givenKana}
            onKanaChange={(v) => update("givenKana", v)}
          />
        </label>
        <label>
          セイ
          <input
            type="text"
            value={values.familyKana}
            onChange={(e) => update("familyKana", e.target.value)}
          />
        </label>
        <label>
          メイ
          <input
            type="text"
            value={values.givenKana}
            onChange={(e) => update("givenKana", e.target.value)}
          />
        </label>
        <label>
          性別
          <GenderSelect value={values.gender} onChange={(v) => update("gender", v)} allowEmpty />
        </label>
        <label>
          生年月日
          <input
            type="date"
            value={values.birthDate}
            onChange={(e) => update("birthDate", e.target.value)}
          />
        </label>
      </div>
      <div className="walk-in__actions">
        <button type="button" onClick={handleSubmit} disabled={identify.isPending}>
          {identify.isPending ? "保存中..." : "保存"}
        </button>
        <button type="button" onClick={onClose} disabled={identify.isPending}>
          キャンセル
        </button>
      </div>
    </Modal>
  );
}
