// 操作マニュアル(別リポジトリ fhir-client-docs)の画面写真に写す、架空の患者・職員・病棟。
//
// 撮影はブラウザの時計を SHOOTING_DATE に固定して行う(開発データの無い日にして、一覧に検証用の
// 患者が写り込まないようにする)。入院などの日付は実行日からの相対ではなく、この日を基準にする。
// fhir-client-docs の shots/lib/session.mjs の撮影日と揃える。
//
// 開発環境専用。既定の全シナリオには入れず、`--only manualShots` で明示したときだけ流す。
// 主治医は撮影の医師(医師 四郎)にする。開発の検証に使う医師は通知やホームの設定を持っていて写真に写るので、
// 撮影の医師はこのシナリオで作った、ほかで使わないアカウントにする。流すアカウントは医療従事者なら誰でもよい。
// 職員のログインは、fhir-client-docs の .env の SHOTS_<役割>_LOGIN / SHOTS_<役割>_PASSWORD が環境変数にあるときだけ作る
// (無ければ医療従事者だけ作る)。

import { upsertLoginAccount } from "../api/authClient";
import { fetchFacilitySettings } from "../api/facilityClient";
import { createResource, postBundle, searchResource } from "../api/fhirClient";
import {
  createSupervisorGroup,
  createSupervisorGroupMember,
  fetchSupervisorGroups,
  holidayClient,
  searchJfagyAllergens,
} from "../api/masterClient";
import { emptyAdmissionRoute } from "../fhir/admissionRouteHelpers";
import { buildAllergy, emptyAllergyForm } from "../fhir/allergyHelpers";
import { buildAdmissionEncounter } from "../fhir/encounterHelpers";
import {
  buildPractitionerSaveBundle,
  createdPractitionerId,
  emptyPractitionerForm,
  type TraineeLevel,
} from "../fhir/practitionerHelpers";
import {
  buildSchedule,
  buildSlotCreateBundle,
  emptyScheduleForm,
  generateSlots,
  isWithinHorizon,
  scheduleName,
  serviceTypeCode,
  slotPatternOf,
  type SlotPattern,
} from "../fhir/scheduleHelpers";
import {
  BED_PHYSICAL_TYPE,
  WARD_PHYSICAL_TYPE,
  bedDisplayName,
  bedNumber,
  buildRoomSaveBundle,
  buildWard,
  emptyRoomForm,
  emptyWardForm,
} from "../fhir/wardHelpers";
import { addDays } from "../lib/dates";
import {
  at,
  createPatient,
  createProblem,
  departmentOf,
  DrugMaster,
  findDisease,
  LabMaster,
  labResultBundle,
  post,
  prescriptionBundle,
  requesterOf,
  SHOOTING_WARD_NAME,
  vitalEntries,
  type Named,
  type PatientSpec,
  type SeedEnv,
} from "./base";

export const SHOOTING_DATE = "2027-02-01";

const ROOM_NAME = "101";
const BED_COUNT = 2;

const OUTPATIENT: PatientSpec = {
  familyKanji: "見本",
  givenKanji: "花子",
  familyKana: "ミホン",
  givenKana: "ハナコ",
  gender: "female",
  birthDate: "1972-04-10",
};

const INPATIENT: PatientSpec = {
  familyKanji: "見本",
  givenKanji: "太郎",
  familyKana: "ミホン",
  givenKana: "タロウ",
  gender: "male",
  birthDate: "1958-09-03",
};

// 化学療法の写真に使う外来の患者。結腸癌で、撮影日にレジメンを適用する(適用はシーンが画面で行う)。
const CHEMO_PATIENT: PatientSpec = {
  familyKanji: "見本",
  givenKanji: "次郎",
  familyKana: "ミホン",
  givenKana: "ジロウ",
  gender: "male",
  birthDate: "1963-06-15",
};

// 適用の体格と、投与前チェック(白血球・血小板・総ビリルビン・クレアチニン)に使う撮影日の 2 日前の測定。
const CHEMO_WORKUP_DAYS_BEFORE = 2;
const CHEMO_VITALS = { height: 168, weight: 62.5, systolic: 128, diastolic: 78, pulse: 70 };
const CHEMO_LABS: [code: string, value: number][] = [
  ["160008010-01", 5.6],
  ["160008010-05", 218],
  ["160017010", 0.6],
  ["160019210", 0.82],
];

// 入院の見本 太郎の入院時の測定(食事の熱量の目安や看護の写真に使う)。
const INPATIENT_ADMISSION_VITALS = { height: 170, weight: 64.2, systolic: 132, diastolic: 80, pulse: 74, temperature: 36.8, spo2: 97 };

interface StaffSpec {
  familyKanji: string;
  givenKanji: string;
  familyKana: string;
  givenKana: string;
  roleCode: string;
  department: string;
  /** ログインの ID とパスワードを読む環境変数の役割(SHOTS_<役割>_LOGIN / SHOTS_<役割>_PASSWORD)。 */
  account: string;
  /** 研修区分。研修医は指導医のカウンターサインの対象になる。 */
  traineeLevel?: TraineeLevel;
}

const DOCTOR: StaffSpec = {
  familyKanji: "医師",
  givenKanji: "四郎",
  familyKana: "イシ",
  givenKana: "シロウ",
  roleCode: "doctor",
  department: "内科",
  account: "DOCTOR",
};

const RESIDENT: StaffSpec = {
  familyKanji: "研修",
  givenKanji: "五郎",
  familyKana: "ケンシュウ",
  givenKana: "ゴロウ",
  roleCode: "doctor",
  department: "内科",
  account: "RESIDENT",
  traineeLevel: "resident",
};

// 研修医のカルテ承認の写真に使う。指導医は撮影の医師。
const SUPERVISOR_GROUP_NAME = "見本 内科研修";

const STAFF: StaffSpec[] = [
  DOCTOR,
  RESIDENT,
  {
    familyKanji: "薬剤",
    givenKanji: "三郎",
    familyKana: "ヤクザイ",
    givenKana: "サブロウ",
    roleCode: "pharmacist",
    department: "薬剤部",
    account: "PHARMACIST",
  },
];

// 外来の見本 花子の受診歴(カルテの見方の写真に使う)。高血圧症で 4 週ごとに通い、アムロジピンを出している。
const AMLODIPINE_5MG = "620007818";
const AFTER_BREAKFAST = "１日１回朝食後　服用";
const OUTPATIENT_VISITS = [
  { daysBefore: 56, systolic: 148, diastolic: 92, pulse: 76, weight: 58.4 },
  { daysBefore: 28, systolic: 136, diastolic: 84, pulse: 72, weight: 58.1 },
];

const PHYSICAL_TYPE_SYSTEM = "http://terminology.hl7.org/CodeSystem/location-physical-type";

// 撮影の医師の診察予約の枠。平日午前の 15 分枠で、撮影日から 8 週ぶん。
const SCHEDULE_NAME = "内科 午前";
const SCHEDULE_PATTERN: SlotPattern = {
  weekdays: [1, 2, 3, 4, 5],
  blocks: [{ start: "09:00", end: "12:00" }],
  durationMinutes: 15,
  capacity: 1,
};
const SCHEDULE_WEEKS = 8;

// 部門の予約(検査・リハビリ・栄養指導・透析)の写真に使う枠。開発環境の部門の枠表に、撮影日から 4 週ぶんの枠を足す。
const DEPARTMENT_SERVICE_TYPES = ["exam", "rehab", "nutrition-guidance", "dialysis"];
const DEPARTMENT_SLOT_WEEKS = 4;

export async function seedManualShots(env: SeedEnv): Promise<void> {
  const selfOrganizationId = (await fetchFacilitySettings()).self_organization_id ?? "";
  const staff = [];
  for (const spec of STAFF) staff.push(await ensureStaff(env, spec, selfOrganizationId));
  const doctor = staff[STAFF.indexOf(DOCTOR)];
  await ensureSupervisorGroup(env, doctor, staff[STAFF.indexOf(RESIDENT)]);
  const beds = await ensureWard(env, selfOrganizationId);
  await ensureDoctorSchedule(env, doctor);
  await ensureDepartmentSlots(env);

  const outpatient = await createPatient(env, OUTPATIENT);
  if (outpatient?.id) await addDrugAllergy(env, outpatient.id);
  await ensureOutpatientHistory(env, doctor);

  await createPatient(env, CHEMO_PATIENT);
  await ensureChemoWorkup(env, doctor);

  const inpatient = await createPatient(env, INPATIENT);
  if (inpatient?.id) {
    const bed = beds[0];
    const department = departmentOf(env, "内科");
    const encounter = buildAdmissionEncounter(
      inpatient,
      {
        bedId: bed.id,
        bedLabel: bed.label,
        departmentName: department.name,
        practitionerName: doctor.name,
        nurses: [],
      },
      {
        departmentId: department.id,
        practitionerId: doctor.id,
        nurseIds: [],
        admissionDate: `${addDays(SHOOTING_DATE, -4)}T10:00`,
        note: "",
        route: emptyAdmissionRoute(),
      },
    );
    await createResource(encounter);
    env.log(`${INPATIENT.familyKanji} ${INPATIENT.givenKanji} を ${bed.label} に入院(${addDays(SHOOTING_DATE, -4)}〜)`);
  }
  await ensureInpatientRecords(env);
}

/** 氏名と生年月日で登録済みの患者を引く。 */
async function findPatient(spec: PatientSpec): Promise<fhir4.Patient | undefined> {
  const { data } = await searchResource<fhir4.Patient>(
    "Patient",
    new URLSearchParams({ family: spec.familyKanji, given: spec.givenKanji, birthdate: spec.birthDate }),
  );
  return (data.entry ?? [])
    .map((entry) => entry.resource)
    .find(
      (p) =>
        p?.birthDate === spec.birthDate &&
        p.name?.some((n) => n.family === spec.familyKanji && n.given?.includes(spec.givenKanji)),
    );
}

/** 外来の患者の病名と受診歴。プロブレムがまだ無いときだけ作る。依頼医師は撮影の医師。 */
async function ensureOutpatientHistory(env: SeedEnv, doctor: Named): Promise<void> {
  const patient = await findPatient(OUTPATIENT);
  if (!patient?.id) return;
  const { data } = await searchResource<fhir4.Condition>("Condition", new URLSearchParams({ patient: patient.id }));
  if (data.entry?.length) {
    env.log(`${OUTPATIENT.familyKanji} ${OUTPATIENT.givenKanji} は病名があるので受診歴を作りません`);
    return;
  }
  const department = departmentOf(env, "内科");
  const requester = requesterOf(env, department, doctor);
  const drugs = new DrugMaster();
  await drugs.load([AMLODIPINE_5MG], [AFTER_BREAKFAST]);
  const firstVisit = addDays(SHOOTING_DATE, -OUTPATIENT_VISITS[0].daysBefore);
  const hypertension = await createProblem(patient.id, 1, {
    disease: await findDisease("高血圧症"),
    start: firstVisit,
  });
  for (const visit of OUTPATIENT_VISITS) {
    const date = addDays(SHOOTING_DATE, -visit.daysBefore);
    const rx = prescriptionBundle(
      drugs,
      patient.id,
      requester,
      date,
      [{ usage: AFTER_BREAKFAST, days: 28, medicines: [[AMLODIPINE_5MG, 1]] }],
      hypertension,
    );
    const { daysBefore: _, ...values } = visit;
    await post({
      resourceType: "Bundle",
      type: "transaction",
      entry: [...(rx.entry ?? []), ...vitalEntries(patient.id, department, at(date, "09:30"), values)],
    });
  }
  env.log(`${OUTPATIENT.familyKanji} ${OUTPATIENT.givenKanji} に高血圧症と受診 ${OUTPATIENT_VISITS.length} 回を登録`);
}

/** 化学療法の患者の病名と、適用前の体格・検査値。プロブレムがまだ無いときだけ作る。 */
async function ensureChemoWorkup(env: SeedEnv, doctor: Named): Promise<void> {
  const patient = await findPatient(CHEMO_PATIENT);
  if (!patient?.id) return;
  const name = `${CHEMO_PATIENT.familyKanji} ${CHEMO_PATIENT.givenKanji}`;
  const { data } = await searchResource<fhir4.Condition>("Condition", new URLSearchParams({ patient: patient.id }));
  if (data.entry?.length) {
    env.log(`${name} は病名があるので体格と検査値を作りません`);
    return;
  }
  const department = departmentOf(env, "内科");
  const date = addDays(SHOOTING_DATE, -CHEMO_WORKUP_DAYS_BEFORE);
  await createProblem(patient.id, 1, { disease: await findDisease("結腸癌"), start: addDays(SHOOTING_DATE, -42) });
  const labs = new LabMaster();
  await labs.load(CHEMO_LABS.map(([code]) => code));
  const labBundle = labResultBundle({ ...env, practitioner: doctor }, labs, patient, department, date, CHEMO_LABS);
  await post({
    resourceType: "Bundle",
    type: "transaction",
    entry: [...(labBundle?.entry ?? []), ...vitalEntries(patient.id, department, at(date, "09:30"), CHEMO_VITALS)],
  });
  env.log(`${name} に結腸癌と ${date} の体格・検査値を登録`);
}

/**
 * 入院の患者の病名(早期胃癌。胃 ESD のクリニカルパスの対象病名)と、入院時の身長・体重・バイタル。
 * それぞれ、まだ無いときだけ作る。
 */
async function ensureInpatientRecords(env: SeedEnv): Promise<void> {
  const patient = await findPatient(INPATIENT);
  if (!patient?.id) return;
  const name = `${INPATIENT.familyKanji} ${INPATIENT.givenKanji}`;
  const { data: conditions } = await searchResource<fhir4.Condition>(
    "Condition",
    new URLSearchParams({ patient: patient.id, _summary: "count" }),
  );
  if (!conditions.total) {
    await createProblem(patient.id, 1, { disease: await findDisease("早期胃癌"), start: addDays(SHOOTING_DATE, -18) });
    env.log(`${name} に早期胃癌を登録`);
  }
  const { data } = await searchResource<fhir4.Observation>(
    "Observation",
    new URLSearchParams({ patient: patient.id, category: "vital-signs", _summary: "count" }),
  );
  if (data.total) {
    env.log(`${name} は測定があるので入院時のバイタルを作りません`);
    return;
  }
  const department = departmentOf(env, "内科");
  const dateTime = at(addDays(SHOOTING_DATE, -4), "11:00");
  await post({ resourceType: "Bundle", type: "transaction", entry: vitalEntries(patient.id, department, dateTime, INPATIENT_ADMISSION_VITALS) });
  env.log(`${name} に入院時の身長・体重・バイタルを登録`);
}

/** 外来の患者の薬剤アレルギー(処方の警告の写真に使う)。 */
async function addDrugAllergy(env: SeedEnv, patientId: string): Promise<void> {
  const { items } = await searchJfagyAllergens({ name: "ロキソプロフェンナトリウム水和物", domain: "M", per: 5 });
  const allergen = items.find((item) => item.name === "ロキソプロフェンナトリウム水和物") ?? items[0];
  if (!allergen) {
    env.log("アレルゲン「ロキソプロフェンナトリウム水和物」がマスタに無いので、アレルギーは作りません");
    return;
  }
  const values = {
    ...emptyAllergyForm(),
    allergen,
    criticality: "high" as const,
    recordedDate: addDays(SHOOTING_DATE, -90),
    reaction: "蕁麻疹",
  };
  await createResource(buildAllergy(values, patientId));
  env.log(`薬剤アレルギー ${allergen.name} を登録`);
}

/** 同じ氏名の医療従事者がいなければ作る。ログインは環境変数に ID とパスワードがあるときだけ作る。 */
async function ensureStaff(env: SeedEnv, staff: StaffSpec, selfOrganizationId: string): Promise<Named> {
  const { data } = await searchResource<fhir4.Practitioner>(
    "Practitioner",
    new URLSearchParams({ family: staff.familyKanji, given: staff.givenKanji }),
  );
  const existing = (data.entry ?? [])
    .map((entry) => entry.resource)
    .find((p) => p?.name?.some((n) => n.family === staff.familyKanji && n.given?.includes(staff.givenKanji)));
  let practitionerId = existing?.id;
  if (practitionerId) {
    env.log(`${staff.familyKanji} ${staff.givenKanji} は登録済みなので作りません`);
  } else {
    const department = departmentOf(env, staff.department);
    const bundle = buildPractitionerSaveBundle({
      values: {
        ...emptyPractitionerForm,
        familyKanji: staff.familyKanji,
        givenKanji: staff.givenKanji,
        familyKana: staff.familyKana,
        givenKana: staff.givenKana,
        roleCode: staff.roleCode,
        traineeLevel: staff.traineeLevel ?? "",
        organizationId: selfOrganizationId,
        departments: [{ organizationId: department.id, name: department.name, code: department.code, primary: true }],
      },
    });
    const { data: response } = await postBundle(bundle);
    practitionerId = createdPractitionerId(response);
    env.log(`医療従事者 ${staff.familyKanji} ${staff.givenKanji}(${department.name})を作成`);
  }

  if (!practitionerId) throw new Error(`${staff.familyKanji} ${staff.givenKanji} を作れませんでした`);
  const variables = globalThis.process?.env ?? {};
  const loginId = variables[`SHOTS_${staff.account}_LOGIN`];
  const password = variables[`SHOTS_${staff.account}_PASSWORD`];
  // 流しているアカウント自身は設定し直さない(パスワードを入れ直すとセッションが切れる)。
  if (loginId && password && practitionerId !== env.practitioner.id) {
    await upsertLoginAccount({ practitionerId, loginId, password });
    env.log(`ログイン ${loginId} を設定`);
  }
  return { id: practitionerId, name: `${staff.familyKanji} ${staff.givenKanji}` };
}

/** 撮影の医師を指導医、研修医を研修医にした指導医グループ。同じ名前のグループがあれば足りないメンバーだけ足す。 */
async function ensureSupervisorGroup(env: SeedEnv, supervisor: Named, trainee: Named): Promise<void> {
  let group = (await fetchSupervisorGroups()).find((g) => g.name === SUPERVISOR_GROUP_NAME);
  if (!group) {
    group = await createSupervisorGroup({ name: SUPERVISOR_GROUP_NAME });
    env.log(`指導医グループ ${SUPERVISOR_GROUP_NAME} を作成`);
  }
  for (const [member, role] of [
    [supervisor, "supervisor"],
    [trainee, "trainee"],
  ] as const) {
    if (group.members.some((m) => m.practitioner_fhir_id === member.id)) continue;
    await createSupervisorGroupMember({
      supervisor_group_id: group.id,
      practitioner_fhir_id: member.id,
      display_name: member.name,
      role,
    });
    env.log(`${SUPERVISOR_GROUP_NAME} に ${member.name} を追加`);
  }
}

/**
 * 撮影の医師の診察予約の枠表と枠(予約の写真に使う)。枠表が無ければ作り、撮影日から SCHEDULE_WEEKS 週の枠を
 * 足りない分だけ作る(祝日・休診日には作らない)。予約の担当医の選択肢にほかの医師の枠表を写さないため、撮影の医師の枠表を持たせる。
 */
async function ensureDoctorSchedule(env: SeedEnv, doctor: Named): Promise<void> {
  const department = departmentOf(env, "内科");
  const { data } = await searchResource<fhir4.Schedule>(
    "Schedule",
    new URLSearchParams({ actor: `Practitioner/${doctor.id}` }),
  );
  let schedule = (data.entry ?? [])
    .map((entry) => entry.resource)
    .find((s) => s?.resourceType === "Schedule" && scheduleName(s) === SCHEDULE_NAME);
  if (!schedule) {
    const { data: created } = await createResource(
      buildSchedule(
        {
          ...emptyScheduleForm,
          name: SCHEDULE_NAME,
          practitionerId: doctor.id,
          departmentCode: department.code,
          departmentName: department.name,
          pattern: SCHEDULE_PATTERN,
        },
        { practitioner: doctor.name },
      ),
    );
    schedule = created;
    env.log(`予約枠表 ${SCHEDULE_NAME} を作成`);
  }
  await ensureSlots(env, schedule, SCHEDULE_PATTERN, SCHEDULE_WEEKS);
}

/** 部門の枠表(枠のパターンを持つもの)に、撮影日から DEPARTMENT_SLOT_WEEKS 週の枠を足りない分だけ作る。 */
async function ensureDepartmentSlots(env: SeedEnv): Promise<void> {
  const { data } = await searchResource<fhir4.Schedule>(
    "Schedule",
    new URLSearchParams({ "service-type": DEPARTMENT_SERVICE_TYPES.join(","), active: "true", _count: "100" }),
  );
  const schedules = (data.entry ?? [])
    .map((entry) => entry.resource)
    .filter((s): s is fhir4.Schedule => s?.resourceType === "Schedule")
    .filter((s) => s.active !== false && DEPARTMENT_SERVICE_TYPES.includes(serviceTypeCode(s)))
    .filter((s) => isWithinHorizon(s, SHOOTING_DATE));
  for (const schedule of schedules) {
    const pattern = slotPatternOf(schedule);
    if (pattern) await ensureSlots(env, schedule, pattern, DEPARTMENT_SLOT_WEEKS);
  }
}

/** 枠表に、撮影日から weeks 週の枠を足りない分だけ作る(祝日・休診日には作らない)。 */
async function ensureSlots(env: SeedEnv, schedule: fhir4.Schedule, pattern: SlotPattern, weeks: number): Promise<void> {
  const scheduleId = schedule.id ?? "";
  const range = { from: SHOOTING_DATE, to: addDays(SHOOTING_DATE, weeks * 7 - 1) };
  const { data: existing } = await searchResource<fhir4.Slot>(
    "Slot",
    new URLSearchParams([
      ["schedule", `Schedule/${scheduleId}`],
      ["start", `ge${range.from}`],
      ["start", `lt${addDays(range.to, 1)}`],
      ["_count", "500"],
    ]),
  );
  const existingSlots = (existing.entry ?? [])
    .map((entry) => entry.resource)
    .filter((r): r is fhir4.Slot => r?.resourceType === "Slot");
  const closedDays = new Map((await holidayClient.search(range.from, range.to)).map((h) => [h.holiday_date, h]));
  const slots = generateSlots(scheduleId, pattern, range, existingSlots, closedDays);
  for (let i = 0; i < slots.length; i += 200) await post(buildSlotCreateBundle(slots.slice(i, i + 200)));
  if (slots.length) env.log(`${scheduleName(schedule)}: 予約枠 ${slots.length} 件を作成(${range.from}〜${range.to})`);
}

/** 撮影用の病棟・病室・ベッド。同じ名前の病棟があればそれを使う。ベッドを番号順に返す。 */
async function ensureWard(
  env: SeedEnv,
  selfOrganizationId: string,
): Promise<{ id: string; label: string }[]> {
  const locations = async (params: Record<string, string>) => {
    const { data } = await searchResource<fhir4.Location>("Location", new URLSearchParams({ _count: "100", ...params }));
    return (data.entry ?? []).map((entry) => entry.resource).filter((r): r is fhir4.Location => Boolean(r));
  };
  const isPhysical = (location: fhir4.Location, code: string) =>
    location.physicalType?.coding?.some((c) => c.system === PHYSICAL_TYPE_SYSTEM && c.code === code) ?? false;

  let ward = (await locations({ name: SHOOTING_WARD_NAME })).find(
    (l) => l.name === SHOOTING_WARD_NAME && isPhysical(l, WARD_PHYSICAL_TYPE.code),
  );
  if (!ward) {
    const { data } = await createResource(
      buildWard({ ...emptyWardForm, name: SHOOTING_WARD_NAME, managingOrganizationId: selfOrganizationId }),
    );
    ward = data;
    env.log(`病棟 ${SHOOTING_WARD_NAME} を作成`);
  }
  const wardId = ward.id ?? "";

  let room = (await locations({ partof: `Location/${wardId}` })).find((l) => l.name === ROOM_NAME);
  if (!room) {
    await postBundle(
      buildRoomSaveBundle({
        values: { ...emptyRoomForm, name: ROOM_NAME, bedCount: String(BED_COUNT), managingOrganizationId: selfOrganizationId },
        wardId,
      }),
    );
    room = (await locations({ partof: `Location/${wardId}` })).find((l) => l.name === ROOM_NAME);
    env.log(`病室 ${ROOM_NAME}(${BED_COUNT} 床)を作成`);
  }
  if (!room?.id) throw new Error(`病室 ${ROOM_NAME} を作れませんでした`);

  const beds = (await locations({ partof: `Location/${room.id}` }))
    .filter((l) => isPhysical(l, BED_PHYSICAL_TYPE.code))
    .sort((a, b) => (bedNumber(a) ?? 0) - (bedNumber(b) ?? 0));
  if (beds.length === 0) throw new Error(`病室 ${ROOM_NAME} にベッドがありません`);
  return beds.map((bed) => ({ id: bed.id ?? "", label: bedDisplayName(bed, ROOM_NAME) }));
}
