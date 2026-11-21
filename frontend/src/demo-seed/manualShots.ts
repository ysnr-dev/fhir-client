// 操作マニュアル(別リポジトリ fhir-client-docs)の画面写真に写す、架空の患者・職員・病棟。
//
// 撮影はブラウザの時計を SHOOTING_DATE に固定して行う(開発データの無い日にして、一覧に検証用の
// 患者が写り込まないようにする)。入院などの日付は実行日からの相対ではなく、この日を基準にする。
// fhir-client-docs の shots/lib/session.mjs の撮影日と揃える。
//
// 開発環境専用。既定の全シナリオには入れず、`--only manualShots` で明示したときだけ流す。
// 依頼医師・主治医はログインしたユーザーなので、撮影の医師のアカウントで流す。
// 職員のログインは、環境変数 MANUAL_SHOTS_PASSWORD があるときだけ作る(無ければ医療従事者だけ作る)。

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
import { createPatient, departmentOf, SHOOTING_WARD_NAME, type PatientSpec, type SeedEnv } from "./base";

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
  loginId: string;
}

const STAFF: StaffSpec[] = [
  {
    familyKanji: "薬剤",
    givenKanji: "三郎",
    familyKana: "ヤクザイ",
    givenKana: "サブロウ",
    roleCode: "pharmacist",
    department: "薬剤部",
    loginId: "pharma",
  },
];

const PHYSICAL_TYPE_SYSTEM = "http://terminology.hl7.org/CodeSystem/location-physical-type";

export async function seedManualShots(env: SeedEnv): Promise<void> {
  const selfOrganizationId = (await fetchFacilitySettings()).self_organization_id ?? "";
  for (const staff of STAFF) await ensureStaff(env, staff, selfOrganizationId);
  const beds = await ensureWard(env, selfOrganizationId);

  const outpatient = await createPatient(env, OUTPATIENT);
  if (outpatient?.id) await addDrugAllergy(env, outpatient.id);

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
        practitionerName: env.practitioner.name,
        nurses: [],
      },
      {
        departmentId: department.id,
        practitionerId: env.practitioner.id,
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

/** 同じ氏名の医療従事者がいなければ作る。ログインは MANUAL_SHOTS_PASSWORD があるときだけ作る。 */
async function ensureStaff(env: SeedEnv, staff: StaffSpec, selfOrganizationId: string): Promise<void> {
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

  const password = globalThis.process?.env?.MANUAL_SHOTS_PASSWORD;
  if (!practitionerId || !password) return;
  await upsertLoginAccount({ practitionerId, loginId: staff.loginId, password });
  env.log(`ログイン ${staff.loginId} を設定`);
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
