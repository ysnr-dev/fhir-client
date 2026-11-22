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
import { searchJfagyAllergens } from "../api/masterClient";
import { emptyAdmissionRoute } from "../fhir/admissionRouteHelpers";
import { buildAllergy, emptyAllergyForm } from "../fhir/allergyHelpers";
import { buildAdmissionEncounter } from "../fhir/encounterHelpers";
import {
  buildPractitionerSaveBundle,
  createdPractitionerId,
  emptyPractitionerForm,
} from "../fhir/practitionerHelpers";
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

interface StaffSpec {
  familyKanji: string;
  givenKanji: string;
  familyKana: string;
  givenKana: string;
  roleCode: string;
  department: string;
  /** ログインの ID とパスワードを読む環境変数の役割(SHOTS_<役割>_LOGIN / SHOTS_<役割>_PASSWORD)。 */
  account: string;
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

const STAFF: StaffSpec[] = [
  DOCTOR,
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

export async function seedManualShots(env: SeedEnv): Promise<void> {
  const selfOrganizationId = (await fetchFacilitySettings()).self_organization_id ?? "";
  const staff = [];
  for (const spec of STAFF) staff.push(await ensureStaff(env, spec, selfOrganizationId));
  const doctor = staff[STAFF.indexOf(DOCTOR)];
  const beds = await ensureWard(env, selfOrganizationId);

  const outpatient = await createPatient(env, OUTPATIENT);
  if (outpatient?.id) await addDrugAllergy(env, outpatient.id);
  await ensureOutpatientHistory(env, doctor);

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
