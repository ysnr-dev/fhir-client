// 入院(Encounter)の組み立て・復元。入院患者一覧(/inpatients)が使う。
//
// 「その患者が今どのベッドに居るか」を Encounter 1 件で表す。
//
//   status          : "in-progress"(入院中)
//   class           : v3-ActCode の IMP(入院)。※ R4 の Encounter.class は
//                     CodeableConcept ではなく Coding 単体なので入れ子にしない
//   subject         : 患者
//   location[0]     : ベッドの Location。病室・病棟は辿れるのでベッドだけ指す
//                     (階層は wardHelpers.ts の冒頭を参照)
//   serviceProvider : 診療科。診療科は partOf を持つ Organization で登録済み
//   participant     : 主治医(種別 ATND)。未指定なら要素ごと付けない
//   period.start    : 入院日(時刻を持たない日付のみ)
//
// 特記事項は R4 の Encounter に置き場所が無いのでローカル拡張にする。上流の
// プロファイル検証は extension の中身を見ないが、R4 に無い要素(note など)は
// 将来 enforce にしたときに弾かれるため使わない。
//
// 退院すると status=finished + period.end(退院日)。誤登録の取り消しは
// status=entered-in-error で、退院とは区別する(退院日を持たない)。どちらも
// in-progress ではなくなるので入院患者一覧からは外れる。

import { referenceId } from "./shared";

const ACT_CODE_SYSTEM = "http://terminology.hl7.org/CodeSystem/v3-ActCode";
const PARTICIPATION_TYPE_SYSTEM = "http://terminology.hl7.org/CodeSystem/v3-ParticipationType";

/** 入院を表す Encounter.class のコード。 */
export const ADMISSION_CLASS_CODE = "IMP";
/** 入院中の Encounter.status。 */
export const ADMISSION_STATUS = "in-progress";
/** 退院した Encounter.status。 */
export const DISCHARGED_STATUS = "finished";
/** 誤登録として取り消した Encounter.status。 */
export const CANCELLED_STATUS = "entered-in-error";
/** 主治医を表す participant.type のコード(attender)。 */
export const ATTENDING_PARTICIPANT_CODE = "ATND";

export const ENCOUNTER_NOTE_EXTENSION_URL =
  "http://fhir-client.local/StructureDefinition/encounter-note";

// ---- 入院登録フォーム ----

export interface AdmissionFormValues {
  /** 診療科 Organization の id。 */
  departmentId: string;
  /** 主治医。Practitioner の id。任意。 */
  practitionerId: string;
  /** 入院日(YYYY-MM-DD)。 */
  admissionDate: string;
  /** 特記事項。任意。 */
  note: string;
}

export function validateAdmissionForm(values: AdmissionFormValues): string | null {
  if (!values.departmentId) return "診療科は必須です。";
  if (!values.admissionDate) return "入院日は必須です。";
  return null;
}

/** 入院先と、参照先の表示名。display は一覧で再取得せずに出すために持たせる。 */
export interface AdmissionTarget {
  bedId: string;
  /** 「301号室 ベッド1」。bedDisplayName で合成したもの。 */
  bedLabel: string;
  departmentName: string;
  practitionerName: string;
}

export function buildAdmissionEncounter(
  patient: fhir4.Patient,
  target: AdmissionTarget,
  values: AdmissionFormValues,
): fhir4.Encounter {
  const encounter: fhir4.Encounter = {
    resourceType: "Encounter",
    status: ADMISSION_STATUS,
    class: {
      system: ACT_CODE_SYSTEM,
      code: ADMISSION_CLASS_CODE,
      display: "inpatient encounter",
    },
    subject: {
      reference: `Patient/${patient.id}`,
      display: patientDisplay(patient),
    },
    period: { start: values.admissionDate },
    location: [
      {
        location: { reference: `Location/${target.bedId}`, display: target.bedLabel },
        status: "active",
      },
    ],
  };

  if (values.departmentId) {
    encounter.serviceProvider = {
      reference: `Organization/${values.departmentId}`,
      display: target.departmentName,
    };
  }

  if (values.practitionerId) {
    encounter.participant = [
      {
        type: [
          {
            coding: [
              {
                system: PARTICIPATION_TYPE_SYSTEM,
                code: ATTENDING_PARTICIPANT_CODE,
                display: "attender",
              },
            ],
          },
        ],
        individual: {
          reference: `Practitioner/${values.practitionerId}`,
          display: target.practitionerName,
        },
      },
    ];
  }

  if (values.note.trim()) {
    encounter.extension = [
      { url: ENCOUNTER_NOTE_EXTENSION_URL, valueString: values.note.trim() },
    ];
  }

  return encounter;
}

// subject.display 用。patientHelpers を読むと循環しかねないのでここで最小限に組む。
function patientDisplay(patient: fhir4.Patient): string {
  const name = patient.name?.[0];
  const text = name?.text?.trim();
  if (text) return text;
  const composed = [name?.family, name?.given?.join(" ")].filter(Boolean).join(" ").trim();
  return composed || (patient.id ?? "");
}

// ---- 復元(一覧の表示) ----

export function encounterBedId(encounter: fhir4.Encounter): string | undefined {
  return referenceId(encounter.location?.[0]?.location?.reference);
}

export function encounterPatientId(encounter: fhir4.Encounter): string | undefined {
  return referenceId(encounter.subject?.reference);
}

export function encounterDepartmentName(encounter: fhir4.Encounter): string {
  return encounter.serviceProvider?.display ?? "-";
}

export function encounterDepartmentId(encounter: fhir4.Encounter): string | undefined {
  return referenceId(encounter.serviceProvider?.reference);
}

// participant の中から種別 ATND(主治医)のものを探す。
function attendingParticipant(
  encounter: fhir4.Encounter,
): fhir4.EncounterParticipant | undefined {
  return encounter.participant?.find((p) =>
    p.type?.some((t) =>
      t.coding?.some(
        (c) => c.system === PARTICIPATION_TYPE_SYSTEM && c.code === ATTENDING_PARTICIPANT_CODE,
      ),
    ),
  );
}

/** 主治医の氏名。 */
export function encounterAttendingName(encounter: fhir4.Encounter): string {
  return attendingParticipant(encounter)?.individual?.display ?? "-";
}

export function encounterAttendingId(encounter: fhir4.Encounter): string | undefined {
  return referenceId(attendingParticipant(encounter)?.individual?.reference);
}

/** 入院日。時刻付きで入っていても日付だけ返す。 */
export function encounterAdmissionDate(encounter: fhir4.Encounter): string {
  const start = encounter.period?.start;
  return start ? start.slice(0, 10) : "-";
}

export function encounterNote(encounter: fhir4.Encounter): string {
  const extension = encounter.extension?.find((e) => e.url === ENCOUNTER_NOTE_EXTENSION_URL);
  return extension?.valueString ?? "";
}

// ---- 退院・入院取消 ----

export function validateDischargeDate(
  encounter: fhir4.Encounter,
  dischargeDate: string,
): string | null {
  if (!dischargeDate) return "退院日は必須です。";
  const admission = encounter.period?.start?.slice(0, 10);
  if (admission && dischargeDate < admission) {
    return `退院日は入院日(${admission})より前にはできません。`;
  }
  return null;
}

/** 退院。ベッドの割り当ても終わるので location の status も閉じる。 */
export function buildDischargedEncounter(
  encounter: fhir4.Encounter,
  dischargeDate: string,
): fhir4.Encounter {
  return {
    ...encounter,
    status: DISCHARGED_STATUS,
    period: { ...encounter.period, end: dischargeDate },
    location: encounter.location?.map((entry, index) =>
      index === 0 ? { ...entry, status: "completed" as const } : entry,
    ),
  };
}

/**
 * 入院登録そのものの取り消し(誤登録)。退院ではないので period.end は付けない。
 * 消さずに status で残すのは、いつ誰が登録した記録なのかを追えるようにするため。
 */
export function buildCancelledEncounter(encounter: fhir4.Encounter): fhir4.Encounter {
  return { ...encounter, status: CANCELLED_STATUS };
}

/**
 * Encounter 1 件を書き換える transaction Bundle。一覧は検索結果の Encounter を
 * 持っているだけで ETag が無いため、単体 PUT ではなく If-Match の付かない
 * Bundle で書く(枠の状態変更 useUpdateSlotStatus と同じ理由)。
 */
export function buildEncounterUpdateBundle(encounter: fhir4.Encounter): fhir4.Bundle {
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      {
        resource: encounter,
        request: { method: "PUT", url: `Encounter/${encounter.id}` },
      },
    ],
  };
}

/**
 * ベッド id ごとの入院 Encounter。同じベッドに入院中が複数あったら
 * 入院日(同日なら更新時刻)が新しいものを採る。データがおかしくても
 * 一覧が壊れないようにするためで、古い方は表示しない。
 */
export function latestEncounterByBed(
  encounters: fhir4.Encounter[],
): Map<string, fhir4.Encounter> {
  const byBed = new Map<string, fhir4.Encounter>();

  for (const encounter of encounters) {
    const bedId = encounterBedId(encounter);
    if (!bedId) continue;
    const current = byBed.get(bedId);
    if (!current || isNewer(encounter, current)) byBed.set(bedId, encounter);
  }

  return byBed;
}

function isNewer(a: fhir4.Encounter, b: fhir4.Encounter): boolean {
  const startA = a.period?.start ?? "";
  const startB = b.period?.start ?? "";
  if (startA !== startB) return startA > startB;
  return (a.meta?.lastUpdated ?? "") > (b.meta?.lastUpdated ?? "");
}
