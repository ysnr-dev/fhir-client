import { useMemo, useState } from "react";
import { useCurrentPractitioner } from "../api/authQueries";
import {
  useCreatePatient,
  useEmergencyCheckIn,
  useLocationOptions,
  usePractitionerOptions,
} from "../api/queries";
import {
  ARRIVAL_MODE_OPTIONS,
  buildEmergencyEncounter,
  buildTriageObservation,
  JTAS_LEVELS,
  provisionalGivenName,
  withProvisionalTag,
  type ArrivalMode,
} from "../fhir/emergencyEncounterHelpers";
import { locationTypeCode } from "../fhir/locationHelpers";
import {
  buildPatient,
  displayName,
  emptyPatientForm,
  validateNewPatientForm,
  type Gender,
  type PatientFormValues,
} from "../fhir/patientHelpers";
import { practitionerDisplayName } from "../fhir/practitionerHelpers";
import { nowDateTimeInput, toFhirDateTime } from "../lib/dates";
import { ErrorBanner } from "./ErrorBanner";
import { Modal } from "./Modal";
import { NewPatientFields } from "./NewPatientFields";
import { WalkInPatientSearch } from "./WalkInCheckInModal";

// 救急受付。患者を決め(既存患者・新患・身元不明)、来院情報を添えて救急の受診を建てる。
// 新患・身元不明は患者を登録してから受診を建てる二段階(新患登録モーダルと同じ)。

/** 救急の処置ベッド(場所種別 ER の Location)。 */
export const EMERGENCY_LOCATION_TYPE_CODE = "ER";

export function useEmergencyBeds() {
  const locations = useLocationOptions();
  const beds = useMemo(
    () => locations.locations.filter((l) => locationTypeCode(l) === EMERGENCY_LOCATION_TYPE_CODE),
    [locations.locations],
  );
  return { ...locations, beds };
}

export interface ArrivalFieldValues {
  arrivalMode: ArrivalMode | "";
  complaint: string;
  bedId: string;
  practitionerId: string;
}

export const emptyArrivalFields: ArrivalFieldValues = {
  arrivalMode: "",
  complaint: "",
  bedId: "",
  practitionerId: "",
};

/** 来院方法・主訴・ベッド・担当医の入力欄。受付と編集で共用する。 */
export function ArrivalFields({
  values,
  onChange,
  beds,
  occupiedBedIds,
  practitioners,
}: {
  values: ArrivalFieldValues;
  onChange: (values: ArrivalFieldValues) => void;
  beds: fhir4.Location[];
  /** 他の患者が使っているベッド。選択肢に「使用中」と添える。 */
  occupiedBedIds: Set<string>;
  practitioners: fhir4.Practitioner[];
}) {
  function update<K extends keyof ArrivalFieldValues>(key: K, value: ArrivalFieldValues[K]) {
    onChange({ ...values, [key]: value });
  }
  return (
    <>
      <label>
        来院方法
        <select
          value={values.arrivalMode}
          onChange={(e) => update("arrivalMode", e.target.value as ArrivalMode | "")}
        >
          <option value="">未指定</option>
          {ARRIVAL_MODE_OPTIONS.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        ベッド
        <select value={values.bedId} onChange={(e) => update("bedId", e.target.value)}>
          <option value="">未指定</option>
          {beds.map((bed) => (
            <option key={bed.id} value={bed.id}>
              {bed.name}
              {bed.id !== values.bedId && bed.id && occupiedBedIds.has(bed.id) ? "（使用中）" : ""}
            </option>
          ))}
        </select>
      </label>
      <label>
        担当医
        <select
          value={values.practitionerId}
          onChange={(e) => update("practitionerId", e.target.value)}
        >
          <option value="">未指定</option>
          {practitioners.map((p) => (
            <option key={p.id} value={p.id}>
              {practitionerDisplayName(p)}
            </option>
          ))}
        </select>
      </label>
      <label className="emergency__complaint">
        主訴
        <input
          type="text"
          value={values.complaint}
          onChange={(e) => update("complaint", e.target.value)}
        />
      </label>
    </>
  );
}

/** JTAS のレベルを色付きボタンで選ぶ。allowNone なら「未判定」も選べる。 */
export function JtasPicker({
  value,
  onChange,
  allowNone = false,
}: {
  value: number | undefined;
  onChange: (level: number | undefined) => void;
  allowNone?: boolean;
}) {
  return (
    <div className="jtas-picker" role="radiogroup" aria-label="JTAS">
      {JTAS_LEVELS.map(({ level, label }) => (
        <button
          key={level}
          type="button"
          role="radio"
          aria-checked={value === level}
          className={`jtas-picker__option jtas--${level}${value === level ? " jtas-picker__option--selected" : ""}`}
          onClick={() => onChange(level)}
        >
          {level} {label}
        </button>
      ))}
      {allowNone && (
        <button
          type="button"
          role="radio"
          aria-checked={value === undefined}
          className={`jtas-picker__option${value === undefined ? " jtas-picker__option--selected" : ""}`}
          onClick={() => onChange(undefined)}
        >
          未判定
        </button>
      )}
    </div>
  );
}

type PatientMode = "existing" | "new" | "unidentified";

export function EmergencyCheckInModal({
  occupiedBedIds,
  onClose,
}: {
  occupiedBedIds: Set<string>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<PatientMode>("existing");
  const [patient, setPatient] = useState<fhir4.Patient | null>(null);
  const [patientValues, setPatientValues] = useState<PatientFormValues>(emptyPatientForm);
  const [unidentifiedGender, setUnidentifiedGender] = useState<Gender>("unknown");
  const [arrivedAt, setArrivedAt] = useState(nowDateTimeInput());
  const [fields, setFields] = useState<ArrivalFieldValues>(emptyArrivalFields);
  const [triageLevel, setTriageLevel] = useState<number | undefined>(undefined);
  const [validationError, setValidationError] = useState<string | null>(null);

  const beds = useEmergencyBeds();
  const practitioners = usePractitionerOptions();
  const { practitionerId: currentPractitionerId } = useCurrentPractitioner();
  const createPatient = useCreatePatient();
  const checkIn = useEmergencyCheckIn();
  const submitting = createPatient.isPending || checkIn.isPending;

  function practitionerName(id: string | null | undefined): string {
    const found = practitioners.practitioners.find((p) => p.id === id);
    return found ? practitionerDisplayName(found) : "";
  }

  function register(target: fhir4.Patient) {
    const at = toFhirDateTime(arrivedAt);
    const encounter = buildEmergencyEncounter(
      target,
      {
        arrivedAt: at,
        arrivalMode: fields.arrivalMode,
        complaint: fields.complaint,
        bedId: fields.bedId,
        bedName: beds.beds.find((b) => b.id === fields.bedId)?.name ?? "",
        practitionerId: fields.practitionerId,
        practitionerName: practitionerName(fields.practitionerId),
      },
      triageLevel,
    );
    const performer = currentPractitionerId
      ? { id: currentPractitionerId, name: practitionerName(currentPractitionerId) }
      : undefined;
    checkIn.mutate(
      {
        encounter,
        triage: triageLevel
          ? (ref) => buildTriageObservation(target.id as string, ref, triageLevel, at, performer)
          : undefined,
      },
      { onSuccess: onClose },
    );
  }

  function handleSubmit() {
    if (!arrivedAt) {
      setValidationError("来院日時は必須です。");
      return;
    }
    if (mode === "existing") {
      if (!patient) {
        setValidationError("患者を選んでください。");
        return;
      }
      setValidationError(null);
      register(patient);
      return;
    }

    let newPatient: fhir4.Patient;
    if (mode === "new") {
      const error = validateNewPatientForm(patientValues);
      if (error) {
        setValidationError(error);
        return;
      }
      newPatient = buildPatient(patientValues);
    } else {
      newPatient = withProvisionalTag(
        buildPatient({
          ...emptyPatientForm,
          familyKanji: "不明",
          givenKanji: provisionalGivenName(unidentifiedGender, arrivedAt),
          familyKana: "フメイ",
          gender: unidentifiedGender,
        }),
      );
    }
    setValidationError(null);
    createPatient.mutate(newPatient, { onSuccess: (result) => register(result.data) });
  }

  const arrivalSection = (
    <>
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

        <div className="emergency__triage-field">
          <span>JTAS</span>
          <JtasPicker value={triageLevel} onChange={setTriageLevel} allowNone />
        </div>
    </>
  );

  return (
    <Modal title="救急受付" onClose={onClose} className="modal--wide">
      <ErrorBanner error={beds.error ?? practitioners.error} />
      <ErrorBanner error={createPatient.error ?? checkIn.error} />
      {validationError && (
        <div className="error-banner" role="alert">
          <p className="error-banner__line error-banner__line--error">{validationError}</p>
        </div>
      )}

      <div className="emergency__modes" role="radiogroup" aria-label="患者">
        {(
          [
            ["existing", "既存患者"],
            ["new", "新患"],
            ["unidentified", "身元不明"],
          ] as const
        ).map(([code, label]) => (
          <label key={code}>
            <input
              type="radio"
              name="emergency-patient-mode"
              checked={mode === code}
              onChange={() => setMode(code)}
              disabled={submitting}
            />
            {label}
          </label>
        ))}
      </div>

      {mode === "existing" &&
        (patient ? (
          <div className="walk-in__patient">
            <span>{patient.identifier?.[0]?.value ?? "-"}</span>
            <span>{displayName(patient)}</span>
            <button type="button" onClick={() => setPatient(null)} disabled={submitting}>
              選び直す
            </button>
          </div>
        ) : (
          <div className="emergency__patient-search">
            <WalkInPatientSearch onSelect={setPatient} />
          </div>
        ))}

      {mode === "unidentified" && (
        <div className="walk-in__fields">
          <label>
            性別
            <GenderSelect value={unidentifiedGender} onChange={setUnidentifiedGender} />
          </label>
        </div>
      )}

      {mode === "new" ? (
        <div className="patient-fields">
          <NewPatientFields values={patientValues} setValues={setPatientValues} />
          <fieldset className="patient-fields__group-box">
            <legend>受付情報</legend>
            {arrivalSection}
          </fieldset>
        </div>
      ) : (
        arrivalSection
      )}

      <div className={`walk-in__actions${mode === "new" ? " patient-fields__actions" : ""}`}>
        <button type="button" onClick={handleSubmit} disabled={submitting}>
          {mode === "new"
            ? submitting
              ? "登録中..."
              : "登録して受付"
            : submitting
              ? "受付中..."
              : "受付"}
        </button>
        <button type="button" onClick={onClose} disabled={submitting}>
          キャンセル
        </button>
      </div>
    </Modal>
  );
}

export function GenderSelect({
  value,
  onChange,
  allowEmpty = false,
}: {
  value: Gender;
  onChange: (value: Gender) => void;
  allowEmpty?: boolean;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as Gender)}>
      {allowEmpty && <option value="">未指定</option>}
      <option value="male">男性</option>
      <option value="female">女性</option>
      <option value="other">その他</option>
      <option value="unknown">不明</option>
    </select>
  );
}
