// 救急外来の受診(Encounter)の組み立て・復元。救急患者一覧(/emergency)とカルテが使う。
//
// 救急は予約を持たないので、来院した時点で Encounter を 1 件建て、来院から転帰までを
// その 1 件の status で追う(外来のように Appointment と組み合わせない)。
//
//   class       : v3-ActCode の EMER(救急)。Coding 単体(入院・外来と同じ)
//   status      : arrived(来院) → triaged(トリアージ済) → in-progress(診察中)
//                 → finished(転帰確定)。来院登録の誤りは entered-in-error
//   statusHistory : 過ぎた status と、その status だった期間。巻き戻し(診察開始の取消など)は
//                 末尾を 1 つ戻す
//   period      : start=来院日時、end=退室日時(転帰確定で入れる)。end が無い間は滞在中で、
//                 上流の date 検索(期間の重なり)は日をまたいでも拾う
//   hospitalization.admitSource          : 来院方法
//   hospitalization.dischargeDisposition : 転帰
//   reasonCode[0].text : 主訴
//   location[0] : 救急の処置ベッド(場所種別 ER の Location)
//   participant : 担当医(種別 ATND)
//   extension   : JTAS の現在のレベル(一覧の表示・並べ替え用。判定の履歴は Observation)
//
// 入院・外来とは class で分かれているので、既存の一覧には混ざらない。

import {
  ACT_CODE_SYSTEM,
  ATTENDING_PARTICIPANT_CODE,
  PARTICIPATION_TYPE_SYSTEM,
  encounterAttendingId,
  encounterPatientId,
} from "./encounterHelpers";
import { withAmbulanceArrival } from "./admissionRouteHelpers";
import { displayName } from "./patientHelpers";
import { referenceId } from "./shared";

/** 救急を表す Encounter.class のコード。 */
export const EMERGENCY_CLASS_CODE = "EMER";

export type EmergencyStatus = "arrived" | "triaged" | "in-progress" | "finished";

/** 滞在中(一覧で常に出す)の status。 */
export const EMERGENCY_ACTIVE_STATUSES: EmergencyStatus[] = ["arrived", "triaged", "in-progress"];
export const EMERGENCY_FINISHED_STATUS = "finished";
export const EMERGENCY_CANCELLED_STATUS = "entered-in-error";

export const EMERGENCY_STATUS_OPTIONS: { code: EmergencyStatus; label: string }[] = [
  { code: "arrived", label: "来院" },
  { code: "triaged", label: "トリアージ済" },
  { code: "in-progress", label: "診察中" },
  { code: "finished", label: "転帰確定" },
];

export function emergencyStatusLabel(status: string | undefined): string {
  return EMERGENCY_STATUS_OPTIONS.find((o) => o.code === status)?.label ?? status ?? "-";
}

export function isEmergencyActive(encounter: fhir4.Encounter): boolean {
  return (EMERGENCY_ACTIVE_STATUSES as string[]).includes(encounter.status);
}

// ---- コード表 ----

export const ARRIVAL_MODE_SYSTEM = "http://fhir-client.local/CodeSystem/emergency-arrival-mode";

export const ARRIVAL_MODE_OPTIONS = [
  { code: "ambulance", label: "救急車", mark: "救" },
  { code: "doctor-heli", label: "ドクターヘリ", mark: "ヘ" },
  { code: "doctor-car", label: "ドクターカー", mark: "DC" },
  { code: "walk-in", label: "自力来院", mark: "" },
  { code: "referral", label: "紹介", mark: "紹" },
  { code: "transfer", label: "転院搬送", mark: "転" },
] as const;

export type ArrivalMode = (typeof ARRIVAL_MODE_OPTIONS)[number]["code"];

export function arrivalModeLabel(code: string | undefined): string {
  return ARRIVAL_MODE_OPTIONS.find((o) => o.code === code)?.label ?? "";
}

export function arrivalModeMark(code: string | undefined): string {
  return ARRIVAL_MODE_OPTIONS.find((o) => o.code === code)?.mark ?? "";
}

export const DISPOSITION_SYSTEM = "http://fhir-client.local/CodeSystem/emergency-disposition";

export const DISPOSITION_OPTIONS = [
  { code: "home", label: "帰宅" },
  { code: "admitted", label: "入院" },
  { code: "transferred", label: "転院" },
  { code: "deceased", label: "死亡" },
  { code: "left", label: "診察前離院" },
  { code: "other", label: "その他" },
] as const;

export type Disposition = (typeof DISPOSITION_OPTIONS)[number]["code"];

export function dispositionLabel(code: string | undefined): string {
  return DISPOSITION_OPTIONS.find((o) => o.code === code)?.label ?? "";
}

// JTAS(緊急度判定支援システム)の 5 段階。色は JTAS の色分け(青・赤・黄・緑・白)。
export const JTAS_LEVEL_SYSTEM = "http://fhir-client.local/CodeSystem/jtas-level";

export const JTAS_LEVELS = [
  { level: 1, label: "蘇生" },
  { level: 2, label: "緊急" },
  { level: 3, label: "準緊急" },
  { level: 4, label: "低緊急" },
  { level: 5, label: "非緊急" },
] as const;

export function jtasLabel(level: number | undefined): string {
  return JTAS_LEVELS.find((l) => l.level === level)?.label ?? "";
}

const TRIAGE_LEVEL_EXTENSION_URL =
  "http://fhir-client.local/StructureDefinition/emergency-triage-level";

// トリアージの判定記録(Observation)の code。
export const EMERGENCY_OBSERVATION_SYSTEM =
  "http://fhir-client.local/CodeSystem/emergency-observation";
export const JTAS_OBSERVATION_CODE = "jtas";

// ---- 受付 ----

export interface EmergencyArrivalValues {
  /** 来院日時(FHIR dateTime)。 */
  arrivedAt: string;
  arrivalMode: ArrivalMode | "";
  complaint: string;
  bedId: string;
  bedName: string;
  practitionerId: string;
  practitionerName: string;
}

function attendingParticipants(id: string, name: string): fhir4.EncounterParticipant[] {
  if (!id) return [];
  return [
    {
      type: [
        {
          coding: [
            { system: PARTICIPATION_TYPE_SYSTEM, code: ATTENDING_PARTICIPANT_CODE, display: "attender" },
          ],
        },
      ],
      individual: { reference: `Practitioner/${id}`, display: name || undefined },
    },
  ];
}

/** 来院方法・主訴・ベッド・担当医を書き込む。空の項目は要素ごと外す。 */
export function withEmergencyDetails(
  encounter: fhir4.Encounter,
  values: Omit<EmergencyArrivalValues, "arrivedAt">,
): fhir4.Encounter {
  const next: fhir4.Encounter = { ...encounter };

  const hospitalization = { ...encounter.hospitalization };
  if (values.arrivalMode) {
    hospitalization.admitSource = {
      coding: [
        {
          system: ARRIVAL_MODE_SYSTEM,
          code: values.arrivalMode,
          display: arrivalModeLabel(values.arrivalMode),
        },
      ],
    };
  } else {
    delete hospitalization.admitSource;
  }
  next.hospitalization = Object.keys(hospitalization).length > 0 ? hospitalization : undefined;

  const complaint = values.complaint.trim();
  next.reasonCode = complaint ? [{ text: complaint }] : undefined;

  const others = (encounter.participant ?? []).filter(
    (p) => !p.individual?.reference?.startsWith("Practitioner/"),
  );
  const participant = [...others, ...attendingParticipants(values.practitionerId, values.practitionerName)];
  next.participant = participant.length > 0 ? participant : undefined;

  const rest = (encounter.location ?? []).slice(1);
  const location = values.bedId
    ? [
        {
          location: { reference: `Location/${values.bedId}`, display: values.bedName || undefined },
          status: encounter.status === EMERGENCY_FINISHED_STATUS ? "completed" : "active",
        } as fhir4.EncounterLocation,
        ...rest,
      ]
    : rest;
  next.location = location.length > 0 ? location : undefined;

  return next;
}

export function buildEmergencyEncounter(
  patient: fhir4.Patient,
  values: EmergencyArrivalValues,
  triageLevel?: number,
): fhir4.Encounter {
  const encounter: fhir4.Encounter = {
    resourceType: "Encounter",
    status: "arrived",
    class: { system: ACT_CODE_SYSTEM, code: EMERGENCY_CLASS_CODE, display: "emergency" },
    subject: { reference: `Patient/${patient.id}`, display: displayName(patient) },
    period: { start: values.arrivedAt },
  };
  const detailed = withEmergencyDetails(encounter, values);
  return triageLevel ? withTriageLevel(detailed, triageLevel, values.arrivedAt) : detailed;
}

// ---- 状態の遷移 ----

/** いまの status になった日時。 */
export function emergencyStatusSince(encounter: fhir4.Encounter): string | undefined {
  const history = encounter.statusHistory ?? [];
  return history[history.length - 1]?.period.end ?? encounter.period?.start;
}

/** status を進める。いまの status を期間つきで statusHistory に積む。 */
export function withEmergencyStatus(
  encounter: fhir4.Encounter,
  status: EmergencyStatus,
  at: string,
): fhir4.Encounter {
  if (encounter.status === status) return encounter;
  return {
    ...encounter,
    status,
    statusHistory: [
      ...(encounter.statusHistory ?? []),
      { status: encounter.status, period: { start: emergencyStatusSince(encounter), end: at } },
    ],
  };
}

/** 直前の status に戻す(診察開始の取消・転帰の取消)。 */
export function withEmergencyStatusReverted(encounter: fhir4.Encounter): fhir4.Encounter {
  const history = encounter.statusHistory ?? [];
  const previous = history[history.length - 1];
  if (!previous) return encounter;
  return {
    ...encounter,
    status: previous.status,
    statusHistory: history.length > 1 ? history.slice(0, -1) : undefined,
  };
}

/** 診察開始の日時。診察が始まっていなければ undefined。 */
export function emergencyExamStartedAt(encounter: fhir4.Encounter): string | undefined {
  if (encounter.status === "in-progress") return emergencyStatusSince(encounter);
  return (encounter.statusHistory ?? []).find((h) => h.status === "in-progress")?.period.start;
}

export function buildEmergencyExamStarted(encounter: fhir4.Encounter, at: string): fhir4.Encounter {
  return withEmergencyStatus(encounter, "in-progress", at);
}

/** 転帰の確定。退室日時を period.end に入れ、ベッドの割り当ても閉じる。 */
export function buildEmergencyDisposition(
  encounter: fhir4.Encounter,
  disposition: Disposition,
  endedAt: string,
): fhir4.Encounter {
  const next = withEmergencyStatus(encounter, EMERGENCY_FINISHED_STATUS, endedAt);
  return {
    ...next,
    period: { ...encounter.period, end: endedAt },
    hospitalization: {
      ...encounter.hospitalization,
      dischargeDisposition: {
        coding: [{ system: DISPOSITION_SYSTEM, code: disposition, display: dispositionLabel(disposition) }],
      },
    },
    location: encounter.location?.map((entry, index) =>
      index === 0 ? { ...entry, status: "completed" as const } : entry,
    ),
  };
}

/** 転帰の取消。滞在中に戻し、退室日時と転帰を消す。 */
export function buildEmergencyDispositionCancelled(encounter: fhir4.Encounter): fhir4.Encounter {
  const reverted = withEmergencyStatusReverted(encounter);
  const period = { ...encounter.period };
  delete period.end;
  const hospitalization = { ...encounter.hospitalization };
  delete hospitalization.dischargeDisposition;
  return {
    ...reverted,
    period,
    hospitalization: Object.keys(hospitalization).length > 0 ? hospitalization : undefined,
    location: encounter.location?.map((entry, index) =>
      index === 0 ? { ...entry, status: "active" as const } : entry,
    ),
  };
}

export function buildEmergencyCancelled(encounter: fhir4.Encounter): fhir4.Encounter {
  return { ...encounter, status: EMERGENCY_CANCELLED_STATUS };
}

// ---- トリアージ ----

export function emergencyTriageLevel(encounter: fhir4.Encounter): number | undefined {
  const value = encounter.extension?.find((e) => e.url === TRIAGE_LEVEL_EXTENSION_URL)?.valueInteger;
  return typeof value === "number" ? value : undefined;
}

/** JTAS のレベルを書き込む。来院のままなら トリアージ済 に進める。 */
export function withTriageLevel(
  encounter: fhir4.Encounter,
  level: number,
  at: string,
): fhir4.Encounter {
  const rest = (encounter.extension ?? []).filter((e) => e.url !== TRIAGE_LEVEL_EXTENSION_URL);
  const next: fhir4.Encounter = {
    ...encounter,
    extension: [...rest, { url: TRIAGE_LEVEL_EXTENSION_URL, valueInteger: level }],
  };
  return encounter.status === "arrived" ? withEmergencyStatus(next, "triaged", at) : next;
}

/** トリアージ 1 回ぶんの判定記録。encounterRef は transaction 内の仮 id でもよい。 */
export function buildTriageObservation(
  patientId: string,
  encounterRef: string,
  level: number,
  at: string,
  performer?: { id: string; name: string },
): fhir4.Observation {
  const observation: fhir4.Observation = {
    resourceType: "Observation",
    status: "final",
    category: [
      {
        coding: [
          { system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "survey" },
        ],
      },
    ],
    code: {
      coding: [
        { system: EMERGENCY_OBSERVATION_SYSTEM, code: JTAS_OBSERVATION_CODE, display: "JTAS 緊急度判定" },
      ],
    },
    subject: { reference: `Patient/${patientId}` },
    encounter: { reference: encounterRef },
    effectiveDateTime: at,
    valueCodeableConcept: {
      coding: [{ system: JTAS_LEVEL_SYSTEM, code: String(level), display: jtasLabel(level) }],
    },
  };
  if (performer?.id) {
    observation.performer = [{ reference: `Practitioner/${performer.id}`, display: performer.name }];
  }
  return observation;
}

export interface TriageRecord {
  level: number;
  at: string;
  performerName: string;
}

export function parseTriageObservation(observation: fhir4.Observation): TriageRecord | null {
  const level = Number(
    observation.valueCodeableConcept?.coding?.find((c) => c.system === JTAS_LEVEL_SYSTEM)?.code,
  );
  if (!level) return null;
  return {
    level,
    at: observation.effectiveDateTime ?? "",
    performerName: observation.performer?.[0]?.display ?? "",
  };
}

// ---- 復元(一覧の表示) ----

export function emergencyArrivalMode(encounter: fhir4.Encounter): string | undefined {
  return encounter.hospitalization?.admitSource?.coding?.find((c) => c.system === ARRIVAL_MODE_SYSTEM)
    ?.code;
}

export function emergencyDisposition(encounter: fhir4.Encounter): string | undefined {
  return encounter.hospitalization?.dischargeDisposition?.coding?.find(
    (c) => c.system === DISPOSITION_SYSTEM,
  )?.code;
}

export function emergencyComplaint(encounter: fhir4.Encounter): string {
  return encounter.reasonCode?.[0]?.text ?? "";
}

export function emergencyBedId(encounter: fhir4.Encounter): string | undefined {
  return referenceId(encounter.location?.[0]?.location?.reference);
}

export function emergencyBedName(encounter: fhir4.Encounter): string {
  return encounter.location?.[0]?.location?.display ?? "";
}

export function emergencyAttendingName(encounter: fhir4.Encounter): string {
  const id = encounterAttendingId(encounter);
  if (!id) return "";
  return (
    encounter.participant?.find((p) => p.individual?.reference === `Practitioner/${id}`)?.individual
      ?.display ?? ""
  );
}

export { encounterAttendingId as emergencyAttendingId, encounterPatientId as emergencyPatientId };

/** 滞在中の Encounter が使っているベッド。 */
export function occupiedEmergencyBedIds(encounters: fhir4.Encounter[]): Set<string> {
  const set = new Set<string>();
  for (const encounter of encounters) {
    if (!isEmergencyActive(encounter)) continue;
    const bedId = emergencyBedId(encounter);
    if (bedId) set.add(bedId);
  }
  return set;
}

/**
 * 一覧の並び。滞在中を上に、JTAS の重い順(未判定は最後)→ 来院の早い順。
 * 転帰確定はその下に来院の早い順。
 */
export function compareEmergencyEncounters(a: fhir4.Encounter, b: fhir4.Encounter): number {
  const activeA = isEmergencyActive(a);
  const activeB = isEmergencyActive(b);
  if (activeA !== activeB) return activeA ? -1 : 1;
  if (activeA) {
    const levelA = emergencyTriageLevel(a) ?? 99;
    const levelB = emergencyTriageLevel(b) ?? 99;
    if (levelA !== levelB) return levelA - levelB;
  }
  return (a.period?.start ?? "").localeCompare(b.period?.start ?? "");
}

// ---- 入院への引き継ぎ ----

const ORIGIN_ENCOUNTER_EXTENSION_URL =
  "http://fhir-client.local/StructureDefinition/encounter-origin-emergency";
export const ADMIT_SOURCE_SYSTEM = "http://terminology.hl7.org/CodeSystem/admit-source";

/** 救急車による搬送にあたる来院方法(現場からの要請で出たドクターカー・ヘリを含む)。 */
const AMBULANCE_ARRIVAL_MODES: string[] = ["ambulance", "doctor-heli", "doctor-car"];

/**
 * 救急から入院するときの入院 Encounter に、入院経路と元の救急受診を添える。救急車などで
 * 来院していれば、救急車による搬送も引き継ぐ。admitSource には入院登録で入れる入院経路も
 * 並ぶので、coding は system ごとに差し替える。
 */
export function withEmergencyOrigin(
  encounter: fhir4.Encounter,
  emergency: fhir4.Encounter,
): fhir4.Encounter {
  const rest = (encounter.extension ?? []).filter((e) => e.url !== ORIGIN_ENCOUNTER_EXTENSION_URL);
  const otherSources = (encounter.hospitalization?.admitSource?.coding ?? []).filter(
    (c) => c.system !== ADMIT_SOURCE_SYSTEM,
  );
  const next: fhir4.Encounter = {
    ...encounter,
    hospitalization: {
      ...encounter.hospitalization,
      admitSource: {
        coding: [
          ...otherSources,
          { system: ADMIT_SOURCE_SYSTEM, code: "emd", display: "救急外来から" },
        ],
      },
    },
    extension: [
      ...rest,
      {
        url: ORIGIN_ENCOUNTER_EXTENSION_URL,
        valueReference: { reference: `Encounter/${emergency.id}` },
      },
    ],
  };
  return AMBULANCE_ARRIVAL_MODES.includes(emergencyArrivalMode(emergency) ?? "")
    ? withAmbulanceArrival(next)
    : next;
}

// ---- 身元不明患者 ----

export const PROVISIONAL_PATIENT_TAG_SYSTEM = "http://fhir-client.local/CodeSystem/patient-tag";
export const PROVISIONAL_PATIENT_TAG_CODE = "unidentified";

export function isProvisionalPatient(patient: fhir4.Patient | undefined): boolean {
  return Boolean(
    patient?.meta?.tag?.some(
      (t) => t.system === PROVISIONAL_PATIENT_TAG_SYSTEM && t.code === PROVISIONAL_PATIENT_TAG_CODE,
    ),
  );
}

export function withProvisionalTag(patient: fhir4.Patient): fhir4.Patient {
  return {
    ...patient,
    meta: {
      ...patient.meta,
      tag: [
        ...(patient.meta?.tag ?? []),
        { system: PROVISIONAL_PATIENT_TAG_SYSTEM, code: PROVISIONAL_PATIENT_TAG_CODE, display: "身元不明" },
      ],
    },
  };
}

export function withoutProvisionalTag(patient: fhir4.Patient): fhir4.Patient {
  const tag = (patient.meta?.tag ?? []).filter(
    (t) => !(t.system === PROVISIONAL_PATIENT_TAG_SYSTEM && t.code === PROVISIONAL_PATIENT_TAG_CODE),
  );
  return { ...patient, meta: { ...patient.meta, tag: tag.length > 0 ? tag : undefined } };
}

/** 仮の名(名の欄)。性別と来院時刻で、同じ日の身元不明患者を見分けられるようにする。 */
export function provisionalGivenName(gender: string, arrivedAt: string): string {
  const sex = gender === "male" ? "男" : gender === "female" ? "女" : "";
  const stamp = `${arrivedAt.slice(5, 7)}${arrivedAt.slice(8, 10)}-${arrivedAt.slice(11, 13)}${arrivedAt.slice(14, 16)}`;
  return `${sex}${stamp}`;
}
