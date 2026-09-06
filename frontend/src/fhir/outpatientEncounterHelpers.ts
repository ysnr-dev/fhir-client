// 外来の診察(Encounter)の組み立て・復元。外来患者一覧(/outpatients)とカルテが使う。
//
// 「その予約の診察がいま行われているか、終わったか」を Encounter 1 件で表す。
//
//   status      : "in-progress"(診察中) / "finished"(診察終了)
//   class       : v3-ActCode の AMB(外来)。※ 入院と同じく R4 の Encounter.class は
//                 CodeableConcept ではなく Coding 単体なので入れ子にしない
//   subject     : 患者
//   appointment : もとの予約。一覧はこの参照で予約と診察を突き合わせる
//   period      : start=診察開始日時、end=診察終了日時
//   participant : 担当医(種別 ATND)。予約に担当医があるときだけ
//   location[0] : 診察室の Location。予約に診察室があるときだけ
//
// 受付までは予約(Appointment.status)だけで足りるが、「診察中」に当たる status が
// R4 の Appointment に無い(arrived は *来院して待っている* 状態で checked-in より
// 前の段階なので流用できない)。R4 は fulfilled の定義が "may have resulted in an
// encounter" で、診察そのものは Encounter が表す前提になっているため、診察開始で
// Encounter を建てる。診察終了では Encounter を finished にすると同時に予約を
// fulfilled にする — 片方だけ書かれた状態を作らないよう必ず同じ transaction で書く。
//
// 入院の Encounter(encounterHelpers.ts)とはリソース型が同じなだけで別物。
// 一覧の検索も class(AMB / IMP)で分かれている。

import {
  appointmentActorDisplay,
  appointmentActorId,
  appointmentStatusLabel,
} from "./appointmentHelpers";
import {
  ACT_CODE_SYSTEM,
  ATTENDING_PARTICIPANT_CODE,
  PARTICIPATION_TYPE_SYSTEM,
} from "./encounterHelpers";
import { displayName } from "./patientHelpers";
import { referenceId } from "./shared";

/** 外来を表す Encounter.class のコード。 */
export const OUTPATIENT_CLASS_CODE = "AMB";
/** 診察中の Encounter.status。 */
export const EXAM_IN_PROGRESS_STATUS = "in-progress";
/** 診察が終わった Encounter.status。 */
export const EXAM_FINISHED_STATUS = "finished";
/** 診察開始を取り消した(誤登録)Encounter.status。 */
export const EXAM_CANCELLED_STATUS = "entered-in-error";

/** 担当医(種別 ATND)の participant。指定が無ければ空。 */
function attendingParticipants(
  practitionerId: string,
  practitionerName: string,
): fhir4.EncounterParticipant[] {
  if (!practitionerId) return [];
  return [
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
        reference: `Practitioner/${practitionerId}`,
        display: practitionerName || undefined,
      },
    },
  ];
}

/**
 * 診察開始。予約 1 件に対して診察の Encounter を建てる。
 *
 * 診療科(serviceProvider)は入れない。Appointment.specialty は SS-MIX2 の診療科コード
 * しか持たず、参照に要る Organization の id が引けないため。一覧の診療科列は従来どおり
 * 予約から出しているので、ここで持たなくても表示は欠けない。
 */
export function buildOutpatientEncounter(
  appointment: fhir4.Appointment,
  patient: fhir4.Patient | undefined,
  startedAt: string,
): fhir4.Encounter {
  const patientId = patient?.id ?? appointmentActorId(appointment, "Patient");
  const encounter: fhir4.Encounter = {
    resourceType: "Encounter",
    status: EXAM_IN_PROGRESS_STATUS,
    class: {
      system: ACT_CODE_SYSTEM,
      code: OUTPATIENT_CLASS_CODE,
      display: "ambulatory",
    },
    subject: {
      reference: `Patient/${patientId}`,
      display: patient
        ? displayName(patient)
        : appointmentActorDisplay(appointment, "Patient"),
    },
    appointment: [{ reference: `Appointment/${appointment.id}` }],
    period: { start: startedAt },
  };

  const practitionerId = appointmentActorId(appointment, "Practitioner");
  if (practitionerId) {
    encounter.participant = attendingParticipants(
      practitionerId,
      appointmentActorDisplay(appointment, "Practitioner"),
    );
  }

  const locationId = appointmentActorId(appointment, "Location");
  if (locationId) {
    encounter.location = [
      {
        location: {
          reference: `Location/${locationId}`,
          display: appointmentActorDisplay(appointment, "Location") || undefined,
        },
        status: "active",
      },
    ];
  }

  return encounter;
}

/**
 * 担当医・診察室の差し替え。外来一覧から受付内容を変えたときに、既に建てて
 * ある診察の Encounter も合わせるために使う(予約だけ変えると、診察の記録が
 * 前の担当医・診察室のまま残る)。
 *
 * 診察室の割り当ての status は今のものを引き継ぐ。終了済みの診察を開き直したり、
 * 診察中の割り当てを閉じたりしないため。
 */
export function withExamAssignment(
  encounter: fhir4.Encounter,
  values: { practitionerId: string; practitionerName: string; locationId: string; locationName: string },
): fhir4.Encounter {
  // 担当医(ATND)だけを入れ替える。他の参加者(将来の代行入力など)は残す。
  const others = (encounter.participant ?? []).filter(
    (p) => !p.individual?.reference?.startsWith("Practitioner/"),
  );
  const participant = [...others, ...attendingParticipants(values.practitionerId, values.practitionerName)];

  const current = encounter.location?.[0];
  const location = values.locationId
    ? [
        {
          location: {
            reference: `Location/${values.locationId}`,
            display: values.locationName || undefined,
          },
          status:
            current?.status ??
            (encounter.status === EXAM_FINISHED_STATUS ? "completed" : "active"),
        } as fhir4.EncounterLocation,
        ...(encounter.location ?? []).slice(1),
      ]
    : (encounter.location ?? []).slice(1);

  return {
    ...encounter,
    participant: participant.length > 0 ? participant : undefined,
    location: location.length > 0 ? location : undefined,
  };
}

/** 診察終了。診察室の割り当ても終わるので location の status も閉じる(退院と同じ)。 */
export function buildFinishedOutpatientEncounter(
  encounter: fhir4.Encounter,
  endedAt: string,
): fhir4.Encounter {
  return {
    ...encounter,
    status: EXAM_FINISHED_STATUS,
    period: { ...encounter.period, end: endedAt },
    location: encounter.location?.map((entry, index) =>
      index === 0 ? { ...entry, status: "completed" as const } : entry,
    ),
  };
}

/**
 * 診察開始の取り消し。誤って開始を押したときのための操作なので、診察した記録は
 * 残さず誤登録にする。予約は受付済(checked-in)のままなので呼び出し側は触らない。
 */
export function buildExamStartCancelledEncounter(encounter: fhir4.Encounter): fhir4.Encounter {
  return { ...encounter, status: EXAM_CANCELLED_STATUS };
}

/** 診察終了の取り消し。診察中に戻し、終了日時と診察室の割り当ての終了も取り消す。 */
export function buildExamFinishCancelledEncounter(encounter: fhir4.Encounter): fhir4.Encounter {
  const period = { ...encounter.period };
  delete period.end;
  return {
    ...encounter,
    status: EXAM_IN_PROGRESS_STATUS,
    period,
    location: encounter.location?.map((entry, index) =>
      index === 0 ? { ...entry, status: "active" as const } : entry,
    ),
  };
}

/** この診察がもとにしている予約の id。 */
export function outpatientEncounterAppointmentId(
  encounter: fhir4.Encounter,
): string | undefined {
  return referenceId(encounter.appointment?.[0]?.reference);
}

export function isExamInProgress(encounter: fhir4.Encounter | undefined): boolean {
  return encounter?.status === EXAM_IN_PROGRESS_STATUS;
}

export function isExamFinished(encounter: fhir4.Encounter | undefined): boolean {
  return encounter?.status === EXAM_FINISHED_STATUS;
}

/**
 * 同じ予約に診察が複数あったら診察開始が新しい方を採る(同時刻なら更新が新しい方)。
 * データがおかしくても一覧が壊れないようにするためで、古い方は表示しない。
 * 入院の latestEncounterByBed と同じ考え方。
 */
export function latestExamByAppointment(
  encounters: fhir4.Encounter[],
): Map<string, fhir4.Encounter> {
  const byAppointment = new Map<string, fhir4.Encounter>();

  for (const encounter of encounters) {
    if (encounter.status === EXAM_CANCELLED_STATUS) continue;
    const appointmentId = outpatientEncounterAppointmentId(encounter);
    if (!appointmentId) continue;
    const current = byAppointment.get(appointmentId);
    if (!current || isNewer(encounter, current)) byAppointment.set(appointmentId, encounter);
  }

  return byAppointment;
}

function isNewer(a: fhir4.Encounter, b: fhir4.Encounter): boolean {
  const startA = a.period?.start ?? "";
  const startB = b.period?.start ?? "";
  if (startA !== startB) return startA > startB;
  return (a.meta?.lastUpdated ?? "") > (b.meta?.lastUpdated ?? "");
}

// ---- 外来一覧の状態(予約 + 診察) ----
//
// 「診察中」に当たる値が Appointment.status に無いので、予約の status と診察が
// 進行中かどうかを 1 つの状態にまとめる。状態列の表示・色分けと絞り込みが同じコードを
// 見るように、擬似コードを 1 つだけ足して扱いを揃える。診察中でも予約は受付済
// (checked-in)のままである点に注意。

/** 診察中を表す擬似コード。Appointment.status には無い。 */
export const IN_EXAM_STATUS = "in-exam";
export const IN_EXAM_LABEL = "診察中";

/** 外来一覧の状態コード。診察が進行中なら IN_EXAM_STATUS、それ以外は予約の status。 */
export function outpatientStatusCode(
  appointment: fhir4.Appointment,
  encounter: fhir4.Encounter | undefined,
): string {
  return isExamInProgress(encounter) ? IN_EXAM_STATUS : appointment.status;
}

/** 外来一覧の状態ラベル。 */
export function outpatientStatusLabel(
  appointment: fhir4.Appointment,
  encounter: fhir4.Encounter | undefined,
): string {
  const code = outpatientStatusCode(appointment, encounter);
  return code === IN_EXAM_STATUS ? IN_EXAM_LABEL : appointmentStatusLabel(code);
}

/** 診察を始められる予約(受付済で、まだ診察が始まっていないもの)。 */
export function canStartExam(
  appointment: fhir4.Appointment,
  encounter: fhir4.Encounter | undefined,
): boolean {
  return appointment.status === "checked-in" && !encounter;
}
