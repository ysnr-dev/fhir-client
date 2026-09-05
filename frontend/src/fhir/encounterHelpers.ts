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
//   participant     : 主治医(種別 ATND)と担当看護師(種別はローカル code の nurse。
//                     看護師を表す標準コードが ParticipationType に無いため)。複数可。
//                     どちらも未指定なら要素ごと付けない
//   period.start    : 入院日時。時刻を付ける前に登録したものは日付だけ
//
// 特記事項は R4 の Encounter に置き場所が無いのでローカル拡張にする。上流の
// プロファイル検証は extension の中身を見ないが、R4 に無い要素(note など)は
// 将来 enforce にしたときに弾かれるため使わない。
//
// 退院すると status=finished + period.end(退院日時)。誤登録の取り消しは
// status=entered-in-error で、退院とは区別する(退院日を持たない)。どちらも
// in-progress ではなくなるので入院患者一覧からは外れる。

import { toFhirDateTime } from "./clinicalNoteHelpers";
import { referenceId } from "./shared";
import {
  BED_PHYSICAL_TYPE,
  PHYSICAL_TYPE_SYSTEM,
  ROOM_PHYSICAL_TYPE,
  WARD_PHYSICAL_TYPE,
} from "./wardHelpers";

export const ACT_CODE_SYSTEM = "http://terminology.hl7.org/CodeSystem/v3-ActCode";
export const PARTICIPATION_TYPE_SYSTEM = "http://terminology.hl7.org/CodeSystem/v3-ParticipationType";

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

// 担当看護師。ParticipationType に看護師を表すコードが無いのでローカルに建てる。
export const PARTICIPANT_ROLE_SYSTEM =
  "http://fhir-client.local/CodeSystem/encounter-participant-role";
export const NURSE_PARTICIPANT_CODE = "nurse";

export const ENCOUNTER_NOTE_EXTENSION_URL =
  "http://fhir-client.local/StructureDefinition/encounter-note";

// ---- 入院登録フォーム ----

export interface AdmissionFormValues {
  /** 診療科 Organization の id。 */
  departmentId: string;
  /** 主治医。Practitioner の id。任意。 */
  practitionerId: string;
  /** 担当看護師。Practitioner の id。複数可、任意。 */
  nurseIds: string[];
  /** 入院日時(YYYY-MM-DDTHH:mm)。食事開始の既定タイミングをこの時刻から出す。 */
  admissionDate: string;
  /** 特記事項。任意。 */
  note: string;
}

export function validateAdmissionForm(values: AdmissionFormValues): string | null {
  if (!values.departmentId) return "診療科は必須です。";
  if (!values.admissionDate) return "入院日時は必須です。";
  return null;
}

/** 入院先と、参照先の表示名。display は一覧で再取得せずに出すために持たせる。 */
export interface AdmissionTarget {
  bedId: string;
  /** 「301号室 ベッド1」。bedDisplayName で合成したもの。 */
  bedLabel: string;
  departmentName: string;
  practitionerName: string;
  /** 担当看護師。id と表示名の組。id は values.nurseIds を解決したもの。 */
  nurses: { id: string; name: string }[];
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
    period: { start: encounterDateTime(values.admissionDate) },
    location: [
      {
        location: { reference: `Location/${target.bedId}`, display: target.bedLabel },
        status: "active",
      },
    ],
  };

  applyAdmissionDetails(encounter, target, values);
  return encounter;
}

/**
 * 画面の日時(YYYY-MM-DDTHH:mm)を FHIR dateTime にする。日付だけの値(時刻を付ける前の
 * 形)はそのまま date として通す。
 */
export function encounterDateTime(value: string): string {
  return value.length > 10 ? toFhirDateTime(value) : value;
}

/**
 * 診療科・主治医・担当看護師・特記事項を Encounter に書き込む。入院登録と
 * 入院予定・入院実施で同じ組み方をするので共通にする。無指定の要素は消す
 * (予定を実施に書き換えるとき、予定側の値が残らないように)。
 */
function applyAdmissionDetails(
  encounter: fhir4.Encounter,
  target: Pick<AdmissionTarget, "departmentName" | "practitionerName" | "nurses">,
  values: Pick<AdmissionFormValues, "departmentId" | "practitionerId" | "note">,
): void {
  if (values.departmentId) {
    encounter.serviceProvider = {
      reference: `Organization/${values.departmentId}`,
      display: target.departmentName,
    };
  } else {
    delete encounter.serviceProvider;
  }

  // 主治医と担当看護師は同じ participant[] に種別違いで並べる。
  const participants: fhir4.EncounterParticipant[] = [];
  if (values.practitionerId) {
    participants.push(
      buildParticipant(
        { system: PARTICIPATION_TYPE_SYSTEM, code: ATTENDING_PARTICIPANT_CODE, display: "attender" },
        values.practitionerId,
        target.practitionerName,
      ),
    );
  }
  for (const nurse of target.nurses) {
    participants.push(
      buildParticipant(
        { system: PARTICIPANT_ROLE_SYSTEM, code: NURSE_PARTICIPANT_CODE, display: "担当看護師" },
        nurse.id,
        nurse.name,
      ),
    );
  }
  if (participants.length > 0) encounter.participant = participants;
  else delete encounter.participant;

  const note = values.note.trim();
  encounter.extension = withReplacedExtension(
    encounter.extension,
    ENCOUNTER_NOTE_EXTENSION_URL,
    note ? { url: ENCOUNTER_NOTE_EXTENSION_URL, valueString: note } : null,
  );
}

/**
 * url が一致する拡張を next で置き換えた extension 配列を返す(next が null なら
 * 取り除くだけ)。外出泊のように同じ url を複数持つものには使わない。
 */
function withReplacedExtension(
  extension: fhir4.Extension[] | undefined,
  url: string,
  next: fhir4.Extension | null,
): fhir4.Extension[] | undefined {
  const rest = (extension ?? []).filter((e) => e.url !== url);
  const result = next ? [...rest, next] : rest;
  return result.length > 0 ? result : undefined;
}

function buildParticipant(
  type: fhir4.Coding,
  practitionerId: string,
  name: string,
): fhir4.EncounterParticipant {
  return {
    type: [{ coding: [type] }],
    individual: { reference: `Practitioner/${practitionerId}`, display: name },
  };
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

/** いま居るベッドの表示名。入院登録のときに合成した display をそのまま使う。 */
export function encounterBedLabel(encounter: fhir4.Encounter): string {
  return encounter.location?.[0]?.location?.display ?? "-";
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

// participant の中から担当看護師(複数可)を拾う。
function nurseParticipants(encounter: fhir4.Encounter): fhir4.EncounterParticipant[] {
  return (encounter.participant ?? []).filter((p) =>
    p.type?.some((t) =>
      t.coding?.some(
        (c) => c.system === PARTICIPANT_ROLE_SYSTEM && c.code === NURSE_PARTICIPANT_CODE,
      ),
    ),
  );
}

/** 担当看護師の氏名。登録順のまま返す。 */
export function encounterNurseNames(encounter: fhir4.Encounter): string[] {
  return nurseParticipants(encounter)
    .map((p) => p.individual?.display)
    .filter((name): name is string => Boolean(name));
}

export function encounterNurseIds(encounter: fhir4.Encounter): string[] {
  return nurseParticipants(encounter)
    .map((p) => referenceId(p.individual?.reference))
    .filter((id): id is string => Boolean(id));
}

/** 入院日。時刻付きで入っていても日付だけ返す(時刻まで要るときは encounterAdmissionAt)。 */
export function encounterAdmissionDate(encounter: fhir4.Encounter): string {
  const start = encounter.period?.start;
  return start ? start.slice(0, 10) : "-";
}

/** 退院日。時刻付きで入っていても日付だけ返す。退院していなければ "-"。 */
export function encounterDischargeDate(encounter: fhir4.Encounter): string {
  const end = encounter.period?.end;
  return end ? end.slice(0, 10) : "-";
}

/** 入院日時(FHIR dateTime そのまま。時刻を付ける前のものは日付だけ)。 */
export function encounterAdmissionAt(encounter: fhir4.Encounter): string {
  return encounter.period?.start ?? "";
}

/** 退院日時(FHIR dateTime そのまま)。退院していなければ空。 */
export function encounterDischargeAt(encounter: fhir4.Encounter): string {
  return encounter.period?.end ?? "";
}

export function encounterNote(encounter: fhir4.Encounter): string {
  const extension = encounter.extension?.find((e) => e.url === ENCOUNTER_NOTE_EXTENSION_URL);
  return extension?.valueString ?? "";
}

// ---- 退院・入院取消 ----

export function validateDischargeDate(
  encounter: fhir4.Encounter,
  dischargeAt: string,
): string | null {
  if (!dischargeAt) return "退院日時は必須です。";
  const admission = encounter.period?.start?.slice(0, 10);
  if (admission && dischargeAt.slice(0, 10) < admission) {
    return `退院日は入院日(${admission})より前にはできません。`;
  }
  return null;
}

/** 退院。ベッドの割り当ても終わるので location の status も閉じる。 */
export function buildDischargedEncounter(
  encounter: fhir4.Encounter,
  /** 退院日時(YYYY-MM-DDTHH:mm)。 */
  dischargeAt: string,
): fhir4.Encounter {
  const discharged: fhir4.Encounter = {
    ...encounter,
    status: DISCHARGED_STATUS,
    period: { ...encounter.period, end: encounterDateTime(dischargeAt) },
    location: encounter.location?.map((entry, index) =>
      index === 0 ? { ...entry, status: "completed" as const } : entry,
    ),
  };
  // 退院してしまえば退院予定は用済みなので落とす(退院予定タブに残り続けないように)。
  return buildDischargePlanEncounter(discharged, null);
}

/**
 * 退院の取り消し。入院中に戻し、退院日とベッドの割り当ての終了も取り消す。
 * 誤って退院にしたときのための操作なので、退院した記録は残さない。
 * 退院のときに落とした退院予定は戻らない(必要なら立て直す)。
 */
export function buildDischargeCancelledEncounter(encounter: fhir4.Encounter): fhir4.Encounter {
  const period = { ...encounter.period };
  delete period.end;
  return {
    ...encounter,
    status: ADMISSION_STATUS,
    period,
    location: encounter.location?.map((entry, index) =>
      index === 0 ? { ...entry, status: "active" as const } : entry,
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
export function buildEncounterUpdateBundle(
  encounter: fhir4.Encounter,
  /**
   * 入院の書き換えと一緒に書きたい他リソースのエントリ。退院と食事オーダーの停止の
   * ように、片方だけが書かれた状態を作りたくないものを同じ transaction に載せる。
   */
  extraEntries: fhir4.BundleEntry[] = [],
): fhir4.Bundle {
  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      {
        resource: encounter,
        request: { method: "PUT", url: `Encounter/${encounter.id}` },
      },
      ...extraEntries,
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

// ---- 入院予定(status=planned) ----
//
// 入院予定も同じ Encounter で表し、status を planned にする。実施前は病室・ベッドが
// 決まっていないことがあるので、location には病棟(必須)・病室・ベッド(任意)を
// physicalType(wa/ro/bd)付きで並べ、どの階層の場所かを参照先を引かずに判別する。
//
// 入院実施は同じリソースを in-progress に書き換える(location も入院登録と同じ
// 「ベッド 1 件」の形に組み直す)。予定の取り消しは status=cancelled。入院取消の
// entered-in-error(誤登録)とは区別する。予定が無くなるのは誤りではないため。

/** 入院予定の Encounter.status。 */
export const PLANNED_STATUS = "planned";
/** 取り消した入院予定の Encounter.status。 */
export const PLAN_CANCELLED_STATUS = "cancelled";

export interface PlannedAdmissionFormValues {
  /** 予定先の病棟 Location の id。必須。 */
  wardId: string;
  /** 予定先の病室 Location の id。任意。 */
  roomId: string;
  /** 予定先のベッド Location の id。任意。 */
  bedId: string;
  departmentId: string;
  practitionerId: string;
  nurseIds: string[];
  /** 入院予定日(YYYY-MM-DD)。 */
  plannedDate: string;
  note: string;
}

export function validatePlannedAdmissionForm(
  values: PlannedAdmissionFormValues,
): string | null {
  if (!values.wardId) return "病棟は必須です。";
  if (!values.plannedDate) return "入院予定日は必須です。";
  return null;
}

/** 入院予定先と、参照先の表示名。 */
export interface PlannedAdmissionTarget {
  wardName: string;
  roomName: string;
  /** ベッドの表示(病室内の番号 "1" など)。 */
  bedName: string;
  departmentName: string;
  practitionerName: string;
  nurses: { id: string; name: string }[];
}

function plannedLocationEntry(
  physicalType: { code: string; display: string },
  id: string,
  display: string,
): fhir4.EncounterLocation {
  return {
    location: { reference: `Location/${id}`, display },
    status: "planned",
    physicalType: { coding: [{ system: PHYSICAL_TYPE_SYSTEM, ...physicalType }] },
  };
}

export function buildPlannedAdmissionEncounter(
  patient: fhir4.Patient,
  target: PlannedAdmissionTarget,
  values: PlannedAdmissionFormValues,
): fhir4.Encounter {
  const location = [plannedLocationEntry(WARD_PHYSICAL_TYPE, values.wardId, target.wardName)];
  if (values.roomId) {
    location.push(plannedLocationEntry(ROOM_PHYSICAL_TYPE, values.roomId, target.roomName));
  }
  if (values.bedId) {
    location.push(plannedLocationEntry(BED_PHYSICAL_TYPE, values.bedId, target.bedName));
  }

  const encounter: fhir4.Encounter = {
    resourceType: "Encounter",
    status: PLANNED_STATUS,
    class: {
      system: ACT_CODE_SYSTEM,
      code: ADMISSION_CLASS_CODE,
      display: "inpatient encounter",
    },
    subject: {
      reference: `Patient/${patient.id}`,
      display: patientDisplay(patient),
    },
    period: { start: values.plannedDate },
    location,
  };
  applyAdmissionDetails(encounter, target, values);
  return encounter;
}

// 予定の location から階層(病棟・病室・ベッド)ごとの 1 件を探す。
function plannedLocationOf(
  encounter: fhir4.Encounter,
  code: string,
): fhir4.EncounterLocation | undefined {
  return encounter.location?.find((entry) =>
    entry.physicalType?.coding?.some(
      (c) => c.system === PHYSICAL_TYPE_SYSTEM && c.code === code,
    ),
  );
}

export function plannedWardId(encounter: fhir4.Encounter): string | undefined {
  return referenceId(plannedLocationOf(encounter, WARD_PHYSICAL_TYPE.code)?.location?.reference);
}

export function plannedRoomId(encounter: fhir4.Encounter): string | undefined {
  return referenceId(plannedLocationOf(encounter, ROOM_PHYSICAL_TYPE.code)?.location?.reference);
}

export function plannedBedId(encounter: fhir4.Encounter): string | undefined {
  return referenceId(plannedLocationOf(encounter, BED_PHYSICAL_TYPE.code)?.location?.reference);
}

export function plannedRoomName(encounter: fhir4.Encounter): string {
  return plannedLocationOf(encounter, ROOM_PHYSICAL_TYPE.code)?.location?.display ?? "-";
}

export function plannedBedName(encounter: fhir4.Encounter): string {
  return plannedLocationOf(encounter, BED_PHYSICAL_TYPE.code)?.location?.display ?? "-";
}

/**
 * 入院実施。予定の Encounter を入院登録と同じ形(in-progress + ベッド 1 件)に
 * 書き換える。診療科・主治医などは実施モーダルの入力で丸ごと置き換える。
 */
export function buildAdmissionFromPlan(
  plan: fhir4.Encounter,
  target: AdmissionTarget,
  values: AdmissionFormValues,
): fhir4.Encounter {
  const encounter: fhir4.Encounter = {
    ...plan,
    status: ADMISSION_STATUS,
    period: { start: encounterDateTime(values.admissionDate) },
    location: [
      {
        location: { reference: `Location/${target.bedId}`, display: target.bedLabel },
        status: "active",
      },
    ],
  };
  applyAdmissionDetails(encounter, target, values);
  return encounter;
}

/** 入院予定の取り消し。誤登録(entered-in-error)ではなく cancelled にする。 */
export function buildPlanCancelledEncounter(encounter: fhir4.Encounter): fhir4.Encounter {
  return { ...encounter, status: PLAN_CANCELLED_STATUS };
}

// ---- 転室・転床 ----

export interface BedTransferValues {
  /** 転室・転床日(YYYY-MM-DD)。 */
  date: string;
  roomId: string;
  bedId: string;
}

export function validateBedTransfer(
  encounter: fhir4.Encounter,
  values: BedTransferValues,
): string | null {
  if (!values.date) return "転室・転床日は必須です。";
  const admission = encounter.period?.start?.slice(0, 10);
  if (admission && values.date < admission) {
    return `転室・転床日は入院日(${admission})より前にはできません。`;
  }
  if (!values.bedId) return "移動先のベッドは必須です。";
  return null;
}

/**
 * 転室・転床。一覧は location[0] を今のベッドとして読むので、移動先を先頭に置き、
 * それまでのベッドは status=completed + period.end で後ろに残す(いつまで
 * どの床に居たかの記録になる)。
 */
export function buildBedTransferEncounter(
  encounter: fhir4.Encounter,
  bedId: string,
  bedLabel: string,
  date: string,
): fhir4.Encounter {
  const past = (encounter.location ?? []).map((entry, index) =>
    index === 0
      ? { ...entry, status: "completed" as const, period: { ...entry.period, end: date } }
      : entry,
  );
  return {
    ...encounter,
    location: [
      {
        location: { reference: `Location/${bedId}`, display: bedLabel },
        status: "active",
        period: { start: date },
      },
      ...past,
    ],
  };
}

// ---- 外出泊 ----
//
// R4 の Encounter に外出泊の置き場が無い(status=onleave はあるが期間・理由を
// 持てず、予定の外出泊も表せない)ので、特記事項と同じくローカル拡張にする。
// 1 回ごとに拡張 1 件で、複数回の外出泊を並べられる。
//
// 開始・終了は日時(valueDateTime)。食事オーダーが「出発までに出た最後の食事で止め、
// 帰院後に出る最初の食事から戻す」ために時刻が要る。時刻を付ける前の valueDate も読める。
// 各外出泊は id(子拡張 `id`)を持ち、食事オーダー側がこの id で結び付く(取消で戻す先を
// 突き止めるため。配列の位置は削除で動くので使わない)。id の無い旧データは、次に
// その入院の外出泊を書き換えるときに採番される。

export const ENCOUNTER_LEAVE_EXTENSION_URL =
  "http://fhir-client.local/StructureDefinition/encounter-leave";

export interface LeaveValues {
  /** 外出泊の id。登録時に採番。旧データでは空のことがある。 */
  id: string;
  /** 外出泊開始日時(YYYY-MM-DDTHH:mm)。旧データは日付だけ。 */
  start: string;
  /** 外出泊終了(帰院)日時。未定なら空。 */
  end: string;
  reason: string;
}

export function validateLeaveForm(values: LeaveValues): string | null {
  if (!values.start) return "外出泊開始日時は必須です。";
  if (values.end && values.end < values.start) {
    return "外出泊終了日時は開始より前にはできません。";
  }
  return null;
}

export function newLeaveId(): string {
  return crypto.randomUUID();
}

function buildLeaveExtension(values: LeaveValues): fhir4.Extension {
  const children: fhir4.Extension[] = [
    { url: "id", valueString: values.id || newLeaveId() },
    { url: "start", valueDateTime: encounterDateTime(values.start) },
  ];
  if (values.end) children.push({ url: "end", valueDateTime: encounterDateTime(values.end) });
  if (values.reason.trim()) children.push({ url: "reason", valueString: values.reason.trim() });
  return { url: ENCOUNTER_LEAVE_EXTENSION_URL, extension: children };
}

/** 外出泊の拡張を丸ごと組み直す(id の無い旧データにも id が付く)。 */
function withLeaves(encounter: fhir4.Encounter, leaves: LeaveValues[]): fhir4.Encounter {
  const rest = (encounter.extension ?? []).filter((e) => e.url !== ENCOUNTER_LEAVE_EXTENSION_URL);
  const extension = [...rest, ...leaves.map(buildLeaveExtension)];
  return { ...encounter, extension: extension.length > 0 ? extension : undefined };
}

/** id の無い外出泊に id を付けて返す(書き込みの前に呼ぶ)。 */
export function leavesWithIds(encounter: fhir4.Encounter): LeaveValues[] {
  return encounterLeaves(encounter).map((leave) => ({ ...leave, id: leave.id || newLeaveId() }));
}

export function buildLeaveAddedEncounter(
  encounter: fhir4.Encounter,
  values: LeaveValues,
): fhir4.Encounter {
  return withLeaves(encounter, [...leavesWithIds(encounter), values]);
}

/** id の外出泊を取り除く。 */
export function buildLeaveRemovedEncounter(
  encounter: fhir4.Encounter,
  leaveId: string,
): fhir4.Encounter {
  return withLeaves(
    encounter,
    leavesWithIds(encounter).filter((leave) => leave.id !== leaveId),
  );
}

export function validateLeaveReturn(leave: LeaveValues, returnAt: string): string | null {
  if (!returnAt) return "帰院日時は必須です。";
  if (returnAt < leave.start) {
    return `帰院日時は外出泊開始(${leave.start.replace("T", " ")})より前にはできません。`;
  }
  return null;
}

/**
 * 帰院。id の外出泊の終了を、実際に戻った日時で確定する。外出泊が終わったことは
 * 終了そのもので表すので、別の目印は持たない。
 */
export function buildLeaveReturnedEncounter(
  encounter: fhir4.Encounter,
  leaveId: string,
  returnAt: string,
): fhir4.Encounter {
  return withLeaves(
    encounter,
    leavesWithIds(encounter).map((leave) =>
      leave.id === leaveId ? { ...leave, end: returnAt } : leave,
    ),
  );
}

/** 拡張の date / dateTime を画面の形(YYYY-MM-DD または YYYY-MM-DDTHH:mm)にする。 */
function leaveInputValue(child: fhir4.Extension | undefined): string {
  if (!child) return "";
  if (child.valueDateTime) return child.valueDateTime.slice(0, 16);
  return child.valueDate ?? "";
}

export function encounterLeaves(encounter: fhir4.Encounter): LeaveValues[] {
  return (encounter.extension ?? [])
    .filter((e) => e.url === ENCOUNTER_LEAVE_EXTENSION_URL)
    .map((e) => ({
      id: e.extension?.find((c) => c.url === "id")?.valueString ?? "",
      start: leaveInputValue(e.extension?.find((c) => c.url === "start")),
      end: leaveInputValue(e.extension?.find((c) => c.url === "end")),
      reason: e.extension?.find((c) => c.url === "reason")?.valueString ?? "",
    }));
}

// ---- 転科・転棟予定 ----
//
// 「いつ・どこへ・どの科で移る予定か」のメモ。これも R4 に置き場が無いので
// ローカル拡張。予定は 1 件だけ持ち、登録し直すと置き換わる。

export const TRANSFER_PLAN_EXTENSION_URL =
  "http://fhir-client.local/StructureDefinition/encounter-transfer-plan";

export interface TransferPlan {
  /** 転科・転棟予定日(YYYY-MM-DD)。必須。 */
  date: string;
  /** 移動先の病棟。必須。 */
  wardId: string;
  wardName: string;
  roomId: string;
  roomName: string;
  bedId: string;
  bedName: string;
  departmentId: string;
  departmentName: string;
}

export function validateTransferPlan(plan: TransferPlan): string | null {
  if (!plan.date) return "転科・転棟予定日は必須です。";
  if (!plan.wardId) return "移動先の病棟は必須です。";
  return null;
}

function referenceChild(url: string, resourceType: string, id: string, display: string): fhir4.Extension {
  return { url, valueReference: { reference: `${resourceType}/${id}`, display } };
}

/** 転科・転棟予定を書き込む。plan が null なら予定を取り消す(拡張を外す)。 */
export function buildTransferPlanEncounter(
  encounter: fhir4.Encounter,
  plan: TransferPlan | null,
): fhir4.Encounter {
  let next: fhir4.Extension | null = null;
  if (plan) {
    const children: fhir4.Extension[] = [
      { url: "date", valueDate: plan.date },
      referenceChild("ward", "Location", plan.wardId, plan.wardName),
    ];
    if (plan.roomId) children.push(referenceChild("room", "Location", plan.roomId, plan.roomName));
    if (plan.bedId) children.push(referenceChild("bed", "Location", plan.bedId, plan.bedName));
    if (plan.departmentId) {
      children.push(
        referenceChild("department", "Organization", plan.departmentId, plan.departmentName),
      );
    }
    next = { url: TRANSFER_PLAN_EXTENSION_URL, extension: children };
  }
  return {
    ...encounter,
    extension: withReplacedExtension(encounter.extension, TRANSFER_PLAN_EXTENSION_URL, next),
  };
}

export function validateTransferExecute(
  encounter: fhir4.Encounter,
  date: string,
  bedId: string,
): string | null {
  if (!date) return "転科・転棟日は必須です。";
  const admission = encounter.period?.start?.slice(0, 10);
  if (admission && date < admission) {
    return `転科・転棟日は入院日(${admission})より前にはできません。`;
  }
  if (!bedId) return "移動先のベッドは必須です。";
  return null;
}

/**
 * 転科・転棟の実施。移動先の床へ移し(転室・転床と同じ組み方)、指定があれば
 * 診療科も移す。済んだ予定は残さない。
 */
export function buildTransferExecutedEncounter(
  encounter: fhir4.Encounter,
  target: { bedId: string; bedLabel: string; departmentId: string; departmentName: string },
  date: string,
): fhir4.Encounter {
  const moved = buildBedTransferEncounter(encounter, target.bedId, target.bedLabel, date);
  if (target.departmentId) {
    moved.serviceProvider = {
      reference: `Organization/${target.departmentId}`,
      display: target.departmentName,
    };
  }
  return buildTransferPlanEncounter(moved, null);
}

export function encounterTransferPlan(encounter: fhir4.Encounter): TransferPlan | undefined {
  const found = encounter.extension?.find((e) => e.url === TRANSFER_PLAN_EXTENSION_URL);
  if (!found) return undefined;
  const child = (url: string) => found.extension?.find((c) => c.url === url);
  const ref = (url: string) => ({
    id: referenceId(child(url)?.valueReference?.reference) ?? "",
    name: child(url)?.valueReference?.display ?? "",
  });
  const ward = ref("ward");
  const room = ref("room");
  const bed = ref("bed");
  const department = ref("department");
  return {
    date: child("date")?.valueDate ?? "",
    wardId: ward.id,
    wardName: ward.name,
    roomId: room.id,
    roomName: room.name,
    bedId: bed.id,
    bedName: bed.name,
    departmentId: department.id,
    departmentName: department.name,
  };
}

// ---- 退院予定 ----
//
// 退院予定日と理由のメモ。転科・転棟予定と同じくローカル拡張で 1 件だけ持つ。

export const DISCHARGE_PLAN_EXTENSION_URL =
  "http://fhir-client.local/StructureDefinition/encounter-discharge-plan";

export interface DischargePlan {
  /** 退院予定日時(YYYY-MM-DDTHH:mm)。必須。時刻を付ける前のデータは日付だけ。 */
  at: string;
  reason: string;
}

export function validateDischargePlan(
  encounter: fhir4.Encounter,
  plan: DischargePlan,
): string | null {
  if (!plan.at) return "退院予定日時は必須です。";
  const admission = encounter.period?.start?.slice(0, 10);
  if (admission && plan.at.slice(0, 10) < admission) {
    return `退院予定日は入院日(${admission})より前にはできません。`;
  }
  return null;
}

/** 退院予定を書き込む。plan が null なら予定を取り消す(拡張を外す)。 */
export function buildDischargePlanEncounter(
  encounter: fhir4.Encounter,
  plan: DischargePlan | null,
): fhir4.Encounter {
  let next: fhir4.Extension | null = null;
  if (plan) {
    const children: fhir4.Extension[] = [
      { url: "date", valueDateTime: encounterDateTime(plan.at) },
    ];
    if (plan.reason.trim()) children.push({ url: "reason", valueString: plan.reason.trim() });
    next = { url: DISCHARGE_PLAN_EXTENSION_URL, extension: children };
  }
  return {
    ...encounter,
    extension: withReplacedExtension(encounter.extension, DISCHARGE_PLAN_EXTENSION_URL, next),
  };
}

export function encounterDischargePlan(encounter: fhir4.Encounter): DischargePlan | undefined {
  const found = encounter.extension?.find((e) => e.url === DISCHARGE_PLAN_EXTENSION_URL);
  if (!found) return undefined;
  const date = found.extension?.find((c) => c.url === "date");
  return {
    at: date?.valueDateTime?.slice(0, 16) ?? date?.valueDate ?? "",
    reason: found.extension?.find((c) => c.url === "reason")?.valueString ?? "",
  };
}

// ---- 入退院・移動のイベント(暦に印を付ける用) ----
//
// 食事カレンダーのように「その日に何があったか」を日付で並べたいとき、Encounter
// 1 件から日付付きのイベントを取り出す。入院日・退院日は period、転室・転床・転棟は
// location の履歴(先頭が今の床、後ろほど古い)、外出泊はローカル拡張から拾う。
// 診療科は今の値しか持たないので、転科はイベントとして取り出せない。
//
// 所在は病棟名だけ出す(暦のマスは狭く、食事の観点では病棟が分かれば足りる)。
// Encounter.location の display はベッドの表示名で病棟を含まないので、ベッド id を
// 持ち帰り、呼び出し側が Location を辿って病棟名に引き直す(withEventWards)。

export type EncounterEventKind =
  | "admission"
  | "discharge"
  | "transfer"
  | "leave-start"
  | "leave-end";

export interface EncounterEvent {
  /** イベントの日(YYYY-MM-DD)。 */
  date: string;
  /**
   * イベントの日時(登録された値そのまま)。時刻を持たない登録では日付だけになる。
   * 暦の印は日で足りるが、経過表の帯は測定日時の列に載せるので時刻まで要る。
   */
  at: string;
  kind: EncounterEventKind;
  /** 「入院」「転床」など、暦の印に出す短い名前。 */
  label: string;
  /** 所在(病棟名)や外出泊の理由など。無ければ空。 */
  detail: string;
  /** 入院・移動先のベッド Location.id。所在を病棟名に引き直すときに使う。 */
  bedId?: string;
  /** 移動元のベッド Location.id(移動のみ)。病棟が変わったか(転棟か転床か)の判定用。 */
  fromBedId?: string;
}

const EVENT_LABELS: Record<EncounterEventKind, string> = {
  admission: "入院",
  discharge: "退院",
  transfer: "転床",
  "leave-start": "外出泊",
  "leave-end": "帰院",
};

export function encounterEvents(encounter: fhir4.Encounter): EncounterEvent[] {
  const events: EncounterEvent[] = [];
  const admissionAt = encounter.period?.start;
  const admission = admissionAt?.slice(0, 10);
  if (admissionAt && admission) {
    // 入院時の床は location の末尾(いちばん古い割り当て)。
    const first = encounter.location?.[encounter.location.length - 1];
    events.push({
      date: admission,
      at: admissionAt,
      kind: "admission",
      label: EVENT_LABELS.admission,
      detail: "",
      bedId: referenceId(first?.location?.reference),
    });
  }

  // 先頭は今の床、後ろほど古い。入院時の割り当て(末尾)以外は移動。同じ日に
  // 2 回動いたときも起きた順に並ぶよう、古い方(末尾側)から拾う。
  const locations = encounter.location ?? [];
  for (let index = locations.length - 2; index >= 0; index -= 1) {
    const entry = locations[index];
    const at = entry.period?.start;
    const date = at?.slice(0, 10);
    if (!at || !date) continue;
    events.push({
      date,
      at,
      kind: "transfer",
      label: EVENT_LABELS.transfer,
      detail: "",
      bedId: referenceId(entry.location?.reference),
      fromBedId: referenceId(locations[index + 1]?.location?.reference),
    });
  }

  for (const leave of encounterLeaves(encounter)) {
    if (leave.start) {
      events.push({
        date: leave.start.slice(0, 10),
        at: leave.start,
        kind: "leave-start",
        label: EVENT_LABELS["leave-start"],
        detail: leave.reason,
      });
    }
    if (leave.end) {
      events.push({
        date: leave.end.slice(0, 10),
        at: leave.end,
        kind: "leave-end",
        label: EVENT_LABELS["leave-end"],
        detail: "",
      });
    }
  }

  if (encounter.status === DISCHARGED_STATUS) {
    const dischargeAt = encounter.period?.end;
    const discharge = dischargeAt?.slice(0, 10);
    if (dischargeAt && discharge) {
      events.push({
        date: discharge,
        at: dischargeAt,
        kind: "discharge",
        label: EVENT_LABELS.discharge,
        detail: "",
      });
    }
  }

  // 同じ日に複数あれば、入院 → 移動 → 外出泊 → 帰院 → 退院 の順に並べる。
  const order: EncounterEventKind[] = ["admission", "transfer", "leave-start", "leave-end", "discharge"];
  return events.sort(
    (a, b) => a.date.localeCompare(b.date) || order.indexOf(a.kind) - order.indexOf(b.kind),
  );
}

/**
 * ベッド id → 病棟名の対応で、入院・移動の所在を病棟名にする。移動は病棟が
 * 変われば「転棟」、同じ病棟なら「転床」に読み替える。
 */
export function withEventWards(
  events: EncounterEvent[],
  wardNameByBed: Map<string, string>,
): EncounterEvent[] {
  return events.map((event) => {
    if (event.kind !== "admission" && event.kind !== "transfer") return event;
    const ward = event.bedId ? (wardNameByBed.get(event.bedId) ?? "") : "";
    if (event.kind === "admission") return { ...event, detail: ward };
    const from = event.fromBedId ? (wardNameByBed.get(event.fromBedId) ?? "") : "";
    const changed = Boolean(ward) && Boolean(from) && ward !== from;
    return { ...event, label: changed ? "転棟" : EVENT_LABELS.transfer, detail: ward };
  });
}
